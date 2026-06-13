import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import test from 'node:test';
import { buildRemoteYamlPreview } from '../../web/src/view-model';
import type { EditableAgentConfig } from '../../web/src/api';

test('buildRemoteYamlPreview serializes the complete nested remote config', () => {
  const config: EditableAgentConfig = {
    schemaVersion: 1,
    defaults: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
    },
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-visible-openai-preview',
        },
        modelDiscovery: {
          path: '/models',
        },
        models: {
          'gpt-4.1-mini': {
            variant: 'chat',
            contextWindow: 1047576,
            contextTokens: 1040000,
            maxTokens: 32768,
          },
          'gpt-4.1': {},
        },
      },
      anthropic: {
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-visible-anthropic-preview',
        },
        models: {
          'claude-3-5-sonnet-latest': {
            contextWindow: 200000,
            contextTokens: 180000,
            maxTokens: 8192,
          },
          'claude-3-haiku': {},
        },
      },
    },
  };

  const preview = buildRemoteYamlPreview(config);
  const parsed = parseYaml(preview);

  assert.deepEqual(parsed, config);
  assert.match(preview, /schemaVersion: 1/);
  assert.match(preview, /defaults:/);
  assert.match(preview, /providers:/);
  assert.match(preview, /"openai":/);
  assert.match(preview, /"anthropic":/);
  assert.match(preview, /modelDiscovery:/);
  assert.match(preview, /path: "\/models"/);
  assert.match(preview, /sk-visible-openai-preview/);
  assert.match(preview, /sk-visible-anthropic-preview/);
  assert.match(preview, /variant: "chat"/);
  assert.match(preview, /contextWindow: 1047576/);
  assert.match(preview, /contextTokens: 1040000/);
  assert.match(preview, /maxTokens: 32768/);
  assert.match(preview, /"gpt-4\.1": \{\}/);
  assert.match(preview, /"claude-3-haiku": \{\}/);
});
