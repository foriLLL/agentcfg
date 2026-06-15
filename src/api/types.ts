import type { AdapterName } from '../adapters';
import type { ApplyAgentResult } from '../core/apply';
import type { ManagedDiffField, ManagedDiffNotice } from '../core/diff';
import type { NativeConfigFormat } from '../core/native-io';
import type { AgentConfigInput, CanonicalAgentConfig } from '../core/schema';
import type { AutoSyncConfig, LastSyncRunSummary, RemoteRevisionMetadata } from '../core/state';
import type {
  ManagedRuleFileApplyResult,
  ManagedRuleFilePlan,
  ManagedRuleFileRemote,
  ManagedRuleFileStatus,
  SyncOnceResult,
  SyncServiceStatus,
} from '../core';

export type RuntimeApiErrorCode =
  | 'invalid-request'
  | 'state-error'
  | 'gist-error'
  | 'provider-error'
  | 'validation-error'
  | 'diff-error'
  | 'apply-error';

export type RuntimeApiErrorDetails = {
  results?: ApiApplyAgentResult[];
};

export type RuntimeRequest = {
  statePath?: string;
};

export type RuntimeStateSummary = {
  statePath: string;
  schemaVersion: 1;
  secrets: {
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
    config?: CanonicalAgentConfig;
  };
  conflict: {
    present: boolean;
    baseRevision?: string;
    baseETag?: string;
    baseConfig?: CanonicalAgentConfig;
  };
  autoSync?: AutoSyncConfig;
  lastSyncRun?: LastSyncRunSummary;
};

export type GetRuntimeStateRequest = RuntimeRequest;

export type GetRuntimeStateResponse = {
  state: RuntimeStateSummary;
};

export type InitRuntimeRequest = RuntimeRequest & {
  gistId: string;
};

export type InitRuntimeResponse = {
  state: RuntimeStateSummary;
};

export type PullRuntimeRequest = RuntimeRequest & {
  githubToken?: string;
  rememberGitHubToken?: boolean;
};

export type PullRuntimeResponse = {
  state: RuntimeStateSummary;
  config: CanonicalAgentConfig;
  remote?: RemoteRevisionMetadata;
};

export type RemoteConfigRuntimeRequest = RuntimeRequest & {
  githubToken?: string;
  rememberGitHubToken?: boolean;
};

export type ClearSavedGitHubTokenRuntimeRequest = RuntimeRequest;

export type ClearSavedGitHubTokenRuntimeResponse = {
  state: RuntimeStateSummary;
};

export type DiscoverProviderModelsRuntimeRequest = RuntimeRequest & {
  provider?: string;
};

export type DiscoverProviderModelsRuntimeResponse = {
  provider: string;
  models: string[];
};

export type SetupRemoteConfigRuntimeRequest = RemoteConfigRuntimeRequest;

export type SetupRemoteConfigRuntimeResponse = {
  state: RuntimeStateSummary;
  config?: CanonicalAgentConfig;
  remote?: RemoteRevisionMetadata;
};

export type LoadRemoteConfigRuntimeRequest = RemoteConfigRuntimeRequest;

export type LoadRemoteConfigRuntimeResponse = {
  state: RuntimeStateSummary;
  config: CanonicalAgentConfig;
  remote?: RemoteRevisionMetadata;
};

export type SaveRemoteConfigRuntimeRequest = RemoteConfigRuntimeRequest & {
  config?: AgentConfigInput;
};

export type SaveRemoteConfigRuntimeResponse = {
  state: RuntimeStateSummary;
  config: CanonicalAgentConfig;
  remote?: RemoteRevisionMetadata;
};

export type RuntimeTargetRequest = RuntimeRequest & {
  agent?: AdapterName;
  allAgents?: boolean;
  configPath?: string;
  fixturesRoot?: string;
};

export type ApiManagedDiffChange = {
  field: ManagedDiffField;
  current?: string;
  expected?: string;
  secret: boolean;
};

export type ApiAgentDiffResult = {
  agent: AdapterName;
  changes: ApiManagedDiffChange[];
  notices: ManagedDiffNotice[];
};

export type DiffRuntimeRequest = RuntimeTargetRequest;

export type DiffRuntimeResponse = {
  results: ApiAgentDiffResult[];
};

export type ApiApplyAgentResult = Omit<ApplyAgentResult, 'changes'> & {
  changes: ApiManagedDiffChange[];
};

export type ApiApplyPlanSummary = {
  agent: AdapterName;
  configPath: string;
  envPath?: string;
  changes: ApiManagedDiffChange[];
  notices: ManagedDiffNotice[];
  operationCount: number;
  operationPaths: string[];
  filePreviews: ApiApplyFilePreview[];
};

export type ApiApplyFilePreview = {
  path: string;
  kind: 'native' | 'env';
  mode?: number;
  currentContent?: string;
  expectedContent: string;
};

export type PlanApplyRuntimeRequest = RuntimeTargetRequest;

export type PlanApplyRuntimeResponse = {
  plans: ApiApplyPlanSummary[];
  results: ApiApplyAgentResult[];
};

export type ApplyRuntimeRequest = RuntimeTargetRequest & {
  confirm?: 'APPLY' | string;
};

export type ApplyRuntimeResponse = {
  results: ApiApplyAgentResult[];
};

export type ConfigFileRuntimeRequest = RuntimeRequest & {
  agent?: string;
  configPath?: string;
  fixturesRoot?: string;
};

export type ConfigAvailabilityStatus = 'available' | 'missing' | 'ambiguous';

export type ConfigAvailabilityEntry = {
  agent: AdapterName;
  available: boolean;
  status: ConfigAvailabilityStatus;
  path?: string;
  format?: NativeConfigFormat;
  updatedAt?: string;
  reason?: string;
};

export type ConfigAvailabilityRuntimeRequest = RuntimeRequest & {
  configPath?: string;
  fixturesRoot?: string;
};

export type ConfigAvailabilityRuntimeResponse = {
  agents: ConfigAvailabilityEntry[];
};

export type ConfigFileRuntimeResponse = {
  agent: AdapterName;
  path: string;
  format: NativeConfigFormat;
  content: string;
  updatedAt?: string;
};

export type SaveConfigFileRuntimeRequest = ConfigFileRuntimeRequest & {
  content?: string;
};

export type SaveConfigFileRuntimeResponse = ConfigFileRuntimeResponse & {
  backupPath?: string;
};

export type ManagedRuleFilesRuntimeRequest = RemoteConfigRuntimeRequest & {
  id?: string;
  ids?: string[];
  confirm?: 'APPLY' | string;
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

export type AutoSyncRuntimeRequest = RemoteConfigRuntimeRequest & {
  autoSync?: AutoSyncConfig;
  targets?: string[];
};

export type AutoSyncRuntimeResponse = {
  state: RuntimeStateSummary;
};

export type SyncNowRuntimeResponse = {
  state: RuntimeStateSummary;
  result: SyncOnceResult;
};

export type SyncServiceRuntimeRequest = RuntimeRequest & {
  intervalMinutes?: number;
};

export type SyncServiceRuntimeResponse = {
  state: RuntimeStateSummary;
  service: SyncServiceStatus;
};
