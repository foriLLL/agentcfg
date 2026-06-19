import { useMemo } from 'react';
import type { EditableAgentConfig } from '../api';
import { BUTTONS } from '../strings';
import { providerDraft } from './remote-draft';
import { useRemoteDraftStore } from '../stores';

export type DefaultsQuickEditProps = {
  readonly draft: EditableAgentConfig;
  readonly isSaving: boolean;
  readonly onSave: () => void | Promise<void>;
};

/**
 * Single-row quick editor for "switch the default provider/model and
 * its API key", placed above the full RemoteConfigPanel form so the
 * 90% case (rotate API key, swap default model) does not require
 * scanning the whole providers/models tree.
 *
 * Reads:
 *   draft.defaults.provider
 *   draft.defaults.model
 *   draft.providers[default].apiKey.value
 *
 * Writes via remoteDraftStore actions:
 *   setDefaultProvider(id)        - also resets default model to the
 *                                   first model under that provider
 *   setDefaultModel(id)
 *   updateProvider(provider => ...) - swaps the API key on the focused
 *                                   provider
 *
 * The Save button delegates to onSave (the same RemoteConfigPanel save
 * path) so the existing validation + outcome-to-toast wiring is reused.
 */
export function DefaultsQuickEdit({ draft, isSaving, onSave }: DefaultsQuickEditProps) {
  const setDefaultProvider = useRemoteDraftStore((state) => state.setDefaultProvider);
  const setDefaultModel = useRemoteDraftStore((state) => state.setDefaultModel);
  const updateProviderForDefault = useRemoteDraftStore((state) => state.updateProviderForDefault);

  const providerIds = useMemo(() => Object.keys(draft.providers), [draft.providers]);
  const defaultProviderId = providerIds.includes(draft.defaults.provider) ? draft.defaults.provider : providerIds[0] ?? '';
  const defaultProvider = providerDraft(draft, defaultProviderId);
  const modelIds = useMemo(() => Object.keys(defaultProvider.models), [defaultProvider]);
  const defaultModelId = modelIds.includes(draft.defaults.model) ? draft.defaults.model : modelIds[0] ?? '';
  const apiKeyValue = defaultProvider.apiKey.value;

  return (
    <article className="card defaults-quick-edit" aria-label="默认提供商快捷编辑">
      <div className="defaults-quick-edit__heading">
        <p className="eyebrow">默认设定</p>
        <h3>修改默认 provider / model / API Key</h3>
        <small>表单只改 defaults 与该 provider 的 API Key；完整列表请展开下方“详细编辑”。</small>
      </div>
      <div className="defaults-quick-edit__row">
        <label htmlFor="defaults-quick-provider">
          默认提供商
          <select
            id="defaults-quick-provider"
            value={defaultProviderId}
            onChange={(event) => setDefaultProvider(event.target.value)}
            disabled={isSaving || providerIds.length === 0}
          >
            {providerIds.map((id) => (
              <option value={id} key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label htmlFor="defaults-quick-model">
          默认模型
          <select
            id="defaults-quick-model"
            value={defaultModelId}
            onChange={(event) => setDefaultModel(event.target.value)}
            disabled={isSaving || modelIds.length === 0}
          >
            {modelIds.map((id) => (
              <option value={id} key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label htmlFor="defaults-quick-api-key">
          API Key
          <input
            id="defaults-quick-api-key"
            type="text"
            value={apiKeyValue}
            onChange={(event) =>
              updateProviderForDefault((provider) => ({
                ...provider,
                apiKey: { type: 'plain', value: event.target.value },
              }))
            }
            placeholder="最终写入 agentcfg.yaml 的 API Key"
            autoComplete="off"
            disabled={isSaving}
          />
        </label>
        <button
          className="primary-action"
          type="button"
          onClick={() => {
            void onSave();
          }}
          disabled={isSaving}
        >
          {isSaving ? BUTTONS.saveRemoteRunning : BUTTONS.saveRemote}
        </button>
      </div>
    </article>
  );
}
