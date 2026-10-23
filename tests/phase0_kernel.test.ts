/**
 * Flowmate Greenfield Domain Kernel — Phase-0 Unit Test Suite
 * STRICT INVARIANT: ZERO `any`
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SchemaRegistry,
  SchemaDefinition,
  validateEntity,
  CapabilityRegistry,
  LOCATIONAL_CAPABILITY,
  METRIC_CAPABILITY,
  KernelAuthorizer,
  ActionExecutionEngine,
  ActionProposal,
  InMemoryPersistenceAdapter,
  compactEntity,
  compactSchemaDigest,
  Entity,
} from '../services/kernel';

describe('Phase-0 Kernel: Schema Registry', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry();
  });

  const sampleSchema: SchemaDefinition = {
    id: 'test/telemetry',
    version: 1,
    displayName: 'Telemetry Sensor',
    description: 'Captures IoT device telemetry',
    scope: 'system',
    capabilities: ['locational', 'metric'],
    attributes: {
      location: {
        name: 'location',
        type: 'geopoint',
        label: 'Device Location',
        description: 'GPS coordinates',
        required: true,
      },
      battery_percentage: {
        name: 'battery_percentage',
        type: 'number',
        label: 'Battery Level',
        description: 'Remaining battery percentage',
        required: true,
        constraints: { min: 0, max: 100 },
      },
    },
    privacy_tier: 'device_local',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  };

  it('successfully registers and retrieves a valid schema definition', () => {
    registry.register(sampleSchema);
    const retrieved = registry.get('test/telemetry');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('test/telemetry');
    expect(retrieved?.displayName).toBe('Telemetry Sensor');
  });

  it('guarantees immutability via deep cloning', () => {
    registry.register(sampleSchema);
    const s1 = registry.get('test/telemetry');
    expect(s1).toBeDefined();
    if (s1) {
      s1.displayName = 'Mutated Display Name';
    }
    const s2 = registry.get('test/telemetry');
    expect(s2?.displayName).toBe('Telemetry Sensor');
  });

  it('rejects invalid schema IDs not conforming to namespace/name', () => {
    const invalid = { ...sampleSchema, id: 'bad_id_without_namespace' };
    expect(() => registry.register(invalid)).toThrow(/namespace\/name/);
  });

  it('rejects schema with non-positive integer version', () => {
    const invalid = { ...sampleSchema, version: 0 };
    expect(() => registry.register(invalid)).toThrow(/positive integer/);
  });

  it('rejects invalid regex patterns in attribute constraints', () => {
    const invalid = {
      ...sampleSchema,
      id: 'test/pattern_test',
      attributes: {
        code: {
          name: 'code',
          type: 'string',
          label: 'Code',
          description: 'Regexp code',
          required: true,
          constraints: { pattern: '[unclosed-regex' },
        },
      },
    } as SchemaDefinition;
    expect(() => registry.register(invalid)).toThrow(/invalid regex/);
  });
});

describe('Phase-0 Kernel: Entity Validation Engine', () => {
  const schema: SchemaDefinition = {
    id: 'test/sample_item',
    version: 1,
    displayName: 'Sample Item',
    description: 'For testing strict validation',
    scope: 'user',
    capabilities: [],
    attributes: {
      title_str: {
        name: 'title_str',
        type: 'string',
        label: 'Title',
        description: 'String title',
        required: true,
      },
      counter: {
        name: 'counter',
        type: 'number',
        label: 'Counter',
        description: 'Numeric counter',
        required: false,
      },
      flag: {
        name: 'flag',
        type: 'boolean',
        label: 'Flag',
        description: 'Boolean flag',
        required: false,
      },
      target_date: {
        name: 'target_date',
        type: 'date',
        label: 'Target Date',
        description: 'YYYY-MM-DD date',
        required: false,
      },
      status_enum: {
        name: 'status_enum',
        type: 'enum',
        label: 'Status',
        description: 'Enum option',
        required: false,
        enum_options: ['draft', 'published'],
      },
      cost: {
        name: 'cost',
        type: 'money',
        label: 'Cost',
        description: 'Money amount',
        required: false,
      },
      weight: {
        name: 'weight',
        type: 'quantity',
        label: 'Weight',
        description: 'Quantity value',
        required: false,
      },
      reference: {
        name: 'reference',
        type: 'entity_ref',
        label: 'Reference',
        description: 'Entity reference',
        required: false,
      },
      tags: {
        name: 'tags',
        type: 'array',
        label: 'Tags',
        description: 'Array tags',
        required: false,
      },
    },
    privacy_tier: 'private',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  };

  const validEntity: Entity = {
    id: 'ent_123',
    schema_id: 'test/sample_item',
    version: 1,
    title: 'Valid Entity',
    attributes: {
      title_str: 'Hello World',
      counter: 42,
      flag: true,
      target_date: '2026-10-07',
      status_enum: 'draft',
      cost: { amount: 99.99, currency: 'USD' },
      weight: { value: 1.5, unit: 'kg' },
      reference: { entity_id: 'ent_target' },
      tags: ['alpha', 'beta'],
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-07T12:00:00.000Z',
      updated_at: '2026-10-07T12:00:00.000Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-07T12:00:00.000Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  it('validates a conformant entity', () => {
    const result = validateEntity(validEntity, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.sanitized).toBeDefined();
  });

  it('rejects string coercion for number attribute', () => {
    const invalid = {
      ...validEntity,
      attributes: { ...validEntity.attributes, counter: '42' as unknown as number },
    };
    const result = validateEntity(invalid, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('counter') && e.includes('number'))).toBe(true);
  });

  it('rejects string coercion for boolean attribute', () => {
    const invalid = {
      ...validEntity,
      attributes: { ...validEntity.attributes, flag: 'true' as unknown as boolean },
    };
    const result = validateEntity(invalid, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('flag') && e.includes('boolean'))).toBe(true);
  });

  it('rejects invalid enum values', () => {
    const invalid = {
      ...validEntity,
      attributes: { ...validEntity.attributes, status_enum: 'archived' },
    };
    const result = validateEntity(invalid, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('status_enum') && e.includes('must be one of'))).toBe(true);
  });

  it('strictly enforces provenance confidence bounds [0, 1] without coercion', () => {
    const invalidHigh = {
      ...validEntity,
      provenance: { ...validEntity.provenance, confidence: 1.5 },
    };
    expect(validateEntity(invalidHigh, schema).valid).toBe(false);

    const invalidNegative = {
      ...validEntity,
      provenance: { ...validEntity.provenance, confidence: -0.1 },
    };
    expect(validateEntity(invalidNegative, schema).valid).toBe(false);

    const invalidString = {
      ...validEntity,
      provenance: { ...validEntity.provenance, confidence: '1.0' as unknown as number },
    };
    expect(validateEntity(invalidString, schema).valid).toBe(false);

    const validConfidence = {
      ...validEntity,
      provenance: { ...validEntity.provenance, confidence: 0.85 },
    };
    expect(validateEntity(validConfidence, schema).valid).toBe(true);
  });

  it('rejects unknown attributes not declared in schema', () => {
    const invalid = {
      ...validEntity,
      attributes: {
        ...validEntity.attributes,
        unregistered_field: 'sneaky_payload',
      },
    };
    const result = validateEntity(invalid, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown attribute "unregistered_field"'))).toBe(true);
  });

  it('detects and rejects prototype pollution keys', () => {
    const polluted = JSON.parse(`{
      "id": "ent_pwn",
      "schema_id": "test/sample_item",
      "version": 1,
      "title": "Pollution",
      "__proto__": { "admin": true },
      "attributes": { "title_str": "Test" },
      "lifecycle": { "status": "active", "created_at": "2026-10-07T00:00:00Z", "updated_at": "2026-10-07T00:00:00Z", "deleted_at": null },
      "provenance": { "source_type": "user", "observed_at": "2026-10-07T00:00:00Z", "confidence": 1.0, "is_inferred": false, "user_confirmed": true }
    }`);
    const result = validateEntity(polluted, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Prototype pollution'))).toBe(true);
  });
});

describe('Phase-0 Kernel: Capability Registry', () => {
  let capRegistry: CapabilityRegistry;

  beforeEach(() => {
    capRegistry = new CapabilityRegistry();
    capRegistry.register(LOCATIONAL_CAPABILITY);
    capRegistry.register(METRIC_CAPABILITY);
  });

  const testEntity: Entity = {
    id: 'ent_device_9',
    schema_id: 'test/device',
    version: 1,
    title: 'Drone Sensor',
    attributes: {
      location: { lat: 20.3533, lng: 85.8266, address: 'Campus 15, KIIT' },
      battery_percentage: 87,
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:00:00.000Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'device_sensor',
      observed_at: '2026-10-07T00:00:00.000Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  it('determines capability satisfaction and extracts typed contracts', () => {
    expect(capRegistry.isSatisfiedBy(testEntity, 'locational')).toBe(true);
    expect(capRegistry.isSatisfiedBy(testEntity, 'metric')).toBe(true);

    const locContract = capRegistry.extractContract<{ coordinates: { lat: number; lng: number }; display_label?: string }>(
      testEntity,
      'locational'
    );
    expect(locContract?.coordinates.lat).toBe(20.3533);
    expect(locContract?.display_label).toBe('Campus 15, KIIT');

    const metricContract = capRegistry.extractContract<{ metric_value: number; metric_unit?: string }>(
      testEntity,
      'metric'
    );
    expect(metricContract?.metric_value).toBe(87);
    expect(metricContract?.metric_unit).toBe('%');
  });

  it('supports open projection contracts without hardcoded view enums', () => {
    const locCap = capRegistry.get('locational');
    expect(locCap?.supported_projections).toEqual(['map']);
  });
});

describe('Phase-0 Kernel: Action Pipeline & Authorization Boundary', () => {
  let schemaRegistry: SchemaRegistry;
  let persistence: InMemoryPersistenceAdapter;
  let authorizer: KernelAuthorizer;
  let engine: ActionExecutionEngine;

  const taskSchema: SchemaDefinition = {
    id: 'system/test_task',
    version: 1,
    displayName: 'Test Task',
    description: 'Task schema for pipeline verification',
    scope: 'system',
    capabilities: [],
    attributes: {
      priority: {
        name: 'priority',
        type: 'number',
        label: 'Priority',
        description: 'Task priority',
        required: true,
      },
    },
    privacy_tier: 'private',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  };

  const sampleEntity: Entity = {
    id: 'task_001',
    schema_id: 'system/test_task',
    version: 1,
    title: 'Complete Phase 0',
    attributes: {
      priority: 1,
    },
    lifecycle: {
      status: 'pending',
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:00:00.000Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'user',
      observed_at: '2026-10-07T00:00:00.000Z',
      confidence: 1.0,
      is_inferred: false,
      user_confirmed: true,
    },
  };

  beforeEach(() => {
    schemaRegistry = new SchemaRegistry();
    schemaRegistry.register(taskSchema);
    persistence = new InMemoryPersistenceAdapter();
    authorizer = new KernelAuthorizer();
    engine = new ActionExecutionEngine(schemaRegistry, authorizer, persistence);
  });

  it('rejects proposals from unauthenticated actors', () => {
    const proposal: ActionProposal = {
      id: 'prop_unauth',
      source: 'ai_agent',
      intent: 'Create task',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const res = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: '' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unauthenticated actor/);
  });

  it('marks AI agent proposals as requires_confirmation: true', () => {
    const proposal: ActionProposal = {
      id: 'prop_ai_01',
      source: 'ai_agent',
      intent: 'Agent suggested task',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const res = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: 'user_42' });
    expect(res.success).toBe(true);
    expect(res.plan?.requires_confirmation).toBe(true);
    expect(res.plan?.preview_items).toHaveLength(1);
    expect(res.plan?.preview_items[0].title).toBe('Complete Phase 0');
  });

  it('allows plan generation without side-effects (clean persistence state before execution)', async () => {
    const proposal: ActionProposal = {
      id: 'prop_clean_test',
      source: 'ai_agent',
      intent: 'Preview without commit',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const res = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: 'user_42' });
    expect(res.success).toBe(true);

    // Verify entity was NOT stored yet
    const existing = await persistence.getEntity('task_001');
    expect(existing).toBeNull();
  });

  it('binds confirmation to the exact plan fingerprint and executes atomically', async () => {
    const proposal: ActionProposal = {
      id: 'prop_bind_test',
      source: 'ai_agent',
      intent: 'Create task with confirmation',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const planRes = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: 'user_42' });
    expect(planRes.plan).toBeDefined();
    if (!planRes.plan) return;

    // Confirm plan
    const confirmed = engine.confirm(planRes.plan, 'user_42');
    expect(confirmed.confirmation_token).toMatch(/^token_/);
    expect(confirmed.verified_fingerprint).toBe(planRes.plan.plan_fingerprint);
    expect(confirmed.verified_fingerprint).toMatch(/^sha256_[0-9a-f]{64}$/);

    // Execute plan with matching user
    const ok = await engine.execute(confirmed, { actor: 'user_ui', authenticated_user_id: 'user_42' });
    expect(ok).toBe(true);

    // Entity is now stored
    const saved = await persistence.getEntity('task_001');
    expect(saved).toBeDefined();
    expect(saved?.title).toBe('Complete Phase 0');
    expect(saved?.attributes.priority).toBe(1);

    // Audit log was appended
    const auditLogs = await persistence.getAuditLogs();
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].intent).toBe('Create task with confirmation');
  });

  it('strictly enforces user binding: User A confirms, User B execution is rejected', async () => {
    const proposal: ActionProposal = {
      id: 'prop_user_binding',
      source: 'ai_agent',
      intent: 'Personal task for user A',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const planRes = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: 'user_A' });
    if (!planRes.plan) throw new Error('Missing plan');

    // User A confirms
    const confirmedByA = engine.confirm(planRes.plan, { actor: 'user_ui', authenticated_user_id: 'user_A' });

    // User B attempts to execute it -> MUST FAIL
    await expect(
      engine.execute(confirmedByA, { actor: 'user_ui', authenticated_user_id: 'user_B' })
    ).rejects.toThrow(/User "user_B" cannot execute plan confirmed by "user_A"/);

    // Unauthenticated execution attempt -> MUST FAIL
    await expect(
      engine.execute(confirmedByA, { actor: 'user_ui', authenticated_user_id: '' })
    ).rejects.toThrow(/Unauthenticated executor context/);

    // Non-user_ui actor attempting to confirm -> MUST FAIL
    await expect(() =>
      engine.confirm(planRes.plan, { actor: 'ai_agent', authenticated_user_id: 'user_A' })
    ).toThrow(/Actor "ai_agent" cannot provide user confirmation/);
  });

  it('strictly prevents confirmation replay: a confirmed plan can only be executed once', async () => {
    const proposal: ActionProposal = {
      id: 'prop_replay_test',
      source: 'ai_agent',
      intent: 'One-time operation',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const planRes = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: 'user_42' });
    if (!planRes.plan) throw new Error('Missing plan');

    const confirmed = engine.confirm(planRes.plan, 'user_42');

    // First execution succeeds
    const ok = await engine.execute(confirmed, { actor: 'user_ui', authenticated_user_id: 'user_42' });
    expect(ok).toBe(true);

    // Second execution attempt with identical token MUST FAIL (replay protection)
    await expect(
      engine.execute(confirmed, { actor: 'user_ui', authenticated_user_id: 'user_42' })
    ).rejects.toThrow(/already been consumed \(replay attack detected\)/);
  });

  it('rejects execution if plan is tampered with after user confirmation (SHA-256)', async () => {
    const proposal: ActionProposal = {
      id: 'prop_tamper_test',
      source: 'ai_agent',
      intent: 'Honest task',
      mutations: [{ op: 'upsert_entity', entity: sampleEntity }],
    };
    const planRes = engine.plan(proposal, { actor: 'ai_agent', authenticated_user_id: 'user_42' });
    if (!planRes.plan) throw new Error('Missing plan');

    const confirmed = engine.confirm(planRes.plan, 'user_42');

    // Tamper with plan mutations after confirmation
    const tamperedPlan = {
      ...confirmed.plan,
      validated_mutations: [
        {
          op: 'upsert_entity' as const,
          entity: { ...sampleEntity, title: 'Tampered Malicious Title' },
        },
      ],
    };

    const tamperedConfirmed = {
      ...confirmed,
      plan: tamperedPlan,
    };

    await expect(
      engine.execute(tamperedConfirmed, { actor: 'user_ui', authenticated_user_id: 'user_42' })
    ).rejects.toThrow(/Plan tampering detected/);
  });

  it('rolls back atomically on batch failure (snapshot isolation)', async () => {
    const proposal: ActionProposal = {
      id: 'prop_fail_batch',
      source: 'user_ui',
      intent: 'Delete non-existent entity',
      mutations: [
        { op: 'upsert_entity', entity: sampleEntity },
        { op: 'soft_delete_entity', entity_id: 'non_existent_entity_999' },
      ],
    };
    const planRes = engine.plan(proposal, { actor: 'user_ui', authenticated_user_id: 'user_42' });
    if (!planRes.plan) throw new Error('Missing plan');

    const confirmed = engine.confirm(planRes.plan, 'user_42');

    // Execution should fail due to soft-delete on non-existent entity
    await expect(
      engine.execute(confirmed, { actor: 'user_ui', authenticated_user_id: 'user_42' })
    ).rejects.toThrow(/Cannot soft-delete non-existent entity/);

    // Task 001 should NOT have been committed (atomic rollback)
    const task = await persistence.getEntity('task_001');
    expect(task).toBeNull();
  });
});

describe('Phase-0 Kernel: Cryptographic Primitives (FIPS 180-4 SHA-256)', () => {
  it('computes exact SHA-256 NIST test vectors', async () => {
    const { sha256, canonicalJsonStringify } = await import('../services/kernel');
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('guarantees deterministic canonical JSON key sorting', async () => {
    const { canonicalJsonStringify } = await import('../services/kernel');
    const objA = { z: 1, a: 2, m: { y: 10, x: 20 } };
    const objB = { a: 2, m: { x: 20, y: 10 }, z: 1 };
    expect(canonicalJsonStringify(objA)).toBe(canonicalJsonStringify(objB));
    expect(canonicalJsonStringify(objA)).toBe('{"a":2,"m":{"x":20,"y":10},"z":1}');
  });
});

describe('Phase-0 Kernel: Deterministic Compact AI Serialization', () => {
  const schema: SchemaDefinition = {
    id: 'system/note',
    version: 2,
    displayName: 'Rich Note',
    description: 'User memo note',
    scope: 'system',
    capabilities: ['searchable'],
    attributes: {
      body: { name: 'body', type: 'string', label: 'Body', description: 'Content', required: true },
      category: { name: 'category', type: 'string', label: 'Category', description: 'Category', required: false },
      unused: { name: 'unused', type: 'string', label: 'Unused', description: 'Empty', required: false },
    },
    privacy_tier: 'private',
    created_at: '2026-10-07T00:00:00.000Z',
    updated_at: '2026-10-07T00:00:00.000Z',
  };

  const entity: Entity = {
    id: 'note_101',
    schema_id: 'system/note',
    version: 3,
    title: 'Research Ideas',
    attributes: {
      body: 'Investigate dynamic schemas',
      category: 'research',
      unused: '', // Should be omitted
    },
    lifecycle: {
      status: 'active',
      created_at: '2026-10-07T00:00:00.000Z',
      updated_at: '2026-10-07T00:00:00.000Z',
      deleted_at: null,
    },
    provenance: {
      source_type: 'agent',
      observed_at: '2026-10-07T00:00:00.000Z',
      confidence: 0.85,
      is_inferred: true,
      user_confirmed: false,
    },
    validity: {
      valid_from: '2026-10-07T10:00:00.000Z',
    },
  };

  it('compacts entity omitting empty fields and serializing concise keys', () => {
    const compact = compactEntity(entity, schema);
    expect(compact).toEqual({
      id: 'note_101',
      s: 'system/note',
      v: 3,
      t: 'Research Ideas',
      st: 'active',
      body: 'Investigate dynamic schemas',
      category: 'research',
      vf: '2026-10-07T10:00:00.000Z',
      inf: true,
      conf: 0.85,
    });
    // 'unused' was empty string, so it must not be present
    expect('unused' in compact).toBe(false);
  });

  it('generates a compact schema digest for prompt injection', () => {
    const digest = compactSchemaDigest(schema);
    expect(digest.id).toBe('system/note');
    expect(digest.version).toBe(2);
    expect(digest.capabilities).toEqual(['searchable']);
    expect(digest.attributes.body).toEqual({ type: 'string', required: true });
    expect(digest.attributes.category).toEqual({ type: 'string', required: false });
  });
});
