import assert from 'node:assert/strict';
import test from 'node:test';
import { renderClaudeCodeConfigObject } from '../../src/adapters/claude';
import type { CanonicalAgentConfig } from '../../src/core';

const CANONICAL_CONFIG: CanonicalAgentConfig = {
  schemaVersion: 1,
  defaults: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-latest',
  },
  providers: {
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: {
        type: 'plain',
        value: 'sk-claude-visible-test',
      },
      models: {
        'claude-3-5-sonnet-latest': {
          contextWindow: 200000,
          maxTokens: 8192,
        },
      },
    },
  },
};

const CONFIG_WITH_MODEL_MAP: CanonicalAgentConfig = {
  ...CANONICAL_CONFIG,
  claudeCode: {
    modelMap: {
      primary: 'claude-primary-route',
      opus: 'claude-opus-route',
      sonnet: 'claude-sonnet-route',
      haiku: 'claude-haiku-route',
      smallFast: 'claude-small-fast-route',
    },
  },
};

test('Claude Code renders canonical model and env settings without unsupported metadata', () => {
  const rendered = renderClaudeCodeConfigObject(CANONICAL_CONFIG, {
    theme: 'dark',
    env: {
      KEEP_ME: 'yes',
      ANTHROPIC_MODEL: 'native-primary',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'native-opus',
    },
  });

  assert.deepEqual(rendered, {
    theme: 'dark',
    model: 'claude-3-5-sonnet-latest',
    env: {
      KEEP_ME: 'yes',
      ANTHROPIC_MODEL: 'native-primary',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'native-opus',
      ANTHROPIC_API_KEY: 'sk-claude-visible-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1',
    },
  });
  assert.equal(JSON.stringify(rendered).includes('contextWindow'), false);
  assert.equal(JSON.stringify(rendered).includes('maxTokens'), false);
});

test('Claude Code renders all configured modelMap slots to managed env settings', () => {
  const rendered = renderClaudeCodeConfigObject(CONFIG_WITH_MODEL_MAP, {
    theme: 'dark',
    env: {
      KEEP_ME: 'yes',
      ANTHROPIC_MODEL: 'native-primary',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'native-opus',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'native-sonnet',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'native-haiku',
      ANTHROPIC_SMALL_FAST_MODEL: 'native-small-fast',
    },
  });

  assert.equal(rendered.model, 'claude-primary-route');
  assert.deepEqual(rendered.env, {
    KEEP_ME: 'yes',
    ANTHROPIC_MODEL: 'claude-primary-route',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-route',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-route',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-route',
    ANTHROPIC_SMALL_FAST_MODEL: 'claude-small-fast-route',
    ANTHROPIC_API_KEY: 'sk-claude-visible-test',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1',
  });
});

test('Claude Code preserves native model env values for missing modelMap slots', () => {
  const rendered = renderClaudeCodeConfigObject(
    {
      ...CANONICAL_CONFIG,
      claudeCode: {
        modelMap: {
          primary: 'claude-primary-route',
          haiku: 'claude-haiku-route',
        },
      },
    },
    {
      env: {
        KEEP_ME: 'yes',
        ANTHROPIC_MODEL: 'native-primary',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'native-opus',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'native-sonnet',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'native-haiku',
        ANTHROPIC_SMALL_FAST_MODEL: 'native-small-fast',
      },
    },
  );

  assert.deepEqual(rendered.env, {
    KEEP_ME: 'yes',
    ANTHROPIC_MODEL: 'claude-primary-route',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'native-opus',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'native-sonnet',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-route',
    ANTHROPIC_SMALL_FAST_MODEL: 'native-small-fast',
    ANTHROPIC_API_KEY: 'sk-claude-visible-test',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1',
  });
});

test('Claude Code rejects native env settings that override managed auth', () => {
  assert.throws(
    () => renderClaudeCodeConfigObject(CANONICAL_CONFIG, { env: { ANTHROPIC_AUTH_TOKEN: 'token' } }),
    /ANTHROPIC_AUTH_TOKEN/,
  );
});

test('Claude Code rejects non-object env settings', () => {
  assert.throws(() => renderClaudeCodeConfigObject(CANONICAL_CONFIG, { env: 'ANTHROPIC_API_KEY=old' }), /env must be an object/);
});
