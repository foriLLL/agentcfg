import type { AgentName } from './api';

const AGENT_CONFIG_ICON_PATHS = {
  codex: ['M5 5h14v14H5z', 'M8 10l3 2-3 2', 'M13 15h3'],
  opencode: ['M9 7l-4 5 4 5', 'M15 7l4 5-4 5', 'M12 6l-2 12'],
  openclaw: ['M6 17c2-6 2-8 0-11', 'M12 18c1-6 1-9 0-13', 'M18 17c-2-6-2-8 0-11'],
  claude: ['M7 5h10l2 4v10H5V9z', 'M7 5v4h12', 'M9 13h6'],
  ohmyopenagent: ['M6 12h4', 'M14 12h4', 'M10 8l4 4-4 4', 'M5 5h4v4H5z', 'M15 15h4v4h-4z'],
} as const satisfies Record<AgentName, readonly string[]>;

type AgentConfigIconProps = {
  readonly agent: AgentName;
};

export function AgentConfigIcon({ agent }: AgentConfigIconProps) {
  return (
    <svg className="agent-config-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {AGENT_CONFIG_ICON_PATHS[agent].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}
