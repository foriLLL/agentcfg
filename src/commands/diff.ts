import { ADAPTER_NAMES, getAdapter, type AdapterName } from '../adapters';
import { formatAgentDiffResults, readLocalState, type AgentDiffResult } from '../core';

export type RunDiffCommandOptions = {
  agent?: AdapterName;
  allAgents?: boolean;
  configPath?: string;
  statePath?: string;
  fixturesRoot?: string;
};

export async function runDiffCommand(options: RunDiffCommandOptions): Promise<string> {
  const selectedAgents = selectDiffAgents(options);
  const state = await readLocalState(options.statePath);

  if (state.cache === undefined) {
    throw new Error('No cached agentcfg.yaml found. Run agentcfg pull before diff.');
  }

  const results: AgentDiffResult[] = [];
  for (const agent of selectedAgents) {
    results.push(
      await getAdapter(agent).diff(state.cache.config, {
        configPath: options.configPath,
        fixturesRoot: options.fixturesRoot,
      }),
    );
  }

  return formatAgentDiffResults(results);
}

function selectDiffAgents(options: RunDiffCommandOptions): AdapterName[] {
  if (options.agent !== undefined && options.allAgents === true) {
    throw new Error('Choose exactly one target selector: --agent <codex|opencode|openclaw> or --all-agents');
  }

  if (options.agent === undefined && options.allAgents !== true) {
    throw new Error('Choose exactly one target selector: --agent <codex|opencode|openclaw> or --all-agents');
  }

  return options.agent === undefined ? [...ADAPTER_NAMES] : [options.agent];
}
