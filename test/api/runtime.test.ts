import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  RuntimeApiError,
  applyRuntime,
  clearSavedGitHubTokenRuntime,
  diffRuntime,
  discoverProviderModelsRuntime,
  getConfigAvailabilityRuntime,
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
const DISCOVERY_SECRET = ['sk', 'api', 'discovery'].join('-');
const NATIVE_SECRET = ['native', 'api', 'secret'].join('-');
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
} as const;

const METADATA_CONFIG = {
  ...CANONICAL_CONFIG,
  providers: {
    openai: {
      ...CANONICAL_CONFIG.providers.openai,
      models: {
        'gpt-4.1-mini': {
          contextWindow: 1047576,
          contextTokens: 1047576,
          maxTokens: 32768,
        },
      },
    },
  },
} as const;

const DISCOVERY_CONFIG = {
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
        value: DISCOVERY_SECRET,
      },
      modelDiscovery: {
        path: '/models',
      },
      models: {
        'gpt-4.1-mini': {},
      },
    },
  },
} as const;

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
  `      value: ${CACHED_SECRET}`,
  '    models:',
  '      gpt-4.1-mini: {}',
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

    assert.equal(pulled.config.providers.openai.apiKey.value, CACHED_SECRET);
    assert.equal(pulled.state.cache.config?.providers.openai.apiKey.value, CACHED_SECRET);
    assert.equal(pulled.state.conflict.baseConfig?.providers.openai.apiKey.value, CACHED_SECRET);
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

