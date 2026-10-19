import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasKey: false,
  managedAvailable: false,
  generateManaged: vi.fn(),
  generateByok: vi.fn(),
}));

vi.mock('../store', () => ({ useStore: { getState: () => ({ settings: { timezone: 'UTC' } }) } }));
vi.mock('../services/ai/client', () => ({
  getAiClient: () => ({ models: { generateContent: mocks.generateByok } }),
  hasAiApiKey: () => mocks.hasKey,
  GEMINI_RETRY_CONFIG: { maxRetries: 0 },
  DEFAULT_MODEL: 'test-model',
  MAX_FUNCTION_TURNS: 5,
}));
vi.mock('../services/ai/managedClient', () => ({
  hasManagedAiIdentity: () => mocks.managedAvailable,
  generateManagedContent: mocks.generateManaged,
  ManagedAiError: class ManagedAiError extends Error {
    constructor(readonly code: string, readonly status: number) { super(code); }
  },
}));
vi.mock('../utils/apiRetry', () => ({ withRetry: (operation: () => unknown) => operation() }));
vi.mock('../services/ai/tools', () => ({ FLOWMATE_TOOLS: [], ACTIVE_AI_TOOLS: [] }));
vi.mock('../services/ai/executors', () => ({ dispatchToolCall: vi.fn(), calculateRelevance: vi.fn() }));
vi.mock('../services/ai/prompts', () => ({
  SYSTEM_INSTRUCTION: '', FOOD_INSTRUCTIONS: '',
  buildBriefingPrompt: () => 'Create a short workspace briefing.',
  IMPROVEMENT_INSTRUCTIONS: {},
}));
vi.mock('../services/ai/context', () => ({
  buildEntityContext: vi.fn(), buildContextPrompt: vi.fn(), buildFoodContext: vi.fn(),
  buildHistory: vi.fn(), summarizeOlderMessages: vi.fn(), isLocationRelevantQuery: vi.fn(),
  formatLiveLocationForContext: vi.fn(),
}));
vi.mock('../context', () => ({ privacyManager: {}, contextResolver: {} }));
vi.mock('../firebase', () => ({ auth: { currentUser: null } }));

import { generateBriefing } from '../services/ai';

describe('daily briefing provider routing', () => {
  beforeEach(() => {
    mocks.hasKey = false;
    mocks.managedAvailable = false;
    mocks.generateManaged.mockReset();
    mocks.generateByok.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses managed Gemini for a guest identity and records managed provenance', async () => {
    mocks.managedAvailable = true;
    mocks.generateManaged.mockResolvedValue({ text: 'A useful AI briefing.' });

    const result = await generateBriefing({ entities: [], relationships: [] });

    expect(result).toEqual({ content: 'A useful AI briefing.', source: 'managed' });
    expect(mocks.generateManaged).toHaveBeenCalledOnce();
    expect(mocks.generateByok).not.toHaveBeenCalled();
  });

  it('does not silently replace a failed managed request with a local summary', async () => {
    mocks.managedAvailable = true;
    mocks.generateManaged.mockRejectedValue(new Error('GUEST_TURN_ALLOWANCE_EXHAUSTED'));

    await expect(generateBriefing({ entities: [], relationships: [] }))
      .rejects.toThrow('GUEST_TURN_ALLOWANCE_EXHAUSTED');
    expect(mocks.generateByok).not.toHaveBeenCalled();
  });

  it('uses the explicit local summary only when no AI provider is available', async () => {
    const result = await generateBriefing({ entities: [], relationships: [] });

    expect(result.source).toBe('local');
    expect(result.content).toContain('without an AI request');
    expect(mocks.generateManaged).not.toHaveBeenCalled();
  });

  it('keeps runtime BYOK as the preferred provider when configured', async () => {
    mocks.hasKey = true;
    mocks.managedAvailable = true;
    mocks.generateByok.mockResolvedValue({ text: 'A BYOK briefing.' });

    const result = await generateBriefing({ entities: [], relationships: [] });

    expect(result).toEqual({ content: 'A BYOK briefing.', source: 'byok' });
    expect(mocks.generateManaged).not.toHaveBeenCalled();
  });
});
