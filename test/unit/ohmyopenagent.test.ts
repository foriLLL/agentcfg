import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OH_MY_OPENAGENT_SCHEMA_URL,
  OhMyOpenAgentAdapterError,
  renderOhMyOpenAgentConfigObject,
  renderOhMyOpenAgentConfigText,
  resolveOhMyOpenAgentConfigPath,
} from '../../src/adapters/ohmyopenagent';
import { validateAgentConfig, type NativeConfigObject } from '../../src/core';

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
        'gpt-4.1-mini': {},
      },
    },
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: {
        type: 'plain',
        value: 'sk-ant-test-redacted',
      },
      models: {
        'claude-3-5-sonnet-latest': {},
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
});

test('OhMyOpenAgent adapter resolves explicit, env, and default config paths', () => {
  assert.equal(resolveOhMyOpenAgentConfigPath({ configPath: '/tmp/oh-my-openagent.json' }), '/tmp/oh-my-openagent.json');
  assert.equal(
    resolveOhMyOpenAgentConfigPath({ env: { OH_MY_OPENAGENT_CONFIG_PATH: '/tmp/from-env.json' } }),
    '/tmp/from-env.json',
  );
  assert.match(resolveOhMyOpenAgentConfigPath(), /\.config\/opencode\/oh-my-openagent\.json$/);
});

test('OhMyOpenAgent renders route overrides while preserving unmanaged fields', () => {
  const rendered = renderOhMyOpenAgentConfigObject(CONFIG, {
    $schema: OH_MY_OPENAGENT_SCHEMA_URL,
    disabled_hooks: ['no-sisyphus-gpt'],
    agents: {
      oracle: {
        model: 'openai/old-oracle',
        variant: 'low',
        prompt_append: 'Keep local oracle prompt.',
      },
      sisyphus: {
        model: 'openai/old-sisyphus',
        variant: 'medium',
        prompt_append: 'Keep local sisyphus prompt.',
      },
      'custom-agent': {
        model: 'local/custom',
        variant: 'high',
      },
    },
    categories: {
      'visual-engineering': {
        model: 'anthropic/old-visual',
        variant: 'medium',
        notes: 'Keep local category metadata.',
      },
      quick: {
        model: 'openai/old-quick',
        variant: 'low',
      },
    },
    background_task: {
      providerConcurrency: {
        openai: 10,
      },
    },
  });

  assert.deepEqual(rendered.agents, {
    oracle: {
      model: 'openai/gpt-4.1-mini',
      variant: 'high',
      prompt_append: 'Keep local oracle prompt.',
    },
    sisyphus: {
      prompt_append: 'Keep local sisyphus prompt.',
    },
    'custom-agent': {
      model: 'local/custom',
      variant: 'high',
    },
  });
  assert.deepEqual(rendered.categories, {
    'visual-engineering': {
      model: 'anthropic/claude-3-5-sonnet-latest',
      notes: 'Keep local category metadata.',
    },
  });
  assert.deepEqual(rendered.disabled_hooks, ['no-sisyphus-gpt']);
  assert.deepEqual(rendered.background_task, { providerConcurrency: { openai: 10 } });
});

test('OhMyOpenAgent creates schema and route groups when missing', () => {
  const rendered = renderOhMyOpenAgentConfigObject(CONFIG, {});

  assert.equal(rendered.$schema, OH_MY_OPENAGENT_SCHEMA_URL);
  assert.deepEqual(rendered.agents, {
    oracle: {
      model: 'openai/gpt-4.1-mini',
      variant: 'high',
    },
  });
  assert.deepEqual(rendered.categories, {
    'visual-engineering': {
      model: 'anthropic/claude-3-5-sonnet-latest',
    },
  });
});

test('OhMyOpenAgent parses JSON input and emits normalized JSON', () => {
  const rendered = renderOhMyOpenAgentConfigText(
    CONFIG,
    JSON.stringify({
      agents: {
        oracle: {
          model: 'openai/old-oracle',
        },
      },
    }),
  );

  assert.doesNotThrow(() => JSON.parse(rendered));
  assert.match(rendered, /"model": "openai\/gpt-4\.1-mini"/);
  assert.match(rendered, /"variant": "high"/);
});

test('OhMyOpenAgent fails closed when managed groups have unsupported shapes', () => {
  const unsupportedConfigs: NativeConfigObject[] = [
    { agents: [] },
    { agents: { oracle: 'openai/gpt-4.1-mini' } },
    { categories: { 'visual-engineering': null } },
  ];

  for (const existingConfig of unsupportedConfigs) {
    assert.throws(
      () => renderOhMyOpenAgentConfigObject(CONFIG, existingConfig),
      (error) => {
        assert.ok(error instanceof OhMyOpenAgentAdapterError);
        if (!(error instanceof Error)) {
          return false;
        }
        assert.match(error.message, /OhMyOpenAgent/);
        return true;
      },
    );
  }
});
