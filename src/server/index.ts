import { createReadStream, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
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
  saveRemoteConfigRuntime,
  saveConfigFileRuntime,
  setupRemoteConfigRuntime,
  type ApplyRuntimeResponse,
  type ClearSavedGitHubTokenRuntimeResponse,
  type ConfigFileRuntimeResponse,
  type DiffRuntimeResponse,
  type GetRuntimeStateResponse,
  type InitRuntimeResponse,
  type LoadRemoteConfigRuntimeResponse,
  type PlanApplyRuntimeResponse,
  type PullRuntimeResponse,
  type RuntimeApiErrorDetails,
  type RuntimeRequest,
  type SaveConfigFileRuntimeResponse,
  type SaveRemoteConfigRuntimeResponse,
  type SetupRemoteConfigRuntimeResponse,
} from '../api';
import { isNodeErrorWithCode, readLastUsedStatePath, rememberLastUsedStatePath, resolveStatePath } from '../core';

export type JsonSuccess<T> = {
  ok: true;
  data: T;
};

export type JsonFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: RuntimeApiErrorDetails;
  };
};

export type JsonEnvelope<T> = JsonSuccess<T> | JsonFailure;

export type AgentCfgWebServerOptions = {
  host?: string;
  port?: number;
  statePath?: string;
  assetsDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type AgentCfgWebServer = {
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
};

type JsonRecord = Record<string, unknown>;

type ApiHandlerResult =
  | GetRuntimeStateResponse
  | InitRuntimeResponse
  | PullRuntimeResponse
  | SetupRemoteConfigRuntimeResponse
  | LoadRemoteConfigRuntimeResponse
  | SaveRemoteConfigRuntimeResponse
  | ClearSavedGitHubTokenRuntimeResponse
  | DiffRuntimeResponse
  | PlanApplyRuntimeResponse
  | ApplyRuntimeResponse
  | ConfigFileRuntimeResponse
  | SaveConfigFileRuntimeResponse;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const MAX_JSON_BYTES = 1024 * 1024;
const LAST_STATE_PATH_FILE_ENV = 'AGENTCFG_LAST_STATE_PATH_FILE';

export async function startWebServer(options: AgentCfgWebServerOptions = {}): Promise<AgentCfgWebServer> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const assetsDir = resolve(options.assetsDir ?? resolve(__dirname, '..', '..', '..', 'web', 'dist'));
  const env = options.env ?? process.env;

  const server = createServer((request, response) => {
    void handleRequest(request, response, { assetsDir, env, statePath: options.statePath }).catch((error: unknown) => {
      sendJson(response, 500, {
        ok: false,
        error: {
          code: 'internal-error',
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      });
    });
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      rejectPromise(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolvePromise();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('agentcfg web server did not bind to a TCP port');
  }

  const boundHost = hostForUrl(host);
  return {
    server,
    host,
    port: address.port,
    url: `http://${boundHost}:${address.port}`,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<Pick<AgentCfgWebServerOptions, 'assetsDir' | 'env'>> & Pick<AgentCfgWebServerOptions, 'statePath'>,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);

  if (requestUrl.pathname.startsWith('/api/')) {
    await handleApiRequest(request, response, requestUrl, options);
    return;
  }

  await handleStaticRequest(request, response, requestUrl, options.assetsDir);
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  options: Required<Pick<AgentCfgWebServerOptions, 'env'>> & Pick<AgentCfgWebServerOptions, 'statePath'>,
): Promise<void> {
  try {
    const data = await dispatchApiRequest(request, requestUrl, options);
    await rememberRuntimeStatePath(data, options);
    sendJson(response, 200, { ok: true, data });
  } catch (error) {
    if (error instanceof InvalidJsonError) {
      sendJson(response, 400, { ok: false, error: { code: 'invalid-json', message: error.message } });
      return;
    }
    if (error instanceof MethodNotAllowedError) {
      response.setHeader('allow', error.allowedMethods.join(', '));
      sendJson(response, 405, { ok: false, error: { code: 'method-not-allowed', message: error.message } });
      return;
    }
    if (error instanceof NotFoundError) {
      sendJson(response, 404, { ok: false, error: { code: 'not-found', message: error.message } });
      return;
    }
    if (error instanceof RuntimeApiError) {
      sendJson(response, statusForRuntimeError(error), {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    sendJson(response, 500, {
      ok: false,
      error: {
        code: 'internal-error',
        message: error instanceof Error ? error.message : 'Internal server error',
      },
    });
  }
}

async function dispatchApiRequest(
  request: IncomingMessage,
  requestUrl: URL,
  options: Required<Pick<AgentCfgWebServerOptions, 'env'>> & Pick<AgentCfgWebServerOptions, 'statePath'>,
): Promise<ApiHandlerResult> {
  if (requestUrl.pathname === '/api/state') {
    assertMethod(request, ['GET']);
    const statePath = requestUrl.searchParams.has('statePath') ? (requestUrl.searchParams.get('statePath') ?? '') : undefined;
    return getRuntimeState({ statePath: await resolveDefaultStatePath(statePath, options) });
  }

  if (requestUrl.pathname === '/api/init') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return initRuntime(await withDefaultStatePath(body, options) as { gistId: string; statePath?: string });
  }

  if (requestUrl.pathname === '/api/pull') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return pullRuntime(await withDefaultStatePath(body, options), {
      gistOptions: {
        apiBaseUrl: options.env.AGENTCFG_GIST_API_BASE_URL,
        env: options.env,
      },
    });
  }

  if (requestUrl.pathname === '/api/remote/setup') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return setupRemoteConfigRuntime(await withDefaultStatePath(body, options), {
      gistOptions: {
        apiBaseUrl: options.env.AGENTCFG_GIST_API_BASE_URL,
        env: options.env,
      },
    });
  }

  if (requestUrl.pathname === '/api/remote/load') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return loadRemoteConfigRuntime(await withDefaultStatePath(body, options), {
      gistOptions: {
        apiBaseUrl: options.env.AGENTCFG_GIST_API_BASE_URL,
        env: options.env,
      },
    });
  }

  if (requestUrl.pathname === '/api/remote/save') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return saveRemoteConfigRuntime(await withDefaultStatePath(body, options), {
      gistOptions: {
        apiBaseUrl: options.env.AGENTCFG_GIST_API_BASE_URL,
        env: options.env,
      },
    });
  }

  if (requestUrl.pathname === '/api/github-token/clear') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return clearSavedGitHubTokenRuntime(await withDefaultStatePath(body, options));
  }

  if (requestUrl.pathname === '/api/diff') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return diffRuntime(await withDefaultStatePath(body, options));
  }

  if (requestUrl.pathname === '/api/apply/plan') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return planApplyRuntime(await withDefaultStatePath(body, options));
  }

  if (requestUrl.pathname === '/api/apply') {
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return applyRuntime(await withDefaultStatePath(body, options));
  }

  if (requestUrl.pathname === '/api/config/file') {
    if (request.method === 'GET') {
      return getConfigFileRuntime({
        statePath: await resolveDefaultStatePath(
          requestUrl.searchParams.has('statePath') ? (requestUrl.searchParams.get('statePath') ?? '') : undefined,
          options,
        ),
        agent: stringOrUndefined(requestUrl.searchParams.get('agent')),
        configPath: stringOrUndefined(requestUrl.searchParams.get('configPath')),
      });
    }
    assertMethod(request, ['POST']);
    const body = await readJsonObject(request);
    return saveConfigFileRuntime(await withDefaultStatePath(body, options));
  }

  throw new NotFoundError(`No API endpoint found for ${requestUrl.pathname}`);
}

