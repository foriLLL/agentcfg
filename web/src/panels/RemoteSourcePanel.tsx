import type { ReactNode } from 'react';
import { ConnectionPanel, type ConnectionPanelProps } from './ConnectionPanel';
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
 * The component itself is a pass-through. The aggregated props split
 * cleanly into the two inner panel contracts; App.tsx is the only
 * call site and forwards each slice with object spread, keeping prop
 * wiring identical to PR3.
 *
 * PR5 will add a DefaultsQuickEdit row above RemoteConfigPanel and
 * collapse the advanced editor into a <details> block, both inside
 * this component so App.tsx does not grow new responsibilities.
 */
export function RemoteSourcePanel({ connection, editor, heading }: RemoteSourcePanelProps) {
  return (
    <section className="remote-source-panel" aria-label="远端真源">
      {heading}
      <ConnectionPanel {...connection} />
      <RemoteConfigPanel {...editor} />
    </section>
  );
}
