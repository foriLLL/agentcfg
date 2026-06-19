import { create } from 'zustand';
import {
  loadRemoteConfigRuntime,
  saveRemoteConfigRuntime,
  type EditableAgentConfig,
  type OhMyOpenAgentModelAssignment,
} from '../api';
import {
  emptyProviderDraft,
  modelDraft,
  providerDraft,
  removeUnknownOhMyOpenAgentReferences,
  renameModelDraft,
  renameProviderDraft,
  uniqueDraftId,
  updateModelDraft as applyModelMutation,
  updateProviderDraft as applyProviderMutation,
  validateRemoteDraft,
  withOhMyOpenAgentAssignment,
  withOhMyOpenAgentModel,
  withOhMyOpenAgentVariant,
  type OhMyOpenAgentAssignmentKind,
} from '../panels/remote-draft';
import { configToDraft } from '../view-model';
import {
  selectRequestStatePath,
  selectShouldRememberGitHubToken,
  useRuntimeStore,
} from './runtimeStore';

const EMPTY_REMOTE_DRAFT: EditableAgentConfig = {
  schemaVersion: 1,
  defaults: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
  providers: {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: { type: 'plain', value: '' },
      models: {
        'gpt-4.1-mini': {},
      },
    },
  },
};

const INITIAL_STATUS =
  '输入 GitHub Token 后，应用会发现现有 agentcfg Gist；没有时会在保存远端配置时自动创建。';

export type LoadRemoteOutcome = { ok: true } | { ok: false; error: unknown };

export type SaveRemoteOutcome =
  | { ok: true }
  | { ok: false; kind: 'validation'; message: string }
  | { ok: false; kind: 'request'; error: unknown };

export type RemoteDraftStore = {
  readonly draft: EditableAgentConfig;
  readonly editorProviderId: string;
  readonly editorModelId: string;
  readonly status: string;
  readonly view: 'editor' | 'preview';
  readonly isLoading: boolean;
  readonly isSaving: boolean;

  readonly setStatus: (status: string) => void;
  readonly setView: (view: 'editor' | 'preview') => void;

  readonly replaceDraft: (next: EditableAgentConfig) => void;

  readonly selectProvider: (providerId: string) => void;
  readonly addProvider: () => void;
  readonly removeProvider: () => void;
  readonly renameProvider: (nextProviderId: string) => boolean;
  readonly updateProvider: (
    update: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string],
  ) => void;
  readonly updateProviderForDefault: (
    update: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string],
  ) => void;

  readonly selectModel: (modelId: string) => void;
  readonly addModel: () => void;
  readonly removeModel: () => void;
  readonly renameModel: (nextModelId: string) => boolean;
  readonly updateModel: (
    update: (
      model: EditableAgentConfig['providers'][string]['models'][string],
    ) => EditableAgentConfig['providers'][string]['models'][string],
  ) => void;

  readonly setDefaultProvider: (providerId: string) => void;
  readonly setDefaultModel: (modelId: string) => void;

  readonly setOhMyOpenAgentModel: (
    kind: OhMyOpenAgentAssignmentKind,
    name: string,
    modelReference: string,
  ) => void;
  readonly setOhMyOpenAgentVariant: (
    kind: OhMyOpenAgentAssignmentKind,
    name: string,
    variant: string,
  ) => void;
  readonly clearOhMyOpenAgentAssignment: (kind: OhMyOpenAgentAssignmentKind, name: string) => void;

  readonly load: () => Promise<LoadRemoteOutcome>;
  readonly save: () => Promise<SaveRemoteOutcome>;
};

