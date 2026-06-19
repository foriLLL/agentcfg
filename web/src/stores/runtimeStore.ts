import { create } from 'zustand';
import {
  clearSavedGitHubTokenRuntime,
  getRuntimeState,
  initRuntime,
  pullRuntime,
  setupRemoteConfigRuntime,
  type AgentConfig,
  type RuntimeStateSummary,
} from '../api';

/**
 * runtimeStore owns:
 *
 * - The local runtime snapshot returned by /api/state (gist binding,
 *   cache metadata, conflict baseline, autoSync, lastSyncRun, secrets
 *   flags).
 * - The connect-form draft: GitHub Token input value, Gist ID input,
 *   state-path input, "remember token" checkbox, edit/cancel toggles
 *   for the saved-token UI.
 * - The async flags for Init / Pull / SetupRemote / ClearSavedToken
 *   plus the page-level loadState (loading/ready/error).
 *
 * It does NOT own:
 * - The editable agentcfg.yaml draft (remoteDraftStore).
 * - The dry-run/apply flow (planStore).
 * - The auto-sync + service-install panel state. SyncPanel keeps its
 *   own local state for now; PR4 will revisit.
 *
 * Store actions never trigger toasts or navigate. They return a small
 * outcome object so the UI layer can map results to notices, while
 * keeping all I/O / state mutation contained here.
 */

export type SetupRemoteOutcome =
  | { ok: true; bootstrapped: boolean; config: AgentConfig | undefined }
  | { ok: false; error: unknown };

export type SimpleOutcome = { ok: true } | { ok: false; error: unknown };

export type BootstrapOutcome =
  | { ok: true; state: RuntimeStateSummary; shouldAutoLoadRemote: boolean }
  | { ok: false; error: unknown };

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

  readonly setGithubToken: (value: string) => void;
  readonly setGistId: (value: string) => void;
  readonly setStatePath: (value: string) => void;
  readonly setRememberGitHubToken: (checked: boolean) => void;

  readonly beginEditSavedToken: () => void;
  readonly cancelEditSavedToken: () => void;

  readonly bootstrap: () => Promise<BootstrapOutcome>;
  readonly refresh: (nextStatePath?: string) => Promise<SimpleOutcome>;
  readonly init: () => Promise<SimpleOutcome>;
  readonly setupRemote: (overrides?: { githubToken?: string; statePath?: string }) => Promise<SetupRemoteOutcome>;
  readonly pull: () => Promise<SimpleOutcome>;
  readonly clearSavedToken: () => Promise<SimpleOutcome>;

  readonly commitRuntimeState: (state: RuntimeStateSummary) => void;
};

export const useRuntimeStore = create<RuntimeStore>((set, get) => ({
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

  setGithubToken: (value) => set({ githubToken: value }),
  setGistId: (value) => set({ gistId: value }),
  setStatePath: (value) => set({ statePath: value }),
  setRememberGitHubToken: (checked) => set({ rememberGitHubToken: checked }),

  beginEditSavedToken: () => set({ githubToken: '', rememberGitHubToken: false, isEditingGitHubToken: true }),
  cancelEditSavedToken: () => set({ githubToken: '', rememberGitHubToken: false, isEditingGitHubToken: false }),

  commitRuntimeState: (nextState) => {
    set({ state: nextState, statePath: nextState.statePath });
    if (nextState.secrets?.hasGitHubToken === true) {
      set({ githubToken: '', rememberGitHubToken: false, isEditingGitHubToken: false });
    }
  },

  bootstrap: async () => {
    try {
      const { state } = await getRuntimeState();
      get().commitRuntimeState(state);
      set({ loadState: 'ready', gistId: state.gist.id ?? '' });
      const shouldAutoLoadRemote = state.secrets?.hasGitHubToken === true && state.gist.present;
      return { ok: true, state, shouldAutoLoadRemote };
    } catch (error) {
      set({ loadState: 'error' });
      return { ok: false, error };
    }
  },

  refresh: async (nextStatePath) => {
    try {
      const { state } = await getRuntimeState(nextStatePath);
      get().commitRuntimeState(state);
      set({ loadState: 'ready', gistId: state.gist.id ?? get().gistId });
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  },

  init: async () => {
    const nextGistId = get().gistId.trim();
    const nextStatePath = get().statePath.trim();
    set({ isSubmittingInit: true });
    try {
      const { state } = await initRuntime({ gistId: nextGistId, statePath: nextStatePath });
      get().commitRuntimeState(state);
      const refreshed = await get().refresh(nextStatePath);
      if (!refreshed.ok) return refreshed;
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      set({ isSubmittingInit: false });
    }
  },

  setupRemote: async (overrides) => {
    const nextGithubToken = (overrides?.githubToken ?? get().githubToken).trim();
    const nextStatePath = (overrides?.statePath ?? get().statePath).trim();
    const tokenRequest = buildGitHubTokenRequestFromState(get(), nextStatePath, nextGithubToken);
    set({ isSettingRemote: true });
    try {
      const response = await setupRemoteConfigRuntime(tokenRequest);
      get().commitRuntimeState(response.state);
      set({ gistId: response.state.gist.id ?? '' });
      return { ok: true, bootstrapped: response.state.gist.present === true, config: response.config };
    } catch (error) {
      return { ok: false, error };
    } finally {
      set({ isSettingRemote: false });
    }
  },

  pull: async () => {
    const requestStatePath = resolveRequestStatePath(get());
    const tokenRequest = buildGitHubTokenRequestFromState(get(), requestStatePath, get().githubToken.trim());
    set({ isPulling: true });
    try {
      const { state } = await pullRuntime(tokenRequest);
      get().commitRuntimeState(state);
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      set({ isPulling: false });
    }
  },

  clearSavedToken: async () => {
    const requestStatePath = resolveRequestStatePath(get());
    set({ isClearingGitHubToken: true });
    try {
      const { state } = await clearSavedGitHubTokenRuntime({ statePath: requestStatePath });
      get().commitRuntimeState(state);
      set({ githubToken: '', rememberGitHubToken: false, isEditingGitHubToken: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      set({ isClearingGitHubToken: false });
    }
  },
}));

/**
 * Whether the saved-token form should be checked. Encodes the same
 * "auto-save when replacing" rule the original App.tsx had:
 * - When replacing a saved token, "remember" follows whether the user
 *   typed something.
 * - Otherwise it follows the explicit checkbox.
 */
export function selectShouldRememberGitHubToken(state: RuntimeStore): boolean {
  const hasSaved = state.state?.secrets?.hasGitHubToken === true;
  const isReplacing = hasSaved && state.isEditingGitHubToken;
  return isReplacing ? state.githubToken.trim() !== '' : state.rememberGitHubToken;
}

/**
 * The state-path arg that every API call should use: explicit input
 * if non-empty, otherwise whatever the runtime echoed.
 */
export function selectRequestStatePath(state: RuntimeStore): string | undefined {
  return resolveRequestStatePath(state);
}

function resolveRequestStatePath(state: RuntimeStore): string | undefined {
  return state.statePath.trim() === '' ? state.state?.statePath : state.statePath.trim();
}

function buildGitHubTokenRequestFromState(
  state: RuntimeStore,
  statePath: string | undefined,
  githubToken: string,
) {
  const remember = selectShouldRememberGitHubToken({ ...state, githubToken });
  return {
    statePath,
    githubToken,
    ...(remember && githubToken !== '' ? { rememberGitHubToken: true } : {}),
  };
}