function stringOrUndefined(value: string | null): string | undefined {
  return value === null || value.trim() === '' ? undefined : value;
}

async function withDefaultStatePath<T extends JsonRecord>(
  body: T,
  options: Required<Pick<AgentCfgWebServerOptions, 'env'>> & Pick<AgentCfgWebServerOptions, 'statePath'>,
): Promise<T & RuntimeRequest> {
  if (typeof body.statePath === 'string') {
    return body as T & RuntimeRequest;
  }
  if (body.statePath !== undefined) {
    throw new RuntimeApiError('invalid-request', 'statePath must be a string when provided.');
  }

  const statePath = await resolveDefaultStatePath(undefined, options);
  return statePath === undefined ? (body as T & RuntimeRequest) : ({ ...body, statePath } as T & RuntimeRequest);
}

async function resolveDefaultStatePath(
  requestStatePath: string | undefined,
  options: Required<Pick<AgentCfgWebServerOptions, 'env'>> & Pick<AgentCfgWebServerOptions, 'statePath'>,
): Promise<string | undefined> {
  if (requestStatePath !== undefined) {
    return requestStatePath;
  }
  if (options.statePath !== undefined) {
    return options.statePath;
  }
  return readLastUsedStatePath(options.env[LAST_STATE_PATH_FILE_ENV]);
}

