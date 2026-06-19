import { create } from 'zustand';
import type {
  AgentName,
  ApplyAgentResult,
  ConfigAvailabilityEntry,
  ConfigFileRuntimeResponse,
  PlanApplyRuntimeResponse,
} from '../api';

/**
 * planStore owns the dry-run / apply flow + the native config file
 * editor:
 *
 * - The apply target selector (single agent / all agents / unset) and
 *   the optional config-path override that is shared by dry-run, apply
 *   and the file editor.
 * - The latest dry-run plan response and the planKey it was computed
 *   for. PR2 kept these as plain useState in App; here they live in
 *   one place so PlanResults can show "stale" without prop drilling.
 * - The latest apply result list.
 * - The APPLY confirmation textbox value.
 * - The native config file (its content + on-disk metadata) that the
 *   "本地配置" tab reads/writes.
 * - The agent availability list returned by /api/config/availability.
 * - Async flags for Plan / Apply / LoadConfig / SaveConfig /
 *   LoadAvailability.
 *
 * The store does NOT yet expose dispatch actions. Wiring lands in
 * PR3-c4 when LocalConfigPanel and ExecutePanel switch to subscribe.
 *
 * Note on the shared plan: today LocalConfigPanel and ExecutePanel
 * both call handlePlan and read the same planResponse. PR2's plan key
 * derivation was implicit; the store makes it explicit so a future
 * SyncTargetsPanel (PR4) can show one canonical "current plan"
 * indicator.
 */

export type TargetMode = AgentName | 'all' | '';

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
};

export const usePlanStore = create<PlanStore>(() => ({
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
}));
