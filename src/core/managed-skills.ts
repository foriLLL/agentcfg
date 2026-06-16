import { chmod, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile } from './atomic-write';
import { createTimestampedBackup } from './backup';
import { fetchGistFile, GistFileNotFoundError, updateGistFile, type FetchGistOptions } from './gist';
import { decodeOperationExpectedFile } from './managed-skills-codec';
import {
  buildSkillOperations,
  createManagedAgentSkillsManifestFromRoot,
  localPathForOperation,
  parseManagedAgentSkillsManifest,
  readLocalSkillFiles,
  serializeManagedAgentSkillsManifest,
  summarizeLocalFiles,
  summarizeManifest,
  toLocalFileMap,
  toRemoteFileMap,
} from './managed-skills-manifest';
import {
  MANAGED_AGENT_SKILLS_GIST_FILE,
  MANAGED_AGENT_SKILLS_ID,
  ManagedAgentSkillsError,
  type ManagedAgentSkillsApplyResult,
  type ManagedAgentSkillsDefinition,
  type ManagedAgentSkillsManifest,
  type ManagedAgentSkillsPlan,
  type ManagedAgentSkillsRemote,
  type ManagedAgentSkillsRemoteState,
  type ManagedAgentSkillsStatus,
  type ManagedAgentSkillsWriteOptions,
} from './managed-skills-types';
import { isNodeErrorWithCode } from './node-errors';

export {
  MANAGED_AGENT_SKILLS_GIST_FILE,
  MANAGED_AGENT_SKILLS_ID,
  MANAGED_AGENT_SKILLS_ROOT,
  ManagedAgentSkillsError,
  type ManagedAgentSkillsApplyResult,
  type ManagedAgentSkillsDefinition,
  type ManagedAgentSkillsManifest,
  type ManagedAgentSkillsManifestFile,
  type ManagedAgentSkillsOperation,
  type ManagedAgentSkillsPlan,
  type ManagedAgentSkillsRemote,
  type ManagedAgentSkillsRemoteState,
  type ManagedAgentSkillsStatus,
  type ManagedAgentSkillsSummary,
  type ManagedAgentSkillsWriteOptions,
} from './managed-skills-types';
export { parseManagedAgentSkillsManifest, serializeManagedAgentSkillsManifest } from './managed-skills-manifest';

export function getManagedAgentSkillsDefinition(home = homedir()): ManagedAgentSkillsDefinition {
  return {
    id: MANAGED_AGENT_SKILLS_ID,
    label: 'Agent Skills',
    gistFileName: MANAGED_AGENT_SKILLS_GIST_FILE,
    localPath: join(home, '.agents', 'skills'),
  };
}

export async function getManagedAgentSkillsStatus(home = homedir()): Promise<ManagedAgentSkillsStatus> {
  const definition = getManagedAgentSkillsDefinition(home);
  const directoryStat = await stat(definition.localPath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  });
  if (directoryStat === undefined) {
    return { ...definition, local: { exists: false, fileCount: 0, totalBytes: 0 } };
  }
  if (!directoryStat.isDirectory()) {
    throw new ManagedAgentSkillsError(`${definition.localPath} exists but is not a directory.`);
  }
  const files = await readLocalSkillFiles(definition.localPath);
  return { ...definition, local: { exists: true, ...summarizeLocalFiles(files) } };
}

export async function loadManagedAgentSkillsFromGist(
  gistId: string,
  options: FetchGistOptions = {},
  home = homedir(),
): Promise<ManagedAgentSkillsRemote> {
  const definition = getManagedAgentSkillsDefinition(home);
  return { ...definition, remote: await readRemoteAgentSkills(gistId, options) };
}

export async function uploadManagedAgentSkillsFromLocal(
  gistId: string,
  options: FetchGistOptions = {},
  home = homedir(),
): Promise<ManagedAgentSkillsRemote> {
  const definition = getManagedAgentSkillsDefinition(home);
  const manifest = await createManagedAgentSkillsManifest(home);
  await updateGistFile(gistId, definition.gistFileName, serializeManagedAgentSkillsManifest(manifest), options);
  return {
    ...definition,
    remote: { status: 'available', manifest, summary: summarizeManifest(manifest) },
  };
}

