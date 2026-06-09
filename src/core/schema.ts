import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type PlainApiKey = {
  type: 'plain';
  value: string;
};

export type CanonicalAgentConfig = {
  schemaVersion: 1;
  provider: string;
  model: string;
  baseURL: string;
  apiKey: PlainApiKey;
};

export type AgentConfigInput = {
  schemaVersion?: unknown;
  provider?: unknown;
  model?: unknown;
  baseURL?: unknown;
  apiKey?: unknown;
};

export class AgentConfigValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid agentcfg.yaml: ${issues.join('; ')}`);
    this.name = 'AgentConfigValidationError';
    this.issues = issues;
  }
}

const REQUIRED_STRING_FIELDS = ['provider', 'model', 'baseURL'] as const;

export function parseAgentConfigYaml(yaml: string): AgentConfigInput {
  try {
    const parsed = parseYaml(yaml) as unknown;

    if (parsed === null) {
      return {};
    }

    if (!isRecord(parsed)) {
      throw new AgentConfigValidationError(['top-level YAML document must be a mapping']);
    }

    return parsed;
  } catch (error) {
    if (error instanceof AgentConfigValidationError) {
      throw error;
    }

    throw new AgentConfigValidationError([`YAML parser failed: ${formatParserError(error)}`]);
  }
}

export function parseCanonicalAgentConfig(yaml: string): CanonicalAgentConfig {
  return validateAgentConfig(parseAgentConfigYaml(yaml));
}

export function serializeCanonicalAgentConfig(config: AgentConfigInput): string {
  const canonicalConfig = validateAgentConfig(config);
  return stringifyYaml({
    schemaVersion: canonicalConfig.schemaVersion,
    provider: canonicalConfig.provider,
    model: canonicalConfig.model,
    baseURL: canonicalConfig.baseURL,
    apiKey: {
      type: canonicalConfig.apiKey.type,
      value: canonicalConfig.apiKey.value,
    },
  });
}

export function validateAgentConfig(input: AgentConfigInput): CanonicalAgentConfig {
  const issues: string[] = [];
  const schemaVersion = normalizeSchemaVersion(input.schemaVersion);

  if (schemaVersion !== 1) {
    const received = input.schemaVersion === undefined ? 'missing' : String(input.schemaVersion);
    issues.push(`schemaVersion must be 1 before parsing native configs (received ${received})`);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (!isNonEmptyString(input[field])) {
      issues.push(`${field} is required and must be a non-empty string`);
    }
  }

  const apiKey = normalizeApiKey(input.apiKey);
  if (apiKey === undefined) {
    issues.push('apiKey is required and must be a non-empty string or { type: "plain", value: string }');
  }

  if (issues.length > 0) {
    throw new AgentConfigValidationError(issues);
  }

  return {
    schemaVersion: 1,
    provider: input.provider as string,
    model: input.model as string,
    baseURL: input.baseURL as string,
    apiKey: apiKey as PlainApiKey,
  };
}

function normalizeSchemaVersion(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
}

function normalizeApiKey(value: unknown): PlainApiKey | undefined {
  if (isNonEmptyString(value)) {
    return { type: 'plain', value };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type !== 'plain' || !isNonEmptyString(value.value)) {
    return undefined;
  }

  return { type: 'plain', value: value.value };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatParserError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.split('\n')[0];
  }

  return 'unknown parser error';
}
