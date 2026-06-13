import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CodexAdapterError,
  DEFAULT_CODEX_ENV_PATH,
  codexEnvKeyForProvider,
  renderCodexConfig,
  resolveCodexEnvPath,
} from '../../src/adapters/codex';
import { NativeConfigParseError, NativeConfigSerializeError, validateAgentConfig } from '../../src/core';

const CACHED_SECRET = ['sk', 'test', 'redacted'].join('-');

const CANONICAL_CONFIG = validateAgentConfig({
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
        value: CACHED_SECRET,
      },
      models: {
        'gpt-4.1-mini': {
          variant: 'chat',
          contextWindow: 1047576,
          contextTokens: 1047576,
          maxTokens: 32768,
        },
      },
    },
  },
});

test('Codex adapter maps canonical config to TOML and env metadata', () => {
  const result = renderCodexConfig(
    CANONICAL_CONFIG,
    `approval_policy = "on-request"

[model_providers.openai]
wire_api = "responses"
`,
  );

  assert.equal(
    result.toml,
    `approval_policy = "on-request"
model = "gpt-4.1-mini"
model_provider = "openai"

[model_providers.openai]
wire_api = "responses"
name = "openai"
base_url = "https://api.openai.com/v1"
env_key = "AGENTCFG_OPENAI_API_KEY"
`,
  );
  assert.deepEqual(result.envFile, {
    path: DEFAULT_CODEX_ENV_PATH,
    content: `AGENTCFG_OPENAI_API_KEY=${CACHED_SECRET}\n`,
    mode: 0o600,
    envKey: 'AGENTCFG_OPENAI_API_KEY',
  });
});

test('Codex default env path resolves under agentcfg state directory', () => {
  assert.equal(DEFAULT_CODEX_ENV_PATH, join(homedir(), '.agentcfg', 'env', 'codex.env'));
  assert.equal(resolveCodexEnvPath(), DEFAULT_CODEX_ENV_PATH);
  assert.equal(resolveCodexEnvPath('/tmp/custom-codex.env'), '/tmp/custom-codex.env');
});

test('Codex adapter preserves existing provider name and unrelated tables structurally', () => {
  const existingConfig = {
    approval_policy: 'never',
    history: { persistence: 'save-all' },
    model_providers: {
      openai: {
        name: 'OpenAI Responses',
        extra: true,
      },
    },
  };

  const result = renderCodexConfig(CANONICAL_CONFIG, existingConfig);

  assert.equal(
    result.toml,
    `approval_policy = "never"
model = "gpt-4.1-mini"
model_provider = "openai"

[history]
persistence = "save-all"

[model_providers.openai]
name = "OpenAI Responses"
extra = true
base_url = "https://api.openai.com/v1"
env_key = "AGENTCFG_OPENAI_API_KEY"
`,
  );
  assert.deepEqual(existingConfig, {
    approval_policy: 'never',
    history: { persistence: 'save-all' },
    model_providers: {
      openai: {
        name: 'OpenAI Responses',
        extra: true,
      },
    },
  });
});

test('Codex adapter skips unsupported canonical model metadata fields', () => {
  const result = renderCodexConfig(CANONICAL_CONFIG, {});

  assert.equal(result.toml.includes('variant'), false);
  assert.equal(result.toml.includes('contextWindow'), false);
  assert.equal(result.toml.includes('contextTokens'), false);
  assert.equal(result.toml.includes('maxTokens'), false);
  assert.equal(result.toml.includes('context_window'), false);
  assert.equal(result.toml.includes('max_tokens'), false);
});

test('Codex adapter fails closed on malformed TOML input', () => {
  assert.throws(
    () => renderCodexConfig(CANONICAL_CONFIG, 'model "gpt-4.1-mini"'),
    (error) => {
      assert.ok(error instanceof NativeConfigParseError);
      assert.equal(error.format, 'toml');
      assert.match(error.message, /Malformed TOML native config/);
      return true;
    },
  );
});

test('Codex adapter rejects non-table provider containers', () => {
  assert.throws(
    () => renderCodexConfig(CANONICAL_CONFIG, { model_providers: 'openai' }),
    (error) => {
      assert.ok(error instanceof NativeConfigSerializeError);
      assert.match(error.message, /model_providers/);
      return true;
    },
  );
});

test('Codex env key normalization produces valid AGENTCFG provider keys', () => {
  assert.equal(codexEnvKeyForProvider('openai-compatible'), 'AGENTCFG_OPENAI_COMPATIBLE_API_KEY');
  assert.throws(() => codexEnvKeyForProvider('---'), CodexAdapterError);
});
