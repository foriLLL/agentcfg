import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const CLI_PATH = resolve(process.cwd(), 'dist/cli.js');
const TEST_SECRET = ['sk', 'test', 'redacted'].join('-');
const NATIVE_SECRET = ['native', 'e2e', 'value'].join('-');
const CANONICAL_YAML = [
  'schemaVersion: 1',
  'defaults:',
  '  provider: openai',
  '  model: gpt-4.1-mini',
  'providers:',
  '  openai:',
  '    baseURL: https://api.openai.com/v1',
  '    apiKey:',
  '      type: plain',
  `      value: ${TEST_SECRET}`,
  '    models:',
  '      gpt-4.1-mini: {}',
  '      gpt-4.1: {}',
  '',
].join('\n');

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type NativePaths = {
  codex: string;
  codexEnv: string;
  opencode: string;
  openclaw: string;
  claude: string;
};

test('E2E init, pull, diff, dry-run apply, real apply, and idempotent apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-e2e-happy-'));
  const statePath = join(directory, 'state.json');
  const homeDirectory = join(directory, 'home');
  const fixturesRoot = join(directory, 'fixtures');
  const fakeBin = await writeFakeGh(directory);
  const server = await startFakeGistServer({
    status: 200,
    etag: 'W/"e2e-etag"',
    body: buildGistBody(CANONICAL_YAML, 'e2e-revision'),
  });

  try {
    await mkdir(homeDirectory, { recursive: true });
    const nativePaths = await writeNativeFixtures(fixturesRoot);
    const nativeBefore = await snapshotFiles(Object.values(nativePaths));

    const init = await runCli(['init', '--gist', 'e2e-gist-id', '--state', statePath], {
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(init.status, 0, init.stderr);
    assertNoSecretOutput(init);

    const pull = await runCli(['pull', '--state', statePath], {
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(pull.status, 0, pull.stderr);
    assert.match(pull.stdout, /Pulled agentcfg\.yaml from Gist e2e-gist-id/);
    assert.match(pull.stdout, /\*\*\*MASKED\*\*\*/);
    assertNoSecretOutput(pull);
    assert.deepEqual(server.requests.map(({ url, authorization }) => ({ url, authorization })), [{ url: '/e2e-gist-id', authorization: undefined }]);
    await assertCachedState(statePath);

    const diff = await runCli(['diff', '--all-agents', '--state', statePath, '--fixtures-root', fixturesRoot], {
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(diff.status, 0, diff.stderr);
    assert.match(diff.stdout, /Agent: codex/);
    assert.match(diff.stdout, /Agent: opencode/);
    assert.match(diff.stdout, /Agent: openclaw/);
    assert.match(diff.stdout, /Agent: claude/);
    assert.match(diff.stdout, /apiKey: \*\*\*MASKED\*\*\* -> \*\*\*MASKED\*\*\*/);
    assertNoSecretOutput(diff);
    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), nativeBefore);

    const dryRun = await runCli(
      ['apply', '--all-agents', '--dry-run', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot],
      { HOME: homeDirectory, PATH: fakeBin },
    );
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run: no files written/);
    assert.match(dryRun.stdout, /Status: would change/);
    assertNoSecretOutput(dryRun);
    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), nativeBefore);
    assert.deepEqual(await allBackupFiles(fixturesRoot), []);

    const firstApply = await runCli(
      ['apply', '--all-agents', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot],
      { HOME: homeDirectory, PATH: fakeBin },
    );
    assert.equal(firstApply.status, 0, firstApply.stderr);
    assert.match(firstApply.stdout, /Apply complete/);
    assert.match(firstApply.stdout, /Agent: codex/);
    assert.match(firstApply.stdout, /Agent: opencode/);
    assert.match(firstApply.stdout, /Agent: openclaw/);
    assert.match(firstApply.stdout, /Agent: claude/);
    assert.match(firstApply.stdout, /Status: applied/);
    assertNoSecretOutput(firstApply);

    await assertAppliedNativeFiles(nativePaths);
    const backupsAfterFirst = await allBackupFiles(fixturesRoot);
    assert.equal(backupsAfterFirst.length, 5);
    assert.equal(await readFile(backupFileFor(backupsAfterFirst, nativePaths.codex), 'utf8'), nativeBefore[nativePaths.codex]);
    assert.equal(await readFile(backupFileFor(backupsAfterFirst, nativePaths.codexEnv), 'utf8'), nativeBefore[nativePaths.codexEnv]);
    assert.equal(await readFile(backupFileFor(backupsAfterFirst, nativePaths.opencode), 'utf8'), nativeBefore[nativePaths.opencode]);
    assert.equal(await readFile(backupFileFor(backupsAfterFirst, nativePaths.openclaw), 'utf8'), nativeBefore[nativePaths.openclaw]);
    assert.equal(await readFile(backupFileFor(backupsAfterFirst, nativePaths.claude), 'utf8'), nativeBefore[nativePaths.claude]);
    const afterFirst = await snapshotFiles(Object.values(nativePaths));

    const secondApply = await runCli(
      ['apply', '--all-agents', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot],
      { HOME: homeDirectory, PATH: fakeBin },
    );
    assert.equal(secondApply.status, 0, secondApply.stderr);
    assert.match(secondApply.stdout, /Status: unchanged/);
    assertNoSecretOutput(secondApply);
    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), afterFirst);
    assert.deepEqual(await allBackupFiles(fixturesRoot), backupsAfterFirst);

    const cleanDiff = await runCli(['diff', '--all-agents', '--state', statePath, '--fixtures-root', fixturesRoot], {
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(cleanDiff.status, 0, cleanDiff.stderr);
    assert.match(cleanDiff.stdout, /Agent: codex\n  No managed diffs\./);
    assert.match(cleanDiff.stdout, /Agent: opencode\n  No managed diffs\./);
    assert.match(cleanDiff.stdout, /Agent: openclaw\n  No managed diffs\./);
    assert.match(cleanDiff.stdout, /Agent: claude\n  No managed diffs\./);
    assertNoSecretOutput(cleanDiff);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('E2E pull failures preserve state and native fixtures with actionable errors', async () => {
  const cases = [
    {
      name: 'invalid-yaml',
      body: buildGistBody('schemaVersion: 1\nprovider: [\n', 'invalid-yaml-revision'),
      error: /Invalid agentcfg\.yaml|YAML parser failed/,
    },
    {
      name: 'missing-agentcfg-yaml',
      body: { files: { 'other.yaml': { content: CANONICAL_YAML } }, history: [{ version: 'missing-file-revision' }] },
      error: /agentcfg\.yaml/,
    },
    {
      name: 'unknown-schema-version',
      body: buildGistBody(CANONICAL_YAML.replace('schemaVersion: 1', 'schemaVersion: 2'), 'schema-revision'),
      error: /schemaVersion must be 1/,
    },
    {
      name: 'missing-api-key',
      body: buildGistBody(CANONICAL_YAML.replace(/    apiKey:\n      type: plain\n      value: .+\n/, ''), 'missing-key-revision'),
      error: /apiKey is required/,
    },
    {
      name: 'http-auth-failure',
      status: 401,
      body: { message: 'Bad credentials' },
      error: /GitHub Gist fetch failed with 401/i,
    },
  ];

  for (const failureCase of cases) {
    const directory = await mkdtemp(join(tmpdir(), `agentcfg-cli-e2e-${failureCase.name}-`));
    const statePath = join(directory, 'state.json');
    const fixturesRoot = join(directory, 'fixtures');
    const fakeBin = await writeFakeGh(directory);
    const server = await startFakeGistServer({ status: failureCase.status ?? 200, body: failureCase.body });

    try {
      const nativePaths = await writeNativeFixtures(fixturesRoot);
      const init = await runCli(['init', '--gist', failureCase.name, '--state', statePath], { PATH: fakeBin });
      assert.equal(init.status, 0, init.stderr);
      const stateBefore = await readFile(statePath, 'utf8');
      const nativeBefore = await snapshotFiles(Object.values(nativePaths));

      const result = await runCli(['pull', '--state', statePath], {
        AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
        PATH: fakeBin,
      });

      assert.notEqual(result.status, 0, failureCase.name);
      assert.match(result.stderr, failureCase.error, failureCase.name);
      assertNoSecretOutput(result);
      assert.equal(await readFile(statePath, 'utf8'), stateBefore);
      assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), nativeBefore);
      assert.deepEqual(await allBackupFiles(fixturesRoot), []);
    } finally {
      await server.close();
      await rm(directory, { force: true, recursive: true });
    }
  }
});

