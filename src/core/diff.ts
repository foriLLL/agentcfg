export const MANAGED_DIFF_FIELDS = [
  'provider',
  'model',
  'baseURL',
  'apiKey',
  'contextWindow',
  'contextTokens',
  'maxTokens',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
] as const;

export type OhMyOpenAgentManagedDiffField = `ohMyOpenAgent.${'agents' | 'categories'}.${string}.${'model' | 'variant'}`;

export type ManagedDiffField = (typeof MANAGED_DIFF_FIELDS)[number] | OhMyOpenAgentManagedDiffField;

export type ManagedDiffSnapshot = Partial<Record<(typeof MANAGED_DIFF_FIELDS)[number], string>>;

export type ManagedDiffChange = {
  field: ManagedDiffField;
  current?: string;
  expected?: string;
  secret: boolean;
};

export type ManagedDiffNotice = {
  field: ManagedDiffField;
  code: 'unsupported-native-mapping';
  message: string;
};

export type AgentDiffResult = {
  agent: string;
  changes: ManagedDiffChange[];
  notices: ManagedDiffNotice[];
};

export class DiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiffError';
  }
}

export function diffManagedSnapshots(current: ManagedDiffSnapshot, expected: ManagedDiffSnapshot): ManagedDiffChange[] {
  const changes: ManagedDiffChange[] = [];

  for (const field of MANAGED_DIFF_FIELDS) {
    if (current[field] === expected[field]) {
      continue;
    }

    changes.push({
      field,
      current: current[field],
      expected: expected[field],
      secret: field === 'apiKey',
    });
  }

  return changes;
}

export function unsupportedCodexManagedFieldNotices(model: {
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
}): ManagedDiffNotice[] {
  const notices: ManagedDiffNotice[] = [];

  for (const field of ['contextWindow', 'contextTokens', 'maxTokens'] as const) {
    if (model[field] === undefined) {
      continue;
    }

    notices.push({
      field,
      code: 'unsupported-native-mapping',
      message: `Codex has no official native mapping for ${field}; agentcfg will not write this canonical model field.`,
    });
  }

  return notices;
}

export function formatAgentDiffResults(results: AgentDiffResult[]): string {
  if (results.length === 0) {
    return 'No agents selected.';
  }

  return results.map(formatAgentDiffResult).join('\n');
}

function formatAgentDiffResult(result: AgentDiffResult): string {
  const lines = [`Agent: ${result.agent}`];

  if (result.changes.length === 0) {
    lines.push('  No managed diffs.');
  } else {
    lines.push(
      ...result.changes.map((change) => {
        return `  ${change.field}: ${formatDiffValue(change.current, change.secret)} -> ${formatDiffValue(
          change.expected,
          change.secret,
        )}`;
      }),
    );
  }

  lines.push(...result.notices.map((notice) => `  Notice: ${notice.message}`));

  return lines.join('\n');
}

function formatDiffValue(value: string | undefined, secret: boolean): string {
  if (value === undefined) {
    return '<missing>';
  }

  return secret ? '***MASKED***' : value;
}
