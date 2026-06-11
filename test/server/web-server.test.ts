import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startWebServer, type JsonEnvelope } from '../../src/server';
import { resolveSecretsPath } from '../../src/core';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const CACHED_SECRET = ['server', 'cached', 'secret'].join('-');
const NATIVE_SECRET = ['server', 'native', 'secret'].join('-');
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

test('web server exposes JSON runtime endpoints with visible provider API keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-server-api-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');
  const server = await startWebServer({ host: '127.0.0.1', port: 0, statePath, assetsDir: join(directory, 'missing-assets') });

  try {
    const initial = await requestJson(server.url, '/api/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.ok, true);
    assert.equal(initial.body.ok === true ? initial.body.data.state.statePath : '', statePath);
    assert.equal(initial.body.ok === true ? initial.body.data.state.gist.present : true, false);

    const init = await requestJson(server.url, '/api/init', { gistId: 'server-gist-id' });
    assert.equal(init.status, 200);
    assert.equal(init.body.ok, true);
    assert.deepEqual(init.body.ok === true ? init.body.data.state.gist : undefined, {
      present: true,
      id: 'server-gist-id',
    });

    await writeState(statePath);
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));

    const diff = await requestJson(server.url, '/api/diff', { agent: 'opencode', configPath: nativePath });
    const diffJson = JSON.stringify(diff.body);
    assert.equal(diff.status, 200);
    assert.equal(diff.body.ok, true);
    assert.equal(diffJson.includes(CACHED_SECRET), true);
    assert.equal(diffJson.includes(NATIVE_SECRET), true);
    if (diff.body.ok !== true) throw new Error('Expected diff success');
    const apiKeyDiff = diff.body.data.results[0]?.changes.find((change: { field: string }) => change.field === 'apiKey');
    assert.deepEqual(apiKeyDiff, {
      field: 'apiKey',
      current: NATIVE_SECRET,
      expected: CACHED_SECRET,
      secret: true,
    });

    const plan = await requestJson(server.url, '/api/apply/plan', { agent: 'opencode', configPath: nativePath });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.ok, true);
    if (plan.body.ok !== true) throw new Error('Expected plan success');
    assert.equal(plan.body.data.plans[0]?.filePreviews[0]?.currentContent?.includes(NATIVE_SECRET), true);
    assert.equal(plan.body.data.plans[0]?.filePreviews[0]?.expectedContent.includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(plan.body.data.results).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(plan.body.data.results).includes(NATIVE_SECRET), true);

    const rejectedApply = await requestJson(server.url, '/api/apply', {
      agent: 'opencode',
      configPath: nativePath,
      confirm: 'yes',
    });
    assert.equal(rejectedApply.status, 400);
    assert.equal(rejectedApply.body.ok, false);
    assert.equal(rejectedApply.body.ok === false ? rejectedApply.body.error.code : '', 'invalid-request');
    assert.equal((await readFile(nativePath, 'utf8')).includes(NATIVE_SECRET), true);

    const applied = await requestJson(server.url, '/api/apply', {
      agent: 'opencode',
      configPath: nativePath,
      confirm: 'APPLY',
    });
    const appliedJson = JSON.stringify(applied.body);
    assert.equal(applied.status, 200);
    assert.equal(applied.body.ok, true);
    assert.equal(appliedJson.includes(CACHED_SECRET), true);
    assert.equal(appliedJson.includes(NATIVE_SECRET), true);
    assert.equal((await readFile(nativePath, 'utf8')).includes(CACHED_SECRET), true);

    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    const config = await requestJson(server.url, `/api/config/file?agent=opencode&configPath=${encodeURIComponent(nativePath)}`);
    assert.equal(config.status, 200);
    assert.equal(config.body.ok, true);
    if (config.body.ok !== true) throw new Error('Expected config read success');
    assert.equal(config.body.data.path, nativePath);
    assert.equal(config.body.data.format, 'jsonc');
    assert.equal(config.body.data.content.includes(NATIVE_SECRET), true);

    const editedConfig = opencodeNativeJson('server-edited-secret');
    const savedConfig = await requestJson(server.url, '/api/config/file', {
      agent: 'opencode',
      configPath: nativePath,
      content: editedConfig,
    });
    assert.equal(savedConfig.status, 200);
    assert.equal(savedConfig.body.ok, true);
    if (savedConfig.body.ok !== true) throw new Error('Expected config save success');
    assert.equal(savedConfig.body.data.backupPath !== undefined, true);
    assert.equal(await readFile(nativePath, 'utf8'), editedConfig);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('web server returns structured errors for invalid JSON and missing API endpoints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-server-errors-'));
  const server = await startWebServer({ host: '127.0.0.1', port: 0, assetsDir: join(directory, 'missing-assets') });
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = directory;
    const invalidJsonResponse = await fetch(`${server.url}/api/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    const invalidJson = (await invalidJsonResponse.json()) as JsonEnvelope<unknown>;
    assert.equal(invalidJsonResponse.status, 400);
    assert.equal(invalidJson.ok, false);
    assert.equal(invalidJson.ok === false ? invalidJson.error.code : '', 'invalid-json');

    const missing = await requestJson(server.url, '/api/missing');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.ok === false ? missing.body.error.code : '', 'not-found');

    const missingConfig = await requestJson(server.url, '/api/config/file?agent=opencode');
    assert.equal(missingConfig.status, 400);
    assert.equal(missingConfig.body.ok, false);
    assert.equal(missingConfig.body.ok === false ? missingConfig.body.error.code : '', 'invalid-request');
    const missingConfigMessage = missingConfig.body.ok === false ? missingConfig.body.error.message : '';
    assert.match(missingConfigMessage, /Missing opencode native config/);
    assert.doesNotMatch(missingConfigMessage, /ENOENT/);

    const defaultConfigDirectory = join(directory, '.config', 'opencode');
    const defaultConfigPath = join(defaultConfigDirectory, 'opencode.json');
    await mkdir(defaultConfigDirectory, { recursive: true });
    await writeFile(defaultConfigPath, opencodeNativeJson(NATIVE_SECRET));

    const defaultConfig = await requestJson(server.url, '/api/config/file?agent=opencode');
    assert.equal(defaultConfig.status, 200);
    assert.equal(defaultConfig.body.ok, true);
    if (defaultConfig.body.ok !== true) throw new Error('Expected default OpenCode config read success');
    assert.equal(defaultConfig.body.data.path, defaultConfigPath);
    assert.equal(defaultConfig.body.data.format, 'json');
    assert.equal(defaultConfig.body.data.content.includes(NATIVE_SECRET), true);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('web server remote config endpoints use body token, show provider API keys, and never store token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-server-remote-'));
  const statePath = join(directory, 'state.json');
  const gistServer = await startFakeGistServer([
    {
      status: 200,
      body: [{ id: 'server-remote-gist', description: 'agentcfg remote config', files: { 'agentcfg.yaml': {} } }],
    },
    { status: 200, body: buildGistBody(remoteYaml(CACHED_SECRET), 'server-remote-revision') },
    { status: 200, body: buildGistBody(remoteYaml(CACHED_SECRET), 'server-load-revision') },
    { status: 200, body: buildGistBody(remoteYaml(CACHED_SECRET), 'server-before-save-revision') },
    { status: 200, body: { id: 'server-remote-gist', ...buildGistBody('', 'server-save-revision') } },
  ]);
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    statePath,
    assetsDir: join(directory, 'missing-assets'),
    env: { AGENTCFG_GIST_API_BASE_URL: gistServer.apiBaseUrl },
  });

  try {
    const setup = await requestJson(server.url, '/api/remote/setup', { githubToken: 'server-token' });
    assert.equal(setup.status, 200);
    assert.equal(setup.body.ok, true);
    assert.equal(JSON.stringify(setup.body).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(setup.body).includes('server-token'), false);
    if (setup.body.ok !== true) throw new Error('Expected remote setup success');
    assert.equal(setup.body.data.state.gist.id, 'server-remote-gist');
    assert.equal(setup.body.data.config.apiKey.value, CACHED_SECRET);

    const load = await requestJson(server.url, '/api/remote/load', { githubToken: 'server-token' });
    assert.equal(load.status, 200);
    assert.equal(load.body.ok, true);
    assert.equal(JSON.stringify(load.body).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(load.body).includes('server-token'), false);

    const save = await requestJson(server.url, '/api/remote/save', {
      githubToken: 'server-token',
      config: {
        schemaVersion: 1,
        provider: 'openai',
        model: 'gpt-4.1-mini-edited',
        baseURL: 'https://api.openai.com/v1',
        apiKey: { type: 'plain', value: '' },
      },
    });
    const storedState = await readFile(statePath, 'utf8');
    const patchBody = JSON.parse(gistServer.requests[4]?.body ?? '{}');

    assert.equal(save.status, 200);
    assert.equal(save.body.ok, true);
    assert.equal(JSON.stringify(save.body).includes(CACHED_SECRET), true);
    assert.equal(JSON.stringify(save.body).includes('server-token'), false);
    assert.equal(storedState.includes('server-token'), false);
    assert.equal(JSON.parse(storedState).gist.id, 'server-remote-gist');
    assert.equal(patchBody.files['agentcfg.yaml'].content.includes(CACHED_SECRET), true);
    assert.equal(patchBody.files['agentcfg.yaml'].content.includes('gpt-4.1-mini-edited'), true);
    assert.deepEqual(gistServer.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/?per_page=100', method: 'GET', authorization: 'Bearer server-token' },
      { url: '/server-remote-gist', method: 'GET', authorization: 'Bearer server-token' },
      { url: '/server-remote-gist', method: 'GET', authorization: 'Bearer server-token' },
      { url: '/server-remote-gist', method: 'GET', authorization: 'Bearer server-token' },
      { url: '/server-remote-gist', method: 'PATCH', authorization: 'Bearer server-token' },
    ]);
  } finally {
    await server.close();
    await gistServer.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('web server can remember, reuse, and clear a local GitHub token without returning it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-server-token-'));
  const statePath = join(directory, 'state.json');
  const secretsPath = resolveSecretsPath(statePath);
  const gistServer = await startFakeGistServer([
    {
      status: 200,
      body: [{ id: 'server-token-gist', description: 'agentcfg remote config', files: { 'agentcfg.yaml': {} } }],
    },
    { status: 200, body: buildGistBody(remoteYaml(CACHED_SECRET), 'server-token-setup-revision') },
    { status: 200, body: buildGistBody(remoteYaml(CACHED_SECRET), 'server-token-load-revision') },
  ]);
  const server = await startWebServer({
    host: '127.0.0.1',
    port: 0,
    statePath,
    assetsDir: join(directory, 'missing-assets'),
    env: { AGENTCFG_GIST_API_BASE_URL: gistServer.apiBaseUrl },
  });

  try {
    const setup = await requestJson(server.url, '/api/remote/setup', {
      githubToken: 'server-remember-token',
      rememberGitHubToken: true,
    });
    assert.equal(setup.status, 200);
    assert.equal(setup.body.ok, true);
    assert.equal(JSON.stringify(setup.body).includes('server-remember-token'), false);
    if (setup.body.ok !== true) throw new Error('Expected remembered setup success');
    assert.equal(setup.body.data.state.secrets.hasGitHubToken, true);
    assert.equal((await readFile(secretsPath, 'utf8')).includes('server-remember-token'), true);
    assert.equal((await readFile(statePath, 'utf8')).includes('server-remember-token'), false);

    const load = await requestJson(server.url, '/api/remote/load', {});
    assert.equal(load.status, 200);
    assert.equal(load.body.ok, true);
    assert.equal(JSON.stringify(load.body).includes('server-remember-token'), false);
    if (load.body.ok !== true) throw new Error('Expected saved-token load success');
    assert.equal(load.body.data.state.secrets.hasGitHubToken, true);

    const cleared = await requestJson(server.url, '/api/github-token/clear', {});
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.ok, true);
    if (cleared.body.ok !== true) throw new Error('Expected token clear success');
    assert.equal(cleared.body.data.state.secrets.hasGitHubToken, false);
    await assert.rejects(readFile(secretsPath, 'utf8'), (error: unknown) => isNodeErrorWithCode(error, 'ENOENT'));

    assert.deepEqual(gistServer.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
      { url: '/?per_page=100', method: 'GET', authorization: 'Bearer server-remember-token' },
      { url: '/server-token-gist', method: 'GET', authorization: 'Bearer server-remember-token' },
      { url: '/server-token-gist', method: 'GET', authorization: 'Bearer server-remember-token' },
    ]);
  } finally {
    await server.close();
    await gistServer.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('web server serves built assets with SPA fallback and blocks traversal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-server-static-'));
  const assetsDir = join(directory, 'dist');
  await mkdir(assetsDir);
  await writeFile(join(directory, 'outside.txt'), 'outside');
  await writeFile(join(assetsDir, 'index.html'), '<!doctype html><div id="root">agentcfg</div>');
  await writeFile(join(assetsDir, 'app.js'), 'window.agentcfg = true;');
  const server = await startWebServer({ host: '127.0.0.1', port: 0, assetsDir });

  try {
    const index = await fetch(`${server.url}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), '<!doctype html><div id="root">agentcfg</div>');

    const asset = await fetch(`${server.url}/app.js`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'window.agentcfg = true;');

    const fallback = await fetch(`${server.url}/settings/diff`);
    assert.equal(fallback.status, 200);
    assert.equal(await fallback.text(), '<!doctype html><div id="root">agentcfg</div>');

    const traversal = await fetch(`${server.url}/..%2foutside.txt`);
    assert.equal(traversal.status, 403);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

type JsonResponse = {
  status: number;
  body: JsonEnvelope<any>;
};

async function requestJson(baseUrl: string, path: string, body?: Record<string, unknown>): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    body: (await response.json()) as JsonEnvelope<any>,
  };
}

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
    'provider: openai',
    'model: gpt-4.1-mini',
    'baseURL: https://api.openai.com/v1',
    'apiKey:',
    '  type: plain',
    `  value: ${apiKey}`,
    '',
  ].join('\n');
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