test('E2E second pull updates remote metadata without mutating native fixtures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-e2e-second-pull-'));
  const statePath = join(directory, 'state.json');
  const homeDirectory = join(directory, 'home');
  const fixturesRoot = join(directory, 'fixtures');
  const fakeBin = await writeFakeGh(directory);
  const changedYaml = CANONICAL_YAML.replace('  model: gpt-4.1-mini', '  model: gpt-4.1');
  const server = await startFakeGistServer([
    {
      status: 200,
      etag: 'W/"first-etag"',
      body: buildGistBody(CANONICAL_YAML, 'first-revision'),
    },
    {
      status: 200,
      etag: 'W/"second-etag"',
      body: buildGistBody(changedYaml, 'second-revision'),
    },
  ]);

  try {
    await mkdir(homeDirectory, { recursive: true });
    const nativePaths = await writeNativeFixtures(fixturesRoot);
    const nativeBefore = await snapshotFiles(Object.values(nativePaths));

    const init = await runCli(['init', '--gist', 'second-pull-gist', '--state', statePath], {
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(init.status, 0, init.stderr);

    const firstPull = await runCli(['pull', '--state', statePath], {
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(firstPull.status, 0, firstPull.stderr);
    assertNoSecretOutput(firstPull);

    const secondPull = await runCli(['pull', '--state', statePath], {
      AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
      HOME: homeDirectory,
      PATH: fakeBin,
    });
    assert.equal(secondPull.status, 0, secondPull.stderr);
    assert.match(secondPull.stdout, /Pulled agentcfg\.yaml from Gist second-pull-gist/);
    assertNoSecretOutput(secondPull);

    assert.deepEqual(server.requests.map(({ url, authorization }) => ({ url, authorization })), [
      { url: '/second-pull-gist', authorization: undefined },
      { url: '/second-pull-gist', authorization: undefined },
    ]);
    const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
    const cache = assertRecord(state.cache, 'cache');
    const config = assertRecord(cache.config, 'cache.config');
    const remote = assertRecord(state.remote, 'remote');
    const conflict = assertRecord(state.conflict, 'conflict');
    const defaults = assertRecord(config.defaults, 'cache.config.defaults');
    assert.equal(defaults.model, 'gpt-4.1');
    assert.equal(remote.revision, 'second-revision');
    assert.equal(remote.etag, 'W/"second-etag"');
    assert.equal(conflict.baseRevision, 'second-revision');
    assert.equal(conflict.baseETag, 'W/"second-etag"');
    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), nativeBefore);
    assert.deepEqual(await allBackupFiles(fixturesRoot), []);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('E2E native failure paths leave fixtures unchanged', async () => {
  await withPulledFixture('malformed-native-config', async ({ statePath, fixturesRoot, nativePaths, env }) => {
    await writeFile(nativePaths.opencode, '{ "model": ');
    const before = await snapshotFiles(Object.values(nativePaths));

    const result = await runCli(['apply', '--all-agents', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot], env);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Apply validation failed; no files were written/);
    assert.match(result.stderr, /Malformed JSONC native config/);
    assertNoSecretOutput(result);
    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), before);
    assert.deepEqual(await allBackupFiles(fixturesRoot), []);
  });

  await withPulledFixture('ambiguous-config-path', async ({ statePath, fixturesRoot, nativePaths, env }) => {
    await writeFile(join(fixturesRoot, 'opencode', 'opencode.json'), '{ "model": "openai/gpt-4.1-mini" }\n');
    const before = await snapshotFiles(Object.values(nativePaths));

    const result = await runCli(['diff', '--agent', 'opencode', '--state', statePath, '--fixtures-root', fixturesRoot], env);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Ambiguous opencode native config/);
    assertNoSecretOutput(result);
    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), before);
    assert.deepEqual(await allBackupFiles(fixturesRoot), []);
  });

  await withPulledFixture('read-only-config', async ({ statePath, fixturesRoot, nativePaths, env }) => {
    const opencodeDirectory = join(fixturesRoot, 'opencode');
    const before = await snapshotFiles(Object.values(nativePaths));
    await chmod(opencodeDirectory, 0o555);

    try {
      const result = await runCli(['apply', '--agent', 'opencode', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot], env);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /EACCES|EPERM|permission/i);
      assertNoSecretOutput(result);
    } finally {
      await chmod(opencodeDirectory, 0o755);
    }

    assert.deepEqual(await snapshotFiles(Object.values(nativePaths)), before);
    assert.deepEqual(await allBackupFiles(fixturesRoot), []);
  });
});

