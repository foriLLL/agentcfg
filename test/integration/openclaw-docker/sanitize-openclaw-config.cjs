const assert = require('node:assert/strict');
const fs = require('node:fs');
const JSON5 = require('json5');

const [configPath, canonicalPath, outputPath] = process.argv.slice(2);

if (!configPath || !canonicalPath || !outputPath) {
  throw new Error('Usage: sanitize-openclaw-config.cjs <openclaw-config-path> <canonical-config-path> <output-path>');
}

const config = JSON5.parse(fs.readFileSync(configPath, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const providerId = canonical.defaults.provider;
const provider = config.models?.providers?.[providerId];

assert.equal(typeof provider, 'object');
assert.notEqual(provider, null);
provider.apiKey = 'agentcfg-docker-redacted-api-key';

fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
