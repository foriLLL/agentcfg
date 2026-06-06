import assert from 'node:assert/strict';
import test from 'node:test';
import { maskConfig, maskConfigForOutput, maskSecret, MASKED_SECRET, type CanonicalAgentConfig } from '../../src/core';

const CONFIG: CanonicalAgentConfig = {
  schemaVersion: 1,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: {
    type: 'plain',
    value: 'sk-test-redacted',
  },
};

test('masks API key values in config helpers', () => {
  const masked = maskConfig(CONFIG);

  assert.equal(masked.apiKey.value, MASKED_SECRET);
  assert.equal(masked.provider, 'openai');
  assert.notEqual(masked.apiKey.value, CONFIG.apiKey.value);
});

test('masks individual secret values', () => {
  assert.equal(maskSecret(CONFIG.apiKey.value), MASKED_SECRET);
  assert.equal(maskSecret(CONFIG.apiKey.value).includes(CONFIG.apiKey.value), false);
});

test('masked output never includes the raw API key', () => {
  const output = maskConfigForOutput(CONFIG);

  assert.ok(output.includes(MASKED_SECRET));
  assert.equal(output.includes(CONFIG.apiKey.value), false);
});
