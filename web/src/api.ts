export type AgentConfig = {
  schemaVersion: 1;
  defaults: AgentConfigDefaults;
  providers: Record<string, ProviderConfig>;
  ohMyOpenAgent?: OhMyOpenAgentConfig;
};

export type EditableAgentConfig = {
  schemaVersion: 1;
  defaults: AgentConfigDefaults;
  providers: Record<string, ProviderConfig>;
  ohMyOpenAgent?: OhMyOpenAgentConfig;
};

export type AgentConfigDefaults = {
  provider: string;
  model: string;
};

export type ProviderConfig = {
  baseURL: string;
  apiKey: {
    type: 'plain';
    value: string;
  };
  modelDiscovery?: {
    path: string;
  };
  models: Record<string, ModelConfig>;
};

export type ModelConfig = {
  variant?: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
};

export type OhMyOpenAgentModelVariant = 'max' | 'high' | 'medium' | 'low' | 'xhigh';

export type OhMyOpenAgentModelAssignment = {
  model: string;
  variant?: OhMyOpenAgentModelVariant;
};

export type OhMyOpenAgentConfig = {
  agents?: Record<string, OhMyOpenAgentModelAssignment>;
  categories?: Record<string, OhMyOpenAgentModelAssignment>;
};

export type RemoteRevisionMetadata = {
  revision?: string;
  etag?: string;
  pulledAt: string;
};

export type AutoSyncConfig = {
  enabled: boolean;
  intervalMinutes: number;
  targets: string[];
};

export type LastSyncRunSummary = {
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  message?: string;
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
    config?: AgentConfig;
  };
  conflict: {
    present: boolean;
    baseRevision?: string;
    baseETag?: string;
    baseConfig?: AgentConfig;
  };
  autoSync?: AutoSyncConfig;
  lastSyncRun?: LastSyncRunSummary;
};

export type AgentName = 'codex' | 'opencode' | 'openclaw' | 'claude' | 'ohmyopenagent';

export type ManagedField =
  | 'provider'
  | 'model'
  | 'baseURL'
  | 'apiKey'
  | 'contextWindow'
  | 'contextTokens'
  | 'maxTokens'
  | `ohMyOpenAgent.${'agents' | 'categories'}.${string}.${'model' | 'variant'}`;

export type ManagedDiffChange = {
  field: ManagedField;
  current?: string;
  expected?: string;
  secret: boolean;
};

export type ManagedDiffNotice = {
  field: ManagedField;
  code: 'unsupported-native-mapping';
  message: string;
};

export type AgentDiffResult = {
  agent: AgentName;
  changes: ManagedDiffChange[];
  notices: ManagedDiffNotice[];
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
  notices: ManagedDiffNotice[];
  backups: string[];
  error?: string;
};

