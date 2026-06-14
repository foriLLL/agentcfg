const assert = require('node:assert/strict');
const fs = require('node:fs');

const [logPath, canonicalPath] = process.argv.slice(2);

if (!logPath || !canonicalPath) {
  throw new Error('Usage: assert-no-codex-secret.cjs <log-path> <canonical-config-path>');
}

const logText = fs.readFileSync(logPath, 'utf8');
const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const providerId = canonical.defaults.provider;
const secret = canonical.providers[providerId].apiKey.value;

assert.equal(logText.includes(secret), false, 'Codex validation log must not contain the raw fixture secret');
