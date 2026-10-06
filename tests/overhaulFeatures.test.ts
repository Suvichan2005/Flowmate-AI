import { describe, it, expect } from 'vitest';
import { mergeChatSessions } from '../services/firestoreSync';
import { getInstantContextualSuggestions } from '../services/ai/suggestions';
import { normalizePayload } from '../store/helpers';
import { ChatSession, EntityKind } from '../types';

describe('Cross-Platform Sync: mergeChatSessions', () => {
    it('should merge disjoint sessions from desktop and mobile without dropping any', () => {
        const desktopSessions: ChatSession[] = [
            { id: 'session-1', title: 'Work Tasks', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' },
            { id: 'session-2', title: 'Gym Routine', created_at: '2026-10-06T11:00:00Z', updated_at: '2026-10-06T11:00:00Z' }
        ];

        const mobileSessions: ChatSession[] = [
            { id: 'session-1', title: 'Work Tasks', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' },
            { id: 'session-3', title: 'Kolkata Trip Planning', created_at: '2026-10-06T12:00:00Z', updated_at: '2026-10-06T12:00:00Z' }
        ];

        const merged = mergeChatSessions(desktopSessions, mobileSessions);
        expect(merged).toHaveLength(3);
        const ids = merged.map(s => s.id);
        expect(ids).toContain('session-1');
        expect(ids).toContain('session-2');
        expect(ids).toContain('session-3');
    });

    it('should prioritize the newer updated_at version when session is renamed on one device', () => {
        const oldDesktop: ChatSession[] = [
            { id: 'session-1', title: 'General Chat', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z' }
        ];

        const updatedMobile: ChatSession[] = [
            { id: 'session-1', title: 'Kolkata Train Details', created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T12:30:00Z' }
        ];

        const merged = mergeChatSessions(oldDesktop, updatedMobile);
        expect(merged).toHaveLength(1);
        expect(merged[0].title).toBe('Kolkata Train Details');
    });
});

describe('Dynamic Contextual Suggestions', () => {
    it('should generate at least 3 instant actionable prompt templates', () => {
        const suggestions = getInstantContextualSuggestions({
            entities: [],
            foodLogs: [],
            subjects: []
        });

        expect(suggestions.length).toBeGreaterThanOrEqual(3);
        suggestions.forEach(s => {
            expect(s.icon).toBeTruthy();
            expect(s.label).toBeTruthy();
            expect(s.prompt).toBeTruthy();
            expect(s.prompt.length).toBeGreaterThan(10);
        });
    });

    it('should generate personalized prompts when tasks or events exist in context', () => {
        const suggestions = getInstantContextualSuggestions({
            entities: [
                {
                    id: 'task-1',
                    kind: EntityKind.TASK,
                    title: 'Submit Lab Report',
                    description: null,
                    status: 'PENDING' as any,
                    priority: 3,
                    start_time: null,
                    end_time: null,
                    deadline: null,
                    duration_minutes: null,
                    recurrence: null,
                    metadata: {},
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    canonical_tags: []
                }
            ],
            foodLogs: [],
            subjects: []
        });

        expect(suggestions.length).toBeGreaterThanOrEqual(3);
        const hasPrompt = suggestions.some(s => s.prompt.length > 0);
        expect(hasPrompt).toBe(true);
    });
});

describe('Operation Normalization: Calendar & IST Precision', () => {
    it('should normalize start and end aliases into start_time and end_time with IST offset', () => {
        const normalized = normalizePayload('create_entity', {
            k: 'EVT',
            t: 'Train to Kolkata',
            start: '2026-10-07T21:30:00',
            end: '2026-10-08T05:15:00'
        });

        expect(normalized.kind).toBe(EntityKind.EVENT);
        expect(normalized.title).toBe('Train to Kolkata');
        expect(normalized.start_time).toBe('2026-10-07T21:30:00+05:30');
        expect(normalized.end_time).toBe('2026-10-08T05:15:00+05:30');
    });

    it('should handle date-only strings by appending midnight and IST offset', () => {
        const normalized = normalizePayload('create_entity', {
            kind: 'EVENT',
            title: 'Hackathon Day 1',
            date: '2026-10-15'
        });

        expect(normalized.start_time).toBe('2026-10-15T00:00:00+05:30');
    });

    it('should support startTime and endTime camelCase aliases', () => {
        const normalized = normalizePayload('create_entity', {
            k: 'EVT',
            name: 'Project Sync',
            startTime: '2026-10-07T14:00:00+05:30',
            endTime: '2026-10-07T15:00:00+05:30'
        });

        expect(normalized.title).toBe('Project Sync');
        expect(normalized.start_time).toBe('2026-10-07T14:00:00+05:30');
        expect(normalized.end_time).toBe('2026-10-07T15:00:00+05:30');
    });
});
