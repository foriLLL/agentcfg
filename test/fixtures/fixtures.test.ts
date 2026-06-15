import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { renderCodexConfig } from '../../src/adapters/codex';
import { renderOhMyOpenAgentConfigText } from '../../src/adapters/ohmyopenagent';
import { renderOpenCodeConfigText } from '../../src/adapters/opencode';
import { renderOpenClawConfigText } from '../../src/adapters/openclaw';
import { parseCanonicalAgentConfig, type CanonicalAgentConfig } from '../../src/core';

test('fixture directory exists for later waves', () => {
  assert.equal(existsSync(resolve(process.cwd(), 'test/fixtures')), true);
});

test('Codex fixture renders expected TOML and env payload', () => {
  const fixtureDirectory = resolve(process.cwd(), 'test/fixtures/codex');
  const canonicalConfig: CanonicalAgentConfig = {
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
    },
  };

  const result = renderCodexConfig(
    canonicalConfig,
    readFileSync(resolve(fixtureDirectory, 'input.config.toml'), 'utf8'),
  );

  assert.equal(result.toml, readFileSync(resolve(fixtureDirectory, 'expected.config.toml'), 'utf8'));
  assert.equal(result.envFile?.content, readFileSync(resolve(fixtureDirectory, 'expected.codex.env'), 'utf8'));
  assert.equal(result.envFile?.mode, 0o600);
});

test('openclaw-happy fixture renders normalized nested provider config', () => {
  const fixtureDirectory = resolve(process.cwd(), 'test/fixtures/openclaw');
  const canonical = parseCanonicalAgentConfig(
    readFileSync(resolve(process.cwd(), 'test/fixtures/canonical/valid.agentcfg.yaml'), 'utf8'),
  );

  const rendered = renderOpenClawConfigText(
    canonical,
    readFileSync(resolve(fixtureDirectory, 'input.openclaw.json5'), 'utf8'),
  );

  assert.equal(rendered, readFileSync(resolve(fixtureDirectory, 'expected.openclaw.json5'), 'utf8'));
});

test('opencode fixture renders canonical config into normalized native JSON', () => {
  const fixtureDirectory = resolve(process.cwd(), 'test/fixtures/opencode');
  const canonical = parseCanonicalAgentConfig(
    readFileSync(resolve(process.cwd(), 'test/fixtures/canonical/valid.agentcfg.yaml'), 'utf8'),
  );

  const rendered = renderOpenCodeConfigText(
    canonical,
    readFileSync(resolve(fixtureDirectory, 'input.opencode.jsonc'), 'utf8'),
  );

  assert.equal(rendered, readFileSync(resolve(fixtureDirectory, 'expected.opencode.json'), 'utf8'));
});

test('ohmyopenagent fixture renders canonical route overrides into normalized native JSON', () => {
  const fixtureDirectory = resolve(process.cwd(), 'test/fixtures/ohmyopenagent');
  const canonical = parseCanonicalAgentConfig(
    readFileSync(resolve(process.cwd(), 'test/fixtures/canonical/valid.agentcfg.yaml'), 'utf8'),
  );

  const rendered = renderOhMyOpenAgentConfigText(
    canonical,
    readFileSync(resolve(fixtureDirectory, 'input.oh-my-openagent.json'), 'utf8'),
  );

  assert.equal(rendered, readFileSync(resolve(fixtureDirectory, 'expected.oh-my-openagent.json'), 'utf8'));
});
