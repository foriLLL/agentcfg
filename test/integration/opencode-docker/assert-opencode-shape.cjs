const assert = require('node:assert/strict');
const fs = require('node:fs');

const [configPath, canonicalPath] = process.argv.slice(2);

if (!configPath || !canonicalPath) {
  throw new Error('Usage: assert-opencode-shape.cjs <opencode-config-path> <canonical-config-path>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const provider = config.provider?.[canonical.provider];

assert.equal(config.model, `${canonical.provider}/${canonical.model}`);
assert.equal(provider?.name, canonical.provider);
assert.equal(provider?.options?.baseURL, canonical.baseURL);
assert.equal(provider?.options?.apiKey, canonical.apiKey.value);
assert.equal(config.theme, 'system');
assert.deepEqual(config.tools, { bash: true });
