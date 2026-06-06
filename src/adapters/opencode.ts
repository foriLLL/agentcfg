import type { CanonicalAgentConfig } from '../core/schema';
import {
  parseNativeConfig,
  serializeNativeConfig,
  type NativeConfigObject,
  type NativeConfigValue,
} from '../core/native-io';

export class OpenCodeAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenCodeAdapterError';
  }
}

export function renderOpenCodeConfigText(
  config: CanonicalAgentConfig,
  existingConfigText: string,
): string {
  return serializeNativeConfig(renderOpenCodeConfigObject(config, parseOpenCodeConfig(existingConfigText)), 'json');
}

export function renderOpenCodeConfigObject(
  config: CanonicalAgentConfig,
  existingConfig: NativeConfigObject = {},
): NativeConfigObject {
  const output = cloneNativeConfigObject(existingConfig);
  const providerPath = ['provider', config.provider];
  const optionsPath = [...providerPath, 'options'];

  failIfManaged(output.model, 'model');
  output.model = `${config.provider}/${config.model}`;

  const providerConfig = getOrCreateObject(output, providerPath);
  const options = getOrCreateObject(output, optionsPath);

  if (providerConfig.name === undefined) {
    providerConfig.name = config.provider;
  } else {
    failIfManaged(providerConfig.name, `${providerPath.join('.')}.name`);
  }

  failIfManaged(options.baseURL, `${optionsPath.join('.')}.baseURL`);
  options.baseURL = config.baseURL;

  failIfManaged(options.apiKey, `${optionsPath.join('.')}.apiKey`);
  options.apiKey = config.apiKey.value;

  return output;
}

function parseOpenCodeConfig(content: string): NativeConfigObject {
  const parsed = parseNativeConfig(content, 'jsonc');
  if (!isNativeConfigObject(parsed)) {
    throw new OpenCodeAdapterError('OpenCode config must be a JSON object at the top level');
  }
  return parsed;
}

function getOrCreateObject(object: NativeConfigObject, path: string[]): NativeConfigObject {
  let current = object;

  for (const [index, segment] of path.entries()) {
    const next = current[segment];
    const currentPath = path.slice(0, index + 1).join('.');

    failIfManaged(next, currentPath);

    if (next === undefined) {
      const created: NativeConfigObject = {};
      current[segment] = created;
      current = created;
      continue;
    }

    if (!isNativeConfigObject(next)) {
      throw new OpenCodeAdapterError(`OpenCode managed path ${currentPath} must be an object`);
    }

    current = next;
  }

  return current;
}

function failIfManaged(value: NativeConfigValue | undefined, path: string): void {
  if (value === undefined) {
    return;
  }

  if (isManagedReference(value)) {
    throw new OpenCodeAdapterError(
      `OpenCode managed path ${path} uses $include/env/file interpolation; inline this value before agentcfg can manage it`,
    );
  }
}

function isManagedReference(value: NativeConfigValue): boolean {
  if (typeof value === 'string') {
    return /\{\s*(?:env|file)\s*:/.test(value);
  }

  if (!isNativeConfigObject(value)) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(value, '$include')) {
    return true;
  }

  const keys = Object.keys(value);
  return keys.length === 1 && (keys[0] === 'env' || keys[0] === 'file');
}

function cloneNativeConfigObject(value: NativeConfigObject): NativeConfigObject {
  return cloneNativeConfigValue(value) as NativeConfigObject;
}

function cloneNativeConfigValue(value: NativeConfigValue): NativeConfigValue {
  if (Array.isArray(value)) {
    return value.map(cloneNativeConfigValue);
  }

  if (isNativeConfigObject(value)) {
    const cloned: NativeConfigObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      cloned[key] = cloneNativeConfigValue(nestedValue);
    }
    return cloned;
  }

  return value;
}

function isNativeConfigObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
