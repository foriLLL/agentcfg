import assert from 'node:assert/strict';
import test from 'node:test';
import { type CanonicalAgentConfig, type NativeConfigObject } from '../../src/core';
import { OpenCodeAdapterError, renderOpenCodeConfigObject, renderOpenCodeConfigText } from '../../src/adapters/opencode';

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

test('OpenCode renders canonical provider and model into native model string', () => {
  const rendered = renderOpenCodeConfigObject(CONFIG, {});

  assert.equal(rendered.model, 'openai/gpt-4.1-mini');
});

test('OpenCode renders provider options and fills provider name when absent', () => {
  const rendered = renderOpenCodeConfigObject(CONFIG, {
    provider: {
      openai: {
        options: {},
      },
    },
  });

  assert.deepEqual(rendered.provider, {
    openai: {
      name: 'openai',
      options: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'sk-test-redacted',
      },
    },
  });
});

test('OpenCode preserves unrelated fields structurally', () => {
  const rendered = renderOpenCodeConfigObject(CONFIG, {
    theme: 'system',
    tools: { bash: true },
    permissions: { edit: 'ask' },
    plugins: ['local-plugin'],
    commands: { lint: 'npm run lint' },
  });

  assert.equal(rendered.theme, 'system');
  assert.deepEqual(rendered.tools, { bash: true });
  assert.deepEqual(rendered.permissions, { edit: 'ask' });
  assert.deepEqual(rendered.plugins, ['local-plugin']);
  assert.deepEqual(rendered.commands, { lint: 'npm run lint' });
});

test('OpenCode parses JSONC with comments and trailing commas and emits valid JSON', () => {
  const rendered = renderOpenCodeConfigText(
    CONFIG,
    `{
      // comments are accepted on input
      "theme": "system",
      "provider": {
        "openai": {
          "options": {},
        },
      },
    }`,
  );

  assert.doesNotThrow(() => JSON.parse(rendered));
  assert.match(rendered, /"model": "openai\/gpt-4\.1-mini"/);
  assert.equal(rendered.includes('// comments'), false);
});

test('OpenCode refuses managed include and env or file interpolation on managed fields', () => {
  const managedConfigs: NativeConfigObject[] = [
    { model: { $include: './model.json' } },
    { provider: { openai: { options: { baseURL: '{env:OPENAI_BASE_URL}' } } } },
    { provider: { openai: { options: { apiKey: { file: './secret' } } } } },
  ];

  for (const existingConfig of managedConfigs) {
    assert.throws(
      () => renderOpenCodeConfigObject(CONFIG, existingConfig),
      (error) => {
        assert.ok(error instanceof OpenCodeAdapterError);
        assert.match(error.message, /managed path/);
        assert.match(error.message, /\$include\/env\/file interpolation/);
        return true;
      },
    );
  }
});
