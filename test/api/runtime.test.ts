import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  RuntimeApiError,
  applyRuntime,
  clearSavedGitHubTokenRuntime,
  diffRuntime,
  getConfigFileRuntime,
  getRuntimeState,
  initRuntime,
  loadRemoteConfigRuntime,
  planApplyRuntime,
  pullRuntime,
  saveConfigFileRuntime,
  saveRemoteConfigRuntime,
  setupRemoteConfigRuntime,
} from '../../src/api';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const CACHED_SECRET = ['sk', 'api', 'cached'].join('-');
const NATIVE_SECRET = ['native', 'api', 'secret'].join('-');
const CANONICAL_CONFIG = {
  schemaVersion: 1,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: {
    type: 'plain',
    value: CACHED_SECRET,
  },
} as const;

const VALID_AGENTCFG_YAML = [
  'schemaVersion: 1',
  'provider: openai',
  'model: gpt-4.1-mini',
  'baseURL: https://api.openai.com/v1',
  'apiKey:',
  '  type: plain',
  `  value: ${CACHED_SECRET}`,
  '',
].join('\n');

test('runtime state init and pull responses show provider API keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-pull-'));
  const statePath = join(directory, 'state.json');
  const server = await startFakeGistServer({
    status: 200,
    etag: 'W/"api-etag"',
    body: buildGistBody(VALID_AGENTCFG_YAML, 'api-revision'),
  });

  try {
    const initial = await getRuntimeState({ statePath });
    assert.equal(initial.state.gist.present, false);
    assert.equal(initial.state.cache.present, false);

    const initialized = await initRuntime({ statePath, gistId: 'api-gist-id' });
    assert.deepEqual(initialized.state.gist, { present: true, id: 'api-gist-id' });

    const pulled = await pullRuntime(
      { statePath },
      {
        gistOptions: {
          apiBaseUrl: server.apiBaseUrl,
          env: { GITHUB_TOKEN: 'github-token-for-test' },
        },
      },
    );
    const responseJson = JSON.stringify(pulled);

    assert.equal(pulled.config.apiKey.value, CACHED_SECRET);
    assert.equal(pulled.state.cache.config?.apiKey.value, CACHED_SECRET);
    assert.equal(pulled.state.conflict.baseConfig?.apiKey.value, CACHED_SECRET);
    assert.equal(pulled.remote?.revision, 'api-revision');
    assert.equal(responseJson.includes(CACHED_SECRET), true);
    assert.equal(responseJson.includes('github-token-for-test'), false);
    assert.deepEqual(server.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/api-gist-id', method: 'GET', authorization: 'Bearer github-token-for-test' },
    ]);

    const storedState = await readFile(statePath, 'utf8');
    assert.equal(storedState.includes(CACHED_SECRET), true);
    assert.equal(storedState.includes('github-token-for-test'), false);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('remote setup discovers an agentcfg gist with request token and stores only gist id', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-remote-setup-'));
  const statePath = join(directory, 'state.json');
  const server = await startFakeGistServer([
    {
      status: 200,
      body: [
        { id: 'other-gist', description: 'notes', files: { 'notes.txt': { filename: 'notes.txt' } } },
        { id: 'remote-gist-id', description: 'agentcfg remote config', files: { 'agentcfg.yaml': { filename: 'agentcfg.yaml' } } },
      ],
    },
    { status: 200, etag: 'W/"setup-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'setup-revision') },
  ]);

  try {
    const setup = await setupRemoteConfigRuntime(
      { statePath, githubToken: 'request-token' },
      { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
    );
    const responseJson = JSON.stringify(setup);
    const storedState = await readFile(statePath, 'utf8');

    assert.equal(setup.state.gist.id, 'remote-gist-id');
    assert.equal(setup.config?.apiKey.value, CACHED_SECRET);
    assert.equal(setup.remote?.revision, 'setup-revision');
    assert.equal(responseJson.includes(CACHED_SECRET), true);
    assert.equal(responseJson.includes('request-token'), false);
    assert.equal(storedState.includes('request-token'), false);
    assert.equal(JSON.parse(storedState).gist.id, 'remote-gist-id');
    assert.equal('token' in JSON.parse(storedState), false);
    assert.deepEqual(server.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/?per_page=100', method: 'GET', authorization: 'Bearer request-token' },
      { url: '/remote-gist-id', method: 'GET', authorization: 'Bearer request-token' },
    ]);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('remote operations can remember, reuse, and clear a local GitHub token without returning it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-token-'));
  const statePath = join(directory, 'state.json');
  const secretsPath = join(directory, 'secrets.json');
  const server = await startFakeGistServer([
    {
      status: 200,
      body: [{ id: 'remembered-gist-id', description: 'agentcfg remote config', files: { 'agentcfg.yaml': { filename: 'agentcfg.yaml' } } }],
    },
    { status: 200, etag: 'W/"remember-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'remember-revision') },
    { status: 200, etag: 'W/"reuse-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'reuse-revision') },
  ]);

  try {
    const setup = await setupRemoteConfigRuntime(
      { statePath, githubToken: 'remember-token', rememberGitHubToken: true },
      { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
    );
    const secretsStat = await stat(secretsPath);
    const secretsJson = await readFile(secretsPath, 'utf8');

    assert.equal(setup.state.secrets.hasGitHubToken, true);
    assert.equal(JSON.stringify(setup).includes('remember-token'), false);
    assert.equal(secretsStat.mode & 0o777, 0o600);
    assert.equal(secretsJson.includes('remember-token'), true);
    assert.equal((await readFile(statePath, 'utf8')).includes('remember-token'), false);

    const loaded = await loadRemoteConfigRuntime(
      { statePath },
      { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
    );
    assert.equal(loaded.state.secrets.hasGitHubToken, true);
    assert.equal(JSON.stringify(loaded).includes('remember-token'), false);

    const cleared = await clearSavedGitHubTokenRuntime({ statePath });
    assert.equal(cleared.state.secrets.hasGitHubToken, false);
    await assert.rejects(readFile(secretsPath, 'utf8'), (error: unknown) => isNodeErrorWithCode(error, 'ENOENT'));

    await assert.rejects(
      loadRemoteConfigRuntime({ statePath }, { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } }),
      (error: unknown) => error instanceof RuntimeApiError && error.code === 'invalid-request',
    );

    assert.deepEqual(server.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/?per_page=100', method: 'GET', authorization: 'Bearer remember-token' },
      { url: '/remembered-gist-id', method: 'GET', authorization: 'Bearer remember-token' },
      { url: '/remembered-gist-id', method: 'GET', authorization: 'Bearer remember-token' },
    ]);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('remote save creates gist, returns provider API key, and updates existing gist while preserving blank api key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-remote-save-'));
  const statePath = join(directory, 'state.json');
  const editedConfig = {
    schemaVersion: 1,
    provider: 'anthropic',
    model: 'claude-3-5-sonnet',
    baseURL: 'https://api.anthropic.com/v1',
    apiKey: { type: 'plain', value: 'new-remote-secret' },
  } as const;
  const blankSecretConfig = { ...editedConfig, model: 'claude-3-opus', apiKey: { type: 'plain', value: '' } };
  const server = await startFakeGistServer([
    { status: 201, etag: 'W/"create-etag"', body: { id: 'created-gist-id', ...buildGistBody('', 'created-revision') } },
    { status: 200, body: buildGistBody(remoteYaml('new-remote-secret'), 'existing-revision') },
    { status: 200, etag: 'W/"update-etag"', body: { id: 'created-gist-id', ...buildGistBody('', 'updated-revision') } },
  ]);

  try {
    const created = await saveRemoteConfigRuntime(
      { statePath, githubToken: 'save-token', config: editedConfig },
      { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
    );
    assert.equal(created.state.gist.id, 'created-gist-id');
    assert.equal(created.config.apiKey.value, 'new-remote-secret');
    assert.equal(JSON.stringify(created).includes('new-remote-secret'), true);
    assert.equal(JSON.stringify(created).includes('save-token'), false);

    // Blank provider keys preserve the existing remote API key instead of erasing it.
    const updated = await saveRemoteConfigRuntime(
      { statePath, githubToken: 'save-token', config: blankSecretConfig },
      { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
    );
    const storedState = await readFile(statePath, 'utf8');
    const createBody = JSON.parse(server.requests[0]?.body ?? '{}');
    const patchBody = JSON.parse(server.requests[2]?.body ?? '{}');

    assert.equal(updated.state.gist.id, 'created-gist-id');
    assert.equal(updated.config.apiKey.value, 'new-remote-secret');
    assert.equal(JSON.stringify(updated).includes('new-remote-secret'), true);
    assert.equal(JSON.stringify(updated).includes('save-token'), false);
    assert.equal(storedState.includes('save-token'), false);
    assert.equal(createBody.public, false);
    assert.equal(createBody.description, 'agentcfg remote config');
    assert.equal(createBody.files['agentcfg.yaml'].content.includes('new-remote-secret'), true);
    assert.equal(patchBody.files['agentcfg.yaml'].content.includes('new-remote-secret'), true);
    assert.equal(patchBody.files['agentcfg.yaml'].content.includes('claude-3-opus'), true);
    assert.deepEqual(server.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/', method: 'POST', authorization: 'Bearer save-token' },
      { url: '/created-gist-id', method: 'GET', authorization: 'Bearer save-token' },
      { url: '/created-gist-id', method: 'PATCH', authorization: 'Bearer save-token' },
    ]);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('remote save classifies GitHub transport failures as gist errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-remote-transport-'));
  const statePath = join(directory, 'state.json');

  try {
    await assert.rejects(
      saveRemoteConfigRuntime(
        { statePath, githubToken: 'save-token', config: CANONICAL_CONFIG },
        {
          gistOptions: {
            env: {},
            httpClient: async () => {
              throw new Error('Client network socket disconnected before secure TLS connection was established');
            },
          },
        },
      ),
      (error: unknown) =>
        error instanceof RuntimeApiError &&
        error.code === 'gist-error' &&
        error.message.includes('GitHub Gist network request failed before receiving a response') &&
        error.message.includes('Client network socket disconnected'),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('remote save surfaces GitHub 403 create details without leaking token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-remote-403-'));
  const statePath = join(directory, 'state.json');
  const server = await startFakeGistServer({
    status: 403,
    body: {
      message: 'Resource not accessible by personal access token',
      documentation_url: 'https://docs.github.com/rest/gists/gists#create-a-gist',
    },
  });

  try {
    await assert.rejects(
      saveRemoteConfigRuntime(
        { statePath, githubToken: 'save-token', config: CANONICAL_CONFIG },
        { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
      ),
      (error: unknown) =>
        error instanceof RuntimeApiError &&
        error.code === 'gist-error' &&
        error.message.includes('GitHub Gist create failed with 403 Forbidden') &&
        error.message.includes('Resource not accessible by personal access token') &&
        error.message.includes('classic personal access tokens need the gist scope') &&
        error.message.includes('https://docs.github.com/rest/gists/gists#create-a-gist') &&
        !error.message.includes('save-token'),
    );
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime diff and apply payloads show provider API keys and require explicit confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-apply-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');

  try {
    await writeState(statePath);
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));

    const diff = await diffRuntime({ statePath, agent: 'opencode', configPath: nativePath });
    const apiKeyDiff = diff.results[0]?.changes.find((change) => change.field === 'apiKey');
    assert.deepEqual(apiKeyDiff, {
      field: 'apiKey',
      current: NATIVE_SECRET,
      expected: CACHED_SECRET,
      secret: true,
    });
    assert.equal(JSON.stringify(diff).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(diff).includes(NATIVE_SECRET), true);

    const plan = await planApplyRuntime({ statePath, agent: 'opencode', configPath: nativePath });
    assert.equal(plan.results[0]?.status, 'would-change');
    assert.equal(plan.plans[0]?.operationCount, 1);
    assert.deepEqual(plan.plans[0]?.operationPaths, [nativePath]);
    assert.equal(plan.plans[0]?.filePreviews[0]?.path, nativePath);
    assert.equal(plan.plans[0]?.filePreviews[0]?.kind, 'native');
    assert.equal(plan.plans[0]?.filePreviews[0]?.currentContent?.includes(NATIVE_SECRET), true);
    assert.equal(plan.plans[0]?.filePreviews[0]?.expectedContent.includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(plan.results).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(plan.results).includes(NATIVE_SECRET), true);

    await assert.rejects(
      applyRuntime({ statePath, agent: 'opencode', configPath: nativePath, confirm: 'yes' }),
      (error: unknown) => error instanceof RuntimeApiError && error.code === 'invalid-request',
    );
    assert.equal((await readFile(nativePath, 'utf8')).includes(NATIVE_SECRET), true);

    const applied = await applyRuntime({ statePath, agent: 'opencode', configPath: nativePath, confirm: 'APPLY' });
    assert.equal(applied.results[0]?.status, 'applied');
    assert.equal(JSON.stringify(applied).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(applied).includes(NATIVE_SECRET), true);
    assert.equal((await readFile(nativePath, 'utf8')).includes(CACHED_SECRET), true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime config editor reads and atomically saves native config files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-config-editor-'));
  const nativePath = join(directory, 'opencode.jsonc');
  const original = opencodeNativeJson(NATIVE_SECRET);
  const edited = opencodeNativeJson('edited-api-secret');

  try {
    await writeFile(nativePath, original);

    const loaded = await getConfigFileRuntime({ agent: 'opencode', configPath: nativePath });
    assert.equal(loaded.agent, 'opencode');
    assert.equal(loaded.path, nativePath);
    assert.equal(loaded.format, 'jsonc');
    assert.equal(loaded.content, original);

    const saved = await saveConfigFileRuntime({ agent: 'opencode', configPath: nativePath, content: edited });
    assert.equal(saved.agent, 'opencode');
    assert.equal(saved.path, nativePath);
    assert.equal(saved.format, 'jsonc');
    assert.equal(saved.backupPath !== undefined, true);
    assert.equal(await readFile(nativePath, 'utf8'), edited);

    await assert.rejects(
      saveConfigFileRuntime({ agent: 'opencode', configPath: nativePath, content: '{bad json' }),
      (error: unknown) => error instanceof RuntimeApiError && error.code === 'validation-error',
    );
    assert.equal(await readFile(nativePath, 'utf8'), edited);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function writeState(path: string): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cache: {
          config: CANONICAL_CONFIG,
          updatedAt: '2026-06-07T00:00:00.000Z',
        },
      },
      null,
      2,
    )}\n`,
  );
}

function opencodeNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
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

function remoteYaml(apiKey: string): string {
  return [
    'schemaVersion: 1',
    'provider: anthropic',
    'model: claude-3-5-sonnet',
    'baseURL: https://api.anthropic.com/v1',
    'apiKey:',
    '  type: plain',
    `  value: ${apiKey}`,
    '',
  ].join('\n');
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