test('runtime provider model discovery fetches configured provider models without mutating state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-provider-models-'));
  const statePath = join(directory, 'state.json');
  const providerServer = await startFakeGistServer({
    status: 200,
    body: { data: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }] },
  });
  const config = {
    ...DISCOVERY_CONFIG,
    providers: {
      openai: {
        ...DISCOVERY_CONFIG.providers.openai,
        baseURL: providerServer.apiBaseUrl,
      },
    },
  } as const;

  try {
    await writeStateWithConfig(statePath, config);
    const before = await readFile(statePath, 'utf8');
    const discovered = await discoverProviderModelsRuntime({ statePath, provider: 'openai' });
    const responseJson = JSON.stringify(discovered);

    assert.deepEqual(discovered, { provider: 'openai', models: ['gpt-4.1-mini', 'gpt-4.1'] });
    assert.equal(responseJson.includes(DISCOVERY_SECRET), false);
    assert.equal(responseJson.includes('github-token-for-test'), false);
    assert.equal(await readFile(statePath, 'utf8'), before);
    assert.deepEqual(providerServer.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/models', method: 'GET', authorization: `Bearer ${DISCOVERY_SECRET}` },
    ]);
  } finally {
    await providerServer.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime provider model discovery rejects missing discovery path without fetching', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-provider-models-disabled-'));
  const statePath = join(directory, 'state.json');
  const providerServer = await startFakeGistServer({ status: 200, body: { data: [{ id: 'unused' }] } });

  try {
    await writeStateWithConfig(statePath, CANONICAL_CONFIG);
    await assert.rejects(
      discoverProviderModelsRuntime({ statePath, provider: 'openai' }),
      (error: unknown) =>
        error instanceof RuntimeApiError &&
        error.code === 'invalid-request' &&
        error.message.includes('model discovery is not configured'),
    );
    assert.equal(providerServer.requests.length, 0);
  } finally {
    await providerServer.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime provider model discovery maps provider fetch failures without leaking tokens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-provider-models-failure-'));
  const statePath = join(directory, 'state.json');
  const providerServer = await startFakeGistServer({
    status: 503,
    body: { message: 'upstream unavailable', token: 'github-token-for-test' },
  });
  const config = {
    ...DISCOVERY_CONFIG,
    providers: {
      openai: {
        ...DISCOVERY_CONFIG.providers.openai,
        baseURL: providerServer.apiBaseUrl,
      },
    },
  } as const;

  try {
    await writeStateWithConfig(statePath, config);
    const before = await readFile(statePath, 'utf8');
    await assert.rejects(
      discoverProviderModelsRuntime({ statePath, provider: 'openai' }),
      (error: unknown) =>
        error instanceof RuntimeApiError &&
        error.code === 'provider-error' &&
        error.message.includes('Provider model discovery failed with 503') &&
        !error.message.includes('github-token-for-test') &&
        !error.message.includes(DISCOVERY_SECRET),
    );

    assert.equal(await readFile(statePath, 'utf8'), before);
    assert.deepEqual(providerServer.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/models', method: 'GET', authorization: `Bearer ${DISCOVERY_SECRET}` },
    ]);
  } finally {
    await providerServer.close();
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
    assert.equal(setup.config?.providers.openai.apiKey.value, CACHED_SECRET);
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

test('remote save creates gist, returns provider API key, and rejects blank provider API keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-remote-save-'));
  const statePath = join(directory, 'state.json');
  const editedConfig = {
    schemaVersion: 1,
    defaults: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
    },
    providers: {
      anthropic: {
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: { type: 'plain', value: 'new-remote-secret' },
        models: {
          'claude-3-5-sonnet': {},
        },
      },
    },
  } as const;
  const blankSecretConfig = {
    ...editedConfig,
    providers: {
      anthropic: {
        ...editedConfig.providers.anthropic,
        apiKey: { type: 'plain', value: '' },
      },
    },
  } as const;
  const server = await startFakeGistServer([
    { status: 201, etag: 'W/"create-etag"', body: { id: 'created-gist-id', ...buildGistBody('', 'created-revision') } },
  ]);

  try {
    const created = await saveRemoteConfigRuntime(
      { statePath, githubToken: 'save-token', config: editedConfig },
      { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
    );
    assert.equal(created.state.gist.id, 'created-gist-id');
    assert.equal(created.config.providers.anthropic.apiKey.value, 'new-remote-secret');
    assert.equal(JSON.stringify(created).includes('new-remote-secret'), true);
    assert.equal(JSON.stringify(created).includes('save-token'), false);

    await assert.rejects(
      saveRemoteConfigRuntime(
        { statePath, githubToken: 'save-token', config: blankSecretConfig },
        { gistOptions: { apiBaseUrl: server.apiBaseUrl, env: {} } },
      ),
      (error: unknown) => error instanceof RuntimeApiError && /providers\.anthropic\.apiKey\.value/.test(error.message),
    );
    const storedState = await readFile(statePath, 'utf8');
    const createBody = JSON.parse(server.requests[0]?.body ?? '{}');

    assert.equal(storedState.includes('save-token'), false);
    assert.equal(createBody.public, false);
    assert.equal(createBody.description, 'agentcfg remote config');
    assert.equal(createBody.files['agentcfg.yaml'].content.includes('new-remote-secret'), true);
    assert.deepEqual(server.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/', method: 'POST', authorization: 'Bearer save-token' },
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

test('runtime Codex diff and apply payloads expose unsupported metadata notices without operations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-codex-notices-'));
  const statePath = join(directory, 'state.json');
  const fixturesRoot = join(directory, 'fixtures');
  const codexDirectory = join(fixturesRoot, 'codex');
  const nativePath = join(codexDirectory, 'input.config.toml');
  const envPath = join(codexDirectory, 'codex.env');

  try {
    await writeStateWithConfig(statePath, METADATA_CONFIG);
    await mkdir(codexDirectory, { recursive: true });
    await writeFile(nativePath, codexNativeToml());
    await writeFile(envPath, `AGENTCFG_OPENAI_API_KEY=${CACHED_SECRET}\n`);
    const beforeNative = await readFile(nativePath, 'utf8');
    const beforeEnv = await readFile(envPath, 'utf8');

    const diff = await diffRuntime({ statePath, agent: 'codex', fixturesRoot });
    assert.deepEqual(diff.results[0]?.changes, []);
    assert.deepEqual(
      diff.results[0]?.notices.map((notice) => [notice.field, notice.code]),
      [
        ['contextWindow', 'unsupported-native-mapping'],
        ['contextTokens', 'unsupported-native-mapping'],
        ['maxTokens', 'unsupported-native-mapping'],
      ],
    );

    const plan = await planApplyRuntime({ statePath, agent: 'codex', fixturesRoot });
    assert.equal(plan.results[0]?.status, 'unchanged');
    assert.equal(plan.plans[0]?.operationCount, 0);
    assert.deepEqual(plan.plans[0]?.operationPaths, []);
    assert.deepEqual(plan.plans[0]?.filePreviews, []);
    assert.deepEqual(plan.plans[0]?.notices.map((notice) => notice.field), ['contextWindow', 'contextTokens', 'maxTokens']);
    assert.deepEqual(plan.results[0]?.notices.map((notice) => notice.field), ['contextWindow', 'contextTokens', 'maxTokens']);

    const applied = await applyRuntime({ statePath, agent: 'codex', fixturesRoot, confirm: 'APPLY' });
    assert.equal(applied.results[0]?.status, 'unchanged');
    assert.deepEqual(applied.results[0]?.notices.map((notice) => notice.field), ['contextWindow', 'contextTokens', 'maxTokens']);
    assert.equal(await readFile(nativePath, 'utf8'), beforeNative);
    assert.equal(await readFile(envPath, 'utf8'), beforeEnv);
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

test('runtime config editor reports missing default native config clearly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-missing-config-'));
  const previousHome = process.env.HOME;
  process.env.HOME = directory;

  try {
    await assert.rejects(
      getConfigFileRuntime({ agent: 'opencode' }),
      (error: unknown) => {
        assert.equal(error instanceof RuntimeApiError, true);
        if (!(error instanceof RuntimeApiError)) return false;
        assert.equal(error.code, 'invalid-request');
        assert.match(error.message, /Missing opencode native config/);
        assert.doesNotMatch(error.message, /ENOENT/);
        return true;
      },
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime diff and apply planning resolve default OpenCode json candidate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-default-opencode-'));
  const previousHome = process.env.HOME;
  process.env.HOME = directory;
  const statePath = join(directory, 'state.json');

  try {
    const configDirectory = join(directory, '.config', 'opencode');
    const nativePath = join(configDirectory, 'opencode.json');
    const original = opencodeCanonicalNativeJson(CACHED_SECRET);
    await mkdir(configDirectory, { recursive: true });
    await writeFile(nativePath, original);
    await writeStateWithConfig(statePath, CANONICAL_CONFIG);

    const diff = await diffRuntime({ statePath, agent: 'opencode' });
    assert.deepEqual(diff.results[0]?.changes, []);

    const plan = await planApplyRuntime({ statePath, agent: 'opencode' });
    assert.equal(plan.plans[0]?.configPath, nativePath);
    assert.equal(plan.plans[0]?.operationCount, 0);
    assert.deepEqual(plan.plans[0]?.operationPaths, []);
    assert.equal(plan.results[0]?.status, 'unchanged');

    const loaded = await getConfigFileRuntime({ agent: 'opencode' });
    assert.equal(loaded.path, nativePath);
    assert.equal(loaded.format, 'json');
    assert.equal(loaded.content, original);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime diff and apply planning prefer OpenCode json over jsonc when both exist', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-opencode-json-first-'));
  const previousHome = process.env.HOME;
  process.env.HOME = directory;
  const statePath = join(directory, 'state.json');

  try {
    const configDirectory = join(directory, '.config', 'opencode');
    const jsonPath = join(configDirectory, 'opencode.json');
    const jsoncPath = join(configDirectory, 'opencode.jsonc');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(jsonPath, opencodeCanonicalNativeJson(CACHED_SECRET));
    await writeFile(jsoncPath, '{ "model": 42 }\n');
    await writeStateWithConfig(statePath, CANONICAL_CONFIG);

    const diff = await diffRuntime({ statePath, agent: 'opencode' });
    assert.deepEqual(diff.results[0]?.changes, []);

    const plan = await planApplyRuntime({ statePath, agent: 'opencode' });
    assert.equal(plan.plans[0]?.configPath, jsonPath);
    assert.equal(plan.plans[0]?.operationCount, 0);
    assert.deepEqual(plan.plans[0]?.operationPaths, []);
    assert.equal(plan.results[0]?.status, 'unchanged');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime config editor resolves JSON-first OpenClaw and Claude candidates and falls back to JSON5', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-json-first-native-'));
  const previousHome = process.env.HOME;
  process.env.HOME = directory;

  try {
    const openclawDirectory = join(directory, '.openclaw');
    const openclawJsonPath = join(openclawDirectory, 'openclaw.json');
    const openclawJson5Path = join(openclawDirectory, 'openclaw.json5');
    await mkdir(openclawDirectory, { recursive: true });
    await writeFile(openclawJsonPath, '{"from":"json"}\n');
    await writeFile(openclawJson5Path, '{"from":"json5"}\n');

    const openclawLoaded = await getConfigFileRuntime({ agent: 'openclaw' });
    assert.equal(openclawLoaded.path, openclawJsonPath);
    assert.equal(openclawLoaded.format, 'json');
    assert.equal(openclawLoaded.content, '{"from":"json"}\n');

    await rm(openclawJsonPath);
    const openclawFallback = await getConfigFileRuntime({ agent: 'openclaw' });
    assert.equal(openclawFallback.path, openclawJson5Path);
    assert.equal(openclawFallback.format, 'json5');
    assert.equal(openclawFallback.content, '{"from":"json5"}\n');

    const claudeDirectory = join(directory, '.claude');
    const claudeJsonPath = join(claudeDirectory, 'settings.json');
    const claudeLocalPath = join(claudeDirectory, 'settings.local.json');
    await mkdir(claudeDirectory, { recursive: true });
    await writeFile(claudeJsonPath, '{"from":"json"}\n');
    await writeFile(claudeLocalPath, '{"from":"local"}\n');

    const claudeLoaded = await getConfigFileRuntime({ agent: 'claude' });
    assert.equal(claudeLoaded.path, claudeJsonPath);
    assert.equal(claudeLoaded.format, 'json');
    assert.equal(claudeLoaded.content, '{"from":"json"}\n');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime config editor resolves default Claude Code settings candidate and availability', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-default-claude-'));
  const previousHome = process.env.HOME;
  process.env.HOME = directory;

  try {
    const configDirectory = join(directory, '.claude');
    const nativePath = join(configDirectory, 'settings.json');
    const original = claudeNativeJson(NATIVE_SECRET);
    await mkdir(configDirectory, { recursive: true });
    await writeFile(nativePath, original);

    const loaded = await getConfigFileRuntime({ agent: 'claude' });
    assert.equal(loaded.agent, 'claude');
    assert.equal(loaded.path, nativePath);
    assert.equal(loaded.format, 'json');
    assert.equal(loaded.content, original);

    const availability = await getConfigAvailabilityRuntime();
    const claude = availability.agents.find((entry) => entry.agent === 'claude');
    assert.equal(claude?.available, true);
    assert.equal(claude?.status, 'available');
    assert.equal(claude?.path, nativePath);
    assert.equal(claude?.format, 'json');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime config editor resolves explicit OpenCode candidate aliases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-opencode-alias-'));
  const nativePath = join(directory, 'opencode.json');
  const requestedAliasPath = join(directory, 'opencode.jsonc');
  const original = opencodeNativeJson(NATIVE_SECRET);

  try {
    await writeFile(nativePath, original);

    const loaded = await getConfigFileRuntime({ agent: 'opencode', configPath: requestedAliasPath });
    assert.equal(loaded.path, nativePath);
    assert.equal(loaded.format, 'json');
    assert.equal(loaded.content, original);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('runtime config editor resolves explicit OpenCode directories by configured candidate priority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-api-opencode-directory-'));
  const configDirectory = join(directory, 'opencode');
  const jsonPath = join(configDirectory, 'opencode.json');
  const jsoncPath = join(configDirectory, 'opencode.jsonc');
  const original = opencodeCanonicalNativeJson(CACHED_SECRET);

  try {
    await mkdir(configDirectory, { recursive: true });
    await writeFile(jsonPath, original);
    await writeFile(jsoncPath, '{"model":"ignored"}\n');

    const loaded = await getConfigFileRuntime({ agent: 'opencode', configPath: configDirectory });
    assert.equal(loaded.path, jsonPath);
    assert.equal(loaded.format, 'json');
    assert.equal(loaded.content, original);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

async function writeState(path: string): Promise<void> {
  await writeStateWithConfig(path, CANONICAL_CONFIG);
}

async function writeStateWithConfig(path: string, config: unknown): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cache: {
          config,
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

function opencodeCanonicalNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
      model: 'openai/gpt-4.1-mini',
      provider: {
        openai: {
          options: {
            baseURL: 'https://api.openai.com/v1',
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
      model: 'claude-3-5-sonnet',
      env: {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: 'https://old.example.test/v1',
      },
    },
    null,
    2,
  )}\n`;
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

function remoteYaml(apiKey: string): string {
  return [
    'schemaVersion: 1',
    'defaults:',
    '  provider: anthropic',
    '  model: claude-3-5-sonnet',
    'providers:',
    '  anthropic:',
    '    baseURL: https://api.anthropic.com/v1',
    '    apiKey:',
    '      type: plain',
    `      value: ${apiKey}`,
    '    models:',
    '      claude-3-5-sonnet: {}',
    '',
  ].join('\n');
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