async function rememberRuntimeStatePath(
  data: ApiHandlerResult,
  options: Required<Pick<AgentCfgWebServerOptions, 'env'>> & Pick<AgentCfgWebServerOptions, 'statePath'>,
): Promise<void> {
  if (!('state' in data) || data.state.statePath === resolveStatePath()) {
    return;
  }
  if (options.statePath !== undefined && data.state.statePath === resolveStatePath(options.statePath)) {
    return;
  }

  await rememberLastUsedStatePath(data.state.statePath, options.env[LAST_STATE_PATH_FILE_ENV]);
}

async function readJsonObject(request: IncomingMessage): Promise<JsonRecord> {
  const body = await readRequestBody(request);
  if (body.trim() === '') {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new InvalidJsonError(`Invalid JSON body: ${error instanceof Error ? error.message : 'parse failed'}`);
  }

  if (!isRecord(parsed)) {
    throw new RuntimeApiError('invalid-request', 'JSON body must be an object.');
  }

  return parsed;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BYTES) {
        rejectPromise(new InvalidJsonError('JSON body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolvePromise(body));
    request.on('error', rejectPromise);
  });
}

function assertMethod(request: IncomingMessage, allowedMethods: string[]): void {
  if (request.method === undefined || !allowedMethods.includes(request.method)) {
    throw new MethodNotAllowedError(allowedMethods);
  }
}

async function handleStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  assetsDir: string,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD');
    sendText(response, 405, 'Method not allowed');
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendText(response, 400, 'Invalid URL path');
    return;
  }

  const assetPath = pathname === '/' ? '/index.html' : pathname;
  const candidatePath = resolve(assetsDir, `.${assetPath}`);
  if (!isPathInside(candidatePath, assetsDir)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  const candidate = await statFile(candidatePath);
  if (candidate !== undefined) {
    streamStaticFile(request, response, candidatePath, candidate);
    return;
  }

  const indexPath = resolve(assetsDir, 'index.html');
  const index = await statFile(indexPath);
  if (index !== undefined) {
    streamStaticFile(request, response, indexPath, index);
    return;
  }

  sendText(response, 404, 'Web assets not found. Run npm run build:web first.');
}

async function statFile(path: string): Promise<Stats | undefined> {
  try {
    const fileStat = await stat(path);
    return fileStat.isFile() ? fileStat : undefined;
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT') || isNodeErrorWithCode(error, 'ENOTDIR')) {
      return undefined;
    }
    throw error;
  }
}

function streamStaticFile(request: IncomingMessage, response: ServerResponse, path: string, fileStat: Stats): void {
  response.statusCode = 200;
  response.setHeader('content-type', contentTypeFor(path));
  response.setHeader('content-length', fileStat.size);
  response.setHeader('cache-control', path.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable');

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(path);
  stream.on('error', () => {
    if (!response.headersSent) {
      sendText(response, 500, 'Failed to read web asset');
      return;
    }
    response.destroy();
  });
  stream.pipe(response);
}

function sendJson<T>(response: ServerResponse, statusCode: number, envelope: JsonEnvelope<T>): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(`${JSON.stringify(envelope)}\n`);
}

function sendText(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(`${message}\n`);
}

function statusForRuntimeError(error: RuntimeApiError): number {
  if (error.code === 'gist-error') {
    return 502;
  }
  return 400;
}

function contentTypeFor(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function isPathInside(path: string, directory: string): boolean {
  const resolvedDirectory = resolve(directory);
  const resolvedPath = resolve(path);
  return resolvedPath === resolvedDirectory || resolvedPath.startsWith(`${resolvedDirectory}${sep}`);
}

function hostForUrl(host: string): string {
  if (host === '0.0.0.0') {
    return '127.0.0.1';
  }
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class InvalidJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJsonError';
  }
}

class MethodNotAllowedError extends Error {
  readonly allowedMethods: string[];

  constructor(allowedMethods: string[]) {
    super(`Method not allowed. Use ${allowedMethods.join(' or ')}.`);
    this.name = 'MethodNotAllowedError';
    this.allowedMethods = allowedMethods;
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
