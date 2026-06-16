import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { decodeSkillContent, previewSkillContent, previewSkillContentKind, encodeSkillContent } from './managed-skills-codec';
import { isNodeErrorWithCode } from './node-errors';
import {
  MANAGED_AGENT_SKILLS_ROOT,
  ManagedAgentSkillsError,
  type LocalSkillFile,
  type ManagedAgentSkillsManifest,
  type ManagedAgentSkillsManifestFile,
  type ManagedAgentSkillsOperation,
  type ManagedAgentSkillsSummary,
  type RemoteSkillFile,
} from './managed-skills-types';

type JsonRecord = Record<string, unknown>;

const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);
const SKIPPED_FILE_NAMES = new Set(['.DS_Store']);

export async function createManagedAgentSkillsManifestFromRoot(root: string): Promise<ManagedAgentSkillsManifest> {
  const files = await readLocalSkillFiles(root);
  return {
    schemaVersion: 1,
    kind: 'agentcfg.agentSkills',
    root: MANAGED_AGENT_SKILLS_ROOT,
    files: files.map((file) => encodeManifestFile(file)),
  };
}

export function serializeManagedAgentSkillsManifest(manifest: ManagedAgentSkillsManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function parseManagedAgentSkillsManifest(content: string): ManagedAgentSkillsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ManagedAgentSkillsError(`Agent skills manifest is not valid JSON: ${formatError(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new ManagedAgentSkillsError('Agent skills manifest must be an object.');
  }
  if (parsed.schemaVersion !== 1) {
    throw new ManagedAgentSkillsError('Agent skills manifest schemaVersion must be 1.');
  }
  if (parsed.kind !== 'agentcfg.agentSkills') {
    throw new ManagedAgentSkillsError('Agent skills manifest kind must be agentcfg.agentSkills.');
  }
  if (parsed.root !== MANAGED_AGENT_SKILLS_ROOT) {
    throw new ManagedAgentSkillsError(`Agent skills manifest root must be ${MANAGED_AGENT_SKILLS_ROOT}.`);
  }
  if (!Array.isArray(parsed.files)) {
    throw new ManagedAgentSkillsError('Agent skills manifest files must be an array.');
  }

  const seen = new Set<string>();
  const files = parsed.files.map((file) => parseManifestFile(file, seen));
  return {
    schemaVersion: 1,
    kind: 'agentcfg.agentSkills',
    root: MANAGED_AGENT_SKILLS_ROOT,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export async function readLocalSkillFiles(root: string): Promise<LocalSkillFile[]> {
  const rootStat = await stat(root).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  });
  if (rootStat === undefined) {
    return [];
  }
  if (!rootStat.isDirectory()) {
    throw new ManagedAgentSkillsError(`${root} exists but is not a directory.`);
  }
  return collectLocalSkillFiles(root, '');
}

export function buildSkillOperations(
  localFiles: Map<string, LocalSkillFile>,
  remoteFiles: Map<string, RemoteSkillFile>,
): ManagedAgentSkillsOperation[] {
  const operations: ManagedAgentSkillsOperation[] = [];
  for (const remoteFile of remoteFiles.values()) {
    const localFile = localFiles.get(remoteFile.path);
    if (localFile === undefined) {
      operations.push(buildCreateOperation(remoteFile));
      continue;
    }
    if (!localFile.content.equals(remoteFile.content) || localFile.mode !== remoteFile.mode) {
      operations.push(buildUpdateOperation(localFile, remoteFile));
    }
  }
  for (const localFile of localFiles.values()) {
    if (!remoteFiles.has(localFile.path)) {
      operations.push(buildDeleteOperation(localFile));
    }
  }
  return operations.sort((left, right) => left.path.localeCompare(right.path));
}

export function toLocalFileMap(files: readonly LocalSkillFile[]): Map<string, LocalSkillFile> {
  return new Map(files.map((file) => [file.path, file]));
}

export function toRemoteFileMap(manifest: ManagedAgentSkillsManifest): Map<string, RemoteSkillFile> {
  return new Map(manifest.files.map((file) => [file.path, decodeManifestFile(file)]));
}

export function summarizeManifest(manifest: ManagedAgentSkillsManifest): ManagedAgentSkillsSummary {
  return {
    fileCount: manifest.files.length,
    totalBytes: manifest.files.reduce((total, file) => total + decodeSkillContent(file).byteLength, 0),
  };
}

export function summarizeLocalFiles(files: readonly LocalSkillFile[]): ManagedAgentSkillsSummary & { updatedAt?: string } {
  return {
    updatedAt: files.map((file) => file.updatedAt).sort().at(-1),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.content.byteLength, 0),
  };
}

export function localPathForOperation(root: string, relativePath: string): string {
  return join(root, ...normalizeManifestPath(relativePath).split('/'));
}

async function collectLocalSkillFiles(root: string, relativeDirectory: string): Promise<LocalSkillFile[]> {
  const directory = relativeDirectory === '' ? root : join(root, ...relativeDirectory.split('/'));
  const entries = await readdir(directory, { withFileTypes: true });
  const files: LocalSkillFile[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        files.push(...await collectLocalSkillFiles(root, joinRelativePath(relativeDirectory, entry.name)));
      }
      continue;
    }
    if (!entry.isFile() || SKIPPED_FILE_NAMES.has(entry.name)) {
      continue;
    }
    const relativePath = joinRelativePath(relativeDirectory, entry.name);
    const filePath = join(root, ...relativePath.split('/'));
    const fileStat = await stat(filePath);
    files.push({
      path: relativePath,
      content: await readFile(filePath),
      mode: fileStat.mode & 0o777,
      updatedAt: fileStat.mtime.toISOString(),
    });
  }

  return files;
}

function buildCreateOperation(remoteFile: RemoteSkillFile): ManagedAgentSkillsOperation {
  return {
    path: remoteFile.path,
    action: 'create',
    contentKind: remoteFile.contentKind,
    expectedContent: remoteFile.previewContent,
    expectedMode: remoteFile.mode,
  };
}

function buildUpdateOperation(localFile: LocalSkillFile, remoteFile: RemoteSkillFile): ManagedAgentSkillsOperation {
  return {
    path: remoteFile.path,
    action: 'update',
    contentKind: remoteFile.contentKind,
    currentContent: previewSkillContent(localFile.content),
    expectedContent: remoteFile.previewContent,
    expectedMode: remoteFile.mode,
  };
}

function buildDeleteOperation(localFile: LocalSkillFile): ManagedAgentSkillsOperation {
  return {
    path: localFile.path,
    action: 'delete',
    contentKind: previewSkillContentKind(localFile.content),
    currentContent: previewSkillContent(localFile.content),
  };
}

function encodeManifestFile(file: LocalSkillFile): ManagedAgentSkillsManifestFile {
  const encoded = encodeSkillContent(file.content);
  return {
    path: file.path,
    encoding: encoded.encoding,
    content: encoded.content,
    mode: file.mode,
  };
}

function parseManifestFile(value: unknown, seen: Set<string>): ManagedAgentSkillsManifestFile {
  if (!isRecord(value)) {
    throw new ManagedAgentSkillsError('Agent skills manifest file entries must be objects.');
  }
  if (typeof value.path !== 'string') {
    throw new ManagedAgentSkillsError('Agent skills manifest file path must be a string.');
  }
  const path = normalizeManifestPath(value.path);
  if (seen.has(path)) {
    throw new ManagedAgentSkillsError(`Agent skills manifest contains duplicate path ${path}.`);
  }
  seen.add(path);
  return parseManifestFileBody(value, path);
}

function parseManifestFileBody(value: JsonRecord, path: string): ManagedAgentSkillsManifestFile {
  if (value.encoding !== 'utf8' && value.encoding !== 'base64') {
    throw new ManagedAgentSkillsError(`Agent skills manifest file ${path} has unsupported encoding.`);
  }
  if (typeof value.content !== 'string') {
    throw new ManagedAgentSkillsError(`Agent skills manifest file ${path} content must be a string.`);
  }
  if (typeof value.mode !== 'number' || !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777) {
    throw new ManagedAgentSkillsError(`Agent skills manifest file ${path} mode must be an integer file mode.`);
  }
  return { path, encoding: value.encoding, content: value.content, mode: value.mode };
}

function decodeManifestFile(file: ManagedAgentSkillsManifestFile): RemoteSkillFile {
  const content = decodeSkillContent(file);
  return {
    path: file.path,
    content,
    mode: file.mode,
    contentKind: previewSkillContentKind(content),
    previewContent: previewSkillContent(content),
  };
}

function joinRelativePath(base: string, name: string): string {
  return base === '' ? normalizeManifestPath(name) : normalizeManifestPath(`${base}/${name}`);
}

function normalizeManifestPath(input: string): string {
  const normalized = posix.normalize(input.replace(/\\/g, '/'));
  if (isUnsafeManifestPath(normalized)) {
    throw new ManagedAgentSkillsError(`Unsafe agent skills path ${input}.`);
  }
  return normalized;
}

function isUnsafeManifestPath(path: string): boolean {
  return path === '' || path === '.' || path === '..' || path.startsWith('../') || path.startsWith('/') || path.includes('\u0000');
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
