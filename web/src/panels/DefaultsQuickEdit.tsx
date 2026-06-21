import { useMemo, useState } from 'react';
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
  const [isApiKeyFocused, setIsApiKeyFocused] = useState(false);
  const [hasCopiedApiKey, setHasCopiedApiKey] = useState(false);
  const setDefaultProvider = useRemoteDraftStore((state) => state.setDefaultProvider);
  const setDefaultModel = useRemoteDraftStore((state) => state.setDefaultModel);
  const updateProviderForDefault = useRemoteDraftStore((state) => state.updateProviderForDefault);

  const providerIds = useMemo(() => Object.keys(draft.providers), [draft.providers]);
  const defaultProviderId = providerIds.includes(draft.defaults.provider) ? draft.defaults.provider : providerIds[0] ?? '';
  const defaultProvider = providerDraft(draft, defaultProviderId);
  const modelIds = useMemo(() => Object.keys(defaultProvider.models), [defaultProvider]);
  const defaultModelId = modelIds.includes(draft.defaults.model) ? draft.defaults.model : modelIds[0] ?? '';
  const apiKeyValue = defaultProvider.apiKey.value;
  const apiKeyDisplayValue = isApiKeyFocused ? apiKeyValue : maskApiKey(apiKeyValue);

  async function copyApiKey(): Promise<void> {
    if (apiKeyValue.trim() === '') {
      return;
    }
    await navigator.clipboard.writeText(apiKeyValue);
    setHasCopiedApiKey(true);
    window.setTimeout(() => setHasCopiedApiKey(false), 1200);
  }

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
          <span className="api-key-input-group">
            <input
              id="defaults-quick-api-key"
              type="text"
              value={apiKeyDisplayValue}
              onFocus={() => setIsApiKeyFocused(true)}
              onBlur={() => setIsApiKeyFocused(false)}
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
            <button
              className="icon-action api-key-copy-button"
              type="button"
              onClick={() => {
                void copyApiKey();
              }}
              disabled={apiKeyValue.trim() === '' || isSaving}
              aria-label="复制完整 API Key"
              title={hasCopiedApiKey ? '已复制' : '复制完整 API Key'}
            >
              {hasCopiedApiKey ? <span aria-hidden="true">✓</span> : <CopyIcon />}
            </button>
          </span>
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

function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}••••••••••••${trimmed.slice(-6)}`;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.5 3A2.5 2.5 0 0 1 9 0.5h6A2.5 2.5 0 0 1 17.5 3v6A2.5 2.5 0 0 1 15 11.5h-1.5V13A2.5 2.5 0 0 1 11 15.5H5A2.5 2.5 0 0 1 2.5 13V7A2.5 2.5 0 0 1 5 4.5h1.5V3Zm1.5 1.5H11A2.5 2.5 0 0 1 13.5 7v3H15a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v1.5ZM5 6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5Z"
      />
    </svg>
  );
}
