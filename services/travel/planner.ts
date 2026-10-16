/**
 * Critical-Path Backwards Journey Planner
 *
 * Implements backward scheduling from a fixed event departure:
 * fixed departure
 *    ↓
 * station/airport arrival buffer
 *    ↓
 * grounded travel duration
 *    ↓
 * departure-from-origin time
 *    ↓
 * dinner / packing / preparation tasks
 */

import { CriticalPathStep, JourneyCriticalPath, ResolvedLocation } from './types';

export interface JourneyPlannerOptions {
  stationBufferMinutes?: number;
  airportBufferMinutes?: number;
  terminalType?: 'station' | 'airport' | 'other';
  timezoneOffsetMinutes?: number; // default +330 (IST: +05:30)
}

export function calculateCriticalPathJourney(
  targetDepartureIso: string,
  origin: ResolvedLocation,
  destination: ResolvedLocation,
  transitDurationMinutes: number,
  isTrafficAware: boolean,
  options?: JourneyPlannerOptions,
): JourneyCriticalPath {
  const departureDate = new Date(targetDepartureIso);
  if (isNaN(departureDate.getTime())) {
    throw new Error(`Invalid target departure timestamp: ${targetDepartureIso}`);
  }

  // Detect terminal type if not specified
  let terminalType = options?.terminalType;
  if (!terminalType) {
    const destStr = (destination.displayName + ' ' + destination.query).toLowerCase();
    if (destStr.includes('airport') || destStr.includes('flight') || destStr.includes('terminal')) {
      terminalType = 'airport';
    } else {
      terminalType = 'station';
    }
  }

  // Buffer: station default 45 min, airport default 120 min
  const bufferMinutes =
    terminalType === 'airport'
      ? options?.airportBufferMinutes ?? 120
      : options?.stationBufferMinutes ?? 45;

  // Effective commute duration:
  // If not live traffic aware, add a cautious 10 min contingency so the user doesn't miss their train/flight
  const effectiveTransitMinutes = isTrafficAware
    ? transitDurationMinutes
    : transitDurationMinutes + 10;

  // 1. Terminal Arrival Target: departure minus buffer
  const terminalArrivalTarget = new Date(departureDate.getTime() - bufferMinutes * 60 * 1000);

  // 2. Leave Origin Time: terminal arrival minus commute duration
  const leaveOriginTime = new Date(
    terminalArrivalTarget.getTime() - effectiveTransitMinutes * 60 * 1000,
  );

  // 3. Dinner Window: 45 minutes, ending 20 minutes before departure from origin
  const dinnerDurationMinutes = 45;
  const dinnerEndTime = new Date(leaveOriginTime.getTime() - 20 * 60 * 1000);
  const dinnerStartTime = new Date(
    dinnerEndTime.getTime() - dinnerDurationMinutes * 60 * 1000,
  );

  // 4. Packing Window: 60 minutes, finishing when dinner starts
  const packingDurationMinutes = 60;
  const packingEndTime = dinnerStartTime;
  const packingStartTime = new Date(
    packingEndTime.getTime() - packingDurationMinutes * 60 * 1000,
  );

  const formatIsoWithOffset = (d: Date): string => {
    // Generate ISO string preserving +05:30 offset
    const pad = (n: number) => String(n).padStart(2, '0');
    const istTime = new Date(d.getTime() + (d.getTimezoneOffset() + 330) * 60 * 1000);
    const y = istTime.getFullYear();
    const m = pad(istTime.getMonth() + 1);
    const day = pad(istTime.getDate());
    const h = pad(istTime.getHours());
    const min = pad(istTime.getMinutes());
    const s = pad(istTime.getSeconds());
    return `${y}-${m}-${day}T${h}:${min}:${s}+05:30`;
  };

  const steps: CriticalPathStep[] = [
    {
      step: 'Packing & Bag Preparation',
      start: formatIsoWithOffset(packingStartTime),
      end: formatIsoWithOffset(packingEndTime),
      duration_minutes: packingDurationMinutes,
      description: `Pack bags, check tickets, chargers, essentials (${packingDurationMinutes} min)`,
      entity_kind: 'TSK',
    },
    {
      step: 'Dinner / Meal',
      start: formatIsoWithOffset(dinnerStartTime),
      end: formatIsoWithOffset(dinnerEndTime),
      duration_minutes: dinnerDurationMinutes,
      description: `Order or have dinner before leaving (${dinnerDurationMinutes} min)`,
      entity_kind: 'EVT',
    },
    {
      step: `Commute to ${destination.displayName || destination.query}`,
      start: formatIsoWithOffset(leaveOriginTime),
      end: formatIsoWithOffset(terminalArrivalTarget),
      duration_minutes: effectiveTransitMinutes,
      description: `Leave ${origin.displayName || origin.query} via cab/auto (${transitDurationMinutes} min road travel${
        !isTrafficAware ? ' + 10 min traffic contingency' : ''
      })`,
      entity_kind: 'EVT',
    },
    {
      step: `Platform / Gate Arrival Buffer`,
      start: formatIsoWithOffset(terminalArrivalTarget),
      end: formatIsoWithOffset(departureDate),
      duration_minutes: bufferMinutes,
      description: `Arrive at station ${bufferMinutes} min prior to departure to locate platform & coach`,
      entity_kind: 'EVT',
    },
    {
      step: `Journey Departure`,
      start: formatIsoWithOffset(departureDate),
      description: `Scheduled train/flight departure from ${destination.displayName || destination.query}`,
      entity_kind: 'EVT',
    },
  ];

  return {
    target_departure_time: formatIsoWithOffset(departureDate),
    terminal_arrival_target: formatIsoWithOffset(terminalArrivalTarget),
    leave_origin_time: formatIsoWithOffset(leaveOriginTime),
    transit_duration_minutes: effectiveTransitMinutes,
    terminal_buffer_minutes: bufferMinutes,
    dinner_window: {
      start: formatIsoWithOffset(dinnerStartTime),
      end: formatIsoWithOffset(dinnerEndTime),
      duration_minutes: dinnerDurationMinutes,
    },
    packing_window: {
      start: formatIsoWithOffset(packingStartTime),
      end: formatIsoWithOffset(packingEndTime),
      duration_minutes: packingDurationMinutes,
    },
    timeline_steps: steps,
  };
}
