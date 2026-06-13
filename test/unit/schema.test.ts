import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  AGENTCFG_SCHEMA_DOCS,
  AgentConfigValidationError,
  parseAgentConfigYaml,
  parseCanonicalAgentConfig,
  serializeCanonicalAgentConfig,
  validateAgentConfig,
} from '../../src/core';

const CANONICAL_FIXTURE_DIR = resolve(process.cwd(), 'test/fixtures/canonical');
const VALID_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'valid.agentcfg.yaml');
const INVALID_SCHEMA_VERSION_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'invalid-schema-version.yaml');
const OLD_FLAT_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'old-flat.agentcfg.yaml');
const INVALID_DEFAULT_PROVIDER_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'invalid-default-provider.yaml');
const INVALID_DEFAULT_MODEL_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'invalid-default-model.yaml');
const INVALID_MODEL_METADATA_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'invalid-model-metadata.yaml');
const INVALID_DISCOVERY_PATH_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'invalid-discovery-path.yaml');
const INVALID_EMPTY_API_KEY_FIXTURE = resolve(CANONICAL_FIXTURE_DIR, 'invalid-empty-api-key.yaml');

const EXPECTED_CANONICAL_CONFIG = {
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
        value: 'sk-test-visible-openai',
      },
      modelDiscovery: {
        path: '/models',
      },
      models: {
        'gpt-4.1-mini': {
          variant: 'chat',
          contextWindow: 1047576,
          contextTokens: 1047576,
          maxTokens: 32768,
        },
        'gpt-4.1': {},
      },
    },
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: {
        type: 'plain',
        value: 'sk-ant-visible-anthropic',
      },
      models: {
        'claude-3-5-sonnet-latest': {
          contextWindow: 200000,
          contextTokens: 180000,
          maxTokens: 8192,
        },
      },
    },
  },
};

test('parses and normalizes the canonical multi-provider YAML fixture', () => {
  const config = parseCanonicalAgentConfig(readFileSync(VALID_FIXTURE, 'utf8'));

  assert.deepEqual(config, EXPECTED_CANONICAL_CONFIG);
});

test('serializes the canonical multi-provider shape without masking provider API keys', () => {
  const serialized = serializeCanonicalAgentConfig(EXPECTED_CANONICAL_CONFIG);
  const reparsed = parseAgentConfigYaml(serialized);

  assert.deepEqual(reparsed, EXPECTED_CANONICAL_CONFIG);
  assert.match(serialized, /sk-test-visible-openai/);
  assert.match(serialized, /sk-ant-visible-anthropic/);
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

test('rejects the old flat schemaVersion 1 provider/model/baseURL/apiKey shape', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(OLD_FLAT_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /defaults is required/);
      assert.match(error.message, /providers is required/);
      return true;
    },
  );
});

test('requires defaults to point at an existing provider and model', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(INVALID_DEFAULT_PROVIDER_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /defaults\.provider/);
      assert.match(error.message, /openai/);
      return true;
    },
  );

  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(INVALID_DEFAULT_MODEL_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /defaults\.model/);
      assert.match(error.message, /gpt-4\.1-mini/);
      return true;
    },
  );
});

test('validates optional model metadata when it is present', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(INVALID_MODEL_METADATA_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /providers\.openai\.models\.gpt-4\.1-mini\.variant/);
      assert.match(error.message, /non-empty string/);
      assert.match(error.message, /providers\.openai\.models\.gpt-4\.1-mini\.contextWindow/);
      assert.match(error.message, /positive integer/);
      assert.match(error.message, /providers\.openai\.models\.gpt-4\.1-mini\.contextTokens/);
      assert.match(error.message, /providers\.openai\.models\.gpt-4\.1-mini\.maxTokens/);
      return true;
    },
  );
});

test('requires optional provider model discovery paths to begin with slash', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(INVALID_DISCOVERY_PATH_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /providers\.openai\.modelDiscovery\.path/);
      assert.match(error.message, new RegExp('begin with /'));
      return true;
    },
  );
});

test('requires visible provider API keys to be non-empty plain values', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(readFileSync(INVALID_EMPTY_API_KEY_FIXTURE, 'utf8')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /providers\.openai\.apiKey\.type/);
      assert.match(error.message, /plain/);
      assert.match(error.message, /providers\.openai\.apiKey\.value/);
      assert.match(error.message, /non-empty string/);
      return true;
    },
  );
});

test('accepts object input with nested defaults, providers, and model metadata', () => {
  const config = validateAgentConfig(EXPECTED_CANONICAL_CONFIG);

  assert.deepEqual(config, EXPECTED_CANONICAL_CONFIG);
});

test('documents every canonical agentcfg.yaml schema field', () => {
  const fieldPaths = AGENTCFG_SCHEMA_DOCS.map((field) => field.path as string);

  assert.deepEqual(fieldPaths, [
    'schemaVersion',
    'defaults',
    'defaults.provider',
    'defaults.model',
    'providers',
    'providers.<provider>',
    'providers.<provider>.baseURL',
    'providers.<provider>.apiKey',
    'providers.<provider>.apiKey.type',
    'providers.<provider>.apiKey.value',
    'providers.<provider>.modelDiscovery',
    'providers.<provider>.modelDiscovery.path',
    'providers.<provider>.models',
    'providers.<provider>.models.<model>',
    'providers.<provider>.models.<model>.variant',
    'providers.<provider>.models.<model>.contextWindow',
    'providers.<provider>.models.<model>.contextTokens',
    'providers.<provider>.models.<model>.maxTokens',
  ]);
  assert.equal(new Set(fieldPaths).size, fieldPaths.length);

  const requiredFields = new Set([
    'schemaVersion',
    'defaults',
    'defaults.provider',
    'defaults.model',
    'providers',
    'providers.<provider>',
    'providers.<provider>.baseURL',
    'providers.<provider>.apiKey',
    'providers.<provider>.apiKey.type',
    'providers.<provider>.apiKey.value',
    'providers.<provider>.models',
  ]);

  for (const field of AGENTCFG_SCHEMA_DOCS) {
    assert.equal(field.required, requiredFields.has(field.path as string), `${field.path} should document required status`);
    assert.equal(field.type.trim().length > 0, true, `${field.path} should document a type`);
    assert.equal(field.description.trim().length > 0, true, `${field.path} should document a description`);
  }

  const apiKeyValueDoc = AGENTCFG_SCHEMA_DOCS.find(
    (field) => (field.path as string) === 'providers.<provider>.apiKey.value',
  );
  assert.match(apiKeyValueDoc?.description ?? '', /visible/);
  assert.match(apiKeyValueDoc?.description ?? '', /provider API key/);
  assert.doesNotMatch(apiKeyValueDoc?.description ?? '', /masked|redacted/i);
});
