const assert = require('node:assert/strict');
const fs = require('node:fs');

const [configPath, canonicalPath] = process.argv.slice(2);

if (!configPath || !canonicalPath) {
  throw new Error('Usage: assert-opencode-shape.cjs <opencode-config-path> <canonical-config-path>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];
const provider = config.provider?.[providerId];

assert.equal(config.model, `${providerId}/${modelId}`);
assert.equal(provider?.name, providerId);
assert.equal(provider?.options?.baseURL, providerConfig.baseURL);
assert.equal(provider?.options?.apiKey, providerConfig.apiKey.value);
assert.equal(config.theme, 'system');
assert.deepEqual(config.tools, { bash: true });
