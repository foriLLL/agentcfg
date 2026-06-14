const assert = require('node:assert/strict');
const fs = require('node:fs');
const TOML = require('smol-toml');

const [tomlPath, envPath, canonicalPath] = process.argv.slice(2);

if (!tomlPath || !envPath || !canonicalPath) {
  throw new Error('Usage: assert-codex-shape.cjs <codex-config-toml-path> <codex-env-path> <canonical-config-path>');
}

const config = TOML.parse(fs.readFileSync(tomlPath, 'utf8'));
const envContent = fs.readFileSync(envPath, 'utf8');
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];
const provider = config.model_providers?.[providerId];
const envKey = `AGENTCFG_${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_API_KEY`;

assert.equal(typeof config, 'object');
assert.notEqual(config, null);
assert.equal(Array.isArray(config), false);
assert.equal(config.model, modelId);
assert.equal(config.model_provider, providerId);
assert.equal(config.approval_policy, 'on-request');
assert.equal(config.sandbox_mode, 'workspace-write');
assert.equal(config.history?.persistence, 'save-all');
assert.equal(provider?.name, providerId);
assert.equal(provider?.wire_api, 'responses');
assert.equal(provider?.base_url, providerConfig.baseURL);
assert.equal(provider?.env_key, envKey);
assert.equal(envContent, `${envKey}=${providerConfig.apiKey.value}\n`);
assert.equal(JSON.stringify(config).includes(providerConfig.apiKey.value), false);
assert.equal(JSON.stringify(config).includes('contextWindow'), false);
assert.equal(JSON.stringify(config).includes('maxTokens'), false);
