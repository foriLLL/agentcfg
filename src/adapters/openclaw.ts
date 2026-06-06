import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  parseNativeConfig,
  serializeNativeConfig,
  type CanonicalAgentConfig,
  type NativeConfigObject,
  type NativeConfigValue,
} from '../core';

export class OpenClawAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenClawAdapterError';
  }
}

export type ResolveOpenClawConfigPathOptions = {
  configPath?: string;
  env?: Pick<NodeJS.ProcessEnv, 'OPENCLAW_CONFIG_PATH'>;
};

const DEFAULT_OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const MANAGED_PROVIDER_PATH = ['models', 'providers'] as const;
const MANAGED_MODEL_PATH = ['agents', 'defaults', 'model', 'primary'] as const;

export function resolveOpenClawConfigPath(options: ResolveOpenClawConfigPathOptions = {}): string {
  return options.configPath ?? options.env?.OPENCLAW_CONFIG_PATH ?? DEFAULT_OPENCLAW_CONFIG_PATH;
}

export function renderOpenClawConfigText(config: CanonicalAgentConfig, existingText = '{}'): string {
  const parsed = parseNativeConfig(existingText, 'json5');
  const rendered = renderOpenClawConfigObject(config, assertNativeConfigObject(parsed, 'top-level OpenClaw config'));

  return serializeNativeConfig(rendered, 'json5');
}

export function renderOpenClawConfigObject(
  config: CanonicalAgentConfig,
  existingConfig: NativeConfigObject = {},
): NativeConfigObject {
  const rendered = cloneNativeConfigObject(existingConfig);
  assertManagedPathsAreDirect(rendered, config.provider);

  const agents = ensureObject(rendered, 'agents');
  const defaults = ensureObject(agents, 'defaults');
  const model = ensureObject(defaults, 'model');
  model.primary = `${config.provider}/${config.model}`;

  const models = ensureObject(rendered, 'models');
  const providers = ensureObject(models, 'providers');
  const providerConfig = ensureObject(providers, config.provider);
  providerConfig.baseUrl = config.baseURL;
  providerConfig.apiKey = config.apiKey.value;

  return rendered;
}

function assertManagedPathsAreDirect(config: NativeConfigObject, provider: string): void {
  assertNoIncludeOnPath(config, [...MANAGED_MODEL_PATH]);
  assertNoIncludeOnPath(config, [...MANAGED_PROVIDER_PATH, provider]);
  assertNoIncludeOnPath(config, [...MANAGED_PROVIDER_PATH, provider, 'baseUrl']);
  assertNoIncludeOnPath(config, [...MANAGED_PROVIDER_PATH, provider, 'apiKey']);
  assertNoUnsupportedExpressionAtPath(config, [...MANAGED_MODEL_PATH]);
  assertNoUnsupportedExpressionAtPath(config, [...MANAGED_PROVIDER_PATH, provider, 'baseUrl']);
  assertNoUnsupportedExpressionAtPath(config, [...MANAGED_PROVIDER_PATH, provider, 'apiKey']);
}

function assertNoIncludeOnPath(config: NativeConfigObject, path: string[]): void {
  let current: NativeConfigValue | undefined = config;
  const traversed: string[] = [];

  for (const segment of path) {
    if (current === undefined) {
      return;
    }

    if (!isNativeConfigObject(current)) {
      throw new OpenClawAdapterError(`OpenClaw managed path '${path.join('.')}' crosses non-object '${traversed.join('.')}'`);
    }

    if (current.$include !== undefined) {
      const location = traversed.length === 0 ? '(root)' : traversed.join('.');
      throw new OpenClawAdapterError(
        `OpenClaw managed path '${path.join('.')}' depends on unsupported $include at '${location}'`,
      );
    }

    current = current[segment];
    traversed.push(segment);
  }

  if (isNativeConfigObject(current) && current.$include !== undefined) {
    throw new OpenClawAdapterError(`OpenClaw managed path '${path.join('.')}' uses unsupported $include`);
  }
}

function assertNoUnsupportedExpressionAtPath(config: NativeConfigObject, path: string[]): void {
  const value = getValueAtPath(config, path);

  if (value === undefined) {
    return;
  }

  if (containsUnsupportedExpression(value)) {
    throw new OpenClawAdapterError(
      `OpenClaw managed path '${path.join('.')}' uses unsupported env substitution or interpolation`,
    );
  }
}

function containsUnsupportedExpression(value: NativeConfigValue): boolean {
  if (typeof value === 'string') {
    return /\$\{[^}]+\}|^\$env\b|^env:|^file:|\{\{[^}]+\}\}/i.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsUnsupportedExpression);
  }

  if (isNativeConfigObject(value)) {
    return Object.values(value).some(containsUnsupportedExpression);
  }

  return false;
}

function getValueAtPath(config: NativeConfigObject, path: string[]): NativeConfigValue | undefined {
  let current: NativeConfigValue | undefined = config;

  for (const segment of path) {
    if (!isNativeConfigObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function ensureObject(parent: NativeConfigObject, key: string): NativeConfigObject {
  const existing = parent[key];

  if (existing === undefined) {
    const created: NativeConfigObject = {};
    parent[key] = created;
    return created;
  }

  if (!isNativeConfigObject(existing)) {
    throw new OpenClawAdapterError(`OpenClaw native field '${key}' must be an object before rendering managed config`);
  }

  return existing;
}

function assertNativeConfigObject(value: NativeConfigValue, description: string): NativeConfigObject {
  if (!isNativeConfigObject(value)) {
    throw new OpenClawAdapterError(`${description} must be an object`);
  }

  return value;
}

function cloneNativeConfigObject(value: NativeConfigObject): NativeConfigObject {
  return assertNativeConfigObject(cloneNativeConfigValue(value), 'cloned OpenClaw config');
}

function cloneNativeConfigValue(value: NativeConfigValue): NativeConfigValue {
  if (Array.isArray(value)) {
    return value.map(cloneNativeConfigValue);
  }

  if (isNativeConfigObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, cloneNativeConfigValue(nestedValue)]));
  }

  return value;
}

function isNativeConfigObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
