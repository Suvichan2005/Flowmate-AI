/**
 * Dynamic Context-Aware Suggestions Service
 * Generates personalized, time-sensitive prompt templates using Gemini Flash Lite
 * with instant zero-latency fallbacks tailored to current IST schedule, tasks, meals, and context.
 */

import { getAiClient } from './client';
import type { Entity, FoodLogEntry, Subject } from '../../types';

export interface ContextualSuggestion {
    icon: string;
    label: string;
    prompt: string;
    category?: 'schedule' | 'food' | 'attendance' | 'tasks' | 'general';
}

export interface SuggestionContext {
    entities: Entity[];
    foodLogs?: FoodLogEntry[];
    subjects?: Subject[];
}

let cachedSuggestions: ContextualSuggestion[] | null = null;
let lastGeneratedTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

/**
 * Get current hour and day in Asia/Kolkata (IST +05:30)
 */
function getIstTimeInfo(): { hour: number; dayName: string; timeStr: string } {
    const now = new Date();
    try {
        const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
        const [h] = timeStr.split(':').map(Number);
        const dayName = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' });
        return { hour: isNaN(h) ? now.getHours() : h, dayName, timeStr };
    } catch {
        return { hour: now.getHours(), dayName: 'Today', timeStr: now.toLocaleTimeString() };
    }
}

/**
 * Generate instant context-aware template suggestions with zero latency.
 */
export function getInstantContextualSuggestions(context: SuggestionContext): ContextualSuggestion[] {
    const { hour, dayName } = getIstTimeInfo();
    const suggestions: ContextualSuggestion[] = [];

    // 1. Check for upcoming events in entities
    const nowIso = new Date().toISOString();
    const upcomingEvents = (context.entities || [])
        .filter(e => e.kind === 'event' && (!e.status || e.status === 'pending'))
        .filter(e => {
            const date = (e.metadata as any)?.start_time || (e.metadata as any)?.date || e.created_at;
            return date && date >= nowIso.slice(0, 10);
        })
        .slice(0, 2);

    // 2. Check for pending tasks
    const pendingTasks = (context.entities || [])
        .filter(e => e.kind === 'task' && e.status !== 'completed' && e.status !== 'done')
        .slice(0, 3);

    // 3. Check today's food logs
    const todayStr = nowIso.slice(0, 10);
    const todaysFood = (context.foodLogs || []).filter(f => f.date === todayStr);
    const loggedMeals = new Set(todaysFood.map(f => f.mealType));

    // Dynamic suggestions based on time of day (IST)
    if (hour >= 5 && hour < 12) {
        // Morning: 5 AM - 12 PM
        if (upcomingEvents.length > 0) {
            const ev = upcomingEvents[0];
            suggestions.push({
                icon: '📅',
                label: `Review ${ev.title}`,
                prompt: `What are the details and preparation notes for "${ev.title}"?`,
                category: 'schedule'
            });
        } else {
            suggestions.push({
                icon: '🌅',
                label: 'Plan today\'s agenda',
                prompt: `Plan my schedule and priority tasks for today (${dayName}).`,
                category: 'schedule'
            });
        }

        if (!loggedMeals.has('breakfast')) {
            suggestions.push({
                icon: '🥣',
                label: 'Log morning breakfast',
                prompt: 'Log breakfast: 2 dosas with sambar and coffee (~380 kcal)',
                category: 'food'
            });
        }

        if (pendingTasks.length > 0) {
            suggestions.push({
                icon: '🎯',
                label: `Tackle ${pendingTasks[0].title}`,
                prompt: `Help me break down and start working on "${pendingTasks[0].title}"`,
                category: 'tasks'
            });
        } else {
            suggestions.push({
                icon: '🚆',
                label: 'Schedule upcoming travel',
                prompt: 'Create an event for my train to Kolkata tomorrow at 9:30 PM reaching at 5:15 AM',
                category: 'schedule'
            });
        }

        suggestions.push({
            icon: '⚡',
            label: 'Quick daily briefing',
            prompt: 'Give me a brief summary of my schedule, pending goals, and habits for today.',
            category: 'general'
        });
    } else if (hour >= 12 && hour < 17) {
        // Afternoon: 12 PM - 5 PM
        if (!loggedMeals.has('lunch')) {
            suggestions.push({
                icon: '🍛',
                label: 'Log lunch & calories',
                prompt: 'Log lunch: 2 rotis, paneer sabzi, dal, and fresh salad (~520 kcal)',
                category: 'food'
            });
        }

        if (pendingTasks.length > 0) {
            suggestions.push({
                icon: '📌',
                label: `Progress on ${pendingTasks[0].title}`,
                prompt: `Update progress on task "${pendingTasks[0].title}": `,
                category: 'tasks'
            });
        }

        suggestions.push({
            icon: '⏰',
            label: 'Afternoon productivity check',
            prompt: 'What tasks should I focus on completing before the evening?',
            category: 'tasks'
        });

        suggestions.push({
            icon: '🎯',
            label: 'Create new project / goal',
            prompt: 'Create a new project named "AI Research" with milestones and subtasks',
            category: 'general'
        });
    } else if (hour >= 17 && hour < 22) {
        // Evening: 5 PM - 10 PM
        if (!loggedMeals.has('dinner')) {
            suggestions.push({
                icon: '🍲',
                label: 'Log evening dinner',
                prompt: 'Log dinner: brown rice, grilled chicken/paneer, and veggies (~480 kcal)',
                category: 'food'
            });
        }

        suggestions.push({
            icon: '🏃',
            label: 'Track workout & hydration',
            prompt: 'Log 45 min evening workout and 2.5L water intake today',
            category: 'tasks'
        });

        suggestions.push({
            icon: '🚆',
            label: 'Schedule travel or commute',
            prompt: 'Create an event for my train tomorrow at 9:30 PM reaching at 5:15 AM',
            category: 'schedule'
        });

        suggestions.push({
            icon: '🌙',
            label: 'Review day\'s achievements',
            prompt: 'Review everything I completed today and calculate my productivity score.',
            category: 'general'
        });
    } else {
        // Night: 10 PM - 5 AM
        suggestions.push({
            icon: '📅',
            label: 'Tomorrow\'s schedule',
            prompt: 'What events, classes, and deadlines do I have scheduled for tomorrow?',
            category: 'schedule'
        });

        suggestions.push({
            icon: '🚆',
            label: 'Schedule travel / train',
            prompt: 'Create an event for my train to Kolkata tomorrow at 9:30 PM reaching at 5:15 AM',
            category: 'schedule'
        });

        suggestions.push({
            icon: '📝',
            label: 'Quick night journal entry',
            prompt: 'Add a journal note about today\'s highlights and key learnings: ',
            category: 'general'
        });

        suggestions.push({
            icon: '🎯',
            label: 'Add high-priority task',
            prompt: 'Create high-priority task: "Prepare slides for presentation" due tomorrow 4 PM',
            category: 'tasks'
        });
    }

    return suggestions.slice(0, 4);
}

