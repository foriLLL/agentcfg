import { execFile } from 'node:child_process';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { promisify } from 'node:util';

export const GIST_AGENTCFG_FILE = 'agentcfg.yaml';
export const DEFAULT_GIST_API_BASE_URL = 'https://api.github.com/gists';

export type GistRevisionMetadata = {
  revision?: string;
  etag?: string;
};

export type FetchedGistConfig = {
  content: string;
  metadata: GistRevisionMetadata;
};

export type GistHttpHeaders = {
  get(name: string): string | null;
};

export type GistHttpResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: GistHttpHeaders;
  json(): Promise<unknown>;
};

export type GistHttpClient = (
  url: string,
  options: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<GistHttpResponse>;

export type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string }>;

export type FetchGistOptions = {
  apiBaseUrl?: string;
  token?: string;
  env?: NodeJS.ProcessEnv;
  httpClient?: GistHttpClient;
  commandRunner?: CommandRunner;
};

export type GistSummary = {
  id: string;
};

type JsonRecord = Record<string, unknown>;

const execFileAsync = promisify(execFile);

export class GistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GistError';
  }
}

export async function fetchGistAgentConfig(
  gistId: string,
  options: FetchGistOptions = {},
): Promise<FetchedGistConfig> {
  const normalizedGistId = gistId.trim();
  if (normalizedGistId === '') {
    throw new GistError('Gist ID is required');
  }

  const response = await requestGistApi(buildGistUrl(normalizedGistId, options.apiBaseUrl), options);

  if (!response.ok) {
    throw new GistError(await formatGistHttpError('fetch', response));
  }

  const body = await response.json();
  return {
    content: extractAgentConfigContent(body),
    metadata: {
      revision: extractGistRevision(body),
      etag: response.headers.get('etag') ?? response.headers.get('ETag') ?? undefined,
    },
  };
}

export async function listAuthenticatedGists(options: FetchGistOptions = {}): Promise<unknown[]> {
  const response = await requestGistApi(`${buildGistCollectionUrl(options.apiBaseUrl)}?per_page=100`, options);

  if (!response.ok) {
    throw new GistError(await formatGistHttpError('list', response));
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new GistError('GitHub Gist list response was not an array');
  }

  return body;
}

export async function discoverAgentConfigGist(options: FetchGistOptions = {}): Promise<GistSummary | undefined> {
  for (const gist of await listAuthenticatedGists(options)) {
    if (isAgentConfigGist(gist)) {
      return { id: gist.id };
    }
  }
  return undefined;
}

export async function createSecretAgentConfigGist(
  content: string,
  options: FetchGistOptions = {},
): Promise<{ id: string; metadata: GistRevisionMetadata }> {
  const response = await requestGistApi(buildGistCollectionUrl(options.apiBaseUrl), options, {
    method: 'POST',
    body: JSON.stringify({
      public: false,
      description: 'agentcfg remote config',
      files: {
        [GIST_AGENTCFG_FILE]: { content },
      },
    }),
  });

  if (!response.ok) {
    throw new GistError(await formatGistHttpError('create', response));
  }

  const body = await response.json();
  return { id: extractGistId(body), metadata: extractGistMetadata(body, response) };
}

export async function updateGistAgentConfig(
  gistId: string,
  content: string,
  options: FetchGistOptions = {},
): Promise<{ id: string; metadata: GistRevisionMetadata }> {
  const normalizedGistId = gistId.trim();
  if (normalizedGistId === '') {
    throw new GistError('Gist ID is required');
  }

  const response = await requestGistApi(buildGistUrl(normalizedGistId, options.apiBaseUrl), options, {
    method: 'PATCH',
    body: JSON.stringify({
      files: {
        [GIST_AGENTCFG_FILE]: { content },
      },
    }),
  });

  if (!response.ok) {
    throw new GistError(await formatGistHttpError('update', response));
  }

  const body = await response.json();
  return { id: extractGistId(body), metadata: extractGistMetadata(body, response) };
}

export async function lookupGitHubToken(options: FetchGistOptions = {}): Promise<string | undefined> {
  if (options.token !== undefined && options.token.trim() !== '') {
    return options.token.trim();
  }

  const tokenFromEnvironment = options.env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (tokenFromEnvironment !== undefined && tokenFromEnvironment.trim() !== '') {
    return tokenFromEnvironment.trim();
  }

  try {
    const result = await (options.commandRunner ?? defaultCommandRunner)('gh', ['auth', 'token']);
    const token = result.stdout.trim();
    return token === '' ? undefined : token;
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    return undefined;
  }
}

async function requestGistApi(
  url: string,
  options: FetchGistOptions,
  requestOptions: { method?: string; body?: string } = {},
): Promise<GistHttpResponse> {
  const token = await lookupGitHubToken(options);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agentcfg',
  };

  if (requestOptions.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    return await (options.httpClient ?? defaultHttpClient)(url, {
      method: requestOptions.method,
      headers,
      body: requestOptions.body,
    });
  } catch (error) {
    if (error instanceof GistError) {
      throw error;
    }
    throw new GistError(`GitHub Gist network request failed before receiving a response: ${formatTransportError(error)}`);
  }
}

function buildGistUrl(gistId: string, apiBaseUrl = DEFAULT_GIST_API_BASE_URL): string {
  return `${buildGistCollectionUrl(apiBaseUrl)}/${encodeURIComponent(gistId)}`;
}

