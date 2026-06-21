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
 * "远端真源" tab content.
 *
 * Composes the existing ConnectionPanel + RemoteConfigPanel into a
 * single tab so users see one page for "connect to Gist + edit
 * agentcfg.yaml" instead of two separate destinations. Both inner
 * panels keep their existing DOM ids (#connection-panel / #setup-panel
 * / #remote-panel) so deep links and the GUI test selectors continue
 * to work.
 *
 * Layout from top to bottom:
 *
 *   1. ConnectionPanel        Gist connection + token form
 *   2. DefaultsQuickEdit       one-liner: default provider/model/key
 *   3. <details> 详细编辑      collapsed by default; full RemoteConfigPanel
 *
 * The advanced editor lives inside a <details> block so users can
 * collapse it once they have set their defaults. The GUI flow test
 * now expands the section explicitly before touching the advanced
 * fields.
 *
 * The component itself is a pass-through. The aggregated props split
 * cleanly into the two inner panel contracts; App.tsx is the only
 * call site and forwards each slice with object spread, keeping prop
 * wiring identical to PR3.
 */
export function RemoteSourcePanel({ connection, editor, heading }: RemoteSourcePanelProps) {
  const hasProviders = Object.keys(editor.remoteDraft.providers).length > 0;

  return (
    <section className="remote-source-panel" aria-label="远端真源">
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
