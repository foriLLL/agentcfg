const assert = require('node:assert/strict');
const fs = require('node:fs');
const JSON5 = require('json5');

const [configPath, canonicalPath] = process.argv.slice(2);

if (!configPath || !canonicalPath) {
  throw new Error('Usage: assert-openclaw-shape.cjs <openclaw-config-path> <canonical-config-path>');
}

const config = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];
const provider = config.models?.providers?.[providerId];

assert.equal(config.agents?.defaults?.model?.primary, `${providerId}/${modelId}`);
assert.deepEqual(config.agents?.defaults?.model?.fallbacks, ['local/fallback-model']);
assert.equal(provider?.baseUrl, providerConfig.baseURL);
assert.equal(provider?.apiKey, providerConfig.apiKey.value);
assert.deepEqual(provider?.models, [
  {
    id: modelId,
    name: 'GPT-4.1 mini',
    contextWindow: 1047576,
    contextTokens: 1047576,
    maxTokens: 32768,
  },
]);
assert.equal(config.models?.providers?.legacy?.baseUrl, 'https://legacy.example.test/v1');
assert.equal(JSON.stringify(config).includes('variant'), false);
