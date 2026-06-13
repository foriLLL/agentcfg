import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawAdapterError,
  renderOpenClawConfigObject,
  renderOpenClawConfigText,
  resolveOpenClawConfigPath,
} from '../../src/adapters/openclaw';
import { validateAgentConfig } from '../../src/core';

const CONFIG = validateAgentConfig({
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

test('openclaw adapter resolves explicit, env, and default config paths', () => {
  assert.equal(resolveOpenClawConfigPath({ configPath: '/tmp/openclaw.json5' }), '/tmp/openclaw.json5');
  assert.equal(
    resolveOpenClawConfigPath({ env: { OPENCLAW_CONFIG_PATH: '/tmp/from-env.json5' } }),
    '/tmp/from-env.json5',
  );
  assert.match(resolveOpenClawConfigPath(), /\.openclaw\/openclaw\.json$/);
});

test('openclaw adapter renders managed fields and preserves unrelated object fields', () => {
  const existing = {
    ui: { theme: 'system' },
    models: {
      providers: {
        legacy: { baseUrl: 'https://legacy.example.test/v1' },
      },
    },
  };

  const rendered = renderOpenClawConfigObject(CONFIG, existing);

  assert.deepEqual(rendered.agents, {
    defaults: {
      model: {
        primary: 'openai/gpt-4.1-mini',
      },
    },
  });
  assert.deepEqual(rendered.models, {
    providers: {
      legacy: { baseUrl: 'https://legacy.example.test/v1' },
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-redacted',
        models: [
          {
            id: 'gpt-4.1-mini',
            contextWindow: 1047576,
            contextTokens: 1047576,
            maxTokens: 32768,
          },
        ],
      },
    },
  });
  assert.deepEqual(rendered.ui, { theme: 'system' });
  assert.deepEqual(existing, {
    ui: { theme: 'system' },
    models: {
      providers: {
        legacy: { baseUrl: 'https://legacy.example.test/v1' },
      },
    },
  });
});

test('openclaw adapter renders only official selected model metadata and skips variant', () => {
  const rendered = renderOpenClawConfigObject(CONFIG, {});

  assert.deepEqual(rendered.models, {
    providers: {
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-redacted',
        models: [
          {
            id: 'gpt-4.1-mini',
            contextWindow: 1047576,
            contextTokens: 1047576,
            maxTokens: 32768,
          },
        ],
      },
    },
  });
  assert.equal(JSON.stringify(rendered).includes('variant'), false);
});

test('openclaw adapter preserves unrelated selected model metadata when updating managed token fields', () => {
  const rendered = renderOpenClawConfigObject(CONFIG, {
    models: {
      providers: {
        openai: {
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test-redacted',
          models: [
            {
              id: 'gpt-4.1-mini',
              name: 'Existing model name',
              input: ['text', 'image'],
              contextWindow: 4096,
              contextTokens: 4096,
              maxTokens: 1024,
            },
            {
              id: 'gpt-4.1',
              name: 'Other model',
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(rendered.models, {
    providers: {
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-redacted',
        models: [
          {
            id: 'gpt-4.1-mini',
            name: 'Existing model name',
            input: ['text', 'image'],
            contextWindow: 1047576,
            contextTokens: 1047576,
            maxTokens: 32768,
          },
          {
            id: 'gpt-4.1',
            name: 'Other model',
          },
        ],
      },
    },
  });
});

test('openclaw adapter fails closed when managed model uses interpolation', () => {
  assert.throws(
    () =>
      renderOpenClawConfigObject(CONFIG, {
        agents: { defaults: { model: { primary: '${OPENCLAW_MODEL}' } } },
      }),
    (error) => {
      assert.ok(error instanceof OpenClawAdapterError);
      assert.match(error.message, /agents\.defaults\.model\.primary/);
      assert.match(error.message, /unsupported env substitution or interpolation/);
      return true;
    },
  );
});

test('openclaw adapter fails closed when managed provider is included', () => {
  assert.throws(
    () =>
      renderOpenClawConfigObject(CONFIG, {
        models: { providers: { openai: { $include: './providers/openai.json5' } } },
      }),
    (error) => {
      assert.ok(error instanceof OpenClawAdapterError);
      assert.match(error.message, /unsupported \$include/);
      assert.match(error.message, /models\.providers\.openai/);
      return true;
    },
  );
});

test('openclaw adapter fails closed when managed apiKey is included', () => {
  assert.throws(
    () =>
      renderOpenClawConfigObject(CONFIG, {
        models: { providers: { openai: { apiKey: { $include: './secrets/openai.json5' } } } },
      }),
    (error) => {
      assert.ok(error instanceof OpenClawAdapterError);
      assert.match(error.message, /unsupported \$include/);
      assert.match(error.message, /models\.providers\.openai\.apiKey/);
      return true;
    },
  );
});

test('openclaw adapter fails closed when managed selected model metadata uses interpolation', () => {
  assert.throws(
    () =>
      renderOpenClawConfigObject(CONFIG, {
        models: { providers: { openai: { models: '${OPENCLAW_MODELS}' } } },
      }),
    (error) => {
      assert.ok(error instanceof OpenClawAdapterError);
      assert.match(error.message, /models\.providers\.openai\.models/);
      assert.match(error.message, /unsupported env substitution or interpolation/);
      return true;
    },
  );
});

test('openclaw-malformed JSON5 input aborts before rendering', () => {
  assert.throws(
    () => renderOpenClawConfigText(CONFIG, '{ agents: { defaults: } }'),
    /Malformed JSON5 native config/,
  );
});