export type ApplyPlanSummary = {
  agent: AgentName;
  configPath: string;
  envPath?: string;
  changes: ManagedDiffChange[];
  notices: ManagedDiffNotice[];
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

export type ConfigAvailabilityEntry = {
  agent: AgentName;
  available: boolean;
  status: 'available' | 'missing' | 'ambiguous';
  path?: string;
  format?: 'json' | 'jsonc' | 'json5' | 'toml';
  updatedAt?: string;
  reason?: string;
};

export type ConfigAvailabilityRuntimeResponse = {
  agents: ConfigAvailabilityEntry[];
};

export type ManagedRuleFileStatus = {
  id: string;
  label: string;
  agent: string;
  gistFileName: string;
  localPath: string;
  local: {
    exists: boolean;
    updatedAt?: string;
    size?: number;
  };
};

export type ManagedRuleFileRemote = Omit<ManagedRuleFileStatus, 'local'> & {
  remote:
    | {
        status: 'available';
        content: string;
      }
    | {
        status: 'missing';
      };
};

export type ManagedRuleFilePlan = Omit<ManagedRuleFileStatus, 'local'> & {
  status: 'would-change' | 'unchanged';
  currentContent?: string;
  expectedContent: string;
};

export type ManagedRuleFileApplyResult = Omit<ManagedRuleFileStatus, 'local'> & {
  status: 'would-change' | 'unchanged' | 'applied' | 'skipped' | 'failed';
  currentContent?: string;
  expectedContent?: string;
  backupPath?: string;
  error?: string;
};

export type ManagedRuleFilesStatusRuntimeResponse = {
  state: RuntimeStateSummary;
  files: ManagedRuleFileStatus[];
};

export type ManagedRuleFilesRemoteRuntimeResponse = {
  state: RuntimeStateSummary;
  files: ManagedRuleFileRemote[];
};

export type ManagedRuleFilesPlanRuntimeResponse = {
  state: RuntimeStateSummary;
  plans: ManagedRuleFilePlan[];
};

export type ManagedRuleFilesApplyRuntimeResponse = {
  state: RuntimeStateSummary;
  results: ManagedRuleFileApplyResult[];
};

export type SyncOnceResult = {
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  targets: string[];
  message?: string;
};

export type SyncServiceStatus = {
  platform: 'darwin' | 'linux' | 'win32';
  installed: boolean;
  paths: string[];
  message: string;
};

export type SyncServiceRuntimeResponse = {
  state: RuntimeStateSummary;
  service: SyncServiceStatus;
};

export type SyncNowRuntimeResponse = {
  state: RuntimeStateSummary;
  result: SyncOnceResult;
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
  config: AgentConfig;
  remote?: RemoteRevisionMetadata;
};

type RemoteConfigRuntimeResponse = RuntimeStateResponse & {
  config?: AgentConfig;
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

export async function loadRemoteConfigRuntime(request: GitHubTokenRuntimeRequest): Promise<RemoteConfigRuntimeResponse & { config: AgentConfig }> {
  return requestJson<RemoteConfigRuntimeResponse & { config: AgentConfig }>('/api/remote/load', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function saveRemoteConfigRuntime(request: GitHubTokenRuntimeRequest & { config: EditableAgentConfig }): Promise<RemoteConfigRuntimeResponse & { config: AgentConfig }> {
  return requestJson<RemoteConfigRuntimeResponse & { config: AgentConfig }>('/api/remote/save', {
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

export async function getConfigAvailabilityRuntime(request: { statePath?: string } = {}): Promise<ConfigAvailabilityRuntimeResponse> {
  const params = new URLSearchParams();
  if (request.statePath !== undefined && request.statePath.trim() !== '') {
    params.set('statePath', request.statePath);
  }
  const query = params.toString();
  return requestJson<ConfigAvailabilityRuntimeResponse>(`/api/config/availability${query === '' ? '' : `?${query}`}`);
}

export async function saveConfigFileRuntime(request: { statePath?: string; agent: AgentName; configPath?: string; content: string }): Promise<ConfigFileRuntimeResponse> {
  return requestJson<ConfigFileRuntimeResponse>('/api/config/file', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function getManagedRuleFilesRuntime(request: { statePath?: string } = {}): Promise<ManagedRuleFilesStatusRuntimeResponse> {
  const params = new URLSearchParams();
  if (request.statePath !== undefined && request.statePath.trim() !== '') {
    params.set('statePath', request.statePath);
  }
  const query = params.toString();
  return requestJson<ManagedRuleFilesStatusRuntimeResponse>(`/api/rules/files${query === '' ? '' : `?${query}`}`);
}

export async function loadManagedRuleFilesRuntime(request: GitHubTokenRuntimeRequest): Promise<ManagedRuleFilesRemoteRuntimeResponse> {
  return requestJson<ManagedRuleFilesRemoteRuntimeResponse>('/api/rules/files', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function initializeManagedRuleFileRuntime(request: GitHubTokenRuntimeRequest & { id: string }): Promise<ManagedRuleFilesRemoteRuntimeResponse> {
  return requestJson<ManagedRuleFilesRemoteRuntimeResponse>('/api/rules/init', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function planManagedRuleFilesRuntime(request: GitHubTokenRuntimeRequest & { id?: string; ids?: string[] }): Promise<ManagedRuleFilesPlanRuntimeResponse> {
  return requestJson<ManagedRuleFilesPlanRuntimeResponse>('/api/rules/plan', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function applyManagedRuleFilesRuntime(request: GitHubTokenRuntimeRequest & { id?: string; ids?: string[]; confirm: 'APPLY' }): Promise<ManagedRuleFilesApplyRuntimeResponse> {
  return requestJson<ManagedRuleFilesApplyRuntimeResponse>('/api/rules/apply', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function saveAutoSyncRuntime(request: GitHubTokenRuntimeRequest & { autoSync: AutoSyncConfig }): Promise<RuntimeStateResponse> {
  return requestJson<RuntimeStateResponse>('/api/sync/settings', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function syncNowRuntime(request: GitHubTokenRuntimeRequest & { targets?: string[] }): Promise<SyncNowRuntimeResponse> {
  return requestJson<SyncNowRuntimeResponse>('/api/sync/now', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function getSyncServiceRuntime(request: { statePath?: string } = {}): Promise<SyncServiceRuntimeResponse> {
  const params = new URLSearchParams();
  if (request.statePath !== undefined && request.statePath.trim() !== '') {
    params.set('statePath', request.statePath);
  }
  const query = params.toString();
  return requestJson<SyncServiceRuntimeResponse>(`/api/sync/service/status${query === '' ? '' : `?${query}`}`);
}

export async function installSyncServiceRuntime(request: { statePath?: string; intervalMinutes?: number }): Promise<SyncServiceRuntimeResponse> {
  return requestJson<SyncServiceRuntimeResponse>('/api/sync/service/install', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function uninstallSyncServiceRuntime(request: { statePath?: string }): Promise<SyncServiceRuntimeResponse> {
  return requestJson<SyncServiceRuntimeResponse>('/api/sync/service/uninstall', {
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
