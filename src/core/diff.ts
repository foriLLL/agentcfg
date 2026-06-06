export const MANAGED_DIFF_FIELDS = ['provider', 'model', 'baseURL', 'apiKey'] as const;

export type ManagedDiffField = (typeof MANAGED_DIFF_FIELDS)[number];

export type ManagedDiffSnapshot = Partial<Record<ManagedDiffField, string>>;

export type ManagedDiffChange = {
  field: ManagedDiffField;
  current?: string;
  expected?: string;
  secret: boolean;
};

export type AgentDiffResult = {
  agent: string;
  changes: ManagedDiffChange[];
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

export function formatAgentDiffResults(results: AgentDiffResult[]): string {
  if (results.length === 0) {
    return 'No agents selected.';
  }

  return results.map(formatAgentDiffResult).join('\n');
}

function formatAgentDiffResult(result: AgentDiffResult): string {
  if (result.changes.length === 0) {
    return [`Agent: ${result.agent}`, '  No managed diffs.'].join('\n');
  }

  return [
    `Agent: ${result.agent}`,
    ...result.changes.map((change) => {
      return `  ${change.field}: ${formatDiffValue(change.current, change.secret)} -> ${formatDiffValue(
        change.expected,
        change.secret,
      )}`;
    }),
  ].join('\n');
}

function formatDiffValue(value: string | undefined, secret: boolean): string {
  if (value === undefined) {
    return '<missing>';
  }

  return secret ? '***MASKED***' : value;
}
