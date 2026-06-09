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
  'Docker OpenCode validation',
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
  'test:gui',
  'npm install',
  'npm run build',
  'npm run build:web',
  'npm test',
  'npm run test:docker:opencode',
  'SKIP: Docker/OpenCode validation unavailable',
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
  assert.ok(readme.includes('The Web UI still respects the same security warning as the CLI.'));
  assert.ok(readme.includes('stores it as local plain text in `secrets.json`'));
  assert.ok(readme.includes('they never return the saved token value'));
  assert.ok(readme.includes("Use the Web UI's clear-token control to delete it."));
  assert.ok(readme.includes('Remember GitHub Token'));
  assert.ok(readme.includes('type `APPLY` before the UI sends a write request.'));
  assert.ok(readme.includes('inspect the raw native config file before editing or applying changes.'));
  assert.ok(readme.includes("including each planned file's current content and post-apply content."));
  assert.ok(readme.includes('The raw config editor and dry-run file previews intentionally show file contents as they exist or will be written, so they may include API keys.'));
});

test('example config parses and masks the fake API key', () => {
  const example = readFileSync(EXAMPLE_PATH, 'utf8');
  const config = parseCanonicalAgentConfig(example);

  assert.deepEqual(config, {
    schemaVersion: 1,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    baseURL: 'https://api.openai.com/v1',
    apiKey: {
      type: 'plain',
      value: 'sk-test-redacted',
    },
  });

  const masked = maskConfigForOutput(config);
  assert.ok(masked.includes(MASKED_SECRET));
  assert.equal(masked.includes('sk-test-redacted'), false);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
