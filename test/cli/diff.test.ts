import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const CLI_PATH = resolve(process.cwd(), 'dist/cli.js');
const CACHED_SECRET = ['sk', 'test', 'redacted'].join('-');
const NATIVE_SECRET = ['native', 'secret', 'value'].join('-');
const CANONICAL_CONFIG = {
  schemaVersion: 1,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: {
    type: 'plain',
    value: CACHED_SECRET,
  },
};

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

test('diff requires exactly one target selector', async () => {
  const missingSelector = await runCli(['diff']);
  assert.notEqual(missingSelector.status, 0);
  assert.match(missingSelector.stderr, /--agent/);
  assert.match(missingSelector.stderr, /--all-agents/);

  const conflictingSelectors = await runCli(['diff', '--agent', 'opencode', '--all-agents']);
  assert.notEqual(conflictingSelectors.status, 0);
  assert.match(conflictingSelectors.stderr, /--agent/);
  assert.match(conflictingSelectors.stderr, /--all-agents/);
});

test('diff reports managed changes, masks api keys, and writes no files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-diff-opencode-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');

  try {
    await writeState(statePath, CANONICAL_CONFIG);
    await writeFile(
      nativePath,
      JSON.stringify(
        {
          theme: 'system',
          model: 'anthropic/claude-3-5-sonnet',
          provider: {
            anthropic: {
              options: {
                baseURL: 'https://old.example.test/v1',
                apiKey: NATIVE_SECRET,
              },
            },
          },
        },
        null,
        2,
      ),
    );
    const stateBefore = await readFile(statePath, 'utf8');
    const nativeBefore = await readFile(nativePath, 'utf8');

    const result = await runCli(['diff', '--agent', 'opencode', '--state', statePath, '--config-path', nativePath]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent: opencode/);
    assert.match(result.stdout, /provider: anthropic -> openai/);
    assert.match(result.stdout, /model: claude-3-5-sonnet -> gpt-4\.1-mini/);
    assert.match(result.stdout, /baseURL: https:\/\/old\.example\.test\/v1 -> https:\/\/api\.openai\.com\/v1/);
    assert.match(result.stdout, /apiKey: \*\*\*MASKED\*\*\* -> \*\*\*MASKED\*\*\*/);
    assert.equal(result.stdout.includes(NATIVE_SECRET), false);
    assert.equal(result.stdout.includes(CACHED_SECRET), false);
    assert.equal(await readFile(statePath, 'utf8'), stateBefore);
    assert.equal(await readFile(nativePath, 'utf8'), nativeBefore);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('diff supports fixtures root for all adapters without mutating state or native fixtures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-diff-all-'));
  const homeDirectory = join(directory, 'home');
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');

  try {
    await writeState(statePath, CANONICAL_CONFIG);
    await mkdir(join(homeDirectory, '.agentcfg', 'env'), { recursive: true });
    await writeFile(join(homeDirectory, '.agentcfg', 'env', 'codex.env'), `AGENTCFG_OPENAI_API_KEY=${NATIVE_SECRET}\n`);
    await writeNativeFixtures(fixturesRoot, CANONICAL_CONFIG.apiKey.value);
    const before = await snapshotFiles([
      statePath,
      join(fixturesRoot, 'codex', 'input.config.toml'),
      join(fixturesRoot, 'codex', 'codex.env'),
      join(fixturesRoot, 'opencode', 'input.opencode.jsonc'),
      join(fixturesRoot, 'openclaw', 'input.openclaw.json5'),
    ]);

    const result = await runCli(['diff', '--all-agents', '--state', statePath, '--fixtures-root', fixturesRoot], {
      HOME: homeDirectory,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent: codex\n  No managed diffs\./);
    assert.match(result.stdout, /Agent: opencode\n  No managed diffs\./);
    assert.match(result.stdout, /Agent: openclaw\n  No managed diffs\./);
    assert.equal(result.stdout.includes(CACHED_SECRET), false);
    assert.deepEqual(await snapshotFiles(Object.keys(before)), before);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('Codex diff default path reads agentcfg env directory instead of codex config directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-diff-codex-default-'));
  const homeDirectory = join(directory, 'home');
  const statePath = join(directory, 'state.json');
  const codexConfigPath = join(homeDirectory, '.codex', 'config.toml');
  const agentcfgEnvPath = join(homeDirectory, '.agentcfg', 'env', 'codex.env');

  try {
    await writeState(statePath, CANONICAL_CONFIG);
    await mkdir(join(homeDirectory, '.codex'), { recursive: true });
    await mkdir(join(homeDirectory, '.agentcfg', 'env'), { recursive: true });
    await writeFile(codexConfigPath, codexNativeToml());
    await writeFile(join(homeDirectory, '.codex', 'codex.env'), `AGENTCFG_OPENAI_API_KEY=${NATIVE_SECRET}\n`);
    await writeFile(agentcfgEnvPath, `AGENTCFG_OPENAI_API_KEY=${CANONICAL_CONFIG.apiKey.value}\n`);

    const before = await snapshotFiles([statePath, codexConfigPath, join(homeDirectory, '.codex', 'codex.env'), agentcfgEnvPath]);
    const result = await runCli(['diff', '--agent', 'codex', '--state', statePath], { HOME: homeDirectory });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent: codex\n  No managed diffs\./);
    assert.equal(result.stdout.includes(NATIVE_SECRET), false);
    assert.equal(result.stdout.includes(CACHED_SECRET), false);
    assert.deepEqual(await snapshotFiles(Object.keys(before)), before);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('Codex diff fails closed when the env file exists but is unreadable', async () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-diff-codex-unreadable-env-'));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const envPath = join(fixturesRoot, 'codex', 'codex.env');

  try {
    await writeState(statePath, CANONICAL_CONFIG);
    await writeNativeFixtures(fixturesRoot, CANONICAL_CONFIG.apiKey.value);
    const before = await snapshotFiles([
      statePath,
      join(fixturesRoot, 'codex', 'input.config.toml'),
      envPath,
      join(fixturesRoot, 'opencode', 'input.opencode.jsonc'),
      join(fixturesRoot, 'openclaw', 'input.openclaw.json5'),
    ]);
    await chmod(envPath, 0o000);

    const result = await runCli(['diff', '--agent', 'codex', '--state', statePath, '--fixtures-root', fixturesRoot]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unable to read optional native env file|EACCES|permission/i);
    assert.equal(result.stderr.includes(CACHED_SECRET), false);
    assert.equal(result.stderr.includes(NATIVE_SECRET), false);
    await chmod(envPath, 0o600);
    assert.deepEqual(await snapshotFiles(Object.keys(before)), before);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'codex')), []);
  } finally {
    await chmod(envPath, 0o600).catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }
});

