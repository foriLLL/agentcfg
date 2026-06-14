const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSON5 = require('json5');

const [rootDir, outputPath] = process.argv.slice(2);

if (!rootDir || !outputPath) {
  throw new Error('Usage: render-openclaw-config.cjs <root-dir> <output-path>');
}

const fixtureDir = path.join(rootDir, 'test/integration/openclaw-docker');
const canonical = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'canonical.agentcfg.json'), 'utf8'));
const existingConfigText = fs.readFileSync(path.join(fixtureDir, 'input.openclaw.json5'), 'utf8');
const { renderOpenClawConfigText } = require(path.join(rootDir, 'dist/src/adapters/openclaw.js'));

const rendered = renderOpenClawConfigText(canonical, existingConfigText);
const parsed = JSON5.parse(rendered);
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];
const provider = parsed.models?.providers?.[providerId];

assert.equal(parsed.agents?.defaults?.model?.primary, `${providerId}/${modelId}`);
assert.deepEqual(parsed.agents?.defaults?.model?.fallbacks, ['local/fallback-model']);
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
assert.equal(parsed.models?.providers?.legacy?.apiKey, 'legacy-placeholder');

fs.writeFileSync(outputPath, rendered, { mode: 0o600 });
