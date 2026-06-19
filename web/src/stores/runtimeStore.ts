import { create } from 'zustand';
import type { RuntimeStateSummary } from '../api';

/**
 * runtimeStore owns:
 *
 * - The local runtime snapshot returned by /api/state (gist binding,
 *   cache metadata, conflict baseline, autoSync, lastSyncRun, secrets
 *   flags).
 * - The connect-form draft: GitHub Token input value, Gist ID input,
 *   state-path input, "remember token" checkbox, edit/cancel toggles
 *   for the saved-token UI.
 * - The async flags for Init / Pull / SetupRemote / ClearSavedToken.
 *
 * It does NOT own:
 * - The editable agentcfg.yaml draft. That belongs to remoteDraftStore.
 * - The dry-run/apply flow. That belongs to planStore.
 * - The auto-sync + service-install panel state. SyncPanel keeps its
 *   own local state for now; PR4 will revisit.
 *
 * This commit only declares the slice + a minimal action surface. App
 * still drives runtime state via useState; subsequent commits replace
 * the call sites incrementally.
 */
export type RuntimeStore = {
  readonly state: RuntimeStateSummary | null;
  readonly loadState: 'loading' | 'ready' | 'error';

  readonly githubToken: string;
  readonly gistId: string;
  readonly statePath: string;
  readonly rememberGitHubToken: boolean;
  readonly isEditingGitHubToken: boolean;

  readonly isSubmittingInit: boolean;
  readonly isSettingRemote: boolean;
  readonly isPulling: boolean;
  readonly isClearingGitHubToken: boolean;
};

export const useRuntimeStore = create<RuntimeStore>(() => ({
  state: null,
  loadState: 'loading',

  githubToken: '',
  gistId: '',
  statePath: '',
  rememberGitHubToken: false,
  isEditingGitHubToken: false,

  isSubmittingInit: false,
  isSettingRemote: false,
  isPulling: false,
  isClearingGitHubToken: false,
}));
