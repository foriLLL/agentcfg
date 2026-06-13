import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

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

type GistRequest = {
  url: string | undefined;
  authorization: string | undefined;
};

type FakeGistServer = {
  apiBaseUrl: string;
  requests: GistRequest[];
  close(): Promise<void>;
};

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

test('init stores gist identity in the requested state path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-init-'));
  const statePath = join(directory, 'state.json');

  try {
    const output = execFileSync(process.execPath, [CLI_PATH, 'init', '--gist', 'test-gist-id', '--state', statePath], {
      encoding: 'utf8',
    });
    const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;

    assert.match(output, /Initialized agentcfg state/);
    assert.deepEqual(state.gist, { id: 'test-gist-id' });
    assert.equal(state.schemaVersion, 1);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('pull fetches agentcfg.yaml, validates it, masks output, and caches metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-pull-'));
  const statePath = join(directory, 'state.json');
  const ghPath = await writeFakeGh(directory, 'gh-token-should-not-win');
  const server = await startFakeGistServer({
    status: 200,
    etag: 'W/"test-etag"',
    body: buildGistBody(VALID_AGENTCFG_YAML, 'test-revision'),
  });

  try {
    execFileSync(process.execPath, [CLI_PATH, 'init', '--gist', 'test-gist-id', '--state', statePath]);

    const result = await runCli(['pull', '--state', statePath], {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
        GITHUB_TOKEN: 'env-token-wins',
        PATH: `${ghPath}:${process.env.PATH ?? ''}`,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Pulled agentcfg\.yaml from Gist test-gist-id/);
    assert.match(result.stdout, /\*\*\*MASKED\*\*\*/);
    assert.equal(result.stdout.includes('test-secret-value'), false);
    assert.deepEqual(server.requests, [{ url: '/test-gist-id', authorization: 'Bearer env-token-wins' }]);

    const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
    const cache = state.cache as Record<string, unknown>;
    const config = cache.config as Record<string, unknown>;
    const providers = config.providers as Record<string, Record<string, unknown>>;
    const openai = providers.openai;
    const apiKey = openai.apiKey as Record<string, unknown>;
    const remote = state.remote as Record<string, unknown>;
    const conflict = state.conflict as Record<string, unknown>;

    assert.deepEqual(config.defaults, { provider: 'openai', model: 'gpt-4.1-mini' });
    assert.deepEqual(apiKey, { type: 'plain', value: 'test-secret-value' });
    assert.equal(remote.revision, 'test-revision');
    assert.equal(remote.etag, 'W/"test-etag"');
    assert.equal(conflict.baseRevision, 'test-revision');
    assert.equal(conflict.baseETag, 'W/"test-etag"');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('pull uses GitHub CLI auth fallback when GITHUB_TOKEN is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-pull-gh-'));
  const statePath = join(directory, 'state.json');
  const ghPath = await writeFakeGh(directory, 'gh-fallback-token');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML, 'fallback-revision'),
  });

  try {
    execFileSync(process.execPath, [CLI_PATH, 'init', '--gist', 'test-gist-id', '--state', statePath]);

    const result = await runCli(
      ['pull', '--state', statePath],
      withoutGithubToken({
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
        PATH: `${ghPath}:${process.env.PATH ?? ''}`,
      }),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(server.requests[0]?.authorization, 'Bearer gh-fallback-token');
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('pull exits non-zero and preserves state when agentcfg.yaml is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-pull-missing-'));
  const statePath = join(directory, 'state.json');
  const server = await startFakeGistServer({
    status: 200,
    body: {
      files: {
        'other.yaml': { content: VALID_AGENTCFG_YAML },
      },
      history: [{ version: 'missing-revision' }],
    },
  });

  try {
    execFileSync(process.execPath, [CLI_PATH, 'init', '--gist', 'test-gist-id', '--state', statePath]);
    const before = await readFile(statePath, 'utf8');

    const result = await runCli(['pull', '--state', statePath], {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
        GITHUB_TOKEN: 'env-token',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /agentcfg\.yaml/);
    assert.equal(await readFile(statePath, 'utf8'), before);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('pull exits non-zero and preserves state when remote config is invalid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-pull-invalid-'));
  const statePath = join(directory, 'state.json');
  const server = await startFakeGistServer({
    status: 200,
    body: buildGistBody(VALID_AGENTCFG_YAML.replace('schemaVersion: 1', 'schemaVersion: 2'), 'invalid-revision'),
  });

  try {
    execFileSync(process.execPath, [CLI_PATH, 'init', '--gist', 'test-gist-id', '--state', statePath]);
    const before = await readFile(statePath, 'utf8');

    const result = await runCli(['pull', '--state', statePath], {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: server.apiBaseUrl,
        GITHUB_TOKEN: 'env-token',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /schemaVersion must be 1/);
    assert.equal(await readFile(statePath, 'utf8'), before);
  } finally {
    await server.close();
    await rm(directory, { force: true, recursive: true });
  }
});

function buildGistBody(content: string, revision: string): Record<string, unknown> {
  return {
    files: {
      'agentcfg.yaml': {
        filename: 'agentcfg.yaml',
        content,
      },
    },
    history: [{ version: revision }],
  };
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise<CliResult>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(process.execPath, [CLI_PATH, ...args], { env });
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

async function startFakeGistServer(response: {
  status: number;
  body: Record<string, unknown>;
  etag?: string;
}): Promise<FakeGistServer> {
  const requests: GistRequest[] = [];
  const server = createServer((request: IncomingMessage, serverResponse: ServerResponse) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    serverResponse.statusCode = response.status;
    serverResponse.setHeader('content-type', 'application/json');
    serverResponse.setHeader('connection', 'close');
    if (response.etag !== undefined) {
      serverResponse.setHeader('etag', response.etag);
    }
    serverResponse.end(JSON.stringify(response.body));
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, '127.0.0.1', resolvePromise);
  });

  const address = server.address();
  assert.notEqual(address, null);
  if (address === null || typeof address === 'string') {
    throw new Error('Fake Gist server did not bind to a TCP port');
  }

  return {
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error !== undefined) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
}

async function writeFakeGh(directory: string, token: string): Promise<string> {
  const binDirectory = join(directory, 'bin');
  const ghPath = join(binDirectory, 'gh');
  await mkdir(binDirectory, { recursive: true });
  await writeFile(ghPath, `#!/bin/sh\nprintf '%s\\n' '${token}'\n`, { mode: 0o755 });
  await chmod(ghPath, 0o755);
  return binDirectory;
}

function withoutGithubToken(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  delete nextEnv.GITHUB_TOKEN;
  return nextEnv;
}
