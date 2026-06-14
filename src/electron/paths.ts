import { join } from 'node:path';

export type ElectronAssetsOptions = {
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
};

export function resolveElectronAssetsDir(options: ElectronAssetsOptions): string {
  if (options.isPackaged) {
    return join(options.resourcesPath, 'web', 'dist');
  }

  return join(options.appPath, 'web', 'dist');
}
