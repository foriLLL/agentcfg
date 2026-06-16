import { useEffect, useState } from 'react';
import {
  getManagedRuleFilesRuntime,
  getSyncServiceRuntime,
  type RuntimeStateSummary,
  type SyncServiceStatus,
} from './api';
import { getManagedAgentSkillsRuntime } from './skills-api';

export type CommandCenterStatusSnapshot = {
  readonly isLoading: boolean;
  readonly error?: string;
  readonly ruleFiles?: {
    readonly totalCount: number;
    readonly existingCount: number;
  };
  readonly skills?: {
    readonly exists: boolean;
    readonly fileCount: number;
    readonly totalBytes: number;
  };
  readonly service?: SyncServiceStatus;
};

type UseCommandCenterStatusOptions = {
  readonly loadState: 'loading' | 'ready' | 'error';
  readonly requestStatePath: string | undefined;
  readonly onState: (state: RuntimeStateSummary) => void;
};

export function useCommandCenterStatus(options: UseCommandCenterStatusOptions): CommandCenterStatusSnapshot {
  const [snapshot, setSnapshot] = useState<CommandCenterStatusSnapshot>({ isLoading: false });

  useEffect(() => {
    if (options.loadState !== 'ready') {
      setSnapshot({ isLoading: false });
      return;
    }

    let active = true;
    setSnapshot((current) => ({ ...current, isLoading: true, error: undefined }));

    void loadCommandCenterStatus(options.requestStatePath, options.onState)
      .then((nextSnapshot) => {
        if (active) {
          setSnapshot({ ...nextSnapshot, isLoading: false });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSnapshot({ isLoading: false, error: formatUnknownError(error) });
        }
      });

    return () => {
      active = false;
    };
  }, [options.loadState, options.requestStatePath]);

  return snapshot;
}

async function loadCommandCenterStatus(
  statePath: string | undefined,
  onState: (state: RuntimeStateSummary) => void,
): Promise<Omit<CommandCenterStatusSnapshot, 'isLoading' | 'error'>> {
  const [ruleFiles, skills, service] = await Promise.all([
    getManagedRuleFilesRuntime({ statePath }),
    getManagedAgentSkillsRuntime({ statePath }),
    getSyncServiceRuntime({ statePath }),
  ]);

  onState(ruleFiles.state);
  onState(skills.state);
  onState(service.state);

  return {
    ruleFiles: {
      totalCount: ruleFiles.files.length,
      existingCount: ruleFiles.files.filter((file) => file.local.exists).length,
    },
    skills: {
      exists: skills.skills.local.exists,
      fileCount: skills.skills.local.fileCount,
      totalBytes: skills.skills.local.totalBytes,
    },
    service: service.service,
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
