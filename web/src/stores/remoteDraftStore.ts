import { create } from 'zustand';
import type { EditableAgentConfig } from '../api';

/**
 * remoteDraftStore owns the editable agentcfg.yaml form:
 *
 * - The current draft (providers, models, defaults, ohMyOpenAgent
 *   mappings) shown in the remote-config tab.
 * - The currently-selected provider id and model id in the per-entity
 *   editor.
 * - The status copy under the editor toolbar and the editor / preview
 *   view switch.
 * - The async flags for Load (Gist -> form) and Save (form -> Gist).
 *
 * This commit only declares the slice + a minimal action surface. The
 * real action implementations land alongside the panel rewiring in
 * PR3-c3.
 */

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

export type RemoteDraftStore = {
  readonly draft: EditableAgentConfig;
  readonly editorProviderId: string;
  readonly editorModelId: string;
  readonly status: string;
  readonly view: 'editor' | 'preview';
  readonly isLoading: boolean;
  readonly isSaving: boolean;
};

export const useRemoteDraftStore = create<RemoteDraftStore>(() => ({
  draft: EMPTY_REMOTE_DRAFT,
  editorProviderId: EMPTY_REMOTE_DRAFT.defaults.provider,
  editorModelId: EMPTY_REMOTE_DRAFT.defaults.model,
  status: '输入 GitHub Token 后，应用会发现现有 agentcfg Gist；没有时会在保存远端配置时自动创建。',
  view: 'editor',
  isLoading: false,
  isSaving: false,
}));

export { EMPTY_REMOTE_DRAFT };
