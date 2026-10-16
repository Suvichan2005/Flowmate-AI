/**
 * AI Timetable and Schedule Extraction Service
 *
 * Provides structured multimodal vision extraction for:
 * 1. Academic Class Timetables -> ExtractedClassSlot[] -> ToonOperation[] (EVT with WEEKLY recurrence)
 * 2. Dining / Hostel Mess Menus -> ExtractedMessMenu -> ToonOperation[] (NOTE with mess-schedule tag)
 */

import { GoogleGenAI, Type } from '@google/genai';
import { getAiClient, GEMINI_RETRY_CONFIG, DEFAULT_MODEL } from './client';
import { stripBase64Prefix, getMimeType } from '../../utils/imageProcessing';
import { withRetry } from '../../utils/apiRetry';
import { ToonOperation, Subject, ClassSchedule } from '../../types';
import { v4 as uuidv4 } from 'uuid';

export interface ExtractedClassSlot {
  id: string;
  subject: string;
  code?: string;
  dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  dayIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=Sunday, 1=Monday...
  startTime: string; // "HH:MM" e.g. "09:00"
  endTime: string;   // "HH:MM" e.g. "10:00"
  room?: string;
  instructor?: string;
  selected?: boolean;
}

export interface ExtractedMealDay {
  day: string;
  breakfast?: string;
  lunch?: string;
  snacks?: string;
  dinner?: string;
}

export interface ExtractedMessMenu {
  title: string;
  days: ExtractedMealDay[];
  notes?: string;
  rawMarkdown: string;
}

export const DAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const DAY_NAMES: ('Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday')[] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Calculates the next upcoming occurrence timestamp in ISO 8601 format with +05:30 IST offset.
 */
