import { describe, it, expect, beforeEach } from 'vitest';
import {
    getNextOccurrenceDate,
    normalizeDayOfWeek,
    normalizeTimeFormat,
    createTimetableOperations,
    buildAttendanceBridge,
    createMessMenuOperation,
    ExtractedClassSlot,
    ExtractedMessMenu
} from '../services/ai/timetable';
import { normalizePayload } from '../store/helpers';
import { useStore } from '../store';
import { getActiveEntities } from '../store/helpers';
import { EntityKind, EntityStatus, Subject, ClassSchedule } from '../types';

describe('TASK-P1-01: Timetable & Schedules Upload Flow', () => {
    beforeEach(() => {
        useStore.setState({
            kernelEntities: {},
            entities: [],
            relationships: [],
            messages: [],
            subjects: [],
            classSchedule: [],
            history: [],
            historyPointer: -1,
            toasts: []
        });
    });

    describe('1. Recurrence Shorthand Normalization', () => {
        it('normalizes rec: "WEEKLY" to recurrence: "WEEKLY"', () => {
            const normalized = normalizePayload('create_entity', {
                k: 'EVT',
                t: 'Operating Systems',
                rec: 'WEEKLY'
            });
            expect(normalized.recurrence).toBe('WEEKLY');
        });

        it('normalizes lower-case repeat: "daily" to uppercase recurrence: "DAILY"', () => {
            const normalized = normalizePayload('create_entity', {
                k: 'EVT',
                t: 'Morning Standup',
                repeat: 'daily'
            });
            expect(normalized.recurrence).toBe('DAILY');
        });

        it('normalizes freq: "monthly" to uppercase recurrence: "MONTHLY"', () => {
            const normalized = normalizePayload('create_entity', {
                k: 'EVT',
                t: 'Council Meeting',
                freq: 'monthly'
            });
            expect(normalized.recurrence).toBe('MONTHLY');
        });
    });

    describe('2. Weekday & Time Format Normalization', () => {
        it('normalizes day names to title case and correct day indices', () => {
            expect(normalizeDayOfWeek('mon')).toEqual({ dayName: 'Monday', dayIndex: 1 });
            expect(normalizeDayOfWeek('Monday')).toEqual({ dayName: 'Monday', dayIndex: 1 });
            expect(normalizeDayOfWeek('WEDNESDAY')).toEqual({ dayName: 'Wednesday', dayIndex: 3 });
            expect(normalizeDayOfWeek('fri')).toEqual({ dayName: 'Friday', dayIndex: 5 });
            expect(normalizeDayOfWeek('Sun')).toEqual({ dayName: 'Sunday', dayIndex: 0 });
            expect(normalizeDayOfWeek('sat')).toEqual({ dayName: 'Saturday', dayIndex: 6 });
            // Fallback for invalid day
            expect(normalizeDayOfWeek('InvalidDay')).toEqual({ dayName: 'Monday', dayIndex: 1 });
        });

        it('normalizes 12-hour and 24-hour time formats into HH:MM', () => {
            expect(normalizeTimeFormat('9:30 AM')).toBe('09:30');
            expect(normalizeTimeFormat('2:15 PM')).toBe('14:15');
            expect(normalizeTimeFormat('12:00 PM')).toBe('12:00');
            expect(normalizeTimeFormat('12:30 AM')).toBe('00:30');
            expect(normalizeTimeFormat('14:30')).toBe('14:30');
            expect(normalizeTimeFormat('09:00')).toBe('09:00');
            expect(normalizeTimeFormat('9:00')).toBe('09:00');
            expect(normalizeTimeFormat('')).toBe('09:00');
        });

        it('calculates the next upcoming occurrence date in IST (+05:30)', () => {
            const iso = getNextOccurrenceDate(1, '09:00'); // Next Monday 09:00
            expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00\+05:30$/);

            const parsed = new Date(iso);
            expect(isNaN(parsed.getTime())).toBe(false);
        });
    });

    describe('3. Timetable Operations Synthesis', () => {
        const sampleClasses: ExtractedClassSlot[] = [
            {
                id: 'slot-1',
                subject: 'Database Management Systems',
                code: 'CS302',
                dayOfWeek: 'Monday',
                dayIndex: 1,
                startTime: '09:00',
                endTime: '10:00',
                room: 'LH-201',
                instructor: 'Service provider',
                selected: true
            },
            {
                id: 'slot-2',
                subject: 'Computer Networks',
                code: 'CS304',
                dayOfWeek: 'Wednesday',
                dayIndex: 3,
                startTime: '11:15',
                endTime: '12:45',
                room: 'Lab-3',
                instructor: 'Prof. Rao',
                selected: true
            }
        ];

        it('generates valid create_entity operations for recurring events', () => {
            const ops = createTimetableOperations(sampleClasses);
            expect(ops).toHaveLength(2);

            const op1 = ops[0];
            expect(op1.type).toBe('create_entity');
            expect(op1.payload.k).toBe('EVT');
            expect(op1.payload.t).toBe('Database Management Systems');
            expect(op1.payload.rec).toBe('WEEKLY');
            expect(op1.payload.canonical_tags).toContain('class-schedule');
            expect(op1.payload.m.room).toBe('LH-201');
            expect(op1.payload.m.course_code).toBe('CS302');
            expect(op1.payload.m.instructor).toBe('Service provider');
            expect(op1.payload.m.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
            expect(op1.payload.dur).toBe(60);

            const op2 = ops[1];
            expect(op2.payload.t).toBe('Computer Networks');
            expect(op2.payload.m.rrule).toBe('FREQ=WEEKLY;BYDAY=WE');
            expect(op2.payload.dur).toBe(90);
        });

        it('applies operations to store and verifies active recurring events selector', () => {
            const ops = createTimetableOperations(sampleClasses);
            useStore.getState().applyOperations(ops);

            const entities = useStore.getState().entities;
            expect(entities).toHaveLength(2);

            const active = getActiveEntities(entities);
            expect(active).toHaveLength(2);

            // SchedulesView filter check: e.kind === EVENT && e.recurrence
            const recurring = active.filter(e => e.kind === EntityKind.EVENT && e.recurrence);
            expect(recurring).toHaveLength(2);
            expect(recurring[0].title).toBe('Database Management Systems');
            expect(recurring[0].recurrence).toBe('WEEKLY');
            expect(recurring[0].metadata?.room).toBe('LH-201');
        });
    });

    describe('4. Attendance Tracker Bridge', () => {
        const sampleClasses: ExtractedClassSlot[] = [
            {
                id: 'slot-1',
                subject: 'Algorithms',
                code: 'CS201',
                dayOfWeek: 'Monday',
                dayIndex: 1,
                startTime: '10:00',
                endTime: '11:00',
                room: 'LH-101',
                instructor: 'Prof. Patel',
                selected: true
            },
            {
                id: 'slot-2',
                subject: 'Algorithms',
                code: 'CS201',
                dayOfWeek: 'Thursday',
                dayIndex: 4,
                startTime: '14:00',
                endTime: '15:00',
                room: 'LH-101',
                instructor: 'Prof. Patel',
                selected: true
            }
        ];

        it('creates one subject and two class schedules for multi-day course', () => {
            const { updatedSubjects, updatedSchedules } = buildAttendanceBridge(
                sampleClasses,
                [],
                []
            );

            expect(updatedSubjects).toHaveLength(1);
            expect(updatedSubjects[0].name).toBe('Algorithms');
            expect(updatedSubjects[0].code).toBe('CS201');
            expect(updatedSubjects[0].teacher_name).toBe('Prof. Patel');
            expect(updatedSubjects[0].min_attendance).toBe(75);

            expect(updatedSchedules).toHaveLength(2);
            expect(updatedSchedules[0].subject_id).toBe(updatedSubjects[0].id);
            expect(updatedSchedules[0].day_of_week).toBe(1);
            expect(updatedSchedules[0].start_time).toBe('10:00');
            expect(updatedSchedules[1].day_of_week).toBe(4);
            expect(updatedSchedules[1].start_time).toBe('14:00');
        });

        it('reuses existing subject when subject name matches case-insensitively', () => {
            const existingSubject: Subject = {
                id: 'sub-existing',
                name: 'algorithms',
                min_attendance: 80,
                color: '#6366f1'
            };

            const { updatedSubjects, updatedSchedules } = buildAttendanceBridge(
                sampleClasses,
                [existingSubject],
                []
            );

            expect(updatedSubjects).toHaveLength(1);
            expect(updatedSubjects[0].id).toBe('sub-existing');
            expect(updatedSchedules).toHaveLength(2);
            expect(updatedSchedules[0].subject_id).toBe('sub-existing');
        });
    });

    describe('5. Mess Menu Operation Synthesis', () => {
        const sampleMenu: ExtractedMessMenu = {
            title: 'October Hostel Menu',
            days: [
                {
                    day: 'Monday',
                    breakfast: 'Puri Sabji, Tea',
                    lunch: 'Rice, Dal, Paneer',
                    snacks: 'Samosa, Chai',
                    dinner: 'Roti, Mixed Veg'
                }
            ],
            notes: 'Timings: Breakfast 7:30-9:30 AM',
            rawMarkdown: '## October Hostel Menu\n\n### Monday\n- **Breakfast**: Puri Sabji, Tea'
        };

        it('creates a NOTE entity with mess-schedule tag and markdown content', () => {
            const op = createMessMenuOperation(sampleMenu);
            expect(op.type).toBe('create_entity');
            expect(op.payload.k).toBe('NOT');
            expect(op.payload.t).toBe('October Hostel Menu');
            expect(op.payload.d).toContain('October Hostel Menu');
            expect(op.payload.canonical_tags).toContain('mess-schedule');

            useStore.getState().applyOperations([op]);

            const entities = useStore.getState().entities;
            const active = getActiveEntities(entities);
            const messNotes = active.filter(
                e => e.kind === EntityKind.NOTE && e.canonical_tags?.includes('mess-schedule')
            );

            expect(messNotes).toHaveLength(1);
            expect(messNotes[0].title).toBe('October Hostel Menu');
            expect(messNotes[0].description).toBe(sampleMenu.rawMarkdown);
        });
    });

    describe('6. Soft Deletion Isolation for Recurring Schedules (P0-01 Compatibility)', () => {
        it('soft-deleted recurring class disappears from active recurring classes', () => {
            const ops = createTimetableOperations([
                {
                    id: 'slot-del',
                    subject: 'Physics Lab',
                    dayOfWeek: 'Friday',
                    dayIndex: 5,
                    startTime: '14:00',
                    endTime: '17:00',
                    selected: true
                }
            ]);

            useStore.getState().applyOperations(ops);
            const created = useStore.getState().entities[0];
            expect(created).toBeDefined();

            // Verify active
            let active = getActiveEntities(useStore.getState().entities);
            expect(active.filter(e => e.kind === EntityKind.EVENT && e.recurrence)).toHaveLength(1);

            // Delete entity via store
            useStore.getState().deleteEntity(created.id);

            // Verify soft-deleted entity tombstone exists
            const inStore = useStore.getState().entities.find(e => e.id === created.id);
            expect(inStore).toBeDefined();
            expect(inStore?.metadata?.deleted).toBe(true);

            // Verify disappeared from active recurring events in SchedulesView
            active = getActiveEntities(useStore.getState().entities);
            const recurringAfter = active.filter(e => e.kind === EntityKind.EVENT && e.recurrence);
            expect(recurringAfter).toHaveLength(0);
        });
    });
});
