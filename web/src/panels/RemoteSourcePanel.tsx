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
 * Between the two, DefaultsQuickEdit provides a single-row shortcut
 * for the most common edit (rotate API Key, swap default model). That
 * row is hidden when the draft has no providers yet (e.g. before the
 * first Gist load), since it has no defaults to display.
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
      <RemoteConfigPanel {...editor} />
    </section>
  );
}
