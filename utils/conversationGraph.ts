/**
 * Flowmate Conversation Graph Utilities
 *
 * Directed Acyclic Graph (DAG) traversal, sibling version discovery,
 * and secret sanitization for developer mode diagnostics.
 */

import { Message, ConversationBranch } from '../types';

/**
 * Resolves the linear message history leading up to the given head message.
 * Follows parent_id references upwards with cycle detection.
 * If no head is provided or for legacy unbranched messages, falls back to
 * chronological channel messages.
 */
export function resolveBranchHistory(
  messages: Message[],
  headMessageId?: string | null,
  channelId: string = 'general',
): Message[] {
  if (!messages || messages.length === 0) return [];
  // Explicitly empty branches must not fall back to sibling/parent messages.
  // Undefined remains the compatibility path for legacy unbranched sessions.
  if (headMessageId === null) return [];

  const channelMessages = messages.filter(
    m => (m.channelId || 'general') === channelId,
  );

  // If headMessageId is specified, attempt DAG traversal from head to root
  if (headMessageId) {
    const msgMap = new Map<string, Message>();
    for (const m of channelMessages) {
      msgMap.set(m.id, m);
    }

    const head = msgMap.get(headMessageId);
    if (head) {
      const history: Message[] = [];
      const visited = new Set<string>();
      let curr: Message | undefined = head;

      while (curr) {
        if (visited.has(curr.id)) {
          console.warn(`[ConversationGraph] Cycle detected at message ${curr.id}`);
          break;
        }
        visited.add(curr.id);
        history.unshift(curr);

        if (!curr.parent_id) break;
        curr = msgMap.get(curr.parent_id);
      }

      if (history.length > 0) {
        return history;
      }
    }
  }

  if (headMessageId) return []; // Missing/cross-conversation head: fail closed.

  // Fallback: chronological order for unbranched / legacy chats
  return [...channelMessages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export interface SiblingVersionsResult {
  currentIndex: number;
  totalCount: number;
  siblings: Message[];
}

/**
 * Discovers sibling alternative versions for a given message.
 * Siblings share the same parent_id and role with deterministic (created_at, id) tie-breaking.
 */
export function getSiblingVersions(
  messages: Message[],
  currentMessageId: string,
): SiblingVersionsResult {
  const currentMsg = messages.find(m => m.id === currentMessageId);
  if (!currentMsg) {
    return { currentIndex: 1, totalCount: 1, siblings: [] };
  }

  const effectiveChannel = currentMsg.channelId || 'general';

  const siblings = messages.filter(m => {
    if ((m.channelId || 'general') !== effectiveChannel) return false;
    if (m.role !== currentMsg.role) return false;

    if (currentMsg.parent_id !== undefined && currentMsg.parent_id !== null) {
      return m.parent_id === currentMsg.parent_id;
    } else {
      return !m.parent_id;
    }
  });

  // Sort siblings deterministically: timestamp then message list insertion order
  siblings.sort((a, b) => {
    const timeDiff = a.created_at.localeCompare(b.created_at);
    if (timeDiff !== 0) return timeDiff;
    const idxA = messages.indexOf(a);
    const idxB = messages.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    return a.id.localeCompare(b.id);
  });

  const idx = siblings.findIndex(s => s.id === currentMessageId);
  const currentIndex = idx >= 0 ? idx + 1 : 1;
  const totalCount = Math.max(siblings.length, 1);

  return {
    currentIndex,
    totalCount,
    siblings,
  };
}

/**
 * Finds the latest descendant (leaf) message along the path from a given message.
 */
export function findLeafMessage(
  messages: Message[],
  fromMessageId: string,
  branchId?: string,
): Message {
  const origin = messages.find(m => m.id === fromMessageId);
  const channel = origin?.channelId || 'general';
  const channelMsgs = messages.filter(m => (m.channelId || 'general') === channel);

  let current = origin;
  if (!current) return messages[messages.length - 1];

  const effectiveBranchId = branchId ?? current.branch_id;

  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    // Restrict traversal to the selected branch. Concurrent sibling replies
    // stay available as versions instead of being picked by array order.
    const children = channelMsgs
      .filter(message => message.parent_id === current!.id &&
        (!effectiveBranchId || message.branch_id === effectiveBranchId) &&
        !(message.role === 'assistant' &&
          (message.status === 'failed' || message.status === 'interrupted') &&
          message.turn_metadata?.response_source === 'unavailable' && !message.text.trim()))
      .sort((left, right) => {
        const time = Date.parse(right.created_at) - Date.parse(left.created_at);
        return Number.isFinite(time) && time !== 0 ? time : right.id.localeCompare(left.id);
      });
    const child = children[0];
    if (!child) break;
    current = child;
  }

  return current;
}

/**
 * Repair branch heads that lag behind already persisted messages. This is a
 * pointer-only recovery: message text and order are untouched. Empty failed
 * assistant placeholders are excluded so rejected requests remain attached
 * to the submitted user message rather than becoming fake conversation turns.
 */
export function repairStaleConversationBranchHeads(
  branches: ConversationBranch[],
  messages: Message[],
  repairedAt = new Date().toISOString(),
): ConversationBranch[] {
  return branches.map(branch => {
    if (!branch.head_message_id || branch.deleted_at) return branch;
    const head = messages.find(message => message.id === branch.head_message_id &&
      (message.channelId || 'general') === branch.conversation_id);
    if (!head) return branch;

    const leaf = findLeafMessage(messages, head.id, branch.id);
    if (leaf.id === head.id) return branch;
    return { ...branch, head_message_id: leaf.id, updated_at: repairedAt };
  });
}

/**
 * Recursively sanitizes secrets (API keys, auth tokens, passwords) for telemetry & diagnostics.
 */
export function sanitizeSecrets<T>(data: T): T {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return data
      .replace(/AIzaSy[A-Za-z0-9_-]{30,40}/g, '[REDACTED_API_KEY]')
      .replace(/ya29\.[A-Za-z0-9_-]+/g, '[REDACTED_OAUTH_TOKEN]')
      .replace(/bearer\s+[a-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_SECRET]') as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeSecrets(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    const copy: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (/key|secret|token|password|auth|credential/i.test(k) && typeof v === 'string') {
        copy[k] = '[REDACTED]';
      } else {
        copy[k] = sanitizeSecrets(v);
      }
    }
    return copy as T;
  }

  return data;
}
