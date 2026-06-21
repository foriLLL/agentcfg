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
const CJK_COPY_PATTERN = /[\u3400-\u9fff]/u;



const PROTOCOL_CATALOG_YAML = [
  'schemaVersion: 1',
  'defaults:',
  '  provider: openai',
  '  model: gpt-4.1-mini',
  'providers:',
  '  openai:',
  '    protocol: openai-compatible',
  '    baseURL: https://api.openai.com/v1',
  '    apiKey:',
  '      type: plain',
  '      value: sk-test-visible-openai',
  '    modelDiscovery:',
  '      path: /models',
  '    models:',
  '      gpt-4.1-mini:',
  '        variant: thinking-medium',
  '        contextWindow: 1047576',
  '        contextTokens: 1047576',
  '        maxTokens: 32768',
  '        supportsVision: true',
  '  anthropic:',
  '    protocol: anthropic-compatible',
  '    baseURL: https://api.anthropic.com/v1',
  '    apiKey:',
  '      type: plain',
  '      value: sk-ant-visible-anthropic',
  '    models:',
  '      claude-3-5-sonnet-latest:',
  '        variant: thinking-high',
  '        contextWindow: 200000',
  '        contextTokens: 180000',
  '        maxTokens: 8192',
  '        supportsVision: true',
  '',
].join('\n');

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
  ohMyOpenAgent: {
    agents: {
      oracle: {
        model: 'openai/gpt-4.1-mini',
        variant: 'high',
      },
    },
    categories: {
      'visual-engineering': {
        model: 'anthropic/claude-3-5-sonnet-latest',
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



test('provider catalog schema preserves OpenAI-compatible and Anthropic-compatible protocol capabilities', () => {
  const config = parseCanonicalAgentConfig(PROTOCOL_CATALOG_YAML);
  const openaiProvider = config.providers.openai as unknown as Record<string, unknown>;
  const anthropicProvider = config.providers.anthropic as unknown as Record<string, unknown>;
  const openaiModel = config.providers.openai.models['gpt-4.1-mini'] as unknown as Record<string, unknown>;
  const anthropicModel = config.providers.anthropic.models['claude-3-5-sonnet-latest'] as unknown as Record<string, unknown>;

  assert.equal(openaiProvider.protocol, 'openai-compatible', 'OpenAI-compatible provider protocol should be preserved in the catalog');
  assert.equal(anthropicProvider.protocol, 'anthropic-compatible', 'Anthropic-compatible provider protocol should be preserved in the catalog');
  assert.deepEqual(
    {
      contextWindow: openaiModel.contextWindow,
      contextTokens: openaiModel.contextTokens,
      maxTokens: openaiModel.maxTokens,
      variant: openaiModel.variant,
      supportsVision: openaiModel.supportsVision,
    },
    {
      contextWindow: 1047576,
      contextTokens: 1047576,
      maxTokens: 32768,
      variant: 'thinking-medium',
      supportsVision: true,
    },
    'OpenAI-compatible model should preserve context, output, thinking variant, and image/vision metadata',
  );
  assert.deepEqual(
    {
      contextWindow: anthropicModel.contextWindow,
      contextTokens: anthropicModel.contextTokens,
      maxTokens: anthropicModel.maxTokens,
      variant: anthropicModel.variant,
      supportsVision: anthropicModel.supportsVision,
    },
    {
      contextWindow: 200000,
      contextTokens: 180000,
      maxTokens: 8192,
      variant: 'thinking-high',
      supportsVision: true,
    },
    'Anthropic-compatible model should preserve context, output, thinking variant, and image/vision metadata',
  );
});

test('provider catalog schema rejects unsupported provider protocols and invalid vision metadata', () => {
  assert.throws(
    () => parseCanonicalAgentConfig(PROTOCOL_CATALOG_YAML.replace('protocol: openai-compatible', 'protocol: browser-compatible')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /providers\.openai\.protocol/);
      assert.match(error.message, /openai-compatible/);
      assert.match(error.message, /anthropic-compatible/);
      return true;
    },
  );

  assert.throws(
    () => parseCanonicalAgentConfig(PROTOCOL_CATALOG_YAML.replace('supportsVision: true', 'supportsVision: maybe')),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /providers\.openai\.models\.gpt-4\.1-mini\.supportsVision/);
      assert.match(error.message, /boolean/);
      return true;
    },
  );
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

test('rejects provider IDs containing slash so provider model references stay unambiguous', () => {
  assert.throws(
    () => validateAgentConfig({
      ...EXPECTED_CANONICAL_CONFIG,
      defaults: {
        provider: 'open/router',
        model: 'gpt-4.1-mini',
      },
      providers: {
        'open/router': {
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: {
            type: 'plain',
            value: 'sk-test-visible-openrouter',
          },
          models: {
            'anthropic/claude-3-5-sonnet-latest': {},
          },
        },
      },
      ohMyOpenAgent: undefined,
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /providers\.open\/router/);
      assert.match(error.message, /must not include \/ because OhMyOpenAgent model references use provider\/model/);
      return true;
    },
  );
});

test('accepts object input with nested defaults, providers, and model metadata', () => {
  const config = validateAgentConfig(EXPECTED_CANONICAL_CONFIG);

  assert.deepEqual(config, EXPECTED_CANONICAL_CONFIG);
});

test('validates OhMyOpenAgent agent and category model mappings', () => {
  assert.throws(
    () => validateAgentConfig({
      ...EXPECTED_CANONICAL_CONFIG,
      ohMyOpenAgent: {
        agents: {
          ghost: {
            model: 'openai/gpt-4.1-mini',
          },
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /ohMyOpenAgent\.agents\.ghost/);
      assert.match(error.message, /supported OhMyOpenAgent name/);
      return true;
    },
  );

  assert.throws(
    () => validateAgentConfig({
      ...EXPECTED_CANONICAL_CONFIG,
      ohMyOpenAgent: {
        categories: {
          background: {
            model: 'openai/gpt-4.1-mini',
          },
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /ohMyOpenAgent\.categories\.background/);
      assert.match(error.message, /supported OhMyOpenAgent name/);
      return true;
    },
  );

  assert.throws(
    () => validateAgentConfig({
      ...EXPECTED_CANONICAL_CONFIG,
      ohMyOpenAgent: {
        agents: {
          oracle: {
            model: 'openai/missing-model',
          },
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /ohMyOpenAgent\.agents\.oracle\.model/);
      assert.match(error.message, /existing providers\.<provider>\.models\.<model>/);
      return true;
    },
  );

  assert.throws(
    () => validateAgentConfig({
      ...EXPECTED_CANONICAL_CONFIG,
      ohMyOpenAgent: {
        categories: {
          'visual-engineering': {
            model: 'anthropic/claude-3-5-sonnet-latest',
            variant: 'turbo',
          },
        },
      },
    }),
    (error) => {
      assert.ok(error instanceof AgentConfigValidationError);
      assert.match(error.message, /ohMyOpenAgent\.categories\.visual-engineering\.variant/);
      assert.match(error.message, /max, high, medium, low, xhigh/);
      return true;
    },
  );
});

test('omits empty OhMyOpenAgent mappings from normalized and serialized config', () => {
  for (const ohMyOpenAgent of [{}, { agents: {} }, { categories: {} }, { agents: {}, categories: {} }]) {
    const config = validateAgentConfig({
      ...EXPECTED_CANONICAL_CONFIG,
      ohMyOpenAgent,
    });

    assert.equal(config.ohMyOpenAgent, undefined);
  }

  const serialized = serializeCanonicalAgentConfig({
    ...EXPECTED_CANONICAL_CONFIG,
    ohMyOpenAgent: {
      agents: {},
      categories: {},
    },
  });

  assert.doesNotMatch(serialized, /ohMyOpenAgent/);
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
    'providers.<provider>.protocol',
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
    'providers.<provider>.models.<model>.supportsVision',
    'ohMyOpenAgent',
    'ohMyOpenAgent.agents',
    'ohMyOpenAgent.agents.<agent>',
    'ohMyOpenAgent.agents.<agent>.model',
    'ohMyOpenAgent.agents.<agent>.variant',
    'ohMyOpenAgent.categories',
    'ohMyOpenAgent.categories.<category>',
    'ohMyOpenAgent.categories.<category>.model',
    'ohMyOpenAgent.categories.<category>.variant',
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
  assert.match(apiKeyValueDoc?.description ?? '', /明文可见/);
  assert.match(apiKeyValueDoc?.description ?? '', /API Key/);
  assert.doesNotMatch(apiKeyValueDoc?.description ?? '', /masked|redacted/i);
});

test('localizes schema labels and descriptions to Simplified Chinese copy', () => {
  for (const field of AGENTCFG_SCHEMA_DOCS) {
    assertLocalizedSchemaCopy(field, 'label');
    assertLocalizedSchemaCopy(field, 'description');
  }
});

function assertLocalizedSchemaCopy(field: (typeof AGENTCFG_SCHEMA_DOCS)[number], property: 'label' | 'description'): void {
  const value = field[property];
  if (value === field.path || value === field.type) {
    return;
  }

  assert.match(value, CJK_COPY_PATTERN, `${field.path} ${property} should contain Simplified Chinese copy`);
}