async function withPulledFixture(
  name: string,
  callback: (fixture: {
    statePath: string;
    fixturesRoot: string;
    nativePaths: NativePaths;
    env: NodeJS.ProcessEnv;
  }) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), `agentcfg-cli-e2e-${name}-`));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const homeDirectory = join(directory, 'home');
  const fakeBin = await writeFakeGh(directory);
  const server = await startFakeGistServer({ status: 200, body: buildGistBody(CANONICAL_YAML, `${name}-revision`) });
  const env = { AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl, HOME: homeDirectory, PATH: fakeBin };

  try {
    await mkdir(homeDirectory, { recursive: true });
    const nativePaths = await writeNativeFixtures(fixturesRoot);
    const init = await runCli(['init', '--gist', `${name}-gist`, '--state', statePath], env);
    assert.equal(init.status, 0, init.stderr);
    const pull = await runCli(['pull', '--state', statePath], env);
    assert.equal(pull.status, 0, pull.stderr);
    assertNoSecretOutput(pull);
    await callback({ statePath, fixturesRoot, nativePaths, env });
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
}

async function writeNativeFixtures(fixturesRoot: string): Promise<NativePaths> {
  const paths = {
    codex: join(fixturesRoot, 'codex', 'input.config.toml'),
    codexEnv: join(fixturesRoot, 'codex', 'codex.env'),
    opencode: join(fixturesRoot, 'opencode', 'input.opencode.jsonc'),
    openclaw: join(fixturesRoot, 'openclaw', 'input.openclaw.json5'),
    claude: join(fixturesRoot, 'claude', 'input.settings.json'),
  };
  await mkdir(join(fixturesRoot, 'codex'), { recursive: true });
  await mkdir(join(fixturesRoot, 'opencode'), { recursive: true });
  await mkdir(join(fixturesRoot, 'openclaw'), { recursive: true });
  await mkdir(join(fixturesRoot, 'claude'), { recursive: true });
  await writeFile(paths.codex, codexNativeToml());
  await writeFile(paths.codexEnv, `AGENTCFG_OPENAI_API_KEY=${NATIVE_SECRET}\n`);
  await writeFile(paths.opencode, opencodeNativeJson());
  await writeFile(paths.openclaw, openclawNativeJson());
  await writeFile(paths.claude, claudeNativeJson());
  return paths;
}

