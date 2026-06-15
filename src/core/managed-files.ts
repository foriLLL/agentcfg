import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteFile, type AtomicWriteFileOptions, type AtomicWriteFileResult } from './atomic-write';
import { type BackupOptions } from './backup';
import { fetchGistFile, GistFileNotFoundError, updateGistFile, type FetchGistOptions } from './gist';
import { isNodeErrorWithCode } from './node-errors';

export const MANAGED_RULE_FILE_IDS = ['codex-agents', 'claude-memory', 'gemini-context'] as const;

export type ManagedRuleFileId = (typeof MANAGED_RULE_FILE_IDS)[number];

export type ManagedRuleFileDefinition = {
  id: ManagedRuleFileId;
  label: string;
  agent: 'codex' | 'claude' | 'gemini';
  gistFileName: string;
  localPath: string;
};

export type ManagedRuleFileStatus = ManagedRuleFileDefinition & {
  local: {
    exists: boolean;
    updatedAt?: string;
    size?: number;
  };
};

export type ManagedRuleFileRemoteState =
  | {
      status: 'available';
      content: string;
    }
  | {
      status: 'missing';
    };

export type ManagedRuleFileRemote = ManagedRuleFileDefinition & {
  remote: ManagedRuleFileRemoteState;
};

export type ManagedRuleFilePlan = ManagedRuleFileDefinition & {
  status: 'would-change' | 'unchanged';
  currentContent?: string;
  expectedContent: string;
};

export type ManagedRuleFileApplyResult = ManagedRuleFileDefinition & {
  status: 'would-change' | 'unchanged' | 'applied' | 'skipped' | 'failed';
  currentContent?: string;
  expectedContent?: string;
  backupPath?: string;
  error?: string;
};

export type ManagedRuleFileWriteOptions = BackupOptions & Pick<AtomicWriteFileOptions, 'beforeRename'>;

type ManagedRuleFileTemplate = Omit<ManagedRuleFileDefinition, 'localPath'> & {
  localPathFromHome(home: string): string;
};

const MANAGED_RULE_FILE_TEMPLATES: readonly ManagedRuleFileTemplate[] = [
  {
    id: 'codex-agents',
    label: 'Codex AGENTS.md',
    agent: 'codex',
    gistFileName: 'AGENTS.md',
    localPathFromHome: (home) => join(home, '.codex', 'AGENTS.md'),
  },
  {
    id: 'claude-memory',
    label: 'Claude Code CLAUDE.md',
    agent: 'claude',
    gistFileName: 'CLAUDE.md',
    localPathFromHome: (home) => join(home, '.claude', 'CLAUDE.md'),
  },
  {
    id: 'gemini-context',
    label: 'Gemini GEMINI.md',
    agent: 'gemini',
    gistFileName: 'GEMINI.md',
    localPathFromHome: (home) => join(home, '.gemini', 'GEMINI.md'),
  },
] as const;

export function listManagedRuleFileDefinitions(home = homedir()): ManagedRuleFileDefinition[] {
  return MANAGED_RULE_FILE_TEMPLATES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    agent: entry.agent,
    gistFileName: entry.gistFileName,
    localPath: entry.localPathFromHome(home),
  }));
}

export function getManagedRuleFileDefinition(id: string, home = homedir()): ManagedRuleFileDefinition {
  const definition = listManagedRuleFileDefinitions(home).find((entry) => entry.id === id);
  if (definition === undefined) {
    throw new ManagedRuleFileError(`Unsupported managed rule file '${id}'.`);
  }
  return definition;
}

export async function getManagedRuleFileStatuses(home = homedir()): Promise<ManagedRuleFileStatus[]> {
  return Promise.all(
    listManagedRuleFileDefinitions(home).map(async (definition) => ({
      ...definition,
      local: await readLocalStatus(definition.localPath),
    })),
  );
}

export async function loadManagedRuleFilesFromGist(
  gistId: string,
  options: FetchGistOptions = {},
  home = homedir(),
): Promise<ManagedRuleFileRemote[]> {
  return Promise.all(
    listManagedRuleFileDefinitions(home).map(async (definition) => ({
      ...definition,
      remote: await readRemoteRuleFile(gistId, definition.gistFileName, options),
    })),
  );
}

