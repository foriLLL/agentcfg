import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyManagedRuleFilePlans,
  listManagedRuleFileDefinitions,
  planManagedRuleFileApply,
} from '../../src/core/managed-files';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const VALID_AGENTCFG_YAML = [
  'schemaVersion: 1',
  'defaults:',
  '  provider: openai',
  '  model: gpt-4.1-mini',
  'providers:',
  '  openai:',
  '    baseURL: https://api.openai.com/v1',
  '    apiKey:',
  '      type: plain',
  '      value: test-secret-value',
  '    models:',
  '      gpt-4.1-mini: {}',
  '',
].join('\n');

test('managed rule file registry uses official user-level files only', () => {
  const files = listManagedRuleFileDefinitions('/home/tester');

  assert.deepEqual(
    files.map((file) => [file.id, file.gistFileName, file.localPath]),
    [
      ['codex-agents', 'AGENTS.md', '/home/tester/.codex/AGENTS.md'],
      ['claude-memory', 'CLAUDE.md', '/home/tester/.claude/CLAUDE.md'],
      ['gemini-context', 'GEMINI.md', '/home/tester/.gemini/GEMINI.md'],
    ],
  );
});

test('managed rule file apply plans and writes backup when remote differs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-managed-files-'));
  const codexPath = join(directory, '.codex', 'AGENTS.md');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'rules-revision', {
      'AGENTS.md': { content: '# remote rules\n' },
    }),
  });

  try {
    await mkdir(join(directory, '.codex'), { recursive: true });
    await writeFile(codexPath, '# local rules\n');

    const plans = await planManagedRuleFileApply(
      'rules-gist',
      ['codex-agents'],
      { apiBaseUrl: server.apiBaseUrl, env: {} },
      directory,
    );
    assert.equal(plans[0]?.status, 'would-change');
    assert.equal(plans[0]?.currentContent, '# local rules\n');
    assert.equal(plans[0]?.expectedContent, '# remote rules\n');

    const results = await applyManagedRuleFilePlans(plans);
    assert.equal(results[0]?.status, 'applied');
    assert.equal(results[0]?.backupPath !== undefined, true);
    assert.equal(await readFile(codexPath, 'utf8'), '# remote rules\n');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});
