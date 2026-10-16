/**
 * Flowmate Greenfield Domain Kernel — Seven-Concept Acceptance Suite
 * STRICT INVARIANT: ZERO `any`
 *
 * Proves that the Greenfield Kernel does NOT depend on a hardcoded ontology
 * or fixed EntityKind enum by instantiating and verifying 7 disparate domains:
 * 1. Task (system/task)
 * 2. Meeting / Event (user/meeting)
 * 3. Person / Contact (user/person)
 * 4. Book (user/book)
 * 5. Trip (user/trip)
 * 6. Job Application (user/job_application)
 * 7. Bad Habit (user/bad_habit)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SchemaRegistry,
  SchemaDefinition,
  validateEntity,
  KernelAuthorizer,
  ActionExecutionEngine,
  InMemoryPersistenceAdapter,
  compactEntity,
  Entity,
} from '../services/kernel';

describe('Phase-0 Kernel: Seven-Concept Open Ontology Proof', () => {
  let schemaRegistry: SchemaRegistry;
  let persistence: InMemoryPersistenceAdapter;
  let authorizer: KernelAuthorizer;
  let engine: ActionExecutionEngine;

  beforeEach(() => {
    schemaRegistry = new SchemaRegistry();
    persistence = new InMemoryPersistenceAdapter();
    authorizer = new KernelAuthorizer();
    engine = new ActionExecutionEngine(schemaRegistry, authorizer, persistence);
  });

  const now = '2026-10-07T12:00:00.000Z';

  // Helper to run full pipeline
  async function submitAndExecute(entity: Entity, userId: string = 'user_test_77') {
    const planRes = engine.plan(
      {
        id: `prop_${entity.id}`,
        source: 'user_ui',
        intent: `Upsert entity ${entity.title}`,
        mutations: [{ op: 'upsert_entity', entity }],
      },
      { actor: 'user_ui', authenticated_user_id: userId }
    );

    expect(planRes.success).toBe(true);
    expect(planRes.plan).toBeDefined();
    if (!planRes.plan) throw new Error('Planning failed');

    const confirmed = engine.confirm(planRes.plan, userId);
    const ok = await engine.execute(confirmed, { actor: 'user_ui', authenticated_user_id: userId });
    expect(ok).toBe(true);

    const retrieved = await persistence.getEntity(entity.id);
    expect(retrieved).toBeDefined();
    return retrieved;
  }

  // --- Concept 1: Task ---
  it('Concept 1: Task — validates, plans, executes and serializes', async () => {
    const taskSchema: SchemaDefinition = {
      id: 'system/task',
      version: 1,
      displayName: 'Task',
      description: 'Actionable item with deadline',
      scope: 'system',
      capabilities: ['schedulable', 'actionable'],
      attributes: {
        priority: { name: 'priority', type: 'number', label: 'Priority', description: 'Urgency 1-5', required: true, constraints: { min: 1, max: 5 } },
        due_at: { name: 'due_at', type: 'datetime', label: 'Due Date', description: 'Deadline', required: false },
        estimated_minutes: { name: 'estimated_minutes', type: 'duration_minutes', label: 'Estimated Time', description: 'Duration', required: false },
      },
      privacy_tier: 'private',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(taskSchema);

    const taskEntity: Entity = {
      id: 'task_demo_1',
      schema_id: 'system/task',
      version: 1,
      title: 'Review pull request',
      attributes: {
        priority: 2,
        due_at: '2026-10-08T18:00:00.000Z',
        estimated_minutes: 45,
      },
      lifecycle: { status: 'todo', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const saved = await submitAndExecute(taskEntity);
    expect(saved?.title).toBe('Review pull request');
    expect(saved?.attributes.priority).toBe(2);

    const compact = compactEntity(taskEntity, taskSchema);
    expect(compact.s).toBe('system/task');
    expect(compact.priority).toBe(2);
    expect(compact.estimated_minutes).toBe(45);
  });

  // --- Concept 2: Meeting / Event ---
  it('Concept 2: Meeting — validates, plans, executes and serializes', async () => {
    const meetingSchema: SchemaDefinition = {
      id: 'user/meeting',
      version: 1,
      displayName: 'Calendar Meeting',
      description: 'Collaborative scheduled event',
      scope: 'user',
      capabilities: ['locational', 'schedulable'],
      attributes: {
        location: { name: 'location', type: 'geopoint', label: 'Location', description: 'Coordinates and address', required: true },
        attendee_count: { name: 'attendee_count', type: 'number', label: 'Attendees', description: 'Number of people', required: true },
        virtual_link: { name: 'virtual_link', type: 'string', label: 'Video Link', description: 'URL', required: false },
      },
      privacy_tier: 'private',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(meetingSchema);

    const meetingEntity: Entity = {
      id: 'meet_demo_2',
      schema_id: 'user/meeting',
      version: 1,
      title: 'Sprint Planning',
      attributes: {
        location: { lat: 20.354, lng: 85.827, address: 'Conference Room B, Campus 15' },
        attendee_count: 8,
        virtual_link: 'https://meet.google.com/abc-defg-hij',
      },
      lifecycle: { status: 'scheduled', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
      validity: { valid_from: '2026-10-09T10:00:00.000Z', valid_until: '2026-10-09T11:00:00.000Z' },
    };

    const saved = await submitAndExecute(meetingEntity);
    expect(saved?.title).toBe('Sprint Planning');
    expect((saved?.attributes.location as Record<string, unknown>).lat).toBe(20.354);

    const compact = compactEntity(meetingEntity, meetingSchema);
    expect(compact.s).toBe('user/meeting');
    expect(compact.vf).toBe('2026-10-09T10:00:00.000Z');
  });

  // --- Concept 3: Person / Contact ---
  it('Concept 3: Person — validates, plans, executes and serializes', async () => {
    const personSchema: SchemaDefinition = {
      id: 'user/person',
      version: 1,
      displayName: 'Contact',
      description: 'Individual contact person',
      scope: 'user',
      capabilities: ['identifiable'],
      attributes: {
        email: { name: 'email', type: 'string', label: 'Email', description: 'Email address', required: true },
        role: { name: 'role', type: 'string', label: 'Role', description: 'Job title', required: false },
        organization: { name: 'organization', type: 'string', label: 'Org', description: 'Company name', required: false },
      },
      privacy_tier: 'sensitive',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(personSchema);

    const personEntity: Entity = {
      id: 'person_demo_3',
      schema_id: 'user/person',
      version: 1,
      title: 'Dr. Jane Smith',
      attributes: {
        email: 'jane.smith@example.org',
        role: 'Research Lead',
        organization: 'DeepMind',
      },
      lifecycle: { status: 'active', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const saved = await submitAndExecute(personEntity);
    expect(saved?.title).toBe('Dr. Jane Smith');
    expect(saved?.attributes.email).toBe('jane.smith@example.org');

    const compact = compactEntity(personEntity, personSchema);
    expect(compact.email).toBe('jane.smith@example.org');
  });

  // --- Concept 4: Book ---
  it('Concept 4: Book — validates, plans, executes and serializes', async () => {
    const bookSchema: SchemaDefinition = {
      id: 'user/book',
      version: 1,
      displayName: 'Book',
      description: 'Reading tracking item',
      scope: 'user',
      capabilities: ['trackable'],
      attributes: {
        author: { name: 'author', type: 'string', label: 'Author', description: 'Book author', required: true },
        total_pages: { name: 'total_pages', type: 'number', label: 'Pages', description: 'Page count', required: true },
        current_page: { name: 'current_page', type: 'number', label: 'Current Page', description: 'Progress', required: true },
        rating: { name: 'rating', type: 'number', label: 'Rating', description: '1-5 Stars', required: false, constraints: { min: 1, max: 5 } },
      },
      privacy_tier: 'private',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(bookSchema);

    const bookEntity: Entity = {
      id: 'book_demo_4',
      schema_id: 'user/book',
      version: 1,
      title: 'Structure and Interpretation of Computer Programs',
      attributes: {
        author: 'Harold Abelson & Gerald Jay Sussman',
        total_pages: 657,
        current_page: 240,
        rating: 5,
      },
      lifecycle: { status: 'reading', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const saved = await submitAndExecute(bookEntity);
    expect(saved?.title).toContain('Structure and Interpretation');
    expect(saved?.attributes.current_page).toBe(240);

    const compact = compactEntity(bookEntity, bookSchema);
    expect(compact.author).toBe('Harold Abelson & Gerald Jay Sussman');
  });

  // --- Concept 5: Trip ---
  it('Concept 5: Trip — validates, plans, executes and serializes', async () => {
    const tripSchema: SchemaDefinition = {
      id: 'user/trip',
      version: 1,
      displayName: 'Travel Itinerary',
      description: 'Trip itinerary and budget',
      scope: 'user',
      capabilities: ['locational', 'budgetable'],
      attributes: {
        destination: { name: 'destination', type: 'string', label: 'Destination', description: 'City/Country', required: true },
        budget: { name: 'budget', type: 'money', label: 'Budget', description: 'Estimated budget', required: true },
        start_date: { name: 'start_date', type: 'date', label: 'Start Date', description: 'Departure', required: true },
        end_date: { name: 'end_date', type: 'date', label: 'End Date', description: 'Return', required: true },
      },
      privacy_tier: 'private',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(tripSchema);

    const tripEntity: Entity = {
      id: 'trip_demo_5',
      schema_id: 'user/trip',
      version: 1,
      title: 'Kyoto Autumn Tour',
      attributes: {
        destination: 'Kyoto, Japan',
        budget: { amount: 350000, currency: 'JPY' },
        start_date: '2026-11-10',
        end_date: '2026-11-18',
      },
      lifecycle: { status: 'planned', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const saved = await submitAndExecute(tripEntity);
    expect(saved?.title).toBe('Kyoto Autumn Tour');
    expect(saved?.attributes.destination).toBe('Kyoto, Japan');
    expect((saved?.attributes.budget as Record<string, unknown>).currency).toBe('JPY');

    const compact = compactEntity(tripEntity, tripSchema);
    expect(compact.destination).toBe('Kyoto, Japan');
  });

  // --- Concept 6: Job Application ---
  it('Concept 6: Job Application — validates, plans, executes and serializes', async () => {
    const jobAppSchema: SchemaDefinition = {
      id: 'user/job_application',
      version: 1,
      displayName: 'Career Opportunity',
      description: 'Job interview pipeline tracker',
      scope: 'user',
      capabilities: ['stageable'],
      attributes: {
        company: { name: 'company', type: 'string', label: 'Company', description: 'Company name', required: true },
        role_title: { name: 'role_title', type: 'string', label: 'Role', description: 'Position title', required: true },
        stage: {
          name: 'stage',
          type: 'enum',
          label: 'Stage',
          description: 'Hiring stage',
          required: true,
          enum_options: ['applied', 'screen', 'technical_interview', 'onsite', 'offer', 'rejected'],
        },
        compensation: { name: 'compensation', type: 'money', label: 'Target Comp', description: 'Base salary target', required: false },
      },
      privacy_tier: 'sensitive',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(jobAppSchema);

    const jobAppEntity: Entity = {
      id: 'job_demo_6',
      schema_id: 'user/job_application',
      version: 1,
      title: 'Senior Systems Architect at DeepMind',
      attributes: {
        company: 'Google DeepMind',
        role_title: 'Senior Systems Architect',
        stage: 'technical_interview',
        compensation: { amount: 220000, currency: 'USD' },
      },
      lifecycle: { status: 'in_progress', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const saved = await submitAndExecute(jobAppEntity);
    expect(saved?.title).toBe('Senior Systems Architect at DeepMind');
    expect(saved?.attributes.stage).toBe('technical_interview');

    const compact = compactEntity(jobAppEntity, jobAppSchema);
    expect(compact.stage).toBe('technical_interview');
  });

  // --- Concept 7: Bad Habit Tracker ---
  it('Concept 7: Bad Habit — validates, plans, executes and serializes', async () => {
    const habitSchema: SchemaDefinition = {
      id: 'user/bad_habit',
      version: 1,
      displayName: 'Harm Reduction Habit',
      description: 'Tracking cessation of unwanted behaviors',
      scope: 'user',
      capabilities: ['trackable', 'metric'],
      attributes: {
        trigger: { name: 'trigger', type: 'string', label: 'Trigger', description: 'Identified stimulus', required: true },
        replacement_behavior: { name: 'replacement_behavior', type: 'string', label: 'Replacement', description: 'Substitute action', required: true },
        streak_days: { name: 'streak_days', type: 'number', label: 'Clean Streak', description: 'Consecutive clean days', required: true, constraints: { min: 0 } },
        severity_level: {
          name: 'severity_level',
          type: 'enum',
          label: 'Severity',
          description: 'Impact score',
          required: true,
          enum_options: ['mild', 'moderate', 'severe'],
        },
      },
      privacy_tier: 'private',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(habitSchema);

    const habitEntity: Entity = {
      id: 'habit_demo_7',
      schema_id: 'user/bad_habit',
      version: 1,
      title: 'Late Night Screen Time',
      attributes: {
        trigger: 'Boredom after 11 PM',
        replacement_behavior: 'Read physical book for 20 minutes',
        streak_days: 14,
        severity_level: 'moderate',
      },
      lifecycle: { status: 'recovering', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const saved = await submitAndExecute(habitEntity);
    expect(saved?.title).toBe('Late Night Screen Time');
    expect(saved?.attributes.streak_days).toBe(14);

    const compact = compactEntity(habitEntity, habitSchema);
    expect(compact.streak_days).toBe(14);
    expect(compact.trigger).toBe('Boredom after 11 PM');
  });

  it('rejects entity when schema constraint or required attribute fails', () => {
    const bookSchema: SchemaDefinition = {
      id: 'user/book',
      version: 1,
      displayName: 'Book',
      description: 'Reading tracking item',
      scope: 'user',
      capabilities: ['trackable'],
      attributes: {
        author: { name: 'author', type: 'string', label: 'Author', description: 'Book author', required: true },
        total_pages: { name: 'total_pages', type: 'number', label: 'Pages', description: 'Page count', required: true },
        current_page: { name: 'current_page', type: 'number', label: 'Current Page', description: 'Progress', required: true },
      },
      privacy_tier: 'private',
      created_at: now,
      updated_at: now,
    };
    schemaRegistry.register(bookSchema);

    const brokenBook: Entity = {
      id: 'broken_book_fail',
      schema_id: 'user/book',
      version: 1,
      title: 'Incomplete Book',
      attributes: {
        author: 'Unknown',
        // total_pages and current_page are missing (required)
      },
      lifecycle: { status: 'reading', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1.0, is_inferred: false, user_confirmed: true },
    };

    const res = validateEntity(brokenBook, bookSchema);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('total_pages') && e.includes('required'))).toBe(true);
    expect(res.errors.some(e => e.includes('current_page') && e.includes('required'))).toBe(true);
  });
});
