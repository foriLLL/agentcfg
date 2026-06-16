import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { applyPlan, type ApplyAgentPlan } from '../../src/core/apply';

const CLI_PATH = resolve(process.cwd(), 'dist/cli.js');
const CACHED_SECRET = ['sk', 'apply', 'redacted'].join('-');
const NATIVE_SECRET = ['native', 'apply', 'value'].join('-');
const CANONICAL_CONFIG = {
  schemaVersion: 1,
  defaults: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
  providers: {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: {
        type: 'plain',
        value: CACHED_SECRET,
      },
      models: {
        'gpt-4.1-mini': {},
      },
    },
  },
};

const METADATA_CONFIG = {
  ...CANONICAL_CONFIG,
  providers: {
    openai: {
      ...CANONICAL_CONFIG.providers.openai,
      models: {
        'gpt-4.1-mini': {
          variant: 'chat',
          contextWindow: 1047576,
          contextTokens: 1047576,
          maxTokens: 32768,
        },
      },
    },
  },
};

const OH_MY_OPENAGENT_CONFIG = {
  ...CANONICAL_CONFIG,
  ohMyOpenAgent: {
    agents: {
      oracle: {
        model: 'openai/gpt-4.1-mini',
        variant: 'high',
      },
    },
    categories: {
      quick: {
        model: 'openai/gpt-4.1-mini',
      },
    },
  },
};

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

test('apply requires exactly one target selector', async () => {
  const missingSelector = await runCli(['apply']);
  assert.notEqual(missingSelector.status, 0);
  assert.match(missingSelector.stderr, /--agent/);
  assert.match(missingSelector.stderr, /--all-agents/);

  const conflictingSelectors = await runCli(['apply', '--agent', 'opencode', '--all-agents']);
  assert.notEqual(conflictingSelectors.status, 0);
  assert.match(conflictingSelectors.stderr, /--agent/);
  assert.match(conflictingSelectors.stderr, /--all-agents/);
});

