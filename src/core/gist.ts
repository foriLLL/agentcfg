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
  options: { headers: Record<string, string> },
) => Promise<GistHttpResponse>;

export type CommandRunner = (command: string, args: string[]) => Promise<{ stdout: string }>;

export type FetchGistOptions = {
  apiBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
  httpClient?: GistHttpClient;
  commandRunner?: CommandRunner;
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

  const token = await lookupGitHubToken(options);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agentcfg',
  };

  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await (options.httpClient ?? defaultHttpClient)(buildGistUrl(normalizedGistId, options.apiBaseUrl), {
    headers,
  });

  if (!response.ok) {
    throw new GistError(`GitHub Gist fetch failed with ${response.status} ${response.statusText}`);
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

export async function lookupGitHubToken(options: FetchGistOptions = {}): Promise<string | undefined> {
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

function buildGistUrl(gistId: string, apiBaseUrl = DEFAULT_GIST_API_BASE_URL): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(gistId)}`;
}

async function defaultHttpClient(
  url: string,
  options: { headers: Record<string, string> },
): Promise<GistHttpResponse> {
  return new Promise<GistHttpResponse>((resolvePromise, rejectPromise) => {
    const parsedUrl = new URL(url);
    const request = parsedUrl.protocol === 'http:' ? requestHttp : requestHttps;
    const clientRequest = request(
      parsedUrl,
      {
        method: 'GET',
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
