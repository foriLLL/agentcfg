const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const [rootDir, outputPath] = process.argv.slice(2);

if (!rootDir || !outputPath) {
  throw new Error('Usage: render-claude-settings.cjs <root-dir> <output-path>');
}

const fixtureDir = path.join(rootDir, 'test/integration/claude-docker');
const canonical = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'canonical.agentcfg.json'), 'utf8'));
const existingSettingsText = fs.readFileSync(path.join(fixtureDir, 'input.settings.json'), 'utf8');
const { renderClaudeCodeConfigText } = require(path.join(rootDir, 'dist/src/adapters/claude.js'));

const rendered = renderClaudeCodeConfigText(canonical, existingSettingsText);
const parsed = JSON.parse(rendered);
const providerId = canonical.defaults.provider;
const modelId = canonical.defaults.model;
const providerConfig = canonical.providers[providerId];

assert.equal(parsed.model, modelId);
assert.equal(parsed.env.ANTHROPIC_API_KEY, providerConfig.apiKey.value);
assert.equal(parsed.env.ANTHROPIC_BASE_URL, providerConfig.baseURL);
assert.equal(parsed.env.KEEP_ME, 'yes');
assert.equal(parsed.theme, 'dark');
assert.deepEqual(parsed.permissions, {
  allow: ['Bash(npm test:*)'],
  deny: ['WebFetch(*)'],
});
assert.equal(JSON.stringify(parsed).includes('contextWindow'), false);
assert.equal(JSON.stringify(parsed).includes('maxTokens'), false);

fs.writeFileSync(outputPath, rendered, { mode: 0o600 });
