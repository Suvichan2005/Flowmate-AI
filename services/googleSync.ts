import { Entity, EntityKind, UserSettings } from "../types";
import { getGoogleAccessToken } from "./firebase";

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

interface CalendarEvent {
  summary: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

interface SyncResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export const GoogleCalendarAdapter = {
  /**
   * Check if we have a valid access token for Calendar API
   */
  isConnected: (): boolean => {
    return !!getGoogleAccessToken();
  },

  /**
   * Create an event in Google Calendar
   */
  createEvent: async (entity: Entity, settings: UserSettings): Promise<SyncResult> => {
    const accessToken = getGoogleAccessToken();

    if (!accessToken) {
      return { success: false, error: 'Not connected to Google Calendar. Sign in with Google first.' };
    }

    if (!settings.sync_enabled) {
      return { success: true }; // Sync disabled, skip
    }

    try {
      const startTime = entity.start_time || new Date().toISOString();
      const endTime = entity.end_time || new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();

      const event: CalendarEvent = {
        summary: entity.title,
        description: entity.description || `Created by Flowmate\n\nID: ${entity.id}`,
        start: {
          dateTime: startTime,
          timeZone: settings.timezone || 'Asia/Kolkata'
        },
        end: {
          dateTime: endTime,
          timeZone: settings.timezone || 'Asia/Kolkata'
        }
      };

      // Add colorId if specified (Google Calendar uses 1-11)
      if (entity.metadata?.calendar_color) {
        (event as any).colorId = entity.metadata.calendar_color;
      }

      // Add location if specified (for room numbers like C25-B-107)
      if (entity.metadata?.location) {
        (event as any).location = entity.metadata.location;
      }

      const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[GoogleSync] Create failed:', errorData);
        return { success: false, error: errorData.error?.message || 'Failed to create event' };
      }

      const data = await response.json();
      console.log(`[GoogleSync] Created event: ${data.id}`);

      return { success: true, externalId: data.id };
    } catch (error: any) {
      console.error('[GoogleSync] Error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Update an existing event in Google Calendar
   */
  updateEvent: async (entity: Entity, externalId: string, settings: UserSettings): Promise<SyncResult> => {
    const accessToken = getGoogleAccessToken();

    if (!accessToken || !settings.sync_enabled) {
      return { success: true };
    }

    try {
      const event: CalendarEvent = {
        summary: entity.title,
        description: entity.description || '',
        start: {
          dateTime: entity.start_time || new Date().toISOString(),
          timeZone: settings.timezone || 'Asia/Kolkata'
        },
        end: {
          dateTime: entity.end_time || new Date().toISOString(),
          timeZone: settings.timezone || 'Asia/Kolkata'
        }
      };

      const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events/${externalId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        return { success: false, error: 'Failed to update event' };
      }

      return { success: true, externalId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Delete an event from Google Calendar
   */
  deleteEvent: async (externalId: string): Promise<SyncResult> => {
    const accessToken = getGoogleAccessToken();

    if (!accessToken) {
      return { success: true }; // Can't delete if not connected
    }

    try {
      const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events/${externalId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok && response.status !== 404) {
        return { success: false, error: 'Failed to delete event' };
      }

      console.log(`[GoogleSync] Deleted event: ${externalId}`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Fetch events from Google Calendar (for import/two-way sync)
   */
  fetchEvents: async (timeMin: string, timeMax: string): Promise<any[]> => {
    const accessToken = getGoogleAccessToken();

    if (!accessToken) {
      return [];
    }

    try {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'false',  // Keep recurring events as single entity with RRULE
        maxResults: '250'
      });

      const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events?${params}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        console.error('[GoogleSync] Fetch failed');
        return [];
      }

      const data = await response.json();
      console.log(`[GoogleSync] Fetched ${data.items?.length || 0} events`);

      return data.items || [];
    } catch (error) {
      console.error('[GoogleSync] Fetch error:', error);
      return [];
    }
  },

  /**
   * Convert a Google Calendar event to Flowmate Entity format
   */
  convertGoogleEventToEntity: (gcEvent: any): Partial<Entity> => {
    // Detect all-day events (dateTime vs date)
    const isAllDay = !gcEvent.start?.dateTime && !!gcEvent.start?.date;

    let startTimeISO: string | undefined;
    let endTimeISO: string | undefined;

    if (isAllDay) {
      // All-day events: parse date as local midnight (not UTC)
      // Google sends "YYYY-MM-DD" format
      const startDateParts = gcEvent.start.date.split('-');
      const endDateParts = gcEvent.end?.date?.split('-');

      // Create date at local midnight
      startTimeISO = new Date(
        parseInt(startDateParts[0]),
        parseInt(startDateParts[1]) - 1,
        parseInt(startDateParts[2]),
        0, 0, 0
      ).toISOString();

      if (endDateParts) {
        // Google Calendar all-day end date is exclusive, so Dec 26 means event ends at midnight Dec 25
        // We'll set end time to 23:59:59 of the day BEFORE
        const endDate = new Date(
          parseInt(endDateParts[0]),
          parseInt(endDateParts[1]) - 1,
          parseInt(endDateParts[2]) - 1,  // Day before (exclusive → inclusive)
          23, 59, 59
        );
        endTimeISO = endDate.toISOString();
      }
    } else {
      // Timed events: use dateTime as-is
      startTimeISO = gcEvent.start?.dateTime ? new Date(gcEvent.start.dateTime).toISOString() : undefined;
      endTimeISO = gcEvent.end?.dateTime ? new Date(gcEvent.end.dateTime).toISOString() : undefined;
    }

    // Map Google Calendar RRULE to Flowmate recurrence type
    let recurrence = null;
    if (gcEvent.recurrence && gcEvent.recurrence.length > 0) {
      const rrule = gcEvent.recurrence[0] || '';
      if (rrule.includes('FREQ=DAILY')) recurrence = 'DAILY';
      else if (rrule.includes('FREQ=WEEKLY')) recurrence = 'WEEKLY';
      else if (rrule.includes('FREQ=MONTHLY')) recurrence = 'MONTHLY';
      else if (rrule.includes('FREQ=YEARLY')) recurrence = 'YEARLY';
    }

    // Map Google Calendar colorId to hex color
    const GCAL_COLORS: Record<string, string> = {
      '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
      '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
      '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
    };
    const colorHex = gcEvent.colorId ? GCAL_COLORS[gcEvent.colorId] : undefined;

    return {
      kind: EntityKind.EVENT,
      title: gcEvent.summary || 'Untitled Event',
      description: gcEvent.description || '',
      start_time: startTimeISO,
      end_time: endTimeISO,
      recurrence: recurrence,
      metadata: {
        google_calendar_id: gcEvent.id,
        google_calendar_etag: gcEvent.etag,
        location: gcEvent.location,
        calendar_color: gcEvent.colorId,
        color_hex: colorHex,
        is_all_day: isAllDay,
        source: 'google_calendar'
      }
    };
  },

  /**
   * Import events from Google Calendar (for 2-way sync)
   * Returns entities that don't already exist in Flowmate
   */
  importFromGoogleCalendar: async (existingEntities: Entity[]): Promise<Partial<Entity>[]> => {
    // Fetch events - extend range to catch recurring events with past start dates
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);

    console.log('[GoogleSync] Fetching events from', oneYearAgo.toISOString(), 'to', sixMonthsFromNow.toISOString());

    const events = await GoogleCalendarAdapter.fetchEvents(
      oneYearAgo.toISOString(),
      sixMonthsFromNow.toISOString()
    );

    // Filter out events that already exist (by google_calendar_id)
    const existingGoogleIds = new Set(
      existingEntities
        .filter(e => e.metadata?.google_calendar_id)
        .map(e => e.metadata.google_calendar_id)
    );

    console.log('[GoogleSync] Existing Google IDs in Flowmate:', [...existingGoogleIds]);
    console.log('[GoogleSync] Fetched events from GCal:', events.map((e: any) => ({ id: e.id, title: e.summary, recurrence: e.recurrence })));

    const newEvents = events
      .filter((e: any) => {
        const exists = existingGoogleIds.has(e.id);
        if (exists) console.log('[GoogleSync] Skipping existing:', e.summary);
        return !exists;
      })
      .map((e: any) => GoogleCalendarAdapter.convertGoogleEventToEntity(e));

    console.log(`[GoogleSync] Found ${newEvents.length} new events to import:`, newEvents.map(e => e.title));
    return newEvents;
  }
};