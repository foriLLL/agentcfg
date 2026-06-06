import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('cli help prints the planned commands', () => {
  const output = execFileSync(process.execPath, [resolve(process.cwd(), 'dist/cli.js'), '--help'], {
    encoding: 'utf8',
  });

  for (const command of ['init', 'pull', 'diff', 'apply']) {
    assert.ok(output.includes(command));
  }
});
