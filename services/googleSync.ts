import { ToonOperation, UserSettings, Entity, EntityKind } from "../types";

// Simulated delay to mimic Google API latency
const SIMULATED_LATENCY_MS = 800;

interface SyncResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export const GoogleCalendarAdapter = {
  /**
   * Applies a schedule_event operation to the external calendar.
   * In a real implementation, this would use the Google Calendar API.
   */
  syncEvent: async (op: ToonOperation, settings: UserSettings, entities: Entity[]): Promise<SyncResult> => {
    // 1. Check if sync is enabled
    if (!settings.sync_enabled) {
      return { success: true }; // Skipped, but technically "handled" locally
    }

    // 2. Identify if this operation affects an EVENT
    let isEventOp = false;

    if (op.type === 'schedule_event') {
        isEventOp = true;
    } else if (op.type === 'delete_entity') {
        // Check if the deleted entity was an EVENT
        // Note: The entity might be gone from the store if we processed the op already locally?
        // Actually, sync is async/background. The entity might be deleted from local store before sync runs?
        // store.ts processes sync AFTER applying ops. So entity is gone.
        // For delete, we assume we just send the delete command for the ID.
        // We can't check kind easily unless we store "deleted" tombstone.
        // For MVP simulation, we'll allow delete pass through.
        isEventOp = true; 
    } else if (op.type === 'update_entity') {
        // Check if the target entity is an EVENT
        const target = entities.find(e => e.id === op.payload.id);
        if (target && target.kind === EntityKind.EVENT) {
            isEventOp = true;
        }
    }

    if (!isEventOp) {
      return { success: true }; 
    }

    // 3. Simulate API Call
    return new Promise((resolve) => {
      setTimeout(() => {
        // Randomly simulate a failure if debug mode is on (10% chance)
        if (settings.debug_mode && Math.random() < 0.1) {
            console.warn("[GoogleSync] Simulated API Failure");
            resolve({ 
                success: false, 
                error: "Google API: Rate limit exceeded (Simulated)" 
            });
            return;
        }

        const payload = op.payload;
        
        // Log for developer visibility
        console.log(`[GoogleSync] Processed ${op.type} for "${payload.title || payload.id}"`);
        
        resolve({ 
            success: true, 
            externalId: `gcal-${Math.random().toString(36).substr(2, 9)}` 
        });
      }, SIMULATED_LATENCY_MS);
    });
  }
};