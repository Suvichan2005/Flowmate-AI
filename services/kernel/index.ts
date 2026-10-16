/**
 * Flowmate Greenfield Domain Kernel — Index Exports (Phase 0)
 * STRICT INVARIANT: ZERO `any`
 */

export * from './types';
export * from './schemaRegistry';
export * from './validation';
export * from './capabilityRegistry';
export * from './authorization';
export * from './persistencePort';
export * from './actionPipeline';
export * from './compactEntity';
export * from './crypto';
export * from './bootstrap';
export * from './operationAdapter';
export * from './storePersistenceAdapter';
export * from './recurrence';
export * from './commitment';
export * from './reminders';

import { SchemaRegistry } from './schemaRegistry';
import { CapabilityRegistry } from './capabilityRegistry';
import { registerSystemSchemas, registerInfrastructureSchemas, registerSystemCapabilities } from './bootstrap';

export const schemaRegistry = new SchemaRegistry();
registerSystemSchemas(schemaRegistry);
registerInfrastructureSchemas(schemaRegistry);

export const capabilityRegistry = new CapabilityRegistry();
registerSystemCapabilities(capabilityRegistry);
