const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const [rootDir, tomlOutputPath, envOutputPath, existingConfigPath] = process.argv.slice(2);

if (!rootDir || !tomlOutputPath || !envOutputPath) {
  throw new Error('Usage: render-codex-config.cjs <root-dir> <toml-output-path> <env-output-path> [existing-config-path]');
}

const fixtureDir = path.join(rootDir, 'test/integration/codex-docker');
const adapterPath = path.join(rootDir, 'dist/src/adapters/codex.js');

if (!fs.existsSync(adapterPath)) {
  throw new Error(`Built Codex adapter not found at ${adapterPath}; run npm run build first`);
}

const canonicalPath = path.join(fixtureDir, 'canonical.agentcfg.json');
const inputPath = existingConfigPath ?? path.join(fixtureDir, 'input.config.toml');
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const existingConfigText = fs.readFileSync(inputPath, 'utf8');
const { renderCodexConfig } = require(adapterPath);

const rendered = renderCodexConfig(canonical, existingConfigText);
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];

assert.equal(typeof rendered.toml, 'string');
assert.equal(rendered.envFile?.envKey, 'AGENTCFG_OPENAI_API_KEY');
assert.equal(rendered.envFile?.mode, 0o600);
assert.equal(rendered.envFile?.content, `AGENTCFG_OPENAI_API_KEY=${providerConfig.apiKey.value}\n`);
assert.match(rendered.toml, new RegExp(`model = "${modelId}"`));
assert.match(rendered.toml, new RegExp(`model_provider = "${providerId}"`));
assert.match(rendered.toml, /env_key = "AGENTCFG_OPENAI_API_KEY"/);

fs.writeFileSync(tomlOutputPath, rendered.toml, { mode: 0o600 });
fs.writeFileSync(envOutputPath, rendered.envFile.content, { mode: 0o600 });
