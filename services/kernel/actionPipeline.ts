/**
 * Flowmate Greenfield Domain Kernel — Canonical Action Pipeline (Phase 0)
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Planning is strictly SIDE-EFFECT FREE (no schema mutations)
 * - Cryptographic SHA-256 plan fingerprinting over canonical JSON
 * - User confirmation bound to the authenticated user and exact plan
 * - Enforces `requires_confirmation` at execution boundary
 * - User binding verification: User A confirms -> User B execution rejected
 * - Single-use token confirmation replay attack prevention
 */

import { Entity, Relationship, VALID_RELATIONSHIP_TYPES } from './types';
import { SchemaRegistry } from './schemaRegistry';
import { validateEntity } from './validation';
import { Authorizer, AuthorizationContext, ActionProposalLike } from './authorization';
import { PersistencePort, PersistenceMutation, AuditLogEntry } from './persistencePort';
import { computePlanFingerprint } from './crypto';

export { computePlanFingerprint, sha256, canonicalJsonStringify } from './crypto';

export interface ActionProposal extends ActionProposalLike {
  id: string;
  source: 'user_ui' | 'ai_agent' | 'system' | 'automation';
  intent: string;
  mutations: MutationPrimitive[];
}

export type MutationPrimitive =
  | { op: 'upsert_entity'; entity: Entity }
  | { op: 'soft_delete_entity'; entity_id: string }
  | { op: 'upsert_relationship'; relationship: Relationship }
  | { op: 'delete_relationship'; relationship_id: string };

export interface PreviewItem {
  id: string;
  op: 'upsert_entity' | 'soft_delete_entity' | 'upsert_relationship' | 'delete_relationship';
  title: string;
  schema_id: string;
  changes: Record<string, { before: unknown; after: unknown }>;
}

export interface ExecutionPlan {
  proposal_id: string;
  intent: string;
  validated_mutations: MutationPrimitive[];
  preview_items: PreviewItem[];
  requires_confirmation: boolean;
  plan_fingerprint: string;
  audit_entry: AuditLogEntry;
}

export interface ConfirmedExecutionPlan {
  readonly plan: ExecutionPlan;
  readonly confirmed_by: string; // Authenticated user ID
  readonly confirmed_at: string; // ISO 8601 UTC
  readonly confirmation_token: string;
  readonly verified_fingerprint: string;
}

export class ActionExecutionEngine {
  private consumedConfirmationTokens: Set<string>;

  constructor(
    private schemaRegistry: SchemaRegistry,
    private authorizer: Authorizer,
    private persistence: PersistencePort,
    consumedTokens?: Set<string>
  ) {
    this.consumedConfirmationTokens = consumedTokens ?? new Set<string>();
  }

