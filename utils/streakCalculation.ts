/**
 * Streak Calculation Utilities
 * 
 * Provides functions to calculate streaks, aggregate activities by time periods,
 * and generate contribution data for heatmaps.
 */

import { Entity, EntityKind, EntityStatus } from '../types';

// Types for aggregation results
export interface DayAggregate {
    date: string; // YYYY-MM-DD
    count: number;
    totalMinutes: number;
    entities: string[]; // Entity IDs
}

export interface WeekAggregate {
    weekStart: string; // YYYY-MM-DD (Monday)
    weekNumber: number;
    count: number;
    totalMinutes: number;
    days: DayAggregate[];
}

export interface MonthAggregate {
    month: string; // YYYY-MM
    monthName: string;
    count: number;
    totalMinutes: number;
    weeks: WeekAggregate[];
}

export interface StreakInfo {
    current: number;
    longest: number;
    isActiveToday: boolean;
    lastActiveDate: string | null;
}

export interface ContributionData {
    date: string;
    count: number;
    level: 0 | 1 | 2 | 3 | 4; // 0 = no activity, 4 = high activity
}

/**
 * Get the date string (YYYY-MM-DD) from an ISO timestamp
 */
function toDateString(isoString: string): string {
    return isoString.split('T')[0];
}

/**
 * Get today's date string in YYYY-MM-DD format
 */
function getTodayString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * Get yesterday's date string in YYYY-MM-DD format
 */
function getYesterdayString(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
}

/**
 * Calculate the week number of the year for a given date
 */
function getWeekNumber(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 1);
    const diff = date.getTime() - start.getTime();
    const oneWeek = 604800000; // milliseconds in a week
    return Math.ceil((diff / oneWeek) + 1);
}

/**
 * Get the Monday of the week for a given date
 */
function getWeekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
}

/**
 * Filter entities to only include activities
 * IMPORTANT: Also extracts embedded metadata.activity_log entries and creates pseudo-entities
 * This ensures hours/heatmap calculations include ALL logged activities
 */
export function getActivityEntities(entities: Entity[]): Entity[] {
    const result: Entity[] = [];

    // 1. Add legacy ACTIVITY entities
    entities
        .filter(e => e.kind === EntityKind.ACTIVITY && e.status !== EntityStatus.CANCELED)
        .forEach(e => result.push(e));

    // 2. Extract metadata.activity_log entries from ALL entities and create pseudo-entities
    entities.forEach(e => {
        if (e.metadata?.activity_log && Array.isArray(e.metadata.activity_log)) {
            e.metadata.activity_log.forEach((log: any, idx: number) => {
                if (log.timestamp) {
                    // Create a pseudo-entity that tracks this activity log entry
                    result.push({
                        id: `${e.id}-log-${idx}`,
                        kind: EntityKind.ACTIVITY,
                        title: log.title || log.note || `Activity on ${e.title}`,
                        description: '',
                        status: EntityStatus.COMPLETED,
                        created_at: log.timestamp,
                        updated_at: log.timestamp,
                        priority: 0,
                        start_time: null,
                        end_time: null,
                        deadline: null,
                        recurrence: null,
                        canonical_tags: [],
                        duration_minutes: log.duration_minutes || 0,
                        metadata: { parentId: e.id, isNestedLog: true }
                    });
                }
            });
        }
    });

    return result;
}

/**
 * Filter entities to only include completed tasks
 */
export function getCompletedTasks(entities: Entity[]): Entity[] {
    return entities.filter(e =>
        e.kind === EntityKind.TASK &&
        e.status === EntityStatus.COMPLETED
    );
}

/**
 * Calculate current streak (consecutive days of activity)
 */
export function calculateCurrentStreak(entities: Entity[]): number {
    const activities = getActivityEntities(entities);
    if (activities.length === 0) return 0;

    // Get unique dates with activity, sorted descending
    const activeDates = [...new Set(
        activities
            .map(e => toDateString(e.created_at))
            .sort((a, b) => b.localeCompare(a))
    )];

    if (activeDates.length === 0) return 0;

    const today = getTodayString();
    const yesterday = getYesterdayString();

    // Streak must include today or yesterday to be "current"
    if (activeDates[0] !== today && activeDates[0] !== yesterday) {
        return 0;
    }

    let streak = 1;
    let checkDate = new Date(activeDates[0]);

    for (let i = 1; i < activeDates.length; i++) {
        checkDate.setDate(checkDate.getDate() - 1);
        const expectedDateStr = checkDate.toISOString().split('T')[0];

        if (activeDates[i] === expectedDateStr) {
            streak++;
        } else {
            break;
        }
    }

    return streak;
}

/**
 * Calculate longest streak ever achieved
 */
export function calculateLongestStreak(entities: Entity[]): number {
    const activities = getActivityEntities(entities);
    if (activities.length === 0) return 0;

    // Get unique dates with activity, sorted ascending
    const activeDates = [...new Set(
        activities
            .map(e => toDateString(e.created_at))
            .sort((a, b) => a.localeCompare(b))
    )];

    if (activeDates.length === 0) return 0;

    let longestStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < activeDates.length; i++) {
        const prevDate = new Date(activeDates[i - 1]);
        const currDate = new Date(activeDates[i]);

        // Check if dates are consecutive
        prevDate.setDate(prevDate.getDate() + 1);

        if (prevDate.toISOString().split('T')[0] === activeDates[i]) {
            currentStreak++;
            longestStreak = Math.max(longestStreak, currentStreak);
        } else {
            currentStreak = 1;
        }
    }

    return longestStreak;
}

