import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const GITIGNORE_PATH = resolve(process.cwd(), '.gitignore');
const PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json');

test('privacy contract keeps private ignores root-scoped and avoids broad patterns', () => {
  const gitignoreLines = readFileSync(GITIGNORE_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  for (const expected of [
    '/.agentcfg-state.json',
    '/secrets.json',
    '/.agentcfg/',
    '/state.json',
    '/last-state-path.json',
  ]) {
    assert.ok(gitignoreLines.includes(expected), `missing ignore entry: ${expected}`);
  }

  for (const forbidden of ['*.json', '*secret*', 'state.json']) {
    assert.equal(gitignoreLines.includes(forbidden), false, `forbidden ignore entry present: ${forbidden}`);
  }
});

test('privacy contract exposes the release privacy verifier script', () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.['verify:privacy'], 'scripts/verify-release-privacy.sh');
});
