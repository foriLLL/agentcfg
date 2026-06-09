export type MaskedAgentConfig = {
  schemaVersion: 1;
  provider: string;
  model: string;
  baseURL: string;
  apiKey?: {
    type: 'plain';
    value?: string;
  };
};

export type EditableAgentConfig = {
  schemaVersion: 1;
  provider: string;
  model: string;
  baseURL: string;
  apiKey: {
    type: 'plain';
    value: string;
  };
};

export type RemoteRevisionMetadata = {
  revision?: string;
  etag?: string;
  pulledAt: string;
};

export type RuntimeStateSummary = {
  statePath: string;
  schemaVersion: 1;
  secrets?: {
    hasGitHubToken: boolean;
  };
  gist: {
    present: boolean;
    id?: string;
  };
  remote?: RemoteRevisionMetadata;
  cache: {
    present: boolean;
    updatedAt?: string;
    config?: MaskedAgentConfig;
  };
  conflict: {
    present: boolean;
    baseRevision?: string;
    baseETag?: string;
    baseConfig?: MaskedAgentConfig;
  };
};

export type AgentName = 'codex' | 'opencode' | 'openclaw';

export type ManagedField = 'provider' | 'model' | 'baseURL' | 'apiKey';

export type ManagedDiffChange = {
  field: ManagedField;
  current?: string;
  expected?: string;
  secret: boolean;
};

export type AgentDiffResult = {
  agent: AgentName;
  changes: ManagedDiffChange[];
};

export type RuntimeTargetRequest = {
  statePath?: string;
  agent?: AgentName;
  allAgents?: boolean;
  configPath?: string;
  fixturesRoot?: string;
};

export type DiffRuntimeResponse = {
  results: AgentDiffResult[];
};

export type ApplyAgentStatus = 'would-change' | 'unchanged' | 'applied' | 'failed' | 'cancelled';

export type ApplyAgentResult = {
  agent: AgentName;
  configPath?: string;
  envPath?: string;
  status: ApplyAgentStatus;
  changes: ManagedDiffChange[];
  backups: string[];
  error?: string;
};

export type ApplyPlanSummary = {
  agent: AgentName;
  configPath: string;
  envPath?: string;
  changes: ManagedDiffChange[];
  operationCount: number;
  operationPaths: string[];
  filePreviews: ApplyFilePreview[];
};

export type ApplyFilePreview = {
  path: string;
  kind: 'native' | 'env';
  mode?: number;
  currentContent?: string;
  expectedContent: string;
};

export type PlanApplyRuntimeResponse = {
  plans: ApplyPlanSummary[];
  results: ApplyAgentResult[];
};

export type ApplyRuntimeResponse = {
  results: ApplyAgentResult[];
};

export type ConfigFileRuntimeResponse = {
  agent: AgentName;
  path: string;
  format: 'json' | 'jsonc' | 'json5' | 'toml';
  content: string;
  updatedAt?: string;
  backupPath?: string;
};

export type RuntimeErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

type JsonSuccess<T> = {
  ok: true;
  data: T;
};

type JsonFailure = {
  ok: false;
  error: RuntimeErrorBody;
};

type JsonEnvelope<T> = JsonSuccess<T> | JsonFailure;

type RuntimeStateResponse = {
  state: RuntimeStateSummary;
};

type PullRuntimeResponse = RuntimeStateResponse & {
  config: MaskedAgentConfig;
  remote?: RemoteRevisionMetadata;
};

type RemoteConfigRuntimeResponse = RuntimeStateResponse & {
  config?: MaskedAgentConfig;
  remote?: RemoteRevisionMetadata;
};

type GitHubTokenRuntimeRequest = {
  statePath?: string;
  githubToken?: string;
  rememberGitHubToken?: boolean;
};

export class RuntimeClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(error: RuntimeErrorBody, status: number) {
    super(error.message);
    this.name = 'RuntimeClientError';
    this.code = error.code;
    this.status = status;
    this.details = error.details;
  }
}

export async function getRuntimeState(statePath?: string): Promise<RuntimeStateResponse> {
  const query = statePath === undefined || statePath.trim() === '' ? '' : `?statePath=${encodeURIComponent(statePath)}`;
  return requestJson<RuntimeStateResponse>(`/api/state${query}`);
}

export async function initRuntime(request: { gistId: string; statePath?: string }): Promise<RuntimeStateResponse> {
  return requestJson<RuntimeStateResponse>('/api/init', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function pullRuntime(request: GitHubTokenRuntimeRequest): Promise<PullRuntimeResponse> {
  return requestJson<PullRuntimeResponse>('/api/pull', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function setupRemoteConfigRuntime(request: GitHubTokenRuntimeRequest): Promise<RemoteConfigRuntimeResponse> {
  return requestJson<RemoteConfigRuntimeResponse>('/api/remote/setup', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function loadRemoteConfigRuntime(request: GitHubTokenRuntimeRequest): Promise<RemoteConfigRuntimeResponse & { config: MaskedAgentConfig }> {
  return requestJson<RemoteConfigRuntimeResponse & { config: MaskedAgentConfig }>('/api/remote/load', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function saveRemoteConfigRuntime(request: GitHubTokenRuntimeRequest & { config: EditableAgentConfig }): Promise<RemoteConfigRuntimeResponse & { config: MaskedAgentConfig }> {
  return requestJson<RemoteConfigRuntimeResponse & { config: MaskedAgentConfig }>('/api/remote/save', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function clearSavedGitHubTokenRuntime(request: { statePath?: string }): Promise<RuntimeStateResponse> {
  return requestJson<RuntimeStateResponse>('/api/github-token/clear', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function diffRuntime(request: RuntimeTargetRequest): Promise<DiffRuntimeResponse> {
  return requestJson<DiffRuntimeResponse>('/api/diff', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function planApplyRuntime(request: RuntimeTargetRequest): Promise<PlanApplyRuntimeResponse> {
  return requestJson<PlanApplyRuntimeResponse>('/api/apply/plan', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function applyRuntime(request: RuntimeTargetRequest & { confirm: 'APPLY' }): Promise<ApplyRuntimeResponse> {
  return requestJson<ApplyRuntimeResponse>('/api/apply', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function getConfigFileRuntime(request: { statePath?: string; agent: AgentName; configPath?: string }): Promise<ConfigFileRuntimeResponse> {
  const params = new URLSearchParams({ agent: request.agent });
  if (request.statePath !== undefined && request.statePath.trim() !== '') {
    params.set('statePath', request.statePath);
  }
  if (request.configPath !== undefined && request.configPath.trim() !== '') {
    params.set('configPath', request.configPath);
  }
  return requestJson<ConfigFileRuntimeResponse>(`/api/config/file?${params.toString()}`);
}

export async function saveConfigFileRuntime(request: { statePath?: string; agent: AgentName; configPath?: string; content: string }): Promise<ConfigFileRuntimeResponse> {
  return requestJson<ConfigFileRuntimeResponse>('/api/config/file', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  });

  const envelope = (await response.json()) as JsonEnvelope<T>;
  if (envelope.ok) {
    return envelope.data;
  }

  throw new RuntimeClientError(envelope.error, response.status);
}

function compactRequest<T extends Record<string, unknown>>(request: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(request).filter(([, value]) => value !== undefined && (typeof value !== 'string' || value.trim() !== '')),
  ) as Partial<T>;
}
