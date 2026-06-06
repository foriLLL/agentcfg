import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  AgentConfigValidationError,
  parseAgentConfigYaml,
  parseCanonicalAgentConfig,
  validateAgentConfig,
} from '../../src/core';

const VALID_FIXTURE = resolve(process.cwd(), 'test/fixtures/canonical/valid.agentcfg.yaml');
const INVALID_SCHEMA_VERSION_FIXTURE = resolve(
  process.cwd(),
  'test/fixtures/canonical/invalid-schema-version.yaml',
);

test('parses and normalizes the canonical MVP YAML fixture', () => {
  const config = parseCanonicalAgentConfig(readFileSync(VALID_FIXTURE, 'utf8'));

  assert.deepEqual(config, {
    schemaVersion: 1,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseURL: 'https://api.openai.com/v1',
    apiKey: {
      type: 'plain',
      value: 'sk-test-redacted',
    },
  });
});

test('rejects unsupported schema versions before native config parsing', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(INVALID_SCHEMA_VERSION_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /schemaVersion must be 1/);
      assert.match(error.message, /received 2/);
      return true;
    },
  );
});

test('rejects missing required fields with actionable field names', () => {
  const requiredFields = ['provider', 'model', 'baseURL', 'apiKey'] as const;

  for (const missingField of requiredFields) {
    const input = parseAgentConfigYaml(readFileSync(VALID_FIXTURE, 'utf8'));
    delete input[missingField];

    assert.throws(
      () => validateAgentConfig(input),
      (error) => {
        assert.ok(error instanceof AgentConfigValidationError);
        assert.match(error.message, new RegExp(`${missingField} is required`));
        return true;
      },
    );
  }
});

test('accepts nested plain apiKey YAML representation', () => {
  const config = parseCanonicalAgentConfig(`
schemaVersion: 1
provider: openai
model: gpt-4.1-mini
baseURL: https://api.openai.com/v1
apiKey:
  type: plain
  value: sk-test-redacted
`);

  assert.equal(config.apiKey.type, 'plain');
  assert.equal(config.apiKey.value, 'sk-test-redacted');
});

test('canonical YAML parser handles package-backed comments, quotes, and flow mappings', () => {
  const config = parseCanonicalAgentConfig(`
schemaVersion: 1
provider: "openai" # inline comment
model: 'gpt-4.1-mini'
baseURL: "https://api.openai.com/v1#default"
apiKey: { type: plain, value: "sk-test-redacted" }
`);

  assert.deepEqual(config, {
    schemaVersion: 1,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseURL: 'https://api.openai.com/v1#default',
    apiKey: {
      type: 'plain',
      value: 'sk-test-redacted',
    },
  });
});

test('accepts object input with a normalized plain apiKey', () => {
  const config = validateAgentConfig({
    schemaVersion: 1,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseURL: 'https://api.openai.com/v1',
    apiKey: {
      type: 'plain',
      value: 'sk-test-redacted',
    },
  });

  assert.deepEqual(config.apiKey, {
    type: 'plain',
    value: 'sk-test-redacted',
  });
});

test('rejects invalid apiKey object shapes', () => {
  assert.throws(
    () =>
      validateAgentConfig({
        schemaVersion: 1,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        baseURL: 'https://api.openai.com/v1',
        apiKey: {
          type: 'env',
          value: 'AGENTCFG_API_KEY',
        },
      }),
    /apiKey is required and must be a non-empty string or \{ type: "plain", value: string \}/,
  );
});
