import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawAdapterError,
  renderOpenClawConfigObject,
  renderOpenClawConfigText,
  resolveOpenClawConfigPath,
} from '../../src/adapters/openclaw';
import type { CanonicalAgentConfig } from '../../src/core';

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

test('openclaw-malformed JSON5 input aborts before rendering', () => {
  assert.throws(
    () => renderOpenClawConfigText(CONFIG, '{ agents: { defaults: } }'),
    /Malformed JSON5 native config/,
  );
});
