import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const CLI_PATH = resolve(process.cwd(), 'dist/cli.js');
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

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

test('sync once applies managed rule files from Gist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-sync-'));
  const statePath = join(directory, 'state.json');
  const localPath = join(directory, '.codex', 'AGENTS.md');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'cli-sync-revision', {
      'AGENTS.md': { content: '# cli remote rules\n' },
      'CLAUDE.md': { content: '# cli claude rules\n' },
      'GEMINI.md': { content: '# cli gemini rules\n' },
    }),
  });

  try {
    await mkdir(join(directory, '.codex'), { recursive: true });
    await writeFile(localPath, '# cli local rules\n');
    await writeFile(statePath, `${JSON.stringify({ schemaVersion: 1, gist: { id: 'cli-sync-gist' } }, null, 2)}\n`);

    const result = await runCli(['sync', 'once', '--rules', '--state', statePath], {
      ...process.env,
      HOME: directory,
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      GITHUB_TOKEN: 'cli-sync-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Sync success/);
    assert.match(result.stdout, /Rule file AGENTS\.md: applied/);
    assert.equal(await readFile(localPath, 'utf8'), '# cli remote rules\n');
    assert.equal(server.requests[0]?.authorization, 'Bearer cli-sync-token');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('sync service status reports without installing service', async () => {
  const result = await runCli(['sync', 'service', 'status'], process.env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sync service/);
  assert.match(result.stdout, /Platform:/);
});

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise<CliResult>((resolvePromise) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolvePromise({ status, stdout, stderr }));
  });
}