export async function uploadManagedRuleFileFromLocal(
  gistId: string,
  id: string,
  options: FetchGistOptions = {},
  home = homedir(),
): Promise<ManagedRuleFileRemote> {
  const definition = getManagedRuleFileDefinition(id, home);
  const content = await readFile(definition.localPath, 'utf8').catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      throw new ManagedRuleFileError(`Missing local rule file at ${definition.localPath}.`);
    }
    throw error;
  });

  await updateGistFile(gistId, definition.gistFileName, content, options);
  return { ...definition, remote: { status: 'available', content } };
}

export async function planManagedRuleFileApply(
  gistId: string,
  ids: readonly string[],
  options: FetchGistOptions = {},
  home = homedir(),
): Promise<ManagedRuleFilePlan[]> {
  const definitions = ids.length === 0
    ? listManagedRuleFileDefinitions(home)
    : ids.map((id) => getManagedRuleFileDefinition(id, home));
  const plans: ManagedRuleFilePlan[] = [];

  for (const definition of definitions) {
    const remote = await readRemoteRuleFile(gistId, definition.gistFileName, options);
    if (remote.status === 'missing') {
      throw new ManagedRuleFileError(`Missing remote rule file ${definition.gistFileName}.`);
    }
    const currentContent = await readOptionalText(definition.localPath);
    plans.push({
      ...definition,
      status: currentContent === remote.content ? 'unchanged' : 'would-change',
      currentContent,
      expectedContent: remote.content,
    });
  }

  return plans;
}

export async function applyManagedRuleFilePlans(
  plans: readonly ManagedRuleFilePlan[],
  options: ManagedRuleFileWriteOptions = {},
): Promise<ManagedRuleFileApplyResult[]> {
  const results: ManagedRuleFileApplyResult[] = [];

  for (const plan of plans) {
    if (plan.status === 'unchanged') {
      results.push({ ...plan, status: 'unchanged' });
      continue;
    }
    try {
      const result = await writeManagedRuleFile(plan, options);
      results.push({ ...plan, status: 'applied', backupPath: result.backup?.backupPath });
    } catch (error) {
      results.push({ ...plan, status: 'failed', error: formatError(error) });
    }
  }

  return results;
}

export async function applyManagedRuleFilesFromGist(
  gistId: string,
  ids: readonly string[],
  options: FetchGistOptions = {},
  writeOptions: ManagedRuleFileWriteOptions = {},
  home = homedir(),
): Promise<ManagedRuleFileApplyResult[]> {
  const definitions = ids.length === 0
    ? listManagedRuleFileDefinitions(home)
    : ids.map((id) => getManagedRuleFileDefinition(id, home));
  const results: ManagedRuleFileApplyResult[] = [];

  for (const definition of definitions) {
    try {
      const remote = await readRemoteRuleFile(gistId, definition.gistFileName, options);
      if (remote.status === 'missing') {
        results.push({ ...definition, status: 'skipped', error: `Missing remote rule file ${definition.gistFileName}.` });
        continue;
      }
      const currentContent = await readOptionalText(definition.localPath);
      const plan: ManagedRuleFilePlan = {
        ...definition,
        status: currentContent === remote.content ? 'unchanged' : 'would-change',
        currentContent,
        expectedContent: remote.content,
      };
      results.push(...await applyManagedRuleFilePlans([plan], writeOptions));
    } catch (error) {
      results.push({ ...definition, status: 'failed', error: formatError(error) });
    }
  }

  return results;
}

export class ManagedRuleFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagedRuleFileError';
  }
}

async function readRemoteRuleFile(
  gistId: string,
  filename: string,
  options: FetchGistOptions,
): Promise<ManagedRuleFileRemote['remote']> {
  try {
    const fetched = await fetchGistFile(gistId, filename, options);
    return { status: 'available', content: fetched.content };
  } catch (error) {
    if (error instanceof GistFileNotFoundError) {
      return { status: 'missing' };
    }
    throw error;
  }
}

async function readLocalStatus(path: string): Promise<ManagedRuleFileStatus['local']> {
  const fileStat = await stat(path).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  });
  return fileStat === undefined
    ? { exists: false }
    : { exists: true, updatedAt: fileStat.mtime.toISOString(), size: fileStat.size };
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

async function writeManagedRuleFile(
  plan: ManagedRuleFilePlan,
  options: ManagedRuleFileWriteOptions,
): Promise<AtomicWriteFileResult> {
  return atomicWriteFile(plan.localPath, plan.expectedContent, { ...options, mode: 0o644 });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
