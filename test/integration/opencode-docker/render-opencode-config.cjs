const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const [rootDir, outputPath] = process.argv.slice(2);

if (!rootDir || !outputPath) {
  throw new Error('Usage: render-opencode-config.cjs <root-dir> <output-path>');
}

const fixtureDir = path.join(rootDir, 'test/integration/opencode-docker');
const canonical = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'canonical.agentcfg.json'), 'utf8'));
const existingConfigText = fs.readFileSync(path.join(fixtureDir, 'input.opencode.jsonc'), 'utf8');
const { renderOpenCodeConfigText } = require(path.join(rootDir, 'dist/src/adapters/opencode.js'));

const rendered = renderOpenCodeConfigText(canonical, existingConfigText);
const parsed = JSON.parse(rendered);

assert.equal(parsed.model, `${canonical.provider}/${canonical.model}`);
assert.equal(parsed.provider[canonical.provider].name, canonical.provider);
assert.equal(parsed.provider[canonical.provider].options.baseURL, canonical.baseURL);
assert.equal(parsed.provider[canonical.provider].options.apiKey, canonical.apiKey.value);
assert.equal(parsed.theme, 'system');
assert.deepEqual(parsed.tools, { bash: true });

fs.writeFileSync(outputPath, rendered, { mode: 0o600 });