function codexNativeToml(): string {
  return [
    'approval_policy = "on-request"',
    'model = "old-model"',
    'model_provider = "anthropic"',
    '',
    '[model_providers.anthropic]',
    'name = "anthropic"',
    'base_url = "https://old.example.test/v1"',
    'env_key = "AGENTCFG_OPENAI_API_KEY"',
    '',
  ].join('\n');
}

function opencodeNativeJson(): string {
  return `${JSON.stringify(
    {
      theme: 'system',
      plugin: {
        keep: true,
      },
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
  )}\n`;
}

function openclawNativeJson(): string {
  return `${JSON.stringify(
    {
      ui: {
        theme: 'dark',
      },
      agents: {
        defaults: {
          model: {
            primary: 'anthropic/claude-3-5-sonnet',
          },
        },
      },
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://old.example.test/v1',
            apiKey: NATIVE_SECRET,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function claudeNativeJson(): string {
  return `${JSON.stringify(
    {
      theme: 'dark',
      model: 'claude-3-5-sonnet',
      env: {
        KEEP_ME: 'yes',
        ANTHROPIC_API_KEY: NATIVE_SECRET,
        ANTHROPIC_BASE_URL: 'https://old.example.test/v1',
      },
    },
    null,
    2,
  )}\n`;
}

async function assertCachedState(statePath: string): Promise<void> {
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(state.gist, { id: 'e2e-gist-id' });
  const cache = assertRecord(state.cache, 'cache');
  const config = assertRecord(cache.config, 'cache.config');
  const defaults = assertRecord(config.defaults, 'cache.config.defaults');
  const providers = assertRecord(config.providers, 'cache.config.providers');
  const openai = assertRecord(providers.openai, 'cache.config.providers.openai');
  const apiKey = assertRecord(openai.apiKey, 'cache.config.providers.openai.apiKey');
  const remote = assertRecord(state.remote, 'remote');
  assert.deepEqual(defaults, { provider: 'openai', model: 'gpt-4.1-mini' });
  assert.equal(openai.baseURL, 'https://api.openai.com/v1');
  assert.deepEqual(apiKey, { type: 'plain', value: TEST_SECRET });
  assert.equal(remote.revision, 'e2e-revision');
  assert.equal(remote.etag, 'W/"e2e-etag"');
}

async function assertAppliedNativeFiles(paths: NativePaths): Promise<void> {
  const codex = await readFile(paths.codex, 'utf8');
  assert.match(codex, /approval_policy = "on-request"/);
  assert.match(codex, /model = "gpt-4\.1-mini"/);
  assert.match(codex, /model_provider = "openai"/);
  assert.match(codex, /base_url = "https:\/\/api\.openai\.com\/v1"/);
  assert.match(codex, /env_key = "AGENTCFG_OPENAI_API_KEY"/);
  assert.equal(await readFile(paths.codexEnv, 'utf8'), `AGENTCFG_OPENAI_API_KEY=${TEST_SECRET}\n`);
  assert.equal((await stat(paths.codexEnv)).mode & 0o777, 0o600);

  const opencode = JSON.parse(await readFile(paths.opencode, 'utf8')) as Record<string, unknown>;
  assert.equal(opencode.theme, 'system');
  assert.deepEqual(opencode.plugin, { keep: true });
  assert.equal(opencode.model, 'openai/gpt-4.1-mini');
  assert.equal(readNestedString(opencode, ['provider', 'openai', 'options', 'baseURL']), 'https://api.openai.com/v1');
  assert.equal(readNestedString(opencode, ['provider', 'openai', 'options', 'apiKey']), TEST_SECRET);
  assert.equal((await stat(paths.opencode)).mode & 0o777, 0o600);

  const openclaw = JSON.parse(await readFile(paths.openclaw, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(openclaw.ui, { theme: 'dark' });
  assert.equal(readNestedString(openclaw, ['agents', 'defaults', 'model', 'primary']), 'openai/gpt-4.1-mini');
  assert.equal(readNestedString(openclaw, ['models', 'providers', 'openai', 'baseUrl']), 'https://api.openai.com/v1');
  assert.equal(readNestedString(openclaw, ['models', 'providers', 'openai', 'apiKey']), TEST_SECRET);
  assert.equal((await stat(paths.openclaw)).mode & 0o777, 0o600);

  const claude = JSON.parse(await readFile(paths.claude, 'utf8')) as Record<string, unknown>;
  assert.equal(claude.theme, 'dark');
  assert.equal(claude.model, 'gpt-4.1-mini');
  assert.equal(readNestedString(claude, ['env', 'KEEP_ME']), 'yes');
  assert.equal(readNestedString(claude, ['env', 'ANTHROPIC_API_KEY']), TEST_SECRET);
  assert.equal(readNestedString(claude, ['env', 'ANTHROPIC_BASE_URL']), 'https://api.openai.com/v1');
  assert.equal((await stat(paths.claude)).mode & 0o777, 0o600);
}

async function snapshotFiles(paths: string[]): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const path of paths) {
    snapshot[path] = await readFile(path, 'utf8');
  }
  return snapshot;
}

async function allBackupFiles(fixturesRoot: string): Promise<string[]> {
  const directories = ['codex', 'opencode', 'openclaw', 'claude'].map((agent) => join(fixturesRoot, agent));
  const backups: string[] = [];
  for (const directory of directories) {
    for (const entry of await readdir(directory)) {
      if (entry.endsWith('.bak')) {
        backups.push(join(directory, entry));
      }
    }
  }
  return backups.sort();
}

function backupFileFor(backups: string[], sourcePath: string): string {
  const sourceName = sourcePath.split('/').at(-1);
  const backup = backups.find((path) => sourceName !== undefined && path.split('/').at(-1)?.startsWith(`${sourceName}.`));
  if (backup === undefined) {
    throw new Error(`Missing backup for ${sourcePath}`);
  }
  return backup;
}

function readNestedString(object: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = object;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertNoSecretOutput(result: CliResult): void {
  assert.equal(result.stdout.includes(TEST_SECRET), false, result.stdout);
  assert.equal(result.stderr.includes(TEST_SECRET), false, result.stderr);
  assert.equal(result.stdout.includes(NATIVE_SECRET), false, result.stdout);
  assert.equal(result.stderr.includes(NATIVE_SECRET), false, result.stderr);
}

async function writeFakeGh(directory: string): Promise<string> {
  const binDirectory = join(directory, 'bin');
  const ghPath = join(binDirectory, 'gh');
  await mkdir(binDirectory, { recursive: true });
  await writeFile(ghPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await chmod(ghPath, 0o755);
  return binDirectory;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  return new Promise<CliResult>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(process.execPath, [CLI_PATH, ...args], {
      env: buildEnv(env),
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

function buildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const pathPrefix = env.PATH ?? '';
  const nextEnv = {
    ...process.env,
    ...env,
    GITHUB_TOKEN: '',
    PATH: `${pathPrefix}:/opt/homebrew/bin:${process.env.PATH ?? ''}`,
  };
  return nextEnv;
}
