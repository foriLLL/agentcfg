import { RuntimeClientError, type RuntimeStateSummary } from './api';

export type ManagedAgentSkillsSummary = {
  fileCount: number;
  totalBytes: number;
};

export type ManagedAgentSkillsStatus = {
  id: 'agent-skills';
  label: string;
  gistFileName: 'AGENT_SKILLS.json';
  localPath: string;
  local: {
    exists: boolean;
    updatedAt?: string;
    fileCount: number;
    totalBytes: number;
  };
};

export type ManagedAgentSkillsRemote = Omit<ManagedAgentSkillsStatus, 'local'> & {
  remote:
    | {
        status: 'available';
        summary: ManagedAgentSkillsSummary;
      }
    | {
        status: 'missing';
      };
};

export type ManagedAgentSkillsOperation = {
  path: string;
  action: 'create' | 'update' | 'delete';
  contentKind: 'text' | 'binary';
  currentContent?: string;
  expectedContent?: string;
  expectedMode?: number;
};

export type ManagedAgentSkillsPlan = Omit<ManagedAgentSkillsStatus, 'local'> & {
  status: 'would-change' | 'unchanged';
  operations: ManagedAgentSkillsOperation[];
};

export type ManagedAgentSkillsApplyResult = Omit<ManagedAgentSkillsStatus, 'local'> & {
  status: 'unchanged' | 'applied' | 'skipped' | 'failed';
  changedCount: number;
  backupPaths: string[];
  error?: string;
};

export type GitHubTokenRuntimeRequest = {
  statePath?: string;
  githubToken?: string;
  rememberGitHubToken?: boolean;
};

type ManagedAgentSkillsStatusRuntimeResponse = {
  state: RuntimeStateSummary;
  skills: ManagedAgentSkillsStatus;
};

type ManagedAgentSkillsRemoteRuntimeResponse = {
  state: RuntimeStateSummary;
  skills: ManagedAgentSkillsRemote;
};

type ManagedAgentSkillsPlanRuntimeResponse = {
  state: RuntimeStateSummary;
  plan: ManagedAgentSkillsPlan;
};

type ManagedAgentSkillsApplyRuntimeResponse = {
  state: RuntimeStateSummary;
  result: ManagedAgentSkillsApplyResult;
};

type RuntimeErrorBody = {
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

export async function getManagedAgentSkillsRuntime(request: { statePath?: string } = {}): Promise<ManagedAgentSkillsStatusRuntimeResponse> {
  const params = new URLSearchParams();
  if (request.statePath !== undefined && request.statePath.trim() !== '') {
    params.set('statePath', request.statePath);
  }
  const query = params.toString();
  return requestJson<ManagedAgentSkillsStatusRuntimeResponse>(`/api/skills/files${query === '' ? '' : `?${query}`}`);
}

export async function loadManagedAgentSkillsRuntime(request: GitHubTokenRuntimeRequest): Promise<ManagedAgentSkillsRemoteRuntimeResponse> {
  return requestJson<ManagedAgentSkillsRemoteRuntimeResponse>('/api/skills/files', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function initializeManagedAgentSkillsRuntime(request: GitHubTokenRuntimeRequest): Promise<ManagedAgentSkillsRemoteRuntimeResponse> {
  return requestJson<ManagedAgentSkillsRemoteRuntimeResponse>('/api/skills/init', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function planManagedAgentSkillsRuntime(request: GitHubTokenRuntimeRequest): Promise<ManagedAgentSkillsPlanRuntimeResponse> {
  return requestJson<ManagedAgentSkillsPlanRuntimeResponse>('/api/skills/plan', {
    method: 'POST',
    body: JSON.stringify(compactRequest(request)),
  });
}

export async function applyManagedAgentSkillsRuntime(
  request: GitHubTokenRuntimeRequest & { confirm: 'APPLY' },
): Promise<ManagedAgentSkillsApplyRuntimeResponse> {
  return requestJson<ManagedAgentSkillsApplyRuntimeResponse>('/api/skills/apply', {
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
