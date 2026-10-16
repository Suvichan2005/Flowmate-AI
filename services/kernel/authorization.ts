/**
 * Flowmate Greenfield Domain Kernel — Authorization Boundary (Phase 0)
 * STRICT INVARIANT: ZERO `any`
 *
 * Explicit distinction:
 * - Authorization (here): "Is this actor allowed to submit this proposal/mutation class?"
 * - Confirmation (ActionPipeline): "Has the authenticated user approved this exact plan?"
 */

export type ActorType =
  | 'user_ui'
  | 'ai_agent'
  | 'sync_worker'
  | 'system_job'
  | 'system'
  | 'automation'
  | 'sandbox';

export interface ActionProposalLike {
  id: string;
  source: 'user_ui' | 'ai_agent' | 'sync_worker' | 'system_job' | 'system' | 'automation';
  intent: string;
  requires_confirmation?: boolean;
  untrusted_input?: boolean;
}

export interface AuthorizationContext {
  actor: ActorType;
  authenticated_user_id: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  requires_user_confirmation: boolean;
  reason?: string;
}

export interface QueryAuthorizationContext {
  actor: ActorType;
  authenticated_user_id: string;
}

export interface QueryAuthorizationResult {
  authorized: boolean;
  effective_scopes: Array<'system' | 'user' | 'module'>;
  max_privacy_tier: 'public' | 'private' | 'sensitive' | 'device_local';
  reason?: string;
}

export interface Authorizer {
  authorize(proposal: ActionProposalLike, context: AuthorizationContext): AuthorizationResult;
  authorizeQuery(
    context: QueryAuthorizationContext,
    requestedScope?: 'system' | 'user' | 'all'
  ): QueryAuthorizationResult;
}

export class KernelAuthorizer implements Authorizer {
  authorize(proposal: ActionProposalLike, context: AuthorizationContext): AuthorizationResult {
    // 1. Unauthenticated actors are rejected
    if (!context.authenticated_user_id || !context.authenticated_user_id.trim()) {
      return {
        authorized: false,
        requires_user_confirmation: false,
        reason: 'Unauthenticated actor: missing valid authenticated_user_id',
      };
    }

    // 2. Untrusted input or explicit proposal confirmation requirement ALWAYS enforces confirmation
    if (proposal.untrusted_input || proposal.requires_confirmation) {
      return {
        authorized: true,
        requires_user_confirmation: true,
        reason: 'Proposal explicitly requires user confirmation or originated from untrusted input',
      };
    }

    // 3. AI agent proposals ALWAYS require explicit user confirmation for state mutations
    if (context.actor === 'ai_agent' || proposal.source === 'ai_agent') {
      return {
        authorized: true,
        requires_user_confirmation: true,
        reason: 'AI agent proposals require explicit user confirmation',
      };
    }

    // 4. Automation proposals require confirmation by default
    if (context.actor === 'automation' || proposal.source === 'automation') {
      return {
        authorized: true,
        requires_user_confirmation: true,
        reason: 'Automation proposals require user confirmation',
      };
    }

    // 5. sync_worker: trusted background state replication, executes without confirmation
    if (context.actor === 'sync_worker') {
      return {
        authorized: true,
        requires_user_confirmation: false,
      };
    }

    // 6. system_job / system: trusted internal maintenance
    if (context.actor === 'system_job' || context.actor === 'system') {
      return {
        authorized: true,
        requires_user_confirmation: false,
      };
    }

    // 7. Direct user UI actions: authorized without confirmation ONLY if source is user_ui
    if (context.actor === 'user_ui') {
      if (proposal.source !== 'user_ui') {
        return {
          authorized: true,
          requires_user_confirmation: true,
          reason: `Proposal originated from non-UI source (${proposal.source}) and requires confirmation`,
        };
      }
      return {
        authorized: true,
        requires_user_confirmation: false,
      };
    }

    // Default fallback: require confirmation
    return {
      authorized: true,
      requires_user_confirmation: true,
    };
  }

  authorizeQuery(
    context: QueryAuthorizationContext,
    requestedScope?: 'system' | 'user' | 'all'
  ): QueryAuthorizationResult {
    // 1. Unauthenticated queries rejected
    if (!context.authenticated_user_id || !context.authenticated_user_id.trim()) {
      return {
        authorized: false,
        effective_scopes: [],
        max_privacy_tier: 'public',
        reason: 'Unauthenticated query: missing valid authenticated_user_id',
      };
    }

    // 2. AI agent and sandbox queries are strictly clamped:
    // Cannot access 'sensitive' or 'device_local' tiers, and 'all' is clamped to ['system', 'user']
    if (context.actor === 'ai_agent' || context.actor === 'sandbox') {
      const allowed: Array<'system' | 'user' | 'module'> =
        requestedScope === 'system'
          ? ['system']
          : requestedScope === 'user'
            ? ['user']
            : ['system', 'user'];

      return {
        authorized: true,
        effective_scopes: allowed,
        max_privacy_tier: 'private',
      };
    }

    // 3. Authenticated direct user UI / system has full tier clearance
    const allowed: Array<'system' | 'user' | 'module'> =
      requestedScope === 'system'
        ? ['system']
        : requestedScope === 'user'
          ? ['user']
          : ['system', 'user', 'module'];

    return {
      authorized: true,
      effective_scopes: allowed,
      max_privacy_tier: 'device_local',
    };
  }
}