test('diff exits non-zero for missing cache, invalid cache, ambiguous path, and unsupported native shape', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-diff-errors-'));
  const fixturesRoot = join(directory, 'fixtures');

  try {
    const missingCacheState = join(directory, 'missing-cache-state.json');
    await writeFile(missingCacheState, `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`);
    const missingCache = await runCli(['diff', '--agent', 'opencode', '--state', missingCacheState]);
    assert.notEqual(missingCache.status, 0);
    assert.match(missingCache.stderr, /cached agentcfg\.yaml/);

    const invalidCacheState = join(directory, 'invalid-cache-state.json');
    await writeFile(
      invalidCacheState,
      `${JSON.stringify({ schemaVersion: 1, cache: { config: { ...CANONICAL_CONFIG, schemaVersion: 2 }, updatedAt: 'now' } })}\n`,
    );
    const invalidCache = await runCli(['diff', '--agent', 'opencode', '--state', invalidCacheState]);
    assert.notEqual(invalidCache.status, 0);
    assert.match(invalidCache.stderr, /schemaVersion must be 1/);

    const statePath = join(directory, 'state.json');
    await writeState(statePath, CANONICAL_CONFIG);
    await mkdir(join(fixturesRoot, 'opencode'), { recursive: true });
    await writeFile(join(fixturesRoot, 'opencode', 'input.opencode.jsonc'), '{ "model": "openai/gpt-4.1-mini" }\n');
    await writeFile(join(fixturesRoot, 'opencode', 'opencode.json'), '{ "model": "openai/gpt-4.1-mini" }\n');
    const ambiguous = await runCli(['diff', '--agent', 'opencode', '--state', statePath, '--fixtures-root', fixturesRoot]);
    assert.notEqual(ambiguous.status, 0);
    assert.match(ambiguous.stderr, /Ambiguous opencode native config/);

    const unsupportedPath = join(directory, 'unsupported.opencode.jsonc');
    await writeFile(unsupportedPath, '{ "model": 42 }\n');
    const unsupported = await runCli(['diff', '--agent', 'opencode', '--state', statePath, '--config-path', unsupportedPath]);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /Unsupported native shape/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function writeState(path: string, config: typeof CANONICAL_CONFIG): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cache: {
          config,
          updatedAt: '2026-06-05T00:00:00.000Z',
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function writeNativeFixtures(fixturesRoot: string, apiKey: string): Promise<void> {
  await mkdir(join(fixturesRoot, 'codex'), { recursive: true });
  await mkdir(join(fixturesRoot, 'opencode'), { recursive: true });
  await mkdir(join(fixturesRoot, 'openclaw'), { recursive: true });

  await writeFile(
    join(fixturesRoot, 'codex', 'input.config.toml'),
    codexNativeToml(),
  );
  await writeFile(join(fixturesRoot, 'codex', 'codex.env'), `AGENTCFG_OPENAI_API_KEY=${apiKey}\n`);
  await writeFile(
    join(fixturesRoot, 'opencode', 'input.opencode.jsonc'),
    `${JSON.stringify({
      model: 'openai/gpt-4.1-mini',
      provider: {
        openai: {
          options: {
            baseURL: 'https://api.openai.com/v1',
            apiKey,
          },
        },
      },
    })}\n`,
  );
  await writeFile(
    join(fixturesRoot, 'openclaw', 'input.openclaw.json5'),
    `${JSON.stringify({
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-4.1-mini',
          },
        },
      },
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey,
          },
        },
      },
    })}\n`,
  );
}

function codexNativeToml(): string {
  return [
    'model = "gpt-4.1-mini"',
    'model_provider = "openai"',
    '',
    '[model_providers.openai]',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "AGENTCFG_OPENAI_API_KEY"',
    '',
  ].join('\n');
}

async function snapshotFiles(paths: string[]): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const path of paths) {
    snapshot[path] = await readFile(path, 'utf8');
  }
  return snapshot;
}

async function backupFiles(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((entry) => entry.endsWith('.bak')).sort();
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise<CliResult>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}` },
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      childProcess.kill('SIGTERM');
      rejectPromise(new Error(`CLI timed out: agentcfg ${args.join(' ')}`));
    }, 5000);

    childProcess.stdout.setEncoding('utf8');
    childProcess.stderr.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    childProcess.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    childProcess.on('close', (status) => {
      clearTimeout(timeout);
      resolvePromise({ status, stdout, stderr });
    });
  });
}
