import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { GoogleGenAIMock } = vi.hoisted(() => ({ GoogleGenAIMock: vi.fn() }));

vi.mock('@google/genai', () => ({ GoogleGenAI: GoogleGenAIMock }));
vi.mock('../services/ai/managedClient', () => ({ hasManagedAiIdentity: () => false }));

import { getByokLiveClient, getManagedLiveClient, setEphemeralApiKey } from '../services/ai/client';

describe('Gemini Live API protocol', () => {
  beforeEach(() => GoogleGenAIMock.mockClear());
  afterEach(() => setEphemeralApiKey(null));

  it('keeps BYOK Live on the standard v1beta endpoint', () => {
    setEphemeralApiKey('runtime-only-test-key');

    getByokLiveClient();

    expect(GoogleGenAIMock).toHaveBeenCalledWith({
      apiKey: 'runtime-only-test-key',
      httpOptions: { apiVersion: 'v1beta' },
    });
  });

  it('uses v1alpha for the SDK constrained ephemeral-token transport', () => {
    getManagedLiveClient('auth_tokens/session-token');

    expect(GoogleGenAIMock).toHaveBeenCalledWith({
      apiKey: 'auth_tokens/session-token',
      httpOptions: { apiVersion: 'v1alpha' },
    });
  });
});