export function getNextOccurrenceDate(dayIndex: number, timeStr: string): string {
  const now = new Date();
  const currentDay = now.getDay();
  let daysToAdd = (dayIndex - currentDay + 7) % 7;

  const [hoursStr, minutesStr] = (timeStr || '09:00').split(':');
  const hours = parseInt(hoursStr, 10) || 0;
  const minutes = parseInt(minutesStr, 10) || 0;

  const target = new Date(now);
  target.setDate(now.getDate() + daysToAdd);
  target.setHours(hours, minutes, 0, 0);

  // If slot was scheduled for today but time has already passed, advance by 7 days
  if (daysToAdd === 0 && target.getTime() < now.getTime()) {
    target.setDate(target.getDate() + 7);
  }

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  const hh = String(hours).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`;
}

/**
 * Normalizes day name to canonical title case and index
 */
export function normalizeDayOfWeek(dayInput: string): { dayName: ExtractedClassSlot['dayOfWeek']; dayIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6 } {
  const cleaned = (dayInput || '').trim().toLowerCase();
  const index = DAY_MAP[cleaned] ?? 1; // Default Monday if unrecognized
  return {
    dayName: DAY_NAMES[index] as ExtractedClassSlot['dayOfWeek'],
    dayIndex: index,
  };
}

/**
 * Normalizes time string to 24-hour "HH:MM" format
 */
export function normalizeTimeFormat(timeInput: string): string {
  if (!timeInput) return '09:00';
  const clean = timeInput.trim().toUpperCase();

  // Match 12-hour format e.g. "9:30 AM", "02:15 PM", "9am", "2pm"
  const match12 = clean.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const meridian = match12[3];

    if (meridian === 'PM' && hours < 12) hours += 12;
    if (meridian === 'AM' && hours === 12) hours = 0;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  // Match 24-hour format e.g. "09:00", "14:30", "9:00"
  const match24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  return '09:00';
}

/**
 * Extracts class schedule slots from a timetable image or PDF base64 data URL.
 */
export async function extractTimetableFromImage(dataUrl: string, preferredModel?: string): Promise<ExtractedClassSlot[]> {
  const ai = getAiClient();
  const modelName = preferredModel || DEFAULT_MODEL;

  const prompt = `You are an expert academic timetable OCR parser.
Analyze this timetable schedule image carefully. Identify all recurring course periods / lectures / labs.
For each scheduled class slot in the grid:
- Identify the course/subject name (e.g. "Computer Networks", "Data Structures", "Operating Systems").
- Identify the course code if present (e.g. "CS301").
- Identify the day of week (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday).
- Identify start time and end time in 24-hour format HH:MM (e.g. "09:00", "10:30"). If given in 12-hour format like 9:00 AM or 2:00 PM, convert to 24-hour ("09:00", "14:00").
- Identify classroom, lecture hall, or lab room number if indicated.
- Identify the faculty or instructor name if indicated.
Return a list of all distinct recurring class periods.`;

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: stripBase64Prefix(dataUrl),
                  mimeType: getMimeType(dataUrl),
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: Type.OBJECT,
            properties: {
              classes: {
                type: Type.ARRAY,
                description: 'List of all recurring class periods found in the timetable grid.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    subject: {
                      type: Type.STRING,
                      description: 'Full course or subject name.',
                    },
                    code: {
                      type: Type.STRING,
                      description: 'Course code if present.',
                    },
                    dayOfWeek: {
                      type: Type.STRING,
                      description: 'Day of week (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday).',
                    },
                    startTime: {
                      type: Type.STRING,
                      description: 'Start time in 24-hour format HH:MM.',
                    },
                    endTime: {
                      type: Type.STRING,
                      description: 'End time in 24-hour format HH:MM.',
                    },
                    room: {
                      type: Type.STRING,
                      description: 'Room or lab location.',
                    },
                    instructor: {
                      type: Type.STRING,
                      description: 'Faculty or professor name.',
                    },
                  },
                  required: ['subject', 'dayOfWeek', 'startTime', 'endTime'],
                },
              },
            },
            required: ['classes'],
          },
        },
      }),
    GEMINI_RETRY_CONFIG
  );

  interface RawClassItem {
    dayOfWeek?: string;
    startTime?: string;
    endTime?: string;
    subject?: string;
    code?: string;
    room?: string;
    instructor?: string;
  }

  const text = response.text || '{}';
  let parsed: { classes?: RawClassItem[] } = {};
  try {
    parsed = JSON.parse(text) as { classes?: RawClassItem[] };
  } catch (err) {
    console.error('Failed to parse Gemini timetable response as JSON:', text, err);
    throw new Error('Could not parse timetable schedule from image. Please ensure the timetable image is clear and legible.');
  }

  const rawClasses = Array.isArray(parsed.classes) ? parsed.classes : [];
  return rawClasses.map((item: RawClassItem) => {
    const { dayName, dayIndex } = normalizeDayOfWeek(item.dayOfWeek);
    const start = normalizeTimeFormat(item.startTime);
    const end = normalizeTimeFormat(item.endTime);

    return {
      id: uuidv4(),
      subject: item.subject?.trim() || 'Untitled Class',
      code: item.code?.trim() || undefined,
      dayOfWeek: dayName,
      dayIndex,
      startTime: start,
      endTime: end,
      room: item.room?.trim() || undefined,
      instructor: item.instructor?.trim() || undefined,
      selected: true,
    };
  });
}

/**
 * Extracts mess dining menu from an image or PDF base64 data URL.
 */
export async function extractMessMenuFromImage(dataUrl: string, preferredModel?: string): Promise<ExtractedMessMenu> {
  const ai = getAiClient();
  const modelName = preferredModel || DEFAULT_MODEL;

  const prompt = `You are an expert dining mess menu reader.
Analyze this hostel/mess dining schedule image.
Extract the dining meal details for every day of the week (Monday through Sunday):
- For each day, extract the items served for Breakfast, Lunch, Evening Snacks, and Dinner.
- Include timings if specified on the menu board.
- Extract any general rules, rebate policies, or timings in notes.
Return structured JSON.`;

  const response = await withRetry(
    () =>
      ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: stripBase64Prefix(dataUrl),
                  mimeType: getMimeType(dataUrl),
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Title of the mess menu (e.g. Hostel Dining Menu).',
              },
              days: {
                type: Type.ARRAY,
                description: 'Day-by-day meal schedule.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    day: {
                      type: Type.STRING,
                      description: 'Day of week.',
                    },
                    breakfast: {
                      type: Type.STRING,
                      description: 'Breakfast items and timings.',
                    },
                    lunch: {
                      type: Type.STRING,
                      description: 'Lunch items and timings.',
                    },
                    snacks: {
                      type: Type.STRING,
                      description: 'Evening snacks items and timings.',
                    },
                    dinner: {
                      type: Type.STRING,
                      description: 'Dinner items and timings.',
                    },
                  },
                  required: ['day'],
                },
              },
              notes: {
                type: Type.STRING,
                description: 'Notes or dining timings.',
              },
            },
            required: ['title', 'days'],
          },
        },
      }),
    GEMINI_RETRY_CONFIG
  );

  interface RawMenuResponse {
    title?: string;
    notes?: string;
    days?: ExtractedMealDay[];
  }

  const text = response.text || '{}';
  let parsed: RawMenuResponse = {};
  try {
    parsed = JSON.parse(text) as RawMenuResponse;
  } catch (err) {
    console.error('Failed to parse Gemini mess menu response as JSON:', text, err);
    throw new Error('Could not parse mess menu from image. Please ensure the menu photo is clear.');
  }

  const days: ExtractedMealDay[] = Array.isArray(parsed.days) ? parsed.days : [];
  const title = parsed.title?.trim() || 'Hostel Dining Menu';
  const notes = parsed.notes?.trim() || '';

  // Generate clean, readable markdown for rendering in SchedulesView
  let md = `## ${title}\n\n`;
  days.forEach(d => {
    md += `### ${d.day}\n`;
    if (d.breakfast) md += `- **Breakfast**: ${d.breakfast}\n`;
    if (d.lunch) md += `- **Lunch**: ${d.lunch}\n`;
    if (d.snacks) md += `- **Snacks**: ${d.snacks}\n`;
    if (d.dinner) md += `- **Dinner**: ${d.dinner}\n`;
    md += '\n';
  });
  if (notes) {
    md += `> **Notes**: ${notes}\n`;
  }

  return {
    title,
    days,
    notes,
    rawMarkdown: md,
  };
}