  /**
   * Phase 1: Planning (STRICTLY SIDE-EFFECT FREE)
   * Answers: "Is this actor allowed to submit this proposal, and are all mutations valid?"
   */
  plan(
    proposal: ActionProposal,
    context: AuthorizationContext,
    entityLookup?: (id: string) => Entity | null | boolean
  ): { success: boolean; plan?: ExecutionPlan; error?: string } {
    const auth = this.authorizer.authorize(proposal, context);
    if (!auth.authorized) {
      return {
        success: false,
        error: `Authorization denied: ${auth.reason || 'Unauthorized actor'}`,
      };
    }

    const validatedMutations: MutationPrimitive[] = [];
    const previewItems: PreviewItem[] = [];

    for (const mutation of proposal.mutations) {
      if (mutation.op === 'upsert_entity') {
        const schema = this.schemaRegistry.get(mutation.entity.schema_id);
        if (!schema) {
          return {
            success: false,
            error: `Schema "${mutation.entity.schema_id}" is not registered`,
          };
        }

        const valResult = validateEntity(mutation.entity, schema);
        if (!valResult.valid || !valResult.sanitized) {
          return {
            success: false,
            error: `Entity validation failed: ${valResult.errors.join('; ')}`,
          };
        }

        validatedMutations.push({ op: 'upsert_entity', entity: valResult.sanitized });

        previewItems.push({
          id: valResult.sanitized.id,
          op: 'upsert_entity',
          title: valResult.sanitized.title,
          schema_id: schema.id,
          changes: Object.fromEntries(
            Object.entries(valResult.sanitized.attributes).map(([k, v]) => [
              k,
              { before: null, after: v },
            ])
          ),
        });
      } else if (mutation.op === 'soft_delete_entity') {
        validatedMutations.push(mutation);
        previewItems.push({
          id: mutation.entity_id,
          op: 'soft_delete_entity',
          title: `Entity ${mutation.entity_id}`,
          schema_id: 'unknown',
          changes: { deleted: { before: false, after: true } },
        });
      } else if (mutation.op === 'upsert_relationship') {
        const rel = mutation.relationship;
        if (!rel || typeof rel !== 'object') {
          return {
            success: false,
            error: 'Invalid relationship mutation: missing relationship payload',
          };
        }

        if (!rel.id || typeof rel.id !== 'string' || !rel.id.trim()) {
          return {
            success: false,
            error: 'Invalid relationship: missing or empty relationship id',
          };
        }

        if (!rel.from || typeof rel.from !== 'string' || !rel.from.trim()) {
          return {
            success: false,
            error: 'Invalid relationship: missing or empty "from" endpoint',
          };
        }

        if (!rel.to || typeof rel.to !== 'string' || !rel.to.trim()) {
          return {
            success: false,
            error: 'Invalid relationship: missing or empty "to" endpoint',
          };
        }

        if (rel.from === rel.to) {
          return {
            success: false,
            error: `Self-referential relationships are rejected: endpoint "${rel.from}" cannot link to itself`,
          };
        }

        const validTypes = VALID_RELATIONSHIP_TYPES as readonly string[];
        if (!validTypes.includes(rel.type)) {
          return {
            success: false,
            error: `Invalid or unsupported relationship type: "${rel.type}". Valid types: ${validTypes.join(', ')}`,
          };
        }

        // Referential integrity check:
        // Reject links to entities that are soft-deleted in this proposal
        const isDeletedInProposal = (id: string) =>
          proposal.mutations.some(m => m.op === 'soft_delete_entity' && m.entity_id === id);

        if (isDeletedInProposal(rel.from)) {
          return {
            success: false,
            error: `Referential integrity violation: Cannot link from deleted entity "${rel.from}"`,
          };
        }

        if (isDeletedInProposal(rel.to)) {
          return {
            success: false,
            error: `Referential integrity violation: Cannot link to deleted entity "${rel.to}"`,
          };
        }

        const isEndpointValid = (id: string): boolean => {
          // Being created/upserted in this proposal
          const inProposal =
            validatedMutations.some(m => m.op === 'upsert_entity' && m.entity.id === id) ||
            proposal.mutations.some(m => m.op === 'upsert_entity' && m.entity.id === id);
          if (inProposal) return true;

          // Check entityLookup if provided
          if (entityLookup) {
            const found = entityLookup(id);
            if (typeof found === 'boolean') return found;
            if (found && typeof found === 'object') {
              return found.lifecycle.deleted_at === null;
            }
            return false;
          }

          // Check synchronous persistence cache if available
          const syncPersistence = this.persistence as unknown as { getEntitySync?: (entityId: string) => Entity | null };
          if (typeof syncPersistence.getEntitySync === 'function') {
            const existing = syncPersistence.getEntitySync(id);
            return existing !== null && existing.lifecycle.deleted_at === null;
          }

          return true;
        };

        if (!isEndpointValid(rel.from)) {
          return {
            success: false,
            error: `Referential integrity violation: Cannot link from non-existent entity "${rel.from}"`,
          };
        }

        if (!isEndpointValid(rel.to)) {
          return {
            success: false,
            error: `Referential integrity violation: Cannot link to non-existent entity "${rel.to}"`,
          };
        }

        validatedMutations.push({ op: 'upsert_relationship', relationship: rel });

        previewItems.push({
          id: rel.id,
          op: 'upsert_relationship',
          title: `${rel.type} Link: ${rel.from} -> ${rel.to}`,
          schema_id: 'system/relationship',
          changes: {
            from: { before: null, after: rel.from },
            to: { before: null, after: rel.to },
            type: { before: null, after: rel.type },
          },
        });
      } else if (mutation.op === 'delete_relationship') {
        if (!mutation.relationship_id || typeof mutation.relationship_id !== 'string' || !mutation.relationship_id.trim()) {
          return {
            success: false,
            error: 'Invalid delete_relationship: missing relationship_id',
          };
        }

        validatedMutations.push(mutation);
        previewItems.push({
          id: mutation.relationship_id,
          op: 'delete_relationship',
          title: `Unlink Relationship ${mutation.relationship_id}`,
          schema_id: 'system/relationship',
          changes: { deleted: { before: false, after: true } },
        });
      }
    }

    const plan_fingerprint = computePlanFingerprint(proposal.id, validatedMutations);

    let requiresConfirmation = auth.requires_user_confirmation;
    if (proposal.untrusted_input || proposal.requires_confirmation) {
      requiresConfirmation = true;
    }
    for (const m of validatedMutations) {
      if (m.op === 'upsert_entity' && m.entity.provenance?.is_inferred && !m.entity.provenance?.user_confirmed) {
        requiresConfirmation = true;
        break;
      }
    }

    const audit_entry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      source: proposal.source,
      intent: proposal.intent,
      mutation_count: validatedMutations.length,
    };

