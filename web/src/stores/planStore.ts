import { create } from 'zustand';
import {
  applyRuntime,
  getConfigAvailabilityRuntime,
  getConfigFileRuntime,
  planApplyRuntime,
  saveConfigFileRuntime,
  type AgentName,
  type ApplyAgentResult,
  type ConfigAvailabilityEntry,
  type ConfigFileRuntimeResponse,
  type PlanApplyRuntimeResponse,
  type RuntimeTargetRequest,
} from '../api';
import { extractApplyResults } from '../view-model';
import { selectRequestStatePath, useRuntimeStore } from './runtimeStore';

/**
 * planStore owns the dry-run / apply flow + the native config file
 * editor:
 *
 * - The apply target selector (single agent / all agents / unset) and
 *   the optional config-path override that is shared by dry-run, apply
 *   and the file editor.
 * - The latest dry-run plan response and the planKey it was computed
 *   for so PlanResults can render "stale" without prop drilling.
 * - The latest apply result list.
 * - The APPLY confirmation textbox value.
 * - The native config file (its content + on-disk metadata) that the
 *   "本地配置" tab reads/writes.
 * - The agent availability list.
 * - Async flags for Plan / Apply / LoadConfig / SaveConfig /
 *   LoadAvailability.
 *
 * Plan invalidation rule: every change to targetMode or configPath
 * resets confirmationText back to '' so a stale plan never accepts an
 * APPLY submission. Saves to the config file or remote draft also
 * invalidate planResponse + applyResults; the caller (App.tsx for now,
 * SyncTargetsPanel in PR4) calls invalidate() to do that.
 */

export type TargetMode = AgentName | 'all' | '';

export type PlanOutcome =
  | { ok: true }
  | { ok: false; targetMissing: true }
  | { ok: false; targetMissing?: false; error: unknown };

export type ApplyOutcome =
  | { ok: true }
  | { ok: false; results?: ApplyAgentResult[]; error: unknown };

export type ConfigFileOutcome = { ok: true } | { ok: false; error: unknown };

export type PlanStore = {
  readonly targetMode: TargetMode;
  readonly configPath: string;
  readonly confirmationText: string;

  readonly planResponse: PlanApplyRuntimeResponse | null;
  readonly planKey: string | null;
  readonly applyResults: ApplyAgentResult[] | null;

  readonly configFile: ConfigFileRuntimeResponse | null;
  readonly configDraft: string;
  readonly configStatus: string;

  readonly configAvailability: ConfigAvailabilityEntry[];

  readonly isPlanning: boolean;
  readonly isApplying: boolean;
  readonly isLoadingConfig: boolean;
  readonly isSavingConfig: boolean;
  readonly isLoadingConfigAvailability: boolean;

  readonly setTargetMode: (target: TargetMode) => void;
  readonly setConfigPath: (path: string) => void;
  readonly setConfirmationText: (value: string) => void;
  readonly setConfigDraft: (value: string) => void;
  readonly setConfigStatus: (status: string) => void;

  readonly invalidate: () => void;

  readonly refreshAvailability: () => Promise<void>;

  readonly plan: () => Promise<PlanOutcome>;
  readonly apply: () => Promise<ApplyOutcome>;

  readonly loadConfigFile: (agent: AgentName) => Promise<ConfigFileOutcome>;
  readonly saveConfigFile: () => Promise<ConfigFileOutcome>;
};

