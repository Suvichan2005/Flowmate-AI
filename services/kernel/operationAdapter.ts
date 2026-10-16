/**
 * Flowmate Greenfield Domain Kernel — Legacy Operation to ActionProposal Adapter
 *
 * Converts legacy ToonOperation[] payloads into canonical ActionProposal format
 * with strict schema compliance and side-effect-free mutation primitives.
 *
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Pure mapping functions
 * - Schema-governed typed attributes
 */

import { v4 as uuidv4 } from 'uuid';
import { ToonOperation } from '../../types';
import { Entity as KernelEntity, AttributeValue, Relationship, VALID_RELATIONSHIP_TYPES } from './types';
import { ActionProposal, MutationPrimitive } from './actionPipeline';
import {
  upgradeLegacyEntityToKernel,
  upgradeLegacyMealLogToKernel,
} from '../persistence/legacyMigration';
import { expandOperationType, normalizePayload } from '../../store/helpers';

export interface OperationToProposalOptions {
  proposalId?: string;
  source: 'user_ui' | 'ai_agent' | 'system' | 'automation';
  intent?: string;
  currentEntities?: Record<string, KernelEntity>;
  currentRelationships?: Relationship[];
}

export function convertOperationsToActionProposal(
  ops: ToonOperation[],
  options: OperationToProposalOptions
): ActionProposal {
  const proposalId = options.proposalId || `prop_${uuidv4()}`;
  const source = options.source;
  const intent = options.intent || `Execute ${ops.length} operation(s)`;
  const currentEntities = options.currentEntities || {};
  const workingEntities: Record<string, KernelEntity> = { ...currentEntities };
  const currentRelationships = options.currentRelationships || [];
  const workingRelationships: Relationship[] = [...currentRelationships];

  const mutations: MutationPrimitive[] = [];

  for (const rawOp of ops) {
    const type = expandOperationType(rawOp.type);
    const rawPayload = (typeof rawOp.payload === 'object' && rawOp.payload !== null)
      ? (rawOp.payload as Record<string, unknown>)
      : {};
    const payload = normalizePayload(type, rawPayload);

    switch (type) {
      case 'create_entity': {
        const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id : uuidv4();
        const entity = upgradeLegacyEntityToKernel({
          ...payload,
          id,
        });

        // Flowmate 4.1: Authoritative scheduling certainty resolution
        if (entity.schema_id === 'system/event' || entity.schema_id === 'system/task') {
          let cert = typeof entity.attributes.scheduling_certainty === 'string'
            ? entity.attributes.scheduling_certainty
            : undefined;

          if (!cert) {
            const rawCert = (typeof payload.scheduling_certainty === 'string' ? payload.scheduling_certainty : undefined)
              || (typeof payload.certainty === 'string' ? payload.certainty : undefined)
              || (typeof (payload.metadata as Record<string, unknown> | undefined)?.scheduling_certainty === 'string'
                ? (payload.metadata as Record<string, unknown>).scheduling_certainty as string
                : undefined);
            if (rawCert) {
              const lower = rawCert.toLowerCase().trim();
              if (lower === 'confirmed' || lower === 'tentative' || lower === 'cancelled' || lower === 'unknown') {
                cert = lower;
              }
            }
          }

          if (!cert) {
            const textToScan = `${entity.title} ${payload.description || ''} ${payload.notes || ''}`.toLowerCase();
            if (/\btentative\b/i.test(textToScan)) {
              cert = 'tentative';
            }
          }

          // Invariant: Missing certainty remains unknown; never silently promote to confirmed
          if (!cert && entity.schema_id === 'system/event') {
            cert = 'unknown';
          }

          if (cert) {
            entity.attributes.scheduling_certainty = cert;
          }
        }

        // Flowmate 4.1: Idempotency & deduplication for persistent memory items
        if (entity.schema_id === 'system/memory_item') {
          const contentStr = typeof entity.attributes.content === 'string'
            ? entity.attributes.content.trim().toLowerCase()
            : entity.title.trim().toLowerCase();

          const existingMem = Object.values(workingEntities).find(
            e => e.schema_id === 'system/memory_item' &&
              e.lifecycle.status !== 'deleted' &&
              e.lifecycle.deleted_at === null &&
              ((typeof e.attributes.content === 'string' && e.attributes.content.trim().toLowerCase() === contentStr) ||
               (e.title.trim().toLowerCase() === contentStr))
          );

          if (existingMem) {
            entity.id = existingMem.id;
            entity.version = existingMem.version + 1;
            entity.lifecycle.created_at = existingMem.lifecycle.created_at;
            entity.lifecycle.updated_at = new Date().toISOString();
          }
        }

        if (source === 'ai_agent') {
          entity.provenance = {
            ...entity.provenance,
            source_type: 'agent',
            is_inferred: true,
            confidence: 0.9,
            user_confirmed: false,
          };
        } else if (source === 'user_ui') {
          entity.provenance = {
            ...entity.provenance,
            source_type: 'user',
            is_inferred: false,
            confidence: 1.0,
            user_confirmed: true,
          };
        }

        if (typeof (payload.metadata as Record<string, unknown> | undefined)?.source_insight_id === 'string') {
          entity.provenance.source_id = (payload.metadata as Record<string, unknown>).source_insight_id as string;
        }
        const existingMutationIdx = mutations.findIndex(
          m => m.op === 'upsert_entity' && m.entity.id === entity.id
        );
        if (existingMutationIdx >= 0) {
          mutations[existingMutationIdx] = {
            op: 'upsert_entity',
            entity,
          };
        } else {
          mutations.push({
            op: 'upsert_entity',
            entity,
          });
        }
        workingEntities[entity.id] = entity;

        // Auto-link context relationship if context reference is provided
        const contextRef = (typeof payload.context_id === 'string' ? payload.context_id : undefined)
          || (typeof payload.context_temp === 'string' ? payload.context_temp : undefined)
          || (typeof payload.context === 'string' ? payload.context : undefined);

        if (contextRef) {
          let contextEntity = workingEntities[contextRef];
          if (!contextEntity) {
            contextEntity = Object.values(workingEntities).find(
              e => e.title.toLowerCase() === contextRef.toLowerCase()
            );
          }
          if (contextEntity) {
            const relId = `rel_${uuidv4()}`;
            const rel: Relationship = {
              id: relId,
              from: entity.id,
              to: contextEntity.id,
              type: 'TAGGED_WITH',
              meta: {},
              created_at: new Date().toISOString(),
            };
            mutations.push({
              op: 'upsert_relationship',
              relationship: rel,
            });
            workingRelationships.push(rel);
          }
        }
        break;
      }

      case 'update_entity': {
        const id = (typeof payload.id === 'string' ? payload.id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);

        if (!id) break;

        let existing = workingEntities[id];
        if (!existing) {
          const byTitle = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === id.toLowerCase()
          );
          if (byTitle) existing = byTitle;
        }

        if (existing) {
          const fields = (typeof payload.fields === 'object' && payload.fields !== null)
            ? (payload.fields as Record<string, unknown>)
            : payload;

          const updatedAttrs: Record<string, AttributeValue> = { ...existing.attributes };
          for (const [k, v] of Object.entries(fields)) {
            if (k !== 'id' && k !== 'fields' && k !== 'title' && k !== 'status' && k !== 'kind' && v !== undefined) {
              updatedAttrs[k] = v as AttributeValue;
            }
          }
          delete updatedAttrs.title;
          delete updatedAttrs.status;
          delete updatedAttrs.kind;

          const updatedTitle = typeof fields.title === 'string' ? fields.title : existing.title;
          const updatedStatus = typeof fields.status === 'string'
            ? fields.status.toLowerCase()
            : existing.lifecycle.status;

          let updatedProvenance = { ...existing.provenance };
          if (source === 'user_ui') {
            updatedProvenance.user_confirmed = true;
          } else if (source === 'ai_agent') {
            // AI agent cannot upgrade its own confidence or mark itself user_confirmed!
            if (updatedProvenance.is_inferred) {
              updatedProvenance.user_confirmed = false;
            }
          }

          const updatedEntity: KernelEntity = {
            ...existing,
            title: updatedTitle,
            version: existing.version + 1,
            attributes: updatedAttrs,
            provenance: updatedProvenance,
            lifecycle: {
              ...existing.lifecycle,
              status: updatedStatus,
              updated_at: new Date().toISOString(),
            },
          };

          workingEntities[updatedEntity.id] = updatedEntity;

          const existingMutationIndex = mutations.findIndex(
            m => m.op === 'upsert_entity' && m.entity.id === updatedEntity.id
          );
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = {
              op: 'upsert_entity',
              entity: updatedEntity,
            };
          } else {
            mutations.push({
              op: 'upsert_entity',
              entity: updatedEntity,
            });
          }
        }
        break;
      }

      case 'delete_entity': {
        let id = (typeof payload.id === 'string' ? payload.id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);

        if (!id) break;

        if (!workingEntities[id]) {
          const byTitle = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === id.toLowerCase()
          );
          if (byTitle) id = byTitle.id;
        }

        if (id) {
          mutations.push({
            op: 'soft_delete_entity',
            entity_id: id,
          });
          delete workingEntities[id];
        }
        break;
      }

      case 'schedule_event': {
        const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id : uuidv4();
        const entity = upgradeLegacyEntityToKernel({
          ...payload,
          kind: 'EVENT',
          id,
        });

        // Flowmate 4.1: Authoritative scheduling certainty resolution
        let cert = typeof entity.attributes.scheduling_certainty === 'string'
          ? entity.attributes.scheduling_certainty
          : undefined;

        if (!cert) {
          const rawCert = (typeof payload.scheduling_certainty === 'string' ? payload.scheduling_certainty : undefined)
            || (typeof payload.certainty === 'string' ? payload.certainty : undefined)
            || (typeof (payload.metadata as Record<string, unknown> | undefined)?.scheduling_certainty === 'string'
              ? (payload.metadata as Record<string, unknown>).scheduling_certainty as string
              : undefined);
          if (rawCert) {
            const lower = rawCert.toLowerCase().trim();
            if (lower === 'confirmed' || lower === 'tentative' || lower === 'cancelled' || lower === 'unknown') {
              cert = lower;
            }
          }
        }

        if (!cert) {
          const textToScan = `${entity.title} ${payload.description || ''} ${payload.notes || ''}`.toLowerCase();
          if (/\btentative\b/i.test(textToScan)) {
            cert = 'tentative';
          }
        }

        // Invariant: Missing certainty remains unknown; never silently promote to confirmed
        if (!cert) {
          cert = 'unknown';
        }

        entity.attributes.scheduling_certainty = cert;

        if (source === 'ai_agent') {
          entity.provenance = {
            ...entity.provenance,
            source_type: 'agent',
            is_inferred: true,
            confidence: 0.9,
            user_confirmed: false,
          };
        } else if (source === 'user_ui') {
          entity.provenance = {
            ...entity.provenance,
            source_type: 'user',
            is_inferred: false,
            confidence: 1.0,
            user_confirmed: true,
          };
        }

        mutations.push({
          op: 'upsert_entity',
          entity,
        });
        workingEntities[entity.id] = entity;
        break;
      }

      case 'log_food': {
        const mealEntity = upgradeLegacyMealLogToKernel(payload);
        mutations.push({
          op: 'upsert_entity',
          entity: mealEntity,
        });
        workingEntities[mealEntity.id] = mealEntity;
        break;
      }

      case 'add_subtask': {
        const parentId = (typeof payload.parent_id === 'string' ? payload.parent_id : undefined)
          || (typeof payload.parent_entity_id === 'string' ? payload.parent_entity_id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);

        if (!parentId) break;

        let parent = workingEntities[parentId];
        if (!parent) {
          const byTitle = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === parentId.toLowerCase()
          );
          if (byTitle) parent = byTitle;
        }

        if (parent) {
          const currentSubtasks = Array.isArray(parent.attributes.subtasks)
            ? [...parent.attributes.subtasks]
            : [];

          const subtaskId = typeof payload.id === 'string' ? payload.id : uuidv4();
          const subtaskTitle = typeof payload.title === 'string'
            ? payload.title
            : (typeof payload.t === 'string' ? payload.t : 'Subtask');

          currentSubtasks.push({
            id: subtaskId,
            title: subtaskTitle,
            completed: Boolean(payload.completed),
          });

          const updatedParent: KernelEntity = {
            ...parent,
            version: parent.version + 1,
            attributes: {
              ...parent.attributes,
              subtasks: currentSubtasks,
            },
            lifecycle: {
              ...parent.lifecycle,
              updated_at: new Date().toISOString(),
            },
          };

          workingEntities[updatedParent.id] = updatedParent;

          const existingMutationIndex = mutations.findIndex(
            m => m.op === 'upsert_entity' && m.entity.id === updatedParent.id
          );
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = {
              op: 'upsert_entity',
              entity: updatedParent,
            };
          } else {
            mutations.push({
              op: 'upsert_entity',
              entity: updatedParent,
            });
          }
        }
        break;
      }

      case 'archive_entity': {
        const id = (typeof payload.id === 'string' ? payload.id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);

        if (!id) break;

        let existing = workingEntities[id];
        if (!existing) {
          const byTitle = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === id.toLowerCase()
          );
          if (byTitle) existing = byTitle;
        }

        if (existing) {
          const updatedEntity: KernelEntity = {
            ...existing,
            version: existing.version + 1,
            attributes: {
              ...existing.attributes,
              archived: true,
            },
            lifecycle: {
              ...existing.lifecycle,
              status: 'archived',
              updated_at: new Date().toISOString(),
            },
          };

          workingEntities[updatedEntity.id] = updatedEntity;

          const existingMutationIndex = mutations.findIndex(
            m => m.op === 'upsert_entity' && m.entity.id === updatedEntity.id
          );
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = {
              op: 'upsert_entity',
              entity: updatedEntity,
            };
          } else {
            mutations.push({
              op: 'upsert_entity',
              entity: updatedEntity,
            });
          }
        }
        break;
      }

      case 'log_to_entity':
      case 'log_activity': {
        const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id : uuidv4();
        const activityEntity = upgradeLegacyEntityToKernel({
          ...payload,
          kind: 'ACTIVITY',
          id,
        });
        mutations.push({
          op: 'upsert_entity',
          entity: activityEntity,
        });
        workingEntities[activityEntity.id] = activityEntity;
        break;
      }

      case 'set_goal_progress': {
        const goalId = (typeof payload.goal_id === 'string' ? payload.goal_id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined)
          || (typeof payload.id === 'string' ? payload.id : undefined);

        if (!goalId) break;
        let existing = workingEntities[goalId];
        if (!existing) {
          const byTitle = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === goalId.toLowerCase()
          );
          if (byTitle) existing = byTitle;
        }

        if (existing) {
          const updatedAttrs: Record<string, AttributeValue> = { ...existing.attributes };
          if (typeof payload.percent === 'number') {
            updatedAttrs.progress = payload.percent;
            updatedAttrs.completion_percentage = payload.percent;
          }
          if (typeof payload.current_count === 'number') {
            updatedAttrs.current_count = payload.current_count;
          }
          if (typeof payload.minutes === 'number') {
            const curMinutes = typeof updatedAttrs.duration_minutes === 'number' ? updatedAttrs.duration_minutes : 0;
            updatedAttrs.duration_minutes = curMinutes + payload.minutes;
          }
          const updatedEntity: KernelEntity = {
            ...existing,
            version: existing.version + 1,
            attributes: updatedAttrs,
            lifecycle: {
              ...existing.lifecycle,
              updated_at: new Date().toISOString(),
            },
          };

          workingEntities[updatedEntity.id] = updatedEntity;

          const existingMutationIndex = mutations.findIndex(
            m => m.op === 'upsert_entity' && m.entity.id === updatedEntity.id
          );
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = {
              op: 'upsert_entity',
              entity: updatedEntity,
            };
          } else {
            mutations.push({
              op: 'upsert_entity',
              entity: updatedEntity,
            });
          }
        }
        break;
      }

      case 'link_entities': {
        const fromRef = (typeof payload.from === 'string' ? payload.from : undefined)
          || (typeof payload.from_temp === 'string' ? payload.from_temp : undefined)
          || (typeof payload.source === 'string' ? payload.source : undefined)
          || (typeof payload.source_id === 'string' ? payload.source_id : undefined)
          || (typeof payload.from_entity_id === 'string' ? payload.from_entity_id : undefined)
          || (typeof payload.origin === 'string' ? payload.origin : undefined);

        const toRef = (typeof payload.to === 'string' ? payload.to : undefined)
          || (typeof payload.to_temp === 'string' ? payload.to_temp : undefined)
          || (typeof payload.target === 'string' ? payload.target : undefined)
          || (typeof payload.target_id === 'string' ? payload.target_id : undefined)
          || (typeof payload.to_entity_id === 'string' ? payload.to_entity_id : undefined)
          || (typeof payload.destination === 'string' ? payload.destination : undefined);

        if (!fromRef || !toRef) {
          throw new Error(`link_entities requires both "from" and "to" entity identifiers (received from="${fromRef}", to="${toRef}")`);
        }

        let fromEntity = workingEntities[fromRef];
        if (!fromEntity) {
          fromEntity = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === fromRef.toLowerCase()
          );
        }
        const fromId = fromEntity ? fromEntity.id : fromRef;

        let toEntity = workingEntities[toRef];
        if (!toEntity) {
          toEntity = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === toRef.toLowerCase()
          );
        }
        const toId = toEntity ? toEntity.id : toRef;

        const rawType = (
          typeof payload.type === 'string'
            ? payload.type
            : (typeof payload.relationship === 'string' ? payload.relationship : 'TAGGED_WITH')
        ).toUpperCase();

        const validTypes = VALID_RELATIONSHIP_TYPES as readonly string[];
        if (!validTypes.includes(rawType)) {
          throw new Error(`Invalid relationship type: "${rawType}". Allowed types: ${validTypes.join(', ')}`);
        }

        // Duplicate check & idempotent reuse
        const existingRel = workingRelationships.find(
          r => r.from === fromId && r.to === toId && r.type === rawType
        );

        if (existingRel) {
          const alreadyInBatch = mutations.some(
            m => m.op === 'upsert_relationship' &&
              m.relationship.from === fromId &&
              m.relationship.to === toId &&
              m.relationship.type === rawType
          );
          if (alreadyInBatch) {
            break;
          }
        }

        const relId = (typeof payload.id === 'string' && payload.id.trim())
          ? payload.id.trim()
          : (existingRel ? existingRel.id : `rel_${uuidv4()}`);

        const rel: Relationship = {
          id: relId,
          from: fromId,
          to: toId,
          type: rawType,
          meta: (typeof payload.meta === 'object' && payload.meta !== null ? payload.meta : {}) as Record<string, unknown>,
          created_at: new Date().toISOString(),
        };

        mutations.push({
          op: 'upsert_relationship',
          relationship: rel,
        });
        workingRelationships.push(rel);
        break;
      }

      case 'unlink_entities': {
        if (typeof payload.id === 'string' && payload.id.trim()) {
          const relId = payload.id.trim();
          mutations.push({
            op: 'delete_relationship',
            relationship_id: relId,
          });
          const idx = workingRelationships.findIndex(r => r.id === relId);
          if (idx >= 0) workingRelationships.splice(idx, 1);
          break;
        }

        const fromRef = (typeof payload.from === 'string' ? payload.from : undefined)
          || (typeof payload.source === 'string' ? payload.source : undefined);
        const toRef = (typeof payload.to === 'string' ? payload.to : undefined)
          || (typeof payload.target === 'string' ? payload.target : undefined);

        if (!fromRef || !toRef) {
          throw new Error('unlink_entities requires "id" or both "from" and "to" identifiers');
        }

        let fromEntity = workingEntities[fromRef];
        if (!fromEntity) {
          fromEntity = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === fromRef.toLowerCase()
          );
        }
        const fromId = fromEntity ? fromEntity.id : fromRef;

        let toEntity = workingEntities[toRef];
        if (!toEntity) {
          toEntity = Object.values(workingEntities).find(
            e => e.title.toLowerCase() === toRef.toLowerCase()
          );
        }
        const toId = toEntity ? toEntity.id : toRef;

        const rawType = typeof payload.type === 'string' ? payload.type.toUpperCase() : undefined;

        const matching = workingRelationships.find(
          r => r.from === fromId && r.to === toId && (!rawType || r.type === rawType)
        );

        if (matching) {
          mutations.push({
            op: 'delete_relationship',
            relationship_id: matching.id,
          });
          const idx = workingRelationships.findIndex(r => r.id === matching.id);
          if (idx >= 0) workingRelationships.splice(idx, 1);
        } else {
          throw new Error(`Cannot unlink entities: No matching relationship found between "${fromRef}" and "${toRef}"`);
        }
        break;
      }

      case 'toggle_subtask': {
        const parentId = (typeof payload.parent_id === 'string' ? payload.parent_id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);
        const subtaskId = typeof payload.subtask_id === 'string' ? payload.subtask_id : (typeof payload.id === 'string' ? payload.id : undefined);

        if (!parentId || !subtaskId) break;

        let parent = workingEntities[parentId];
        if (!parent) {
          const byTitle = Object.values(workingEntities).find(e => e.title.toLowerCase() === parentId.toLowerCase());
          if (byTitle) parent = byTitle;
        }

        if (parent && Array.isArray(parent.attributes.subtasks)) {
          const updatedSubtasks = (parent.attributes.subtasks as Array<{ id: string; title: string; completed: boolean }>).map(st => {
            if (st.id === subtaskId) {
              const completed = typeof payload.completed === 'boolean' ? payload.completed : !st.completed;
              return { ...st, completed };
            }
            return st;
          });

          const updatedParent: KernelEntity = {
            ...parent,
            version: parent.version + 1,
            attributes: { ...parent.attributes, subtasks: updatedSubtasks },
            lifecycle: { ...parent.lifecycle, updated_at: new Date().toISOString() },
          };
          workingEntities[updatedParent.id] = updatedParent;

          const existingMutationIndex = mutations.findIndex(m => m.op === 'upsert_entity' && m.entity.id === updatedParent.id);
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = { op: 'upsert_entity', entity: updatedParent };
          } else {
            mutations.push({ op: 'upsert_entity', entity: updatedParent });
          }
        }
        break;
      }

      case 'delete_subtask': {
        const parentId = (typeof payload.parent_id === 'string' ? payload.parent_id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);
        const subtaskId = typeof payload.subtask_id === 'string' ? payload.subtask_id : (typeof payload.id === 'string' ? payload.id : undefined);

        if (!parentId || !subtaskId) break;

        let parent = workingEntities[parentId];
        if (!parent) {
          const byTitle = Object.values(workingEntities).find(e => e.title.toLowerCase() === parentId.toLowerCase());
          if (byTitle) parent = byTitle;
        }

        if (parent && Array.isArray(parent.attributes.subtasks)) {
          const updatedSubtasks = (parent.attributes.subtasks as Array<{ id: string; title: string; completed: boolean }>).filter(
            st => st.id !== subtaskId
          );

          const updatedParent: KernelEntity = {
            ...parent,
            version: parent.version + 1,
            attributes: { ...parent.attributes, subtasks: updatedSubtasks },
            lifecycle: { ...parent.lifecycle, updated_at: new Date().toISOString() },
          };
          workingEntities[updatedParent.id] = updatedParent;

          const existingMutationIndex = mutations.findIndex(m => m.op === 'upsert_entity' && m.entity.id === updatedParent.id);
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = { op: 'upsert_entity', entity: updatedParent };
          } else {
            mutations.push({ op: 'upsert_entity', entity: updatedParent });
          }
        }
        break;
      }

      case 'tag_update': {
        const id = (typeof payload.id === 'string' ? payload.id : undefined)
          || (typeof payload.entity_id === 'string' ? payload.entity_id : undefined);
        if (!id) break;

        let existing = workingEntities[id];
        if (!existing) {
          const byTitle = Object.values(workingEntities).find(e => e.title.toLowerCase() === id.toLowerCase());
          if (byTitle) existing = byTitle;
        }

        if (existing) {
          const tags = Array.isArray(payload.tags) ? (payload.tags as string[]) : [];
          const updatedEntity: KernelEntity = {
            ...existing,
            version: existing.version + 1,
            attributes: { ...existing.attributes, tags },
            lifecycle: { ...existing.lifecycle, updated_at: new Date().toISOString() },
          };
          workingEntities[updatedEntity.id] = updatedEntity;
          const existingMutationIndex = mutations.findIndex(m => m.op === 'upsert_entity' && m.entity.id === updatedEntity.id);
          if (existingMutationIndex >= 0) {
            mutations[existingMutationIndex] = { op: 'upsert_entity', entity: updatedEntity };
          } else {
            mutations.push({ op: 'upsert_entity', entity: updatedEntity });
          }
        }
        break;
      }

      default:
        throw new Error(`Unsupported operation type: "${type}". Cannot plan proposal.`);
    }
  }

  return {
    id: proposalId,
    source,
    intent,
    mutations,
  };
}
