import assert from 'node:assert/strict';
import test from 'node:test';
import { maskConfig, maskConfigForOutput, maskSecret, MASKED_SECRET, type CanonicalAgentConfig } from '../../src/core';

const CONFIG: CanonicalAgentConfig = {
  schemaVersion: 1,
  defaults: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
  providers: {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: {
        type: 'plain',
        value: 'sk-test-redacted',
      },
      models: {
        'gpt-4.1-mini': {},
      },
    },
  },
};

test('masks API key values in config helpers', () => {
  const masked = maskConfig(CONFIG);

  assert.equal(masked.providers.openai.apiKey.value, MASKED_SECRET);
  assert.equal(masked.defaults.provider, 'openai');
  assert.notEqual(masked.providers.openai.apiKey.value, CONFIG.providers.openai.apiKey.value);
});

test('masks individual secret values', () => {
  assert.equal(maskSecret(CONFIG.providers.openai.apiKey.value), MASKED_SECRET);
  assert.equal(maskSecret(CONFIG.providers.openai.apiKey.value).includes(CONFIG.providers.openai.apiKey.value), false);
});

test('masked output never includes the raw API key', () => {
  const output = maskConfigForOutput(CONFIG);

  assert.ok(output.includes(MASKED_SECRET));
  assert.equal(output.includes(CONFIG.providers.openai.apiKey.value), false);
});