export const useRemoteDraftStore = create<RemoteDraftStore>((set, get) => ({
  draft: EMPTY_REMOTE_DRAFT,
  editorProviderId: EMPTY_REMOTE_DRAFT.defaults.provider,
  editorModelId: EMPTY_REMOTE_DRAFT.defaults.model,
  status: INITIAL_STATUS,
  view: 'editor',
  isLoading: false,
  isSaving: false,

  setStatus: (status) => set({ status }),
  setView: (view) => set({ view }),

  replaceDraft: (next) => {
    const providerId =
      next.providers[next.defaults.provider] === undefined
        ? Object.keys(next.providers)[0] ?? ''
        : next.defaults.provider;
    const provider = providerDraft(next, providerId);
    const modelId =
      provider.models[next.defaults.model] === undefined
        ? Object.keys(provider.models)[0] ?? ''
        : next.defaults.model;
    set({ draft: next, editorProviderId: providerId, editorModelId: modelId });
  },

  selectProvider: (providerId) => {
    const { draft } = get();
    const firstModel = Object.keys(providerDraft(draft, providerId).models)[0] ?? '';
    set({ editorProviderId: providerId, editorModelId: firstModel });
  },

  addProvider: () => {
    set((store) => {
      const providerId = uniqueDraftId('provider', store.draft.providers);
      const modelId = 'model';
      return {
        draft: {
          ...store.draft,
          providers: {
            ...store.draft.providers,
            [providerId]: emptyProviderDraft(modelId),
          },
        },
        editorProviderId: providerId,
        editorModelId: modelId,
      };
    });
  },

  removeProvider: () => {
    set((store) => {
      const providerIds = Object.keys(store.draft.providers);
      const target = store.editorProviderId;
      if (providerIds.length <= 1 || store.draft.providers[target] === undefined) {
        return store;
      }
      const providers = { ...store.draft.providers };
      delete providers[target];
      const nextProviderId = providerIds.find((id) => id !== target) ?? '';
      const nextModelId = Object.keys(providers[nextProviderId]?.models ?? {})[0] ?? '';
      const defaults =
        store.draft.defaults.provider === target
          ? { provider: nextProviderId, model: nextModelId }
          : store.draft.defaults;

      return {
        draft: removeUnknownOhMyOpenAgentReferences({ ...store.draft, defaults, providers }),
        editorProviderId: nextProviderId,
        editorModelId: nextModelId,
      };
    });
  },

  renameProvider: (nextProviderId) => {
    const { draft, editorProviderId } = get();
    if (nextProviderId === editorProviderId) return true;
    if (draft.providers[nextProviderId] !== undefined) return false;
    set({
      draft: renameProviderDraft(draft, editorProviderId, nextProviderId),
      editorProviderId: nextProviderId,
    });
    return true;
  },

  updateProvider: (update) => {
    set((store) => ({
      draft: applyProviderMutation(store.draft, store.editorProviderId, update),
    }));
  },

  updateProviderForDefault: (update) => {
    set((store) => {
      const ids = Object.keys(store.draft.providers);
      const targetId = ids.includes(store.draft.defaults.provider) ? store.draft.defaults.provider : ids[0];
      if (targetId === undefined) return store;
      return { draft: applyProviderMutation(store.draft, targetId, update) };
    });
  },

  selectModel: (modelId) => set({ editorModelId: modelId }),

  addModel: () => {
    set((store) => {
      const provider = providerDraft(store.draft, store.editorProviderId);
      const modelId = uniqueDraftId('model', provider.models);
      return {
        draft: applyProviderMutation(store.draft, store.editorProviderId, (current) => ({
          ...current,
          models: { ...current.models, [modelId]: {} },
        })),
        editorModelId: modelId,
      };
    });
  },

  removeModel: () => {
    set((store) => {
      const providerId = store.editorProviderId;
      const modelId = store.editorModelId;
      const provider = providerDraft(store.draft, providerId);
      const modelIds = Object.keys(provider.models);
      if (modelIds.length <= 1 || provider.models[modelId] === undefined) return store;

      const models = { ...provider.models };
      delete models[modelId];
      const nextModelId = modelIds.find((candidate) => candidate !== modelId) ?? '';
      const defaults =
        store.draft.defaults.provider === providerId && store.draft.defaults.model === modelId
          ? { ...store.draft.defaults, model: nextModelId }
          : store.draft.defaults;

      return {
        draft: removeUnknownOhMyOpenAgentReferences({
          ...store.draft,
          defaults,
          providers: {
            ...store.draft.providers,
            [providerId]: { ...provider, models },
          },
        }),
        editorModelId: nextModelId,
      };
    });
  },

  renameModel: (nextModelId) => {
    const { draft, editorProviderId, editorModelId } = get();
    if (nextModelId === editorModelId) return true;
    const provider = providerDraft(draft, editorProviderId);
    if (provider.models[nextModelId] !== undefined) return false;
    set({
      draft: renameModelDraft(draft, editorProviderId, editorModelId, nextModelId),
      editorModelId: nextModelId,
    });
    return true;
  },

  updateModel: (update) => {
    set((store) => ({
      draft: applyModelMutation(store.draft, store.editorProviderId, store.editorModelId, update),
    }));
  },

  setDefaultProvider: (providerId) => {
    set((store) => ({
      draft: {
        ...store.draft,
        defaults: {
          provider: providerId,
          model: Object.keys(providerDraft(store.draft, providerId).models)[0] ?? '',
        },
      },
    }));
  },

  setDefaultModel: (modelId) => {
    set((store) => ({
      draft: {
        ...store.draft,
        defaults: { ...store.draft.defaults, model: modelId },
      },
    }));
  },

  setOhMyOpenAgentModel: (kind, name, modelReference) => {
    set((store) => ({ draft: withOhMyOpenAgentModel(store.draft, kind, name, modelReference) }));
  },

  setOhMyOpenAgentVariant: (kind, name, variant) => {
    set((store) => ({ draft: withOhMyOpenAgentVariant(store.draft, kind, name, variant) }));
  },

  clearOhMyOpenAgentAssignment: (kind, name) => {
    set((store) => ({
      draft: withOhMyOpenAgentAssignment(store.draft, kind, name, undefined as OhMyOpenAgentModelAssignment | undefined),
    }));
  },

  load: async () => {
    set({ isLoading: true });
    try {
      const tokenRequest = buildGitHubTokenRequestFromRuntime();
      const response = await loadRemoteConfigRuntime(tokenRequest);
      useRuntimeStore.getState().commitRuntimeState(response.state);
      get().replaceDraft(configToDraft(response.config));
      set({ status: '远端配置已加载。API Key 直接显示；保存前请确认表单就是最终写入值。' });
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      set({ isLoading: false });
    }
  },

  save: async () => {
    const { draft } = get();
    const validationError = validateRemoteDraft(draft);
    if (validationError !== null) {
      return { ok: false, kind: 'validation', message: validationError };
    }
    set({ isSaving: true });
    try {
      const tokenRequest = buildGitHubTokenRequestFromRuntime();
      const response = await saveRemoteConfigRuntime({ ...tokenRequest, config: draft });
      useRuntimeStore.getState().commitRuntimeState(response.state);
      get().replaceDraft(configToDraft(response.config));
      set({ status: '远端配置已保存。表单和预览已回填最终写入的完整值。' });
      return { ok: true };
    } catch (error) {
      return { ok: false, kind: 'request', error };
    } finally {
      set({ isSaving: false });
    }
  },
}));

export { EMPTY_REMOTE_DRAFT };

function buildGitHubTokenRequestFromRuntime() {
  const runtime = useRuntimeStore.getState();
  const statePath = selectRequestStatePath(runtime);
  const githubToken = runtime.githubToken.trim();
  const remember = selectShouldRememberGitHubToken(runtime);
  return {
    statePath,
    githubToken,
    ...(remember && githubToken !== '' ? { rememberGitHubToken: true } : {}),
  };
}