/**
 * Fetch dynamic AI suggestions using Gemini Flash Lite if available,
 * with graceful fallback to context-rich instant suggestions.
 */
export async function generateContextualSuggestions(context: SuggestionContext): Promise<ContextualSuggestion[]> {
    const now = Date.now();
    if (cachedSuggestions && now - lastGeneratedTimestamp < CACHE_TTL_MS) {
        return cachedSuggestions;
    }

    const instant = getInstantContextualSuggestions(context);

    // If API key is not configured, return instant template suggestions
    if (!import.meta.env.VITE_GEMINI_API_KEY) {
        cachedSuggestions = instant;
        lastGeneratedTimestamp = now;
        return instant;
    }

    try {
        const ai = getAiClient();
        const { hour, dayName, timeStr } = getIstTimeInfo();

        const taskTitles = (context.entities || [])
            .filter(e => e.kind === 'task' && e.status !== 'completed')
            .slice(0, 3)
            .map(e => e.title);

        const prompt = `You are Flowmate AI's proactive assistant.
Generate exactly 4 concise, context-aware prompt templates for the user's empty chat state.
Current Time in India: ${timeStr} IST (${dayName}, hour ${hour}).
Pending user tasks: ${taskTitles.length ? taskTitles.join(', ') : 'None'}.

Rules:
1. Prompts must be realistic, actionable message templates the user might want to send Flowmate right now (e.g. scheduling a train/event with specific times, logging a meal, tracking a project, or reviewing tasks).
2. Each template must have:
   - "icon": a single emoji (e.g. 🚄, 🎯, 🥗, 📅)
   - "label": short 3-5 word label (e.g. "Schedule train to Kolkata", "Log lunch calories")
   - "prompt": pre-filled sentence ready to be edited and sent (e.g. "Create an event for my train to Kolkata tomorrow at 9:30 PM reaching at 5:15 AM")
3. Return ONLY valid JSON array with 4 items:
[{"icon":"...","label":"...","prompt":"..."},...]`;

        // Use gemini-2.5-flash-lite for instant, ultra-fast generation
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
            config: {
                temperature: 0.6,
                maxOutputTokens: 300,
                responseMimeType: 'application/json',
            }
        });

        const text = response.text?.trim();
        if (text) {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed) && parsed.length >= 3) {
                const cleaned: ContextualSuggestion[] = parsed.slice(0, 4).map(item => ({
                    icon: item.icon || '✨',
                    label: String(item.label || 'Action'),
                    prompt: String(item.prompt || ''),
                })).filter(s => s.prompt.length > 0);

                if (cleaned.length >= 3) {
                    cachedSuggestions = cleaned;
                    lastGeneratedTimestamp = now;
                    return cleaned;
                }
            }
        }
    } catch (error) {
        console.warn('[Suggestions] Gemini Flash-Lite generation fallback to local:', error);
    }

    cachedSuggestions = instant;
    lastGeneratedTimestamp = now;
    return instant;
}