test('apply dry-run validates and prints masked changes without writing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-dry-run-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');

  try {
    await writeState(statePath);
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    const before = await readFile(nativePath, 'utf8');

    const result = await runCli([
      'apply',
      '--agent',
      'opencode',
      '--dry-run',
      '--yes',
      '--state',
      statePath,
      '--config-path',
      nativePath,
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run: no files written/);
    assert.match(result.stdout, /Status: would change/);
    assert.match(result.stdout, /apiKey: \*\*\*MASKED\*\*\* -> \*\*\*MASKED\*\*\*/);
    assert.equal(result.stdout.includes(CACHED_SECRET), false);
    assert.equal(result.stdout.includes(NATIVE_SECRET), false);
    assert.equal(await readFile(nativePath, 'utf8'), before);
    assert.deepEqual(await backupFiles(directory), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply without yes rejects non-interactive confirmation and writes nothing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-confirm-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');

  try {
    await writeState(statePath);
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    const before = await readFile(nativePath, 'utf8');

    const result = await runCli(['apply', '--agent', 'opencode', '--state', statePath, '--config-path', nativePath]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Apply cancelled; no files written/);
    assert.equal(result.stderr.includes(CACHED_SECRET), false);
    assert.equal(result.stderr.includes(NATIVE_SECRET), false);
    assert.equal(await readFile(nativePath, 'utf8'), before);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply yes writes atomically with backup and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-yes-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');
  const oldNative = opencodeNativeJson(NATIVE_SECRET);

  try {
    await writeState(statePath);
    await writeFile(nativePath, oldNative);

    const first = await runCli(['apply', '--agent', 'opencode', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Apply complete/);
    assert.match(first.stdout, /Status: applied/);
    assert.equal(first.stdout.includes(CACHED_SECRET), false);
    assert.equal(first.stdout.includes(NATIVE_SECRET), false);
    const rendered = JSON.parse(await readFile(nativePath, 'utf8')) as Record<string, unknown>;
    assert.equal(rendered.model, 'openai/gpt-4.1-mini');
    assert.equal(readNestedString(rendered, ['provider', 'openai', 'options', 'baseURL']), 'https://api.openai.com/v1');
    assert.equal(readNestedString(rendered, ['provider', 'openai', 'options', 'apiKey']), CACHED_SECRET);
    assert.equal((await stat(nativePath)).mode & 0o777, 0o600);
    const backupsAfterFirst = await backupFiles(directory);
    assert.equal(backupsAfterFirst.length, 1);
    assert.equal(await readFile(join(directory, backupsAfterFirst[0]), 'utf8'), oldNative);

    const afterFirst = await readFile(nativePath, 'utf8');
    const second = await runCli(['apply', '--agent', 'opencode', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Status: unchanged/);
    assert.equal(await readFile(nativePath, 'utf8'), afterFirst);
    assert.deepEqual(await backupFiles(directory), backupsAfterFirst);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply yes writes Claude Code settings and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-claude-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'settings.json');
  const original = `${JSON.stringify({ theme: 'dark', env: { KEEP_ME: 'yes', ANTHROPIC_API_KEY: NATIVE_SECRET, ANTHROPIC_BASE_URL: 'https://old.example.test' } }, null, 2)}\n`;

  try {
    await writeState(statePath);
    await writeFile(nativePath, original);

    const first = await runCli(['apply', '--agent', 'claude', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Apply complete/);
    assert.match(first.stdout, /Status: applied/);
    assert.equal(first.stdout.includes(CACHED_SECRET), false);
    assert.equal(first.stdout.includes(NATIVE_SECRET), false);
    const rendered = JSON.parse(await readFile(nativePath, 'utf8')) as Record<string, unknown>;
    assert.equal(rendered.model, 'gpt-4.1-mini');
    assert.equal(readNestedString(rendered, ['env', 'KEEP_ME']), 'yes');
    assert.equal(readNestedString(rendered, ['env', 'ANTHROPIC_API_KEY']), CACHED_SECRET);
    assert.equal(readNestedString(rendered, ['env', 'ANTHROPIC_BASE_URL']), 'https://api.openai.com/v1');
    assert.equal((await stat(nativePath)).mode & 0o777, 0o600);
    const backupsAfterFirst = await backupFiles(directory);
    assert.equal(backupsAfterFirst.length, 1);
    assert.equal(await readFile(join(directory, backupsAfterFirst[0]), 'utf8'), original);

    const afterFirst = await readFile(nativePath, 'utf8');
    const second = await runCli(['apply', '--agent', 'claude', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Status: unchanged/);
    assert.equal(await readFile(nativePath, 'utf8'), afterFirst);
    assert.deepEqual(await backupFiles(directory), backupsAfterFirst);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply yes writes OhMyOpenAgent route config and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-ohmyopenagent-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'oh-my-openagent.json');
  const original = ohMyOpenAgentDriftNativeJson();

  try {
    await writeState(statePath, OH_MY_OPENAGENT_CONFIG);
    await writeFile(nativePath, original);

    const first = await runCli(['apply', '--agent', 'ohmyopenagent', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Apply complete/);
    assert.match(first.stdout, /Agent: ohmyopenagent/);
    assert.match(first.stdout, /Status: applied/);
    assert.match(first.stdout, /ohMyOpenAgent\.agents\.oracle\.model: anthropic\/claude-3-5-sonnet -> openai\/gpt-4\.1-mini/);
    assert.match(first.stdout, /ohMyOpenAgent\.agents\.oracle\.variant: low -> high/);
    const rendered = JSON.parse(await readFile(nativePath, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(rendered.disabled_hooks, ['no-sisyphus-gpt']);
    assert.equal(readNestedString(rendered, ['agents', 'oracle', 'model']), 'openai/gpt-4.1-mini');
    assert.equal(readNestedString(rendered, ['agents', 'oracle', 'variant']), 'high');
    assert.equal(readNestedString(rendered, ['agents', 'oracle', 'prompt_append']), 'Keep oracle prompt.');
    assert.equal(readNestedString(rendered, ['categories', 'quick', 'model']), 'openai/gpt-4.1-mini');
    assert.equal(readNestedString(rendered, ['categories', 'quick', 'variant']), undefined);
    assert.equal(readNestedString(rendered, ['categories', 'quick', 'notes']), 'Keep quick metadata.');
    assert.equal((await stat(nativePath)).mode & 0o777, 0o600);
    const backupsAfterFirst = await backupFiles(directory);
    assert.equal(backupsAfterFirst.length, 1);
    assert.equal(await readFile(join(directory, backupsAfterFirst[0]), 'utf8'), original);

    const afterFirst = await readFile(nativePath, 'utf8');
    const second = await runCli(['apply', '--agent', 'ohmyopenagent', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Status: unchanged/);
    assert.equal(await readFile(nativePath, 'utf8'), afterFirst);
    assert.deepEqual(await backupFiles(directory), backupsAfterFirst);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply yes writes OpenCode metadata-only changes and preserves existing model fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-opencode-metadata-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');

  try {
    await writeState(statePath, METADATA_CONFIG);
    await writeFile(
      nativePath,
      `${JSON.stringify(
        {
          theme: 'system',
          model: 'openai/gpt-4.1-mini',
          provider: {
            openai: {
              options: {
                baseURL: 'https://api.openai.com/v1',
                apiKey: CACHED_SECRET,
              },
              models: {
                'gpt-4.1-mini': {
                  reasoning: true,
                  limit: {
                    context: 4096,
                    input: 4096,
                    output: 1024,
                  },
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runCli(['apply', '--agent', 'opencode', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Status: applied/);
    assert.match(result.stdout, /contextWindow: 4096 -> 1047576/);
    assert.match(result.stdout, /contextTokens: 4096 -> 1047576/);
    assert.match(result.stdout, /maxTokens: 1024 -> 32768/);
    const rendered = JSON.parse(await readFile(nativePath, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(readNestedValue(rendered, ['provider', 'openai', 'models', 'gpt-4.1-mini']), {
      reasoning: true,
      limit: {
        context: 1047576,
        input: 1047576,
        output: 32768,
      },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply yes writes OpenClaw metadata-only changes and preserves selected model fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-openclaw-metadata-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'openclaw.json5');

  try {
    await writeState(statePath, METADATA_CONFIG);
    await writeFile(
      nativePath,
      `${JSON.stringify(
        {
          agents: { defaults: { model: { primary: 'openai/gpt-4.1-mini' } } },
          models: {
            providers: {
              openai: {
                baseUrl: 'https://api.openai.com/v1',
                apiKey: CACHED_SECRET,
                models: [
                  {
                    id: 'gpt-4.1-mini',
                    name: 'Existing model name',
                    input: ['text', 'image'],
                    contextWindow: 4096,
                    contextTokens: 4096,
                    maxTokens: 1024,
                  },
                  {
                    id: 'gpt-4.1',
                    name: 'Other model',
                  },
                ],
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await runCli(['apply', '--agent', 'openclaw', '--yes', '--state', statePath, '--config-path', nativePath]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Status: applied/);
    assert.match(result.stdout, /contextWindow: 4096 -> 1047576/);
    assert.match(result.stdout, /contextTokens: 4096 -> 1047576/);
    assert.match(result.stdout, /maxTokens: 1024 -> 32768/);
    const rendered = JSON.parse(await readFile(nativePath, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(readNestedValue(rendered, ['models', 'providers', 'openai', 'models']), [
      {
        id: 'gpt-4.1-mini',
        name: 'Existing model name',
        input: ['text', 'image'],
        contextWindow: 1047576,
        contextTokens: 1047576,
        maxTokens: 32768,
      },
      {
        id: 'gpt-4.1',
        name: 'Other model',
      },
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply yes writes Codex native config and generated env file with backups and idempotency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-codex-'));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const codexDirectory = join(fixturesRoot, 'codex');
  const nativePath = join(codexDirectory, 'input.config.toml');
  const envPath = join(codexDirectory, '.env');

  try {
    await writeState(statePath);
    await writeNativeFixtures(fixturesRoot);
    const oldNative = await readFile(nativePath, 'utf8');
    const oldEnv = await readFile(envPath, 'utf8');

    const first = await runCli(['apply', '--agent', 'codex', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot]);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Apply complete/);
    assert.match(first.stdout, /Agent: codex/);
    assert.match(first.stdout, /Status: applied/);
    assert.equal(first.stdout.includes(CACHED_SECRET), false);
    assert.equal(first.stdout.includes(NATIVE_SECRET), false);
    assert.equal(first.stderr.includes(CACHED_SECRET), false);
    assert.equal(first.stderr.includes(NATIVE_SECRET), false);
    assert.match(await readFile(nativePath, 'utf8'), /model = "gpt-4\.1-mini"/);
    assert.match(await readFile(nativePath, 'utf8'), /model_provider = "openai"/);
    assert.match(await readFile(nativePath, 'utf8'), /base_url = "https:\/\/api\.openai\.com\/v1"/);
    assert.match(await readFile(nativePath, 'utf8'), /env_key = "AGENTCFG_OPENAI_API_KEY"/);
    assert.equal(await readFile(envPath, 'utf8'), `AGENTCFG_OPENAI_API_KEY=${CACHED_SECRET}\n`);
    assert.equal((await stat(envPath)).mode & 0o777, 0o600);

    const backupsAfterFirst = await backupFiles(codexDirectory);
    assert.equal(backupsAfterFirst.length, 2);
    assert.equal(await readFile(join(codexDirectory, backupFileFor(backupsAfterFirst, 'input.config.toml')), 'utf8'), oldNative);
    assert.equal(await readFile(join(codexDirectory, backupFileFor(backupsAfterFirst, '.env')), 'utf8'), oldEnv);

    const nativeAfterFirst = await readFile(nativePath, 'utf8');
    const envAfterFirst = await readFile(envPath, 'utf8');
    const second = await runCli(['apply', '--agent', 'codex', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot]);

    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Status: unchanged/);
    assert.equal(second.stdout.includes(CACHED_SECRET), false);
    assert.equal(second.stdout.includes(NATIVE_SECRET), false);
    assert.equal(await readFile(nativePath, 'utf8'), nativeAfterFirst);
    assert.equal(await readFile(envPath, 'utf8'), envAfterFirst);
    assert.deepEqual(await backupFiles(codexDirectory), backupsAfterFirst);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply all-agents validates all selected agents before any write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-all-or-nothing-'));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const paths = {
    codex: join(fixturesRoot, 'codex', 'input.config.toml'),
    codexEnv: join(fixturesRoot, 'codex', '.env'),
    opencode: join(fixturesRoot, 'opencode', 'input.opencode.jsonc'),
    openclaw: join(fixturesRoot, 'openclaw', 'input.openclaw.json5'),
    claude: join(fixturesRoot, 'claude', 'input.settings.json'),
    ohmyopenagent: join(fixturesRoot, 'ohmyopenagent', 'input.oh-my-openagent.json'),
  };

  try {
    await writeState(statePath);
    await writeNativeFixtures(fixturesRoot);
    await writeFile(paths.opencode, '{ "model": ');
    const before = await snapshotFiles(Object.values(paths));

    const result = await runCli(['apply', '--all-agents', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Apply validation failed; no files were written/);
    assert.match(result.stderr, /Agent: codex/);
    assert.match(result.stderr, /Agent: opencode/);
    assert.match(result.stderr, /Status: failed/);
    assert.match(result.stderr, /Agent: openclaw/);
    assert.match(result.stderr, /Agent: claude/);
    assert.match(result.stderr, /Agent: ohmyopenagent/);
    assert.equal(result.stderr.includes(CACHED_SECRET), false);
    assert.equal(result.stderr.includes(NATIVE_SECRET), false);
    assert.deepEqual(await snapshotFiles(Object.values(paths)), before);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'codex')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'opencode')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'openclaw')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'claude')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'ohmyopenagent')), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply all-agents rejects a read-only later target before writing earlier agents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-readonly-file-'));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const paths = {
    codex: join(fixturesRoot, 'codex', 'input.config.toml'),
    codexEnv: join(fixturesRoot, 'codex', '.env'),
    opencode: join(fixturesRoot, 'opencode', 'input.opencode.jsonc'),
    openclaw: join(fixturesRoot, 'openclaw', 'input.openclaw.json5'),
    claude: join(fixturesRoot, 'claude', 'input.settings.json'),
    ohmyopenagent: join(fixturesRoot, 'ohmyopenagent', 'input.oh-my-openagent.json'),
  };

  try {
    await writeState(statePath);
    await writeNativeFixtures(fixturesRoot);
    const before = await snapshotFiles(Object.values(paths));
    await chmod(paths.openclaw, 0o444);

    const result = await runCli(['apply', '--all-agents', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /read-only existing file/i);
    assert.equal(result.stderr.includes(CACHED_SECRET), false);
    assert.equal(result.stderr.includes(NATIVE_SECRET), false);
    assert.deepEqual(await snapshotFiles(Object.values(paths)), before);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'codex')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'opencode')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'openclaw')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'claude')), []);
    assert.deepEqual(await backupFiles(join(fixturesRoot, 'ohmyopenagent')), []);
  } finally {
    await chmod(paths.openclaw, 0o644).catch(() => undefined);
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply rollback restores prior content and mode after a later write failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-rollback-mode-'));
  const secretPath = join(directory, 'secret.env');
  const laterPath = join(directory, 'later.env');
  const oldSecret = 'AGENTCFG_OPENAI_API_KEY=old-secret\n';
  const oldLater = 'LATER=old\n';

  try {
    await writeFile(secretPath, oldSecret, { mode: 0o600 });
    await chmod(secretPath, 0o600);
    await writeFile(laterPath, oldLater, { mode: 0o644 });
    const plans: ApplyAgentPlan[] = [
      {
        agent: 'codex',
        configPath: laterPath,
        envPath: secretPath,
        changes: [],
        notices: [],
        operations: [
          { path: secretPath, content: 'AGENTCFG_OPENAI_API_KEY=new-secret\n', mode: 0o600, kind: 'env' },
          { path: laterPath, content: 'LATER=new\n', kind: 'env' },
        ],
      },
    ];

    await assert.rejects(
      applyPlan(plans, {
        beforeRename: (_tempPath, targetPath) => {
          if (targetPath === laterPath) {
            throw new Error('forced later write failure');
          }
        },
      }),
      /forced later write failure/,
    );

    assert.equal(await readFile(secretPath, 'utf8'), oldSecret);
    assert.equal((await stat(secretPath)).mode & 0o777, 0o600);
    assert.equal(await readFile(laterPath, 'utf8'), oldLater);
    assert.equal((await stat(laterPath)).mode & 0o777, 0o644);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('apply dry-run reports Codex unsupported metadata notices without writing or changing status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-apply-codex-notices-'));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const codexDirectory = join(fixturesRoot, 'codex');
  const nativePath = join(codexDirectory, 'input.config.toml');
  const envPath = join(codexDirectory, '.env');

  try {
    await writeState(statePath, METADATA_CONFIG);
    await mkdir(codexDirectory, { recursive: true });
    await writeFile(
      nativePath,
      [
        'model = "gpt-4.1-mini"',
        'model_provider = "openai"',
        '',
        '[model_providers.openai]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "AGENTCFG_OPENAI_API_KEY"',
        '',
      ].join('\n'),
    );
    await writeFile(envPath, `AGENTCFG_OPENAI_API_KEY=${CACHED_SECRET}\n`);
    const before = await snapshotFiles([nativePath, envPath]);

    const result = await runCli(['apply', '--agent', 'codex', '--dry-run', '--yes', '--state', statePath, '--fixtures-root', fixturesRoot]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Status: unchanged/);
    assert.match(result.stdout, /No managed changes\./);
    assert.match(result.stdout, /Notice: Codex has no official native mapping for contextWindow/);
    assert.match(result.stdout, /Notice: Codex has no official native mapping for contextTokens/);
    assert.match(result.stdout, /Notice: Codex has no official native mapping for maxTokens/);
    assert.doesNotMatch(result.stdout, /contextWindow: .* -> /);
    assert.doesNotMatch(result.stdout, /contextTokens: .* -> /);
    assert.doesNotMatch(result.stdout, /maxTokens: .* -> /);
    assert.deepEqual(await snapshotFiles(Object.keys(before)), before);
    assert.deepEqual(await backupFiles(codexDirectory), []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function writeState(path: string, config = CANONICAL_CONFIG): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cache: {
          config,
          updatedAt: '2026-06-06T00:00:00.000Z',
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function writeNativeFixtures(fixturesRoot: string): Promise<void> {
  await mkdir(join(fixturesRoot, 'codex'), { recursive: true });
  await mkdir(join(fixturesRoot, 'opencode'), { recursive: true });
  await mkdir(join(fixturesRoot, 'openclaw'), { recursive: true });
  await mkdir(join(fixturesRoot, 'claude'), { recursive: true });
  await mkdir(join(fixturesRoot, 'ohmyopenagent'), { recursive: true });
  await writeFile(join(fixturesRoot, 'codex', 'input.config.toml'), codexNativeToml());
  await writeFile(join(fixturesRoot, 'codex', '.env'), `AGENTCFG_OPENAI_API_KEY=${NATIVE_SECRET}\n`);
  await writeFile(join(fixturesRoot, 'opencode', 'input.opencode.jsonc'), opencodeNativeJson(NATIVE_SECRET));
  await writeFile(join(fixturesRoot, 'openclaw', 'input.openclaw.json5'), openclawNativeJson(NATIVE_SECRET));
  await writeFile(join(fixturesRoot, 'claude', 'input.settings.json'), claudeNativeJson(NATIVE_SECRET));
  await writeFile(join(fixturesRoot, 'ohmyopenagent', 'input.oh-my-openagent.json'), ohMyOpenAgentNativeJson());
}

function codexNativeToml(): string {
  return [
    'model = "old-model"',
    'model_provider = "openai"',
    '',
    '[model_providers.openai]',
    'base_url = "https://old.example.test/v1"',
    'env_key = "AGENTCFG_OPENAI_API_KEY"',
    '',
  ].join('\n');
}

function opencodeNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
      theme: 'system',
      model: 'anthropic/claude-3-5-sonnet',
      provider: {
        anthropic: {
          options: {
            baseURL: 'https://old.example.test/v1',
            apiKey,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function openclawNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
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
            apiKey,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function claudeNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
      theme: 'dark',
      model: 'claude-3-5-sonnet',
      env: {
        KEEP_ME: 'yes',
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: 'https://old.example.test/v1',
      },
    },
    null,
    2,
  )}\n`;
}

function ohMyOpenAgentNativeJson(): string {
  return `${JSON.stringify(
    {
      disabled_hooks: ['no-sisyphus-gpt'],
      agents: {
        sisyphus: {
          prompt_append: 'Keep local prompt.',
        },
      },
    },
    null,
    2,
  )}\n`;
}

function ohMyOpenAgentDriftNativeJson(): string {
  return `${JSON.stringify(
    {
      disabled_hooks: ['no-sisyphus-gpt'],
      agents: {
        oracle: {
          model: 'anthropic/claude-3-5-sonnet',
          variant: 'low',
          prompt_append: 'Keep oracle prompt.',
        },
      },
      categories: {
        quick: {
          model: 'anthropic/claude-3-5-sonnet',
          variant: 'medium',
          notes: 'Keep quick metadata.',
        },
      },
    },
    null,
    2,
  )}\n`;
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

function backupFileFor(backups: string[], sourceName: string): string {
  const backup = backups.find((entry) => entry.startsWith(`${sourceName}.`));
  if (backup === undefined) {
    throw new Error(`Missing backup for ${sourceName}`);
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

function readNestedValue(object: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = object;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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
