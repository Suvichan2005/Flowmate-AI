import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { contextResolver } from '../services/context';
import { ACTIVE_AI_TOOLS } from '../services/ai/tools';
import { SYSTEM_INSTRUCTION } from '../services/ai/prompts';

describe('removed location and travel defaults', () => {
  beforeEach(() => {
    useStore.setState({
      currentUser: null,
      kernelEntities: {},
      settings: {
        timezone: 'Asia/Kolkata',
        custom_instructions: '',
        // Simulate legacy persisted values. They must be ignored after this feature is removed.
        home_location: 'Legacy private home address',
        travel_preferences: {
          station_buffer_minutes: 45,
          airport_buffer_minutes: 120,
        },
        privacy_preferences: { capabilities: { device_location: { read: 'allow', mutation: 'deny' } } },
      } as never,
    });
  });

  it('does not add saved home location or arrival buffers to model context', async () => {
    const resolved = await contextResolver.resolveContext({
      userMessage: 'Plan my train trip tonight.',
      source: 'text_chat',
    });

    expect(resolved.serializedPromptSection).not.toContain('Legacy private home address');
    expect(resolved.serializedPromptSection).not.toContain('station_buffer_minutes');
    expect(resolved.serializedPromptSection).not.toContain('airport_buffer_minutes');
    expect(resolved.serializedPromptSection).not.toContain('45');
    expect(resolved.serializedPromptSection).not.toContain('120');
    expect(resolved).not.toHaveProperty('liveLocationContext');
    expect(resolved.userProfile).not.toHaveProperty('home_location');
  });

  it('does not expose route planning as a model tool or instruct the model to use hidden location', () => {
    const declarations = ACTIVE_AI_TOOLS.flatMap(tool => tool.functionDeclarations || []);
    expect(declarations.some(declaration => declaration.name === 'lookup_travel_route')).toBe(false);
    expect(SYSTEM_INSTRUCTION).not.toContain('station');
    expect(SYSTEM_INSTRUCTION).not.toContain('airport');
    expect(SYSTEM_INSTRUCTION).not.toContain('arrival buffer');
    expect(SYSTEM_INSTRUCTION).not.toContain('configured default home base');
    expect(SYSTEM_INSTRUCTION).not.toContain('lookup_travel_route');
  });

  it('drops retired location and travel fields when settings are next updated', () => {
    useStore.getState().updateSettings({ timezone: 'UTC' });
    expect(useStore.getState().settings).not.toHaveProperty('home_location');
    expect(useStore.getState().settings).not.toHaveProperty('travel_preferences');
    expect(useStore.getState().settings.privacy_preferences?.capabilities).not.toHaveProperty('device_location');
    expect(useStore.getState().settings.timezone).toBe('UTC');
  });
});
