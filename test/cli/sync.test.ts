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
const AGENT_SKILLS_GIST_FILE = 'AGENT_SKILLS.json';

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

test('sync once applies managed agent skills from Gist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-sync-skills-'));
  const statePath = join(directory, 'state.json');
  const skillPath = join(directory, '.agents', 'skills', 'cli-skill', 'SKILL.md');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'cli-sync-skills-revision', {
      [AGENT_SKILLS_GIST_FILE]: { content: buildSkillsManifest({ 'cli-skill/SKILL.md': '# cli remote skill\n' }) },
    }),
  });

  try {
    await writeFile(statePath, `${JSON.stringify({ schemaVersion: 1, gist: { id: 'cli-sync-skills-gist' } }, null, 2)}\n`);

    const result = await runCli(['sync', 'once', '--skills', '--state', statePath], {
      ...process.env,
      HOME: directory,
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      GITHUB_TOKEN: 'cli-sync-skills-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Sync success/);
    assert.match(result.stdout, /Agent skills AGENT_SKILLS\.json: applied/);
    assert.equal(await readFile(skillPath, 'utf8'), '# cli remote skill\n');
    assert.equal(server.requests[0]?.authorization, 'Bearer cli-sync-skills-token');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('sync once uses configured auto-sync targets when no target flags are passed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-sync-configured-'));
  const statePath = join(directory, 'state.json');
  const localPath = join(directory, '.gemini', 'GEMINI.md');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'cli-sync-configured-revision', {
      'AGENTS.md': { content: '# configured codex rules\n' },
      'CLAUDE.md': { content: '# configured claude rules\n' },
      'GEMINI.md': { content: '# configured gemini rules\n' },
    }),
  });

  try {
    await mkdir(join(directory, '.gemini'), { recursive: true });
    await writeFile(localPath, '# configured local gemini rules\n');
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          gist: { id: 'cli-sync-configured-gist' },
          autoSync: { enabled: true, intervalMinutes: 15, targets: ['ruleFiles'] },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runCli(['sync', 'once', '--state', statePath], {
      ...process.env,
      HOME: directory,
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      GITHUB_TOKEN: 'cli-sync-configured-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Targets: ruleFiles/);
    assert.match(result.stdout, /Rule file GEMINI\.md: applied/);
    assert.equal(await readFile(localPath, 'utf8'), '# configured gemini rules\n');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('sync once uses configured agent skills target when no target flags are passed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-sync-skills-configured-'));
  const statePath = join(directory, 'state.json');
  const skillPath = join(directory, '.agents', 'skills', 'configured', 'SKILL.md');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'cli-sync-skills-configured-revision', {
      [AGENT_SKILLS_GIST_FILE]: { content: buildSkillsManifest({ 'configured/SKILL.md': '# configured skill\n' }) },
    }),
  });

  try {
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          gist: { id: 'cli-sync-skills-configured-gist' },
          autoSync: { enabled: true, intervalMinutes: 15, targets: ['agentSkills'] },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runCli(['sync', 'once', '--state', statePath], {
      ...process.env,
      HOME: directory,
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      GITHUB_TOKEN: 'cli-sync-skills-configured-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Targets: agentSkills/);
    assert.match(result.stdout, /Agent skills AGENT_SKILLS\.json: applied/);
    assert.equal(await readFile(skillPath, 'utf8'), '# configured skill\n');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('sync once skips configured targets when auto-sync is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-sync-disabled-'));
  const statePath = join(directory, 'state.json');
  const localPath = join(directory, '.codex', 'AGENTS.md');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'cli-sync-disabled-revision', {
      'AGENTS.md': { content: '# disabled remote rules\n' },
    }),
  });

  try {
    await mkdir(join(directory, '.codex'), { recursive: true });
    await writeFile(localPath, '# disabled local rules\n');
    await writeFile(
      statePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          gist: { id: 'cli-sync-disabled-gist' },
          autoSync: { enabled: false, intervalMinutes: 15, targets: ['ruleFiles'] },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runCli(['sync', 'once', '--state', statePath], {
      ...process.env,
      HOME: directory,
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      GITHUB_TOKEN: 'cli-sync-disabled-token',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Auto-sync is disabled/);
    assert.equal(await readFile(localPath, 'utf8'), '# disabled local rules\n');
    assert.equal(server.requests.length, 0);
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

function buildSkillsManifest(files: Record<string, string>): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'agentcfg.agentSkills',
      root: '~/.agents/skills',
      files: Object.entries(files).map(([path, content]) => ({ path, encoding: 'utf8', content, mode: 0o644 })),
    },
    null,
    2,
  )}\n`;
}