/**
 * Converts confirmed timetable slots into ToonOperations (EVENT entities with WEEKLY recurrence).
 */
export function createTimetableOperations(classes: ExtractedClassSlot[]): ToonOperation[] {
  return classes.map(slot => {
    const dayIndex = slot.dayIndex ?? DAY_MAP[slot.dayOfWeek.toLowerCase()] ?? 1;
    const startIso = getNextOccurrenceDate(dayIndex, slot.startTime);
    const endIso = getNextOccurrenceDate(dayIndex, slot.endTime);

    const [startH, startM] = slot.startTime.split(':').map(Number);
    const [endH, endM] = slot.endTime.split(':').map(Number);
    const durationMinutes = Math.max(15, (endH * 60 + endM) - (startH * 60 + startM));

    return {
      type: 'create_entity',
      payload: {
        k: 'EVT',
        t: slot.subject,
        start: startIso,
        end: endIso,
        dur: durationMinutes,
        rec: 'WEEKLY',
        canonical_tags: ['class-schedule', 'academic'],
        m: {
          room: slot.room || '',
          instructor: slot.instructor || '',
          course_code: slot.code || '',
          day_of_week: slot.dayOfWeek,
          day_index: dayIndex,
          is_class: true,
          rrule: `FREQ=WEEKLY;BYDAY=${RRULE_DAYS[dayIndex]}`,
        },
      },
    };
  });
}

/**
 * Bridges timetable slots to store subjects and classSchedule arrays for AttendanceTracker.
 */
export function buildAttendanceBridge(
  classes: ExtractedClassSlot[],
  existingSubjects: Subject[],
  existingSchedules: ClassSchedule[]
): { updatedSubjects: Subject[]; updatedSchedules: ClassSchedule[] } {
  const newSubjects: Subject[] = [...existingSubjects];
  const newSchedules: ClassSchedule[] = [...existingSchedules];

  const subjectMap = new Map<string, string>(); // Lowercase subject name -> subject ID

  existingSubjects.forEach(s => {
    subjectMap.set(s.name.trim().toLowerCase(), s.id);
  });

  const PALETTE = ['#6366f1', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#14b8a6'];

  classes.forEach(slot => {
    const key = slot.subject.trim().toLowerCase();
    let subjectId = subjectMap.get(key);

    if (!subjectId) {
      subjectId = uuidv4();
      subjectMap.set(key, subjectId);
      newSubjects.push({
        id: subjectId,
        name: slot.subject.trim(),
        code: slot.code?.trim(),
        teacher_name: slot.instructor?.trim(),
        min_attendance: 75,
        color: PALETTE[newSubjects.length % PALETTE.length],
      });
    }

    const dayIndex = slot.dayIndex ?? DAY_MAP[slot.dayOfWeek.toLowerCase()] ?? 1;

    // Check if slot already exists to prevent duplication
    const duplicate = newSchedules.some(
      s =>
        s.subject_id === subjectId &&
        s.day_of_week === dayIndex &&
        s.start_time === slot.startTime &&
        s.end_time === slot.endTime
    );

    if (!duplicate) {
      newSchedules.push({
        id: uuidv4(),
        subject_id: subjectId,
        day_of_week: dayIndex,
        start_time: slot.startTime,
        end_time: slot.endTime,
        room: slot.room?.trim(),
      });
    }
  });

  return {
    updatedSubjects: newSubjects,
    updatedSchedules: newSchedules,
  };
}

/**
 * Converts extracted mess menu into a ToonOperation (NOTE entity with mess-schedule tag).
 */
export function createMessMenuOperation(menu: ExtractedMessMenu): ToonOperation {
  return {
    type: 'create_entity',
    payload: {
      k: 'NOT',
      t: menu.title || 'Hostel Mess Menu',
      d: menu.rawMarkdown,
      canonical_tags: ['mess-schedule', 'food-tracking'],
      m: {
        source: 'mess',
        days_count: menu.days?.length || 0,
      },
    },
  };
}
