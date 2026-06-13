import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  NativeConfigParseError,
  NativeConfigSerializeError,
  getSelectedProviderConfig,
  parseNativeConfig,
  serializeNativeConfig,
  type CanonicalAgentConfig,
  type NativeConfigObject,
  type NativeConfigValue,
} from '../core';

export type CodexEnvFilePayload = {
  path: string;
  content: string;
  mode: 0o600;
  envKey: string;
};

export type RenderCodexConfigResult = {
  toml: string;
  envFile?: CodexEnvFilePayload;
};

export class CodexAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexAdapterError';
  }
}

export const DEFAULT_CODEX_ENV_PATH = join(homedir(), '.agentcfg', 'env', 'codex.env');

export function resolveCodexEnvPath(envPath?: string): string {
  return envPath ?? DEFAULT_CODEX_ENV_PATH;
}

export function renderCodexConfig(
  config: CanonicalAgentConfig,
  existingConfig: string | NativeConfigObject = {},
): RenderCodexConfigResult {
  const selected = getSelectedProviderConfig(config);
  const nativeConfig = cloneNativeConfigObject(parseExistingCodexToml(existingConfig));
  const providerConfig = ensureProviderConfig(nativeConfig, selected.providerId);
  const envKey = codexEnvKeyForProvider(selected.providerId);

  nativeConfig.model = selected.modelId;
  nativeConfig.model_provider = selected.providerId;
  providerConfig.name ??= selected.providerId;
  providerConfig.base_url = selected.provider.baseURL;
  providerConfig.env_key = envKey;

  return {
    toml: serializeNativeConfig(nativeConfig, 'toml'),
    envFile: {
      path: resolveCodexEnvPath(),
      content: `${envKey}=${selected.provider.apiKey.value}\n`,
      mode: 0o600,
      envKey,
    },
  };
}

export function codexEnvKeyForProvider(provider: string): string {
  const normalizedProvider = provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  if (normalizedProvider === '') {
    throw new CodexAdapterError('Codex provider must produce a non-empty environment variable segment');
  }

  return `AGENTCFG_${normalizedProvider}_API_KEY`;
}

function parseExistingCodexToml(existingConfig: string | NativeConfigObject): NativeConfigObject {
  if (typeof existingConfig !== 'string') {
    return existingConfig;
  }

  const parsed = parseNativeConfig(existingConfig, 'toml');
  if (!isNativeConfigObject(parsed)) {
    throw new NativeConfigParseError('toml', 'Codex config must be a top-level TOML table');
  }

  return parsed;
}

function ensureProviderConfig(root: NativeConfigObject, provider: string): NativeConfigObject {
  const providers = ensureObject(root, 'model_providers', 'model_providers');
  return ensureObject(providers, provider, `model_providers.${provider}`);
}

function ensureObject(parent: NativeConfigObject, key: string, path: string): NativeConfigObject {
  const existing = parent[key];
  if (existing === undefined) {
    const next: NativeConfigObject = {};
    parent[key] = next;
    return next;
  }

  if (!isNativeConfigObject(existing)) {
    throw new NativeConfigSerializeError('toml', `Codex key '${path}' must be a table`);
  }

  return existing;
}

function cloneNativeConfigObject(value: NativeConfigObject): NativeConfigObject {
  return cloneNativeConfigValue(value) as NativeConfigObject;
}

function cloneNativeConfigValue(value: NativeConfigValue): NativeConfigValue {
  if (Array.isArray(value)) {
    return value.map(cloneNativeConfigValue);
  }

  if (isNativeConfigObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, cloneNativeConfigValue(nested)]));
  }

  return value;
}

function isNativeConfigObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
