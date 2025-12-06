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
        singleEvents: 'true',
        orderBy: 'startTime'
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
  }
};