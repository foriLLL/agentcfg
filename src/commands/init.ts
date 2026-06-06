import { resolveStatePath, storeGistIdentity } from '../core';

export type InitCommandOptions = {
  gistId: string;
  statePath?: string;
};

export async function runInitCommand(options: InitCommandOptions): Promise<string> {
  const state = await storeGistIdentity(options.gistId, options.statePath);
  return [`Initialized agentcfg state`, `Gist: ${state.gist?.id}`, `State: ${resolveStatePath(options.statePath)}`].join(
    '\n',
  );
}
