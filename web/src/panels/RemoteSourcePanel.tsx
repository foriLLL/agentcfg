import type { ReactNode } from 'react';
import { ConnectionPanel, type ConnectionPanelProps } from './ConnectionPanel';
import { DefaultsQuickEdit } from './DefaultsQuickEdit';
import { RemoteConfigPanel, type RemoteConfigPanelProps } from './RemoteConfigPanel';

export type RemoteSourcePanelProps = {
  readonly heading?: ReactNode;
  readonly connection: ConnectionPanelProps;
  readonly editor: RemoteConfigPanelProps;
};

/**
 * "配置" tab content.
 *
 * Composes ConnectionPanel, DefaultsQuickEdit, and RemoteConfigPanel
 * into one page so users can connect Gist and edit agentcfg.yaml
 * without leaving the redesigned Configuration section. The advanced
 * editor remains collapsed by default and is expanded only when needed.
 */
export function RemoteSourcePanel({ connection, editor, heading }: RemoteSourcePanelProps) {
  const hasProviders = Object.keys(editor.remoteDraft.providers).length > 0;

  return (
    <section className="remote-source-panel" aria-label="配置">
      {heading}
      <ConnectionPanel {...connection} />
      {hasProviders && (
        <DefaultsQuickEdit
          draft={editor.remoteDraft}
          isSaving={editor.isSavingRemote}
          onSave={editor.onSaveRemoteConfig}
        />
      )}
      <details className="remote-source-panel__advanced">
        <summary>
          <span>详细编辑</span>
          <small>列出所有 providers / models / OhMyOpenAgent 映射，并提供 YAML 预览与 schema 参考。可折叠以聚焦默认设定。</small>
        </summary>
        <RemoteConfigPanel {...editor} />
      </details>
    </section>
  );
}
