import { type AtomicWriteFileOptions } from './atomic-write';
import { type BackupOptions } from './backup';

export const MANAGED_AGENT_SKILLS_ID = 'agent-skills';
export const MANAGED_AGENT_SKILLS_GIST_FILE = 'AGENT_SKILLS.json';
export const MANAGED_AGENT_SKILLS_ROOT = '~/.agents/skills';

export type ManagedAgentSkillsDefinition = {
  id: typeof MANAGED_AGENT_SKILLS_ID;
  label: string;
  gistFileName: typeof MANAGED_AGENT_SKILLS_GIST_FILE;
  localPath: string;
};

export type ManagedAgentSkillsManifestFile = {
  path: string;
  encoding: 'utf8' | 'base64';
  content: string;
  mode: number;
};

export type ManagedAgentSkillsManifest = {
  schemaVersion: 1;
  kind: 'agentcfg.agentSkills';
  root: typeof MANAGED_AGENT_SKILLS_ROOT;
  files: ManagedAgentSkillsManifestFile[];
};

export type ManagedAgentSkillsSummary = {
  fileCount: number;
  totalBytes: number;
};

export type ManagedAgentSkillsStatus = ManagedAgentSkillsDefinition & {
  local: {
    exists: boolean;
    updatedAt?: string;
    fileCount: number;
    totalBytes: number;
  };
};

export type ManagedAgentSkillsRemoteState =
  | {
      status: 'available';
      manifest: ManagedAgentSkillsManifest;
      summary: ManagedAgentSkillsSummary;
    }
  | {
      status: 'missing';
    };

export type ManagedAgentSkillsRemote = ManagedAgentSkillsDefinition & {
  remote: ManagedAgentSkillsRemoteState;
};

export type ManagedAgentSkillsOperation = {
  path: string;
  action: 'create' | 'update' | 'delete';
  contentKind: 'text' | 'binary';
  currentContent?: string;
  expectedContent?: string;
  expectedMode?: number;
};

export type ManagedAgentSkillsPlan = ManagedAgentSkillsDefinition & {
  status: 'would-change' | 'unchanged';
  operations: ManagedAgentSkillsOperation[];
};

export type ManagedAgentSkillsApplyResult = ManagedAgentSkillsDefinition & {
  status: 'unchanged' | 'applied' | 'skipped' | 'failed';
  changedCount: number;
  backupPaths: string[];
  error?: string;
};

export type ManagedAgentSkillsWriteOptions = BackupOptions & Pick<AtomicWriteFileOptions, 'beforeRename'>;

export type LocalSkillFile = {
  path: string;
  content: Buffer;
  mode: number;
  updatedAt: string;
};

export type RemoteSkillFile = {
  path: string;
  content: Buffer;
  mode: number;
  contentKind: 'text' | 'binary';
  previewContent: string;
};

export class ManagedAgentSkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedAgentSkillsError';
  }
}
