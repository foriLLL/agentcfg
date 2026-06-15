import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { MASKED_SECRET, maskConfigForOutput, parseCanonicalAgentConfig } from '../../src/core';

const README_PATH = resolve(process.cwd(), 'README.md');
const EXAMPLE_PATH = resolve(process.cwd(), 'examples/agentcfg.yaml');

const REQUIRED_HEADINGS = [
  'Security warning',
  'MVP scope',
  'Canonical schema',
  'Gist auth and state',
  'Web UI',
  'Setup',
  'Commands',
  'Adapter behavior',
  'Managed and unmanaged fields',
  'Backups and rollback',
  'Docker validation',
  'Non-goals',
] as const;

const REQUIRED_COMMANDS = [
  'agentcfg init --gist <gist-id>',
  'agentcfg pull',
  'agentcfg diff',
  'agentcfg apply --dry-run',
  'agentcfg apply --yes',
  'agentcfg web',
  '--host <host>',
  '--port <port>',
  '--state',
  '--no-open',
  '--config-path',
  '--agent',
  '--all-agents',
  '--fixtures-root',
  'dev:web',
  'build:web',
  'preview:web',
  'test:api',
  'test:server',
  'test:electron',
  'test:gui',
  'npm install',
  'npm run build',
  'npm run build:web',
  'npm test',
  'npm run test:docker',
  'npm run verify:privacy',
  'test:docker:opencode',
  'test:docker:codex',
  'test:docker:openclaw',
  'test:docker:claude',
  'SKIP: Docker/<Agent> validation unavailable',
] as const;

test('readme documents the required agentcfg MVP sections', () => {
  const readme = readFileSync(README_PATH, 'utf8');

  for (const heading of REQUIRED_HEADINGS) {
    assert.match(readme, new RegExp(`^## ${escapeRegExp(heading)}$`, 'm'));
  }

  for (const phrase of REQUIRED_COMMANDS) {
    assert.ok(readme.includes(phrase), `missing README phrase: ${phrase}`);
  }

  assert.match(
    readme,
    /This MVP stores provider and agent API keys in plain text in the private Gist's `agentcfg\.yaml`\./,
  );
  assert.ok(readme.includes('Encryption is deferred to a later release.'));
  assert.ok(readme.includes('private Gist is not a hard security boundary'));
  assert.ok(readme.includes('examples/agentcfg.yaml'));
  assert.ok(readme.includes('ohMyOpenAgent.agents.<agent>.model'));
  assert.ok(readme.includes('ohMyOpenAgent.categories.<category>.model'));
  assert.ok(readme.includes('model` values must reference the provider catalog as `provider/model`'));
  assert.ok(readme.includes('empty mappings are omitted from generated YAML'));
  assert.ok(readme.includes('Provider IDs cannot contain `/`'));
  assert.ok(readme.includes('Model IDs may still contain `/`'));
  assert.ok(readme.includes('The Web UI still respects the same security warning as the CLI.'));
  assert.ok(readme.includes('provider API keys exactly as the local runtime API will write them'));
  assert.ok(readme.includes('including provider API key values'));
  assert.ok(readme.includes('The Web UI and local runtime API show provider API keys directly'));
  assert.ok(readme.includes('stores it as local plain text in `secrets.json`'));
  assert.ok(readme.includes('they never return the saved token value'));
  assert.ok(readme.includes("Use the Web UI's clear-token control to delete it."));
  assert.ok(readme.includes('Remember GitHub Token'));
  assert.ok(readme.includes('type `APPLY` before the UI sends a write request.'));
  assert.ok(readme.includes('inspect the raw native config file before editing or applying changes.'));
  assert.ok(readme.includes("including each planned file's current content and post-apply content."));
  assert.ok(readme.includes('Saved GitHub Tokens are different'));
  assert.ok(readme.includes('docs/testing-capability.md'));
  assert.ok(readme.includes('OpenCode, OpenClaw, Claude Code, and OhMyOpenAgent'));
  assert.ok(readme.includes('--agent <codex|opencode|openclaw|claude|ohmyopenagent>'));
  assert.ok(readme.includes('~/.config/opencode/oh-my-openagent.json'));
  assert.ok(readme.includes('agents.<name>.model'));
  assert.ok(readme.includes('Codex has no confirmed upstream full config validator'));
  assert.ok(readme.includes('AGENTCFG_DOCKER_CODEX_STRICT=1'));
  assert.ok(readme.includes('default host is loopback-only'));
  assert.ok(readme.includes('does not read private file contents'));
  assert.equal(readme.includes('desktop packaging or an Electron wrapper'), false);
});

test('example config parses and masks the fake API key', () => {
  const example = readFileSync(EXAMPLE_PATH, 'utf8');
  const config = parseCanonicalAgentConfig(example);

  assert.deepEqual(config, {
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
          model: 'openai/gpt-4.1-mini',
        },
      },
    },
  });

  const masked = maskConfigForOutput(config);
  assert.ok(masked.includes(MASKED_SECRET));
  assert.equal(masked.includes('sk-test-redacted'), false);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
