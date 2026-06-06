import { copyFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export type BackupOptions = {
  now?: () => Date;
  backupDirectory?: string;
};

export type BackupResult = {
  sourcePath: string;
  backupPath: string;
};

export async function createTimestampedBackup(
  sourcePath: string,
  options: BackupOptions = {},
): Promise<BackupResult> {
  const backupPath = buildBackupPath(sourcePath, options);
  await mkdir(dirname(backupPath), { recursive: true });
  await copyFile(sourcePath, backupPath);
  return { sourcePath, backupPath };
}

export async function restoreBackup(backupPath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(backupPath, targetPath);
}

export function buildBackupPath(sourcePath: string, options: BackupOptions = {}): string {
  const timestamp = formatBackupTimestamp((options.now ?? (() => new Date()))());
  const directory = options.backupDirectory ?? dirname(sourcePath);
  return join(directory, `${basename(sourcePath)}.${timestamp}.bak`);
}

export function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '');
}
