import type { ConversationBranch } from '../types';

/** The default fresh-install branch points at an artificial welcome prompt. */
const isFreshWelcomeBranch = (branch: ConversationBranch): boolean =>
  branch.id === `b_main_${branch.conversation_id}` &&
  branch.name === 'Main' &&
  branch.head_message_id === 'init-1' &&
  !branch.deleted_at &&
  !branch.diverged_from_branch_id &&
  !branch.diverged_from_message_id;

/**
 * Merge conversation branch metadata by stable branch ID. A newer explicit
 * restore can clear an older tombstone; equal-time ties preserve deletion so
 * a stale replica cannot resurrect a branch.
 */
export const mergeConversationBranches = (
  local: ConversationBranch[],
  remote: ConversationBranch[],
): ConversationBranch[] => {
  const merged = new Map<string, ConversationBranch>();
  for (const branch of remote) merged.set(branch.id, branch);

  for (const branch of local) {
    const existing = merged.get(branch.id);
    if (!existing) {
      merged.set(branch.id, branch);
      continue;
    }

    // A freshly initialized store timestamps its synthetic welcome branch at
    // load time. That timestamp must not make it newer than a real cloud branch
    // restored on another device.
    if (isFreshWelcomeBranch(branch) && !isFreshWelcomeBranch(existing)) continue;

    const localTime = Date.parse(branch.updated_at || branch.created_at);
    const remoteTime = Date.parse(existing.updated_at || existing.created_at);
    if (branch.deleted_at && !existing.deleted_at) {
      const remoteRestoredAfterLocalDelete = !!existing.restored_at &&
        Date.parse(existing.restored_at) > Date.parse(branch.deleted_at);
      if (!remoteRestoredAfterLocalDelete) merged.set(branch.id, branch);
    } else if (existing.deleted_at && !branch.deleted_at) {
      const explicitlyRestored = !!branch.restored_at && Date.parse(branch.restored_at) > Date.parse(existing.deleted_at);
      if (explicitlyRestored) merged.set(branch.id, branch);
    } else if (localTime > remoteTime || (localTime === remoteTime && branch.deleted_at && !existing.deleted_at)) {
      merged.set(branch.id, branch);
    }
  }

  return [...merged.values()].sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)
  );
};

export const sameConversationBranches = (
  left: ConversationBranch[],
  right: ConversationBranch[],
): boolean => {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map(branch => [branch.id, branch]));
  return left.every(branch => {
    const other = rightById.get(branch.id);
    return !!other && branch.conversation_id === other.conversation_id &&
      branch.name === other.name && branch.label === other.label &&
      branch.created_at === other.created_at &&
      branch.root_message_id === other.root_message_id &&
      branch.head_message_id === other.head_message_id &&
      branch.diverged_from_branch_id === other.diverged_from_branch_id &&
      branch.diverged_from_message_id === other.diverged_from_message_id &&
      branch.active === other.active && branch.deleted_at === other.deleted_at &&
      branch.restored_at === other.restored_at &&
      branch.updated_at === other.updated_at;
  });
};