function buildGistCollectionUrl(apiBaseUrl = DEFAULT_GIST_API_BASE_URL): string {
  return apiBaseUrl.replace(/\/+$/, '');
}

async function defaultHttpClient(
  url: string,
  options: { method?: string; headers: Record<string, string>; body?: string },
): Promise<GistHttpResponse> {
  return new Promise<GistHttpResponse>((resolvePromise, rejectPromise) => {
    const parsedUrl = new URL(url);
    const request = parsedUrl.protocol === 'http:' ? requestHttp : requestHttps;
    const clientRequest = request(
      parsedUrl,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolvePromise({
            ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            headers: {
              get(name: string): string | null {
                const value = response.headers[name.toLowerCase()];
                if (Array.isArray(value)) {
                  return value.join(', ');
                }
                return value ?? null;
              },
            },
            async json(): Promise<unknown> {
              return JSON.parse(body);
            },
          });
        });
      },
    );

    clientRequest.on('error', rejectPromise);
    if (options.body !== undefined) {
      clientRequest.write(options.body);
    }
    clientRequest.end();
  });
}

async function defaultCommandRunner(command: string, args: string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync(command, args, { encoding: 'utf8' });
  return { stdout: result.stdout };
}

function extractAgentConfigContent(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.files)) {
    throw new GistError('GitHub Gist response did not include files');
  }

  const fileNames = Object.keys(body.files);
  if (fileNames.length !== 1 || fileNames[0] !== GIST_AGENTCFG_FILE) {
    throw new GistError(`Gist must contain exactly one file named ${GIST_AGENTCFG_FILE}`);
  }

  const file = body.files[GIST_AGENTCFG_FILE];
  if (!isRecord(file) || typeof file.content !== 'string') {
    throw new GistError(`${GIST_AGENTCFG_FILE} content is missing from the Gist response`);
  }

  if (file.truncated === true) {
    throw new GistError(`${GIST_AGENTCFG_FILE} content is truncated in the Gist response`);
  }

  return file.content;
}

function extractGistRevision(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  if (typeof body.version === 'string' && body.version.trim() !== '') {
    return body.version;
  }

  if (!Array.isArray(body.history)) {
    return undefined;
  }

  const [latestHistoryEntry] = body.history;
  if (!isRecord(latestHistoryEntry) || typeof latestHistoryEntry.version !== 'string') {
    return undefined;
  }

  return latestHistoryEntry.version.trim() === '' ? undefined : latestHistoryEntry.version;
}

function extractGistMetadata(body: unknown, response: GistHttpResponse): GistRevisionMetadata {
  return {
    revision: extractGistRevision(body),
    etag: response.headers.get('etag') ?? response.headers.get('ETag') ?? undefined,
  };
}

function extractGistId(body: unknown): string {
  if (!isRecord(body) || typeof body.id !== 'string' || body.id.trim() === '') {
    throw new GistError('GitHub Gist response did not include an id');
  }
  return body.id;
}

function isAgentConfigGist(value: unknown): value is JsonRecord & { id: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === '') {
    return false;
  }

  if (isRecord(value.files) && isRecord(value.files[GIST_AGENTCFG_FILE])) {
    return true;
  }

  return typeof value.description === 'string' && value.description.toLowerCase().includes('agentcfg');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatTransportError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'unknown network error';
}

async function formatGistHttpError(action: 'create' | 'fetch' | 'list' | 'update', response: GistHttpResponse): Promise<string> {
  const status = `GitHub Gist ${action} failed with ${response.status} ${response.statusText}`;
  const details = formatGistErrorDetails(await readGistErrorBody(response));
  const hint = action === 'create' && response.status === 403
    ? 'Verify the GitHub token can create Gists; classic personal access tokens need the gist scope.'
    : undefined;
  return [status, details, hint].filter((part): part is string => part !== undefined && part.trim() !== '').join(': ');
}

async function readGistErrorBody(response: GistHttpResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function formatGistErrorDetails(body: unknown): string | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const details: string[] = [];
  if (typeof body.message === 'string' && body.message.trim() !== '') {
    details.push(body.message.trim());
  }
  const validationErrors = formatGistValidationErrors(body.errors);
  if (validationErrors !== undefined) {
    details.push(validationErrors);
  }
  if (typeof body.documentation_url === 'string' && body.documentation_url.trim() !== '') {
    details.push(`Docs: ${body.documentation_url.trim()}`);
  }
  return details.length === 0 ? undefined : details.join(' ');
}

function formatGistValidationErrors(errors: unknown): string | undefined {
  if (!Array.isArray(errors)) {
    return undefined;
  }
  const messages = errors
    .map((error) => {
      if (!isRecord(error)) {
        return undefined;
      }
      if (typeof error.message === 'string' && error.message.trim() !== '') {
        return error.message.trim();
      }
      const field = typeof error.field === 'string' ? error.field : undefined;
      const code = typeof error.code === 'string' ? error.code : undefined;
      return [field, code].filter((part): part is string => part !== undefined && part.trim() !== '').join(' ');
    })
    .filter((message): message is string => message !== undefined && message.trim() !== '');
  return messages.length === 0 ? undefined : `Errors: ${messages.join('; ')}`;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
