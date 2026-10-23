/**
 * Flowmate Greenfield Domain Kernel — Capability Registry (Phase 0)
 * STRICT INVARIANTS:
 * - ZERO `any`
 * - Extensible `supported_projections: string[]` (NO hardcoded enum)
 * - Semantic Capability != Executable Authority
 */

import { Entity, GeoPointValue } from './types';

export interface CapabilityDefinition<TContract = unknown> {
  id: string;
  name: string;
  description: string;
  category: 'semantic' | 'executable';
  required_attributes: string[];
  is_satisfied_by: (entity: Entity) => boolean;
  extract_contract: (entity: Entity) => TContract;
  supported_projections: string[]; // Extensible projection contract references
}

export interface LocationalContract {
  coordinates: GeoPointValue;
  display_label?: string;
}

export interface MetricContract {
  metric_value: number;
  metric_unit?: string;
}

export class CapabilityRegistry {
  private capabilities = new Map<string, CapabilityDefinition<unknown>>();

  register<T>(cap: CapabilityDefinition<T>): void {
    this.capabilities.set(cap.id, cap as CapabilityDefinition<unknown>);
  }

  get(id: string): CapabilityDefinition<unknown> | undefined {
    return this.capabilities.get(id);
  }

  list(): CapabilityDefinition<unknown>[] {
    return Array.from(this.capabilities.values());
  }

  isSatisfiedBy(entity: Entity, capabilityId: string): boolean {
    const cap = this.capabilities.get(capabilityId);
    return cap ? cap.is_satisfied_by(entity) : false;
  }

  extractContract<T>(entity: Entity, capabilityId: string): T | null {
    const cap = this.capabilities.get(capabilityId);
    if (!cap || !cap.is_satisfied_by(entity)) return null;
    return cap.extract_contract(entity) as T;
  }
}

// Built-in Capability Definitions for Phase-0 Proof
export const LOCATIONAL_CAPABILITY: CapabilityDefinition<LocationalContract> = {
  id: 'locational',
  name: 'Locational Placement',
  description: 'Exposes geographic coordinate placement',
  category: 'semantic',
  required_attributes: ['location'],
  is_satisfied_by: (e: Entity) => {
    const loc = e.attributes.location;
    return Boolean(
      loc &&
        typeof loc === 'object' &&
        !Array.isArray(loc) &&
        typeof (loc as GeoPointValue).lat === 'number' &&
        typeof (loc as GeoPointValue).lng === 'number'
    );
  },
  extract_contract: (e: Entity) => {
    const geo = e.attributes.location as GeoPointValue;
    return {
      coordinates: geo,
      display_label: geo.address || e.title,
    };
  },
  supported_projections: ['map'],
};

export const METRIC_CAPABILITY: CapabilityDefinition<MetricContract> = {
  id: 'metric',
  name: 'Numeric Metric',
  description: 'Exposes quantitative measurement',
  category: 'semantic',
  required_attributes: ['battery_percentage'],
  is_satisfied_by: (e: Entity) => typeof e.attributes.battery_percentage === 'number',
  extract_contract: (e: Entity) => ({
    metric_value: e.attributes.battery_percentage as number,
    metric_unit: '%',
  }),
  supported_projections: ['chart', 'summary_card'],
};