/**
 * Get complete streak info
 */
export function getStreakInfo(entities: Entity[]): StreakInfo {
    const activities = getActivityEntities(entities);
    const activeDates = [...new Set(
        activities.map(e => toDateString(e.created_at))
    )].sort((a, b) => b.localeCompare(a));

    const today = getTodayString();

    return {
        current: calculateCurrentStreak(entities),
        longest: calculateLongestStreak(entities),
        isActiveToday: activeDates.includes(today),
        lastActiveDate: activeDates[0] || null
    };
}

/**
 * Aggregate activities by day
 */
export function aggregateByDay(entities: Entity[]): Map<string, DayAggregate> {
    const activities = getActivityEntities(entities);
    const dayMap = new Map<string, DayAggregate>();

    activities.forEach(activity => {
        const dateStr = toDateString(activity.created_at);
        const existing = dayMap.get(dateStr);
        const duration = activity.duration_minutes || 0;

        if (existing) {
            existing.count++;
            existing.totalMinutes += duration;
            existing.entities.push(activity.id);
        } else {
            dayMap.set(dateStr, {
                date: dateStr,
                count: 1,
                totalMinutes: duration,
                entities: [activity.id]
            });
        }
    });

    return dayMap;
}

/**
 * Aggregate activities by week
 */
export function aggregateByWeek(entities: Entity[]): WeekAggregate[] {
    const dayAggregates = aggregateByDay(entities);
    const weekMap = new Map<string, WeekAggregate>();

    dayAggregates.forEach((day, dateStr) => {
        const date = new Date(dateStr);
        const weekStart = getWeekStart(date);
        const weekNumber = getWeekNumber(date);

        const existing = weekMap.get(weekStart);
        if (existing) {
            existing.count += day.count;
            existing.totalMinutes += day.totalMinutes;
            existing.days.push(day);
        } else {
            weekMap.set(weekStart, {
                weekStart,
                weekNumber,
                count: day.count,
                totalMinutes: day.totalMinutes,
                days: [day]
            });
        }
    });

    return Array.from(weekMap.values())
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

/**
 * Aggregate activities by month
 */
export function aggregateByMonth(entities: Entity[]): MonthAggregate[] {
    const weekAggregates = aggregateByWeek(entities);
    const monthMap = new Map<string, MonthAggregate>();

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    weekAggregates.forEach(week => {
        const date = new Date(week.weekStart);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthName = monthNames[date.getMonth()];

        const existing = monthMap.get(monthKey);
        if (existing) {
            existing.count += week.count;
            existing.totalMinutes += week.totalMinutes;
            existing.weeks.push(week);
        } else {
            monthMap.set(monthKey, {
                month: monthKey,
                monthName,
                count: week.count,
                totalMinutes: week.totalMinutes,
                weeks: [week]
            });
        }
    });

    return Array.from(monthMap.values())
        .sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Generate contribution data for heatmap (GitHub-style)
 * Returns last 365 days of contribution data
 */
export function generateContributionData(entities: Entity[]): ContributionData[] {
    const dayAggregates = aggregateByDay(entities);
    const contributions: ContributionData[] = [];

    // Get all counts to calculate level thresholds
    const counts = Array.from(dayAggregates.values()).map(d => d.count);
    const maxCount = Math.max(...counts, 1);

    // Calculate level thresholds (quartiles)
    const threshold1 = Math.ceil(maxCount * 0.25);
    const threshold2 = Math.ceil(maxCount * 0.5);
    const threshold3 = Math.ceil(maxCount * 0.75);

    // Generate last 365 days
    const today = new Date();
    for (let i = 364; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        const dayData = dayAggregates.get(dateStr);
        const count = dayData?.count || 0;

        let level: 0 | 1 | 2 | 3 | 4 = 0;
        if (count > 0) {
            if (count >= threshold3) level = 4;
            else if (count >= threshold2) level = 3;
            else if (count >= threshold1) level = 2;
            else level = 1;
        }

        contributions.push({ date: dateStr, count, level });
    }

    return contributions;
}

/**
 * Get summary statistics
 */
export function getActivitySummary(entities: Entity[]) {
    const activities = getActivityEntities(entities);
    const completedTasks = getCompletedTasks(entities);
    const streak = getStreakInfo(entities);
    const thisWeek = aggregateByWeek(entities)[0];
    const thisMonth = aggregateByMonth(entities)[0];

    return {
        totalActivities: activities.length,
        totalCompletedTasks: completedTasks.length,
        totalMinutes: activities.reduce((sum, e) => sum + (e.duration_minutes || 0), 0),
        currentStreak: streak.current,
        longestStreak: streak.longest,
        activeToday: streak.isActiveToday,
        thisWeekCount: thisWeek?.count || 0,
        thisWeekMinutes: thisWeek?.totalMinutes || 0,
        thisMonthCount: thisMonth?.count || 0,
        thisMonthMinutes: thisMonth?.totalMinutes || 0
    };
}
