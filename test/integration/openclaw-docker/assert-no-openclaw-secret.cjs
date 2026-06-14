const fs = require('node:fs');
const path = require('node:path');

const [canonicalPath, ...logPaths] = process.argv.slice(2);

if (!canonicalPath) {
  throw new Error('Usage: assert-no-openclaw-secret.cjs <canonical-config-path> [log-path...]');
}

const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
const secrets = Object.values(canonical.providers ?? {})
  .map((provider) => provider?.apiKey?.value)
  .filter((value) => typeof value === 'string' && value.length > 0);

for (const logPath of logPaths) {
  if (!fs.existsSync(logPath)) {
    continue;
  }

  const content = fs.readFileSync(logPath, 'utf8');
  if (secrets.some((secret) => content.includes(secret))) {
    process.stderr.write(`OpenClaw fixture secret leak detected in ${path.basename(logPath)}\n`);
    process.exit(1);
  }
}
