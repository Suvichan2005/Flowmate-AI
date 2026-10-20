import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { GoogleGenAIMock } = vi.hoisted(() => ({ GoogleGenAIMock: vi.fn() }));

vi.mock('@google/genai', () => ({ GoogleGenAI: GoogleGenAIMock }));
vi.mock('../services/ai/managedClient', () => ({ hasManagedAiIdentity: () => false }));

import { getByokLiveClient, setEphemeralApiKey } from '../services/ai/client';

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

});