export const usePlanStore = create<PlanStore>((set, get) => ({
  targetMode: '',
  configPath: '',
  confirmationText: '',

  planResponse: null,
  planKey: null,
  applyResults: null,

  configFile: null,
  configDraft: '',
  configStatus: '尚未加载配置文件。',

  configAvailability: [],

  isPlanning: false,
  isApplying: false,
  isLoadingConfig: false,
  isSavingConfig: false,
  isLoadingConfigAvailability: false,

  setTargetMode: (target) => set({ targetMode: target, confirmationText: '' }),
  setConfigPath: (path) => set({ configPath: path, confirmationText: '' }),
  setConfirmationText: (value) => set({ confirmationText: value }),
  setConfigDraft: (value) => set({ configDraft: value }),
  setConfigStatus: (status) => set({ configStatus: status }),

  invalidate: () =>
    set({
      planResponse: null,
      planKey: null,
      applyResults: null,
      confirmationText: '',
    }),

  refreshAvailability: async () => {
    const statePath = selectRequestStatePath(useRuntimeStore.getState());
    set({ isLoadingConfigAvailability: true });
    try {
      const { agents } = await getConfigAvailabilityRuntime({ statePath });
      set({ configAvailability: agents });
    } catch {
      set({ configAvailability: [] });
    } finally {
      set({ isLoadingConfigAvailability: false });
    }
  },

  plan: async () => {
    const targetRequest = buildTargetRequest(get());
    if (targetRequest === null) {
      return { ok: false, targetMissing: true };
    }
    const planKey = JSON.stringify(targetRequest);
    set({ isPlanning: true, applyResults: null });
    try {
      const response = await planApplyRuntime(targetRequest);
      set({ planResponse: response, planKey });
      return { ok: true };
    } catch (error) {
      set({ planResponse: null, planKey: null, applyResults: extractApplyResults(error) ?? null });
      return { ok: false, error };
    } finally {
      set({ isPlanning: false });
    }
  },

  apply: async () => {
    const targetRequest = buildTargetRequest(get());
    if (targetRequest === null) {
      return { ok: false, error: new Error('NO_TARGET') };
    }
    set({ isApplying: true });
    try {
      const response = await applyRuntime({ ...targetRequest, confirm: 'APPLY' });
      set({ applyResults: response.results, confirmationText: '' });
      await useRuntimeStore.getState().refresh(targetRequest.statePath);
      return { ok: true };
    } catch (error) {
      const results = extractApplyResults(error);
      set({ applyResults: results ?? null });
      return { ok: false, error, results };
    } finally {
      set({ isApplying: false });
    }
  },

  loadConfigFile: async (agent) => {
    const state = get();
    const statePath = selectRequestStatePath(useRuntimeStore.getState());
    set({ isLoadingConfig: true });
    try {
      const response = await getConfigFileRuntime({
        statePath,
        agent,
        configPath: state.configPath.trim(),
      });
      set({ configFile: response, configDraft: response.content, configStatus: '配置已加载' });
      return { ok: true };
    } catch (error) {
      set({ configFile: null, configDraft: '' });
      return { ok: false, error };
    } finally {
      set({ isLoadingConfig: false });
    }
  },

  saveConfigFile: async () => {
    const state = get();
    if (state.configFile === null) {
      return { ok: false, error: new Error('NO_FILE_LOADED') };
    }
    const statePath = selectRequestStatePath(useRuntimeStore.getState());
    const agent = configAgentOf(state.targetMode);
    if (agent === null) {
      return { ok: false, error: new Error('NO_TARGET') };
    }
    set({ isSavingConfig: true });
    try {
      const response = await saveConfigFileRuntime({
        statePath,
        agent,
        configPath: state.configFile.path,
        content: state.configDraft,
      });
      set({
        configFile: response,
        configDraft: response.content,
        configStatus:
          response.backupPath === undefined ? '配置已保存' : `配置已保存，备份：${response.backupPath}`,
      });
      get().invalidate();
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      set({ isSavingConfig: false });
    }
  },
}));

export function selectTargetRequest(state: PlanStore): RuntimeTargetRequest | null {
  return buildTargetRequest(state);
}

export function selectPlanKey(state: PlanStore): string {
  const request = buildTargetRequest(state);
  return request === null ? '' : JSON.stringify(request);
}

export function selectIsPlanCurrent(state: PlanStore): boolean {
  return state.planResponse !== null && state.planKey !== null && state.planKey === selectPlanKey(state);
}

export function selectConfigAgent(state: PlanStore): AgentName | null {
  return configAgentOf(state.targetMode);
}

function configAgentOf(mode: TargetMode): AgentName | null {
  return mode === '' || mode === 'all' ? null : mode;
}

function buildTargetRequest(state: PlanStore): RuntimeTargetRequest | null {
  if (state.targetMode === '') return null;
  const statePath = selectRequestStatePath(useRuntimeStore.getState());
  return {
    statePath,
    ...(state.targetMode === 'all' ? { allAgents: true } : { agent: state.targetMode }),
    configPath: state.configPath.trim(),
  };
}
