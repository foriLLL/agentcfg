import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWriteFile } from './atomic-write';
import { resolveStatePath } from './state';

export type AgentCfgSecrets = {
  githubToken?: string;
};

type JsonRecord = Record<string, unknown>;

export function resolveSecretsPath(statePath?: string): string {
  return join(dirname(resolveStatePath(statePath)), 'secrets.json');
}

export async function readSecrets(statePath?: string): Promise<AgentCfgSecrets> {
  const secretsPath = resolveSecretsPath(statePath);
  try {
    const parsed = JSON.parse(await readFile(secretsPath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`Invalid agentcfg secrets at ${secretsPath}: root must be an object`);
    }
    const githubToken = parsed.githubToken;
    if (githubToken !== undefined && (typeof githubToken !== 'string' || githubToken.trim() === '')) {
      throw new Error(`Invalid agentcfg secrets at ${secretsPath}: githubToken must be a non-empty string`);
    }
    return githubToken === undefined ? {} : { githubToken };
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return {};
    }
    throw error;
  }
}

export async function hasSavedGitHubToken(statePath?: string): Promise<boolean> {
  return (await readSecrets(statePath)).githubToken !== undefined;
}

export async function saveGitHubToken(token: string, statePath?: string): Promise<void> {
  const normalizedToken = token.trim();
  if (normalizedToken === '') {
    throw new Error('GitHub Token is required');
  }
  await atomicWriteFile(resolveSecretsPath(statePath), `${JSON.stringify({ githubToken: normalizedToken }, null, 2)}\n`, {
    createBackup: false,
    mode: 0o600,
  });
}

export async function clearSavedGitHubToken(statePath?: string): Promise<void> {
  await rm(resolveSecretsPath(statePath), { force: true });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
