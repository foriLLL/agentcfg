import assert from 'node:assert/strict';
import test from 'node:test';
import { diffManagedSnapshots, formatAgentDiffResults } from '../../src/core';

const NATIVE_SECRET = ['native', 'secret', 'value'].join('-');
const CACHED_SECRET = ['sk', 'test', 'redacted'].join('-');

test('managed diff compares only known managed fields and marks apiKey secret', () => {
  const changes = diffManagedSnapshots(
    {
      provider: 'anthropic',
      model: 'claude-old',
      baseURL: 'https://old.example.test/v1',
      apiKey: NATIVE_SECRET,
    },
    {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      baseURL: 'https://api.openai.com/v1',
      apiKey: CACHED_SECRET,
    },
  );

  assert.deepEqual(
    changes.map((change) => [change.field, change.secret]),
    [
      ['provider', false],
      ['model', false],
      ['baseURL', false],
      ['apiKey', true],
    ],
  );
});

test('managed diff formatter masks secret values', () => {
  const output = formatAgentDiffResults([
    {
      agent: 'opencode',
      changes: diffManagedSnapshots(
        { apiKey: NATIVE_SECRET },
        { apiKey: CACHED_SECRET },
      ),
    },
  ]);

  assert.match(output, /apiKey: \*\*\*MASKED\*\*\* -> \*\*\*MASKED\*\*\*/);
  assert.equal(output.includes(NATIVE_SECRET), false);
  assert.equal(output.includes(CACHED_SECRET), false);
});
