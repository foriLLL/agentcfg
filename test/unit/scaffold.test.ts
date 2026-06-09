import assert from 'node:assert/strict';
import test from 'node:test';
import { CLI_COMMANDS } from '../../src/core';
import { buildHelpText, buildVersionText } from '../../src/cli';

test('scaffold exports the planned commands', () => {
  assert.deepEqual(CLI_COMMANDS, ['init', 'pull', 'diff', 'apply', 'web']);
});

test('help text includes the planned commands', () => {
  const helpText = buildHelpText();
  for (const command of CLI_COMMANDS) {
    assert.ok(helpText.includes(command));
  }
});

test('version text is available', () => {
  assert.equal(buildVersionText(), 'agentcfg v0.0.0');
});
