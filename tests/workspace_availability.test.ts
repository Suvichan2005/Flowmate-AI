import { describe, it, expect } from 'vitest';
import { describeWorkspaceAvailability, AvailabilityInput } from '../services/workspaceAvailability';
import { describeLocalRequest } from '../services/ai/local';
import { Entity, EntityKind, EntityStatus } from '../types';
const base: AvailabilityInput = { online: true, firebaseConfigured: false, authenticated: false, syncStatus: 'idle', pendingCount: 0, lastSyncedAt: null, geminiConfigured: false };
describe('Truthful workspace availability', () => {
  it('does not call an unconfigured online local workspace offline or synced', () => {
    const result = describeWorkspaceAvailability(base);
    expect(result.cloud).toBe('Firebase not configured'); expect(result.network).toBe('Browser network available');
    expect(result.gemini).toBe('Gemini not configured');
  });
  it('separates authenticated, pending, failed, offline and unverified connections', () => {
    const configured = { ...base, firebaseConfigured: true, authenticated: true };
    expect(describeWorkspaceAvailability(configured).cloud).toContain('not yet verified');
    expect(describeWorkspaceAvailability({ ...configured, pendingCount: 1 }).cloud).toContain('pending');
    expect(describeWorkspaceAvailability({ ...configured, syncStatus: 'error' }).cloud).toContain('error');
    expect(describeWorkspaceAvailability({ ...configured, online: false }).cloud).toContain('disconnected');
  });
  it('a configured Gemini key is not presented as a confirmed successful connection', () => {
    expect(describeWorkspaceAvailability({ ...base, geminiConfigured: true }).gemini).toContain('checked on request');
  });
  it('local responses recalculate from arbitrary state and disclose their origin', () => {
    const task = { id: 'arbitrary', kind: EntityKind.TASK, title: 'User-created task', status: EntityStatus.ACTIVE, metadata: {} } as Entity;
    expect(describeLocalRequest('show tasks', [])).toContain('0 active');
    const answer = describeLocalRequest('show tasks', [task]);
    expect(answer).toContain('1 active'); expect(answer).toContain(task.title); expect(answer).toContain('Gemini is not configured');
    expect(describeLocalRequest('unrecognized', [])).toContain('no AI request was made');
  });
});