export async function createManagedAgentSkillsManifest(home = homedir()): Promise<ManagedAgentSkillsManifest> {
  const definition = getManagedAgentSkillsDefinition(home);
  return createManagedAgentSkillsManifestFromRoot(definition.localPath);
}

export async function planManagedAgentSkillsApply(
  gistId: string,
  options: FetchGistOptions = {},
  home = homedir(),
): Promise<ManagedAgentSkillsPlan> {
  const definition = getManagedAgentSkillsDefinition(home);
  const remote = await readRemoteAgentSkills(gistId, options);
  if (remote.status === 'missing') {
    throw new ManagedAgentSkillsError(`Missing remote agent skills manifest ${definition.gistFileName}.`);
  }
  const localFiles = toLocalFileMap(await readLocalSkillFiles(definition.localPath));
  const remoteFiles = toRemoteFileMap(remote.manifest);
  const operations = buildSkillOperations(localFiles, remoteFiles);
  return { ...definition, status: operations.length === 0 ? 'unchanged' : 'would-change', operations };
}

export async function applyManagedAgentSkillsPlan(
  plan: ManagedAgentSkillsPlan,
  options: ManagedAgentSkillsWriteOptions = {},
): Promise<ManagedAgentSkillsApplyResult> {
  if (plan.status === 'unchanged') {
    return { ...plan, status: 'unchanged', changedCount: 0, backupPaths: [] };
  }

  const backupPaths: string[] = [];
  try {
    for (const operation of plan.operations) {
      const targetPath = localPathForOperation(plan.localPath, operation.path);
      if (operation.action === 'delete') {
        const backup = await createTimestampedBackup(targetPath, options);
        backupPaths.push(backup.backupPath);
        await rm(targetPath, { force: true });
        continue;
      }
      const remoteFile = decodeOperationExpectedFile(operation);
      const result = await atomicWriteFile(targetPath, remoteFile.content, { ...options, mode: remoteFile.mode });
      if (result.backup !== undefined) {
        backupPaths.push(result.backup.backupPath);
      }
      await chmod(targetPath, remoteFile.mode);
    }
    return { ...plan, status: 'applied', changedCount: plan.operations.length, backupPaths };
  } catch (error) {
    return { ...plan, status: 'failed', changedCount: plan.operations.length, backupPaths, error: formatError(error) };
  }
}

export async function applyManagedAgentSkillsFromGist(
  gistId: string,
  options: FetchGistOptions = {},
  writeOptions: ManagedAgentSkillsWriteOptions = {},
  home = homedir(),
): Promise<ManagedAgentSkillsApplyResult> {
  const definition = getManagedAgentSkillsDefinition(home);
  try {
    const remote = await readRemoteAgentSkills(gistId, options);
    if (remote.status === 'missing') {
      return {
        ...definition,
        status: 'skipped',
        changedCount: 0,
        backupPaths: [],
        error: `Missing remote agent skills manifest ${definition.gistFileName}.`,
      };
    }
    return await applyManagedAgentSkillsPlan(await planManagedAgentSkillsApply(gistId, options, home), writeOptions);
  } catch (error) {
    return { ...definition, status: 'failed', changedCount: 0, backupPaths: [], error: formatError(error) };
  }
}

async function readRemoteAgentSkills(gistId: string, options: FetchGistOptions): Promise<ManagedAgentSkillsRemoteState> {
  try {
    const fetched = await fetchGistFile(gistId, MANAGED_AGENT_SKILLS_GIST_FILE, options);
    const manifest = parseManagedAgentSkillsManifest(fetched.content);
    return { status: 'available', manifest, summary: summarizeManifest(manifest) };
  } catch (error) {
    if (error instanceof GistFileNotFoundError) {
      return { status: 'missing' };
    }
    throw error;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
