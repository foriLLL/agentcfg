import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createTimestampedBackup, type BackupOptions, type BackupResult } from './backup';
import { isNodeErrorWithCode } from './node-errors';

export type AtomicWriteFileOptions = BackupOptions & {
  mode?: number;
  createBackup?: boolean;
  beforeRename?: (tempPath: string, targetPath: string) => void | Promise<void>;
};

export type AtomicWriteFileResult = {
  path: string;
  backup?: BackupResult;
};

export async function atomicWriteFile(
  targetPath: string,
  content: string | Buffer,
  options: AtomicWriteFileOptions = {},
): Promise<AtomicWriteFileResult> {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });

  const backup = options.createBackup === false ? undefined : await backupExistingTarget(targetPath, options);
  const tempPath = buildTempPath(targetPath);
  let renamed = false;

  try {
    await writeFile(tempPath, content, { mode: options.mode });
    if (options.mode !== undefined) {
      await chmod(tempPath, options.mode);
    }
    await options.beforeRename?.(tempPath, targetPath);
    await rename(tempPath, targetPath);
    renamed = true;
    if (options.mode !== undefined) {
      await chmod(targetPath, options.mode);
    }
    return { path: targetPath, backup };
  } finally {
    if (!renamed) {
      await removeTempFileIfPresent(tempPath);
    }
  }
}

function buildTempPath(targetPath: string): string {
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  return join(dirname(targetPath), `.${basename(targetPath)}.${unique}.tmp`);
}

async function backupExistingTarget(
  targetPath: string,
  options: BackupOptions,
): Promise<BackupResult | undefined> {
  if (!(await fileExists(targetPath))) {
    return undefined;
  }
  return createTimestampedBackup(targetPath, options);
}

async function removeTempFileIfPresent(tempPath: string): Promise<void> {
  try {
    await rm(tempPath, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}
