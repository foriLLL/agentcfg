const assert = require('node:assert/strict');
const fs = require('node:fs');

const [settingsPath, canonicalPath] = process.argv.slice(2);

if (!settingsPath || !canonicalPath) {
  throw new Error('Usage: assert-claude-shape.cjs <settings-path> <canonical-config-path>');
}

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];

assert.equal(typeof settings, 'object');
assert.notEqual(settings, null);
assert.equal(Array.isArray(settings), false);
assert.equal(typeof settings.env, 'object');
assert.notEqual(settings.env, null);
assert.equal(Array.isArray(settings.env), false);
assert.equal(settings.model, modelId);
assert.equal(settings.env.ANTHROPIC_API_KEY, providerConfig.apiKey.value);
assert.equal(settings.env.ANTHROPIC_BASE_URL, providerConfig.baseURL);
assert.equal(settings.env.KEEP_ME, 'yes');
assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, undefined);
assert.equal(settings.env.ANTHROPIC_MODEL, undefined);
assert.equal(settings.theme, 'dark');
assert.deepEqual(settings.permissions, {
  allow: ['Bash(npm test:*)'],
  deny: ['WebFetch(*)'],
});
assert.equal(JSON.stringify(settings).includes('contextWindow'), false);
assert.equal(JSON.stringify(settings).includes('maxTokens'), false);
