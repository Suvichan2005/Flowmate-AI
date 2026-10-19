import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCountTokensRequest } from '../lib/policy.js';

test('Gemini countTokens request preserves content, system instructions, and tools in the supported envelope', () => {
  const contents = [{ role: 'user', parts: [{ text: 'Synthetic acceptance prompt.' }] }];
  const tools = [{ functionDeclarations: [{ name: 'search_entities', description: 'Search this workspace.', parameters: { type: 'OBJECT', properties: {} } }] }];
  const body = buildCountTokensRequest('gemini-3.8-flash', contents, {
    systemInstruction: 'Keep the response concise.',
    tools,
    temperature: 0.2,
    thinkingConfig: { thinkingLevel: 'LOW' },
  });

  assert.deepEqual(body.generateContentRequest, {
    model: 'models/gemini-3.8-flash',
    contents,
    systemInstruction: { parts: [{ text: 'Keep the response concise.' }] },
    tools,
  });
});

test('Gemini countTokens omits optional empty steering fields', () => {
  assert.deepEqual(
    buildCountTokensRequest('gemini-3.8-flash', [{ role: 'user', parts: [{ text: 'Hi' }] }], { systemInstruction: '', tools: [] }),
    { generateContentRequest: { model: 'models/gemini-3.8-flash', contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] } },
  );
});
