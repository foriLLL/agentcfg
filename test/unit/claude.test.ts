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

test('Claude Code renders canonical model and env settings without unsupported metadata', () => {
  const rendered = renderClaudeCodeConfigObject(CANONICAL_CONFIG, {
    theme: 'dark',
    env: {
      KEEP_ME: 'yes',
    },
  });

  assert.deepEqual(rendered, {
    theme: 'dark',
    model: 'claude-3-5-sonnet-latest',
    env: {
      KEEP_ME: 'yes',
      ANTHROPIC_API_KEY: 'sk-claude-visible-test',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1',
    },
  });
  assert.equal(JSON.stringify(rendered).includes('contextWindow'), false);
  assert.equal(JSON.stringify(rendered).includes('maxTokens'), false);
});

test('Claude Code rejects native env settings that override managed auth or model', () => {
  assert.throws(
    () => renderClaudeCodeConfigObject(CANONICAL_CONFIG, { env: { ANTHROPIC_AUTH_TOKEN: 'token' } }),
    /ANTHROPIC_AUTH_TOKEN/,
  );
  assert.throws(
    () => renderClaudeCodeConfigObject(CANONICAL_CONFIG, { env: { ANTHROPIC_MODEL: 'opus' } }),
    /ANTHROPIC_MODEL/,
  );
});

test('Claude Code rejects non-object env settings', () => {
  assert.throws(() => renderClaudeCodeConfigObject(CANONICAL_CONFIG, { env: 'ANTHROPIC_API_KEY=old' }), /env must be an object/);
});
