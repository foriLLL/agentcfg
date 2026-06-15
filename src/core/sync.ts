import { ADAPTER_NAMES, isAdapterName, type AdapterName } from '../adapters';
import { applyManagedRuleFilesFromGist, type ManagedRuleFileApplyResult, type ManagedRuleFileWriteOptions } from './managed-files';
import { applyPlan, planApply, type ApplyAgentResult, type ApplyWriteOptions } from './apply';
import { fetchGistAgentConfig, type FetchGistOptions } from './gist';
import { parseCanonicalAgentConfig } from './schema';
import { readLocalState, updateLastSyncRun, updatePulledConfig, type LastSyncRunSummary } from './state';

export const AUTO_SYNC_RULE_FILES_TARGET = 'ruleFiles';

export type SyncTarget = AdapterName | typeof AUTO_SYNC_RULE_FILES_TARGET;

export type SyncOnceOptions = {
  statePath?: string;
  targets?: readonly string[];
  gistOptions?: FetchGistOptions;
  applyWriteOptions?: ApplyWriteOptions;
  managedRuleFileWriteOptions?: ManagedRuleFileWriteOptions;
  now?: () => Date;
};

export type SyncOnceResult = {
  status: LastSyncRunSummary['status'];
  startedAt: string;
  completedAt: string;
  targets: SyncTarget[];
  agents: ApplyAgentResult[];
  ruleFiles: ManagedRuleFileApplyResult[];
  message?: string;
};

export class SyncTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncTargetError';
  }
}

export function resolveSyncTargets(targets: readonly string[] | undefined): SyncTarget[] {
  if (targets === undefined || targets.length === 0) {
    throw new SyncTargetError('No sync targets configured.');
  }

  const resolved: SyncTarget[] = [];
  for (const target of targets) {
    const normalizedTarget = target.trim();
    if (normalizedTarget === AUTO_SYNC_RULE_FILES_TARGET) {
      resolved.push(AUTO_SYNC_RULE_FILES_TARGET);
      continue;
    }
    if (isAdapterName(normalizedTarget)) {
      resolved.push(normalizedTarget);
      continue;
    }
    throw new SyncTargetError(`Unsupported sync target '${target}'.`);
  }

  return [...new Set(resolved)];
}

export async function runSyncOnce(options: SyncOnceOptions = {}): Promise<SyncOnceResult> {
  const startedAt = (options.now ?? (() => new Date()))().toISOString();
  const state = await readLocalState(options.statePath);
  if (state.gist === undefined) {
    throw new SyncTargetError('Run agentcfg init --gist <gist-id> before sync.');
  }

  if (options.targets === undefined && state.autoSync?.enabled === false) {
    const completedAt = (options.now ?? (() => new Date()))().toISOString();
    const result: SyncOnceResult = {
      status: 'success',
      startedAt,
      completedAt,
      targets: [],
      agents: [],
      ruleFiles: [],
      message: 'Auto-sync is disabled.',
    };
    await updateLastSyncRun(options.statePath, {
      status: result.status,
      startedAt,
      completedAt,
      message: result.message,
    });
    return result;
  }

  const selectedTargets = resolveSyncTargets(options.targets ?? state.autoSync?.targets ?? defaultAutoSyncTargets());
  const agentTargets = selectedTargets.filter(isAdapterName);
  const shouldSyncRuleFiles = selectedTargets.includes(AUTO_SYNC_RULE_FILES_TARGET);
  let agents: ApplyAgentResult[] = [];
  let ruleFiles: ManagedRuleFileApplyResult[] = [];

  if (agentTargets.length > 0) {
    const fetched = await fetchGistAgentConfig(state.gist.id, options.gistOptions);
    const config = parseCanonicalAgentConfig(fetched.content);
    await updatePulledConfig(options.statePath, config, fetched.metadata);
    agents = await applyPlan(await planApply(config, agentTargets, {}), options.applyWriteOptions);
  }

  if (shouldSyncRuleFiles) {
    ruleFiles = await applyManagedRuleFilesFromGist(
      state.gist.id,
      [],
      options.gistOptions,
      options.managedRuleFileWriteOptions,
    );
  }

  const completedAt = (options.now ?? (() => new Date()))().toISOString();
  const result = summarizeSyncRun({ startedAt, completedAt, targets: selectedTargets, agents, ruleFiles });
  await updateLastSyncRun(options.statePath, {
    status: result.status,
    startedAt,
    completedAt,
    message: result.message,
  });
  return result;
}

export function defaultAutoSyncTargets(): SyncTarget[] {
  return [...ADAPTER_NAMES, AUTO_SYNC_RULE_FILES_TARGET];
}

function summarizeSyncRun(result: Omit<SyncOnceResult, 'status' | 'message'>): SyncOnceResult {
  const failures = [
    ...result.agents.filter((entry) => entry.status === 'failed'),
    ...result.ruleFiles.filter((entry) => entry.status === 'failed'),
  ];
  const skipped = result.ruleFiles.filter((entry) => entry.status === 'skipped');

  if (failures.length > 0) {
    return { ...result, status: 'failed', message: `${failures.length} sync target(s) failed.` };
  }
  if (skipped.length > 0) {
    return { ...result, status: 'partial', message: `${skipped.length} remote rule file(s) were missing and skipped.` };
  }
  return { ...result, status: 'success' };
}
