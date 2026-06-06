import {
  fetchGistAgentConfig,
  maskConfigForOutput,
  parseCanonicalAgentConfig,
  readLocalState,
  resolveStatePath,
  updatePulledConfig,
  type FetchGistOptions,
} from '../core';

export type PullCommandOptions = {
  statePath?: string;
  gistOptions?: FetchGistOptions;
};

export async function runPullCommand(options: PullCommandOptions = {}): Promise<string> {
  const state = await readLocalState(options.statePath);
  if (state.gist === undefined) {
    throw new Error('Run agentcfg init --gist <gist-id> before pull');
  }

  const fetched = await fetchGistAgentConfig(state.gist.id, options.gistOptions);
  const config = parseCanonicalAgentConfig(fetched.content);
  await updatePulledConfig(options.statePath, config, fetched.metadata);

  return [
    `Pulled agentcfg.yaml from Gist ${state.gist.id}`,
    `State: ${resolveStatePath(options.statePath)}`,
    maskConfigForOutput(config),
  ].join('\n');
}