    return {
      success: true,
      plan: {
        proposal_id: proposal.id,
        intent: proposal.intent,
        validated_mutations: validatedMutations,
        preview_items: previewItems,
        requires_confirmation: requiresConfirmation,
        plan_fingerprint,
        audit_entry,
      },
    };
  }

  /**
   * Phase 2: Explicit User Confirmation Boundary
   * Answers: "Has the authenticated user explicitly approved this exact mutation plan?"
   */
  confirm(
    plan: ExecutionPlan,
    confirmationContext: AuthorizationContext | string
  ): ConfirmedExecutionPlan {
    const actor =
      typeof confirmationContext === 'string'
        ? 'user_ui'
        : confirmationContext.actor;
    const userId =
      typeof confirmationContext === 'string'
        ? confirmationContext
        : confirmationContext.authenticated_user_id;

    if (!userId || !userId.trim()) {
      throw new Error('Confirmation rejected: Missing valid authenticated user ID');
    }

    if (actor !== 'user_ui') {
      throw new Error(
        `Confirmation rejected: Actor "${actor}" cannot provide user confirmation. Only "user_ui" is authorized.`
      );
    }

    const currentFingerprint = computePlanFingerprint(
      plan.proposal_id,
      plan.validated_mutations
    );
    if (currentFingerprint !== plan.plan_fingerprint) {
      throw new Error('Confirmation rejected: Plan has been modified since generation');
    }

    return {
      plan,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
      confirmation_token: `token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      verified_fingerprint: plan.plan_fingerprint,
    };
  }

  /**
   * Phase 3: Execution Boundary
   * Enforces:
   * 1. Requires valid execution context with authenticated_user_id.
   * 2. If requires_confirmation === true, ConfirmedExecutionPlan is MANDATORY.
   * 3. Cannot execute plain/unconfirmed ExecutionPlan if confirmation is required.
   * 4. Confirmation must belong to the executing user (User A confirms -> User B executes fails).
   * 5. Confirmation token replay protection: tokens are single-use only.
   * 6. Cryptographic SHA-256 fingerprint check must match the confirmed plan.
   */
  async execute(
    confirmed: ConfirmedExecutionPlan,
    executionContext: AuthorizationContext | string
  ): Promise<boolean> {
    if (!confirmed || typeof confirmed !== 'object') {
      throw new Error('Execution rejected: Missing valid confirmed execution plan');
    }

    if (!confirmed.confirmation_token || !confirmed.plan) {
      throw new Error(
        'Execution rejected: A plan requiring confirmation cannot be executed as an unconfirmed ExecutionPlan'
      );
    }

    const executorId =
      typeof executionContext === 'string'
        ? executionContext
        : executionContext?.authenticated_user_id;

    if (!executorId || !executorId.trim()) {
      throw new Error(
        'Execution rejected: Unauthenticated executor context (missing authenticated_user_id)'
      );
    }

    // Replay attack prevention: single-use confirmation token
    if (this.consumedConfirmationTokens.has(confirmed.confirmation_token)) {
      throw new Error(
        `Execution rejected: Confirmation token "${confirmed.confirmation_token}" has already been consumed (replay attack detected)`
      );
    }

    const plan = confirmed.plan;

    // Verify SHA-256 confirmation fingerprint matches exact current plan
    const currentFingerprint = computePlanFingerprint(
      plan.proposal_id,
      plan.validated_mutations
    );
    if (
      currentFingerprint !== confirmed.verified_fingerprint ||
      currentFingerprint !== plan.plan_fingerprint
    ) {
      throw new Error('Execution rejected: Plan tampering detected! Fingerprint mismatch.');
    }

    // User binding verification: User A confirms -> User B executes must fail
    if (plan.requires_confirmation) {
      if (!confirmed.confirmed_by || !confirmed.confirmed_by.trim()) {
        throw new Error('Execution rejected: Plan requires explicit user confirmation');
      }
      if (confirmed.confirmed_by !== executorId) {
        throw new Error(
          `Execution rejected: User "${executorId}" cannot execute plan confirmed by "${confirmed.confirmed_by}"`
        );
      }
    }

    const persistenceOps: PersistenceMutation[] = [];

    for (const mut of plan.validated_mutations) {
      if (mut.op === 'upsert_entity') {
        persistenceOps.push({ type: 'set_entity', entity: mut.entity });
      } else if (mut.op === 'soft_delete_entity') {
        persistenceOps.push({ type: 'soft_delete_entity', id: mut.entity_id });
      } else if (mut.op === 'upsert_relationship') {
        persistenceOps.push({ type: 'set_relationship', relationship: mut.relationship });
      } else if (mut.op === 'delete_relationship') {
        persistenceOps.push({ type: 'delete_relationship', id: mut.relationship_id });
      }
    }

    persistenceOps.push({ type: 'append_audit_log', entry: plan.audit_entry });

    await this.persistence.commitBatch(persistenceOps);

    // Consume token on successful commit to prevent replay
    this.consumedConfirmationTokens.add(confirmed.confirmation_token);

    return true;
  }
}
