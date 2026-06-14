import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { resolveElectronAssetsDir } from '../../src/electron/paths';

type PackageJson = {
  main?: string;
  scripts?: Record<string, string>;
  build?: {
    appId?: string;
    productName?: string;
    files?: string[];
    extraResources?: Array<{ from?: string; to?: string }>;
    directories?: { output?: string };
    mac?: { target?: string[] };
    linux?: { target?: string[] };
    win?: { target?: string[] };
  };
  devDependencies?: Record<string, string>;
};

test('package metadata declares Electron entry, scripts, and distributable targets', async () => {
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as PackageJson;

  assert.equal(packageJson.main, 'dist/src/electron/main.js');
  assert.equal(packageJson.scripts?.['dev:electron'], 'npm run build && npm run build:web && electron .');
  assert.equal(packageJson.scripts?.['dist:dir'], 'npm run build && npm run build:web && electron-builder --dir');
  assert.equal(packageJson.scripts?.dist, 'npm run build && npm run build:web && electron-builder');
  assert.equal(typeof packageJson.devDependencies?.electron, 'string');
  assert.equal(typeof packageJson.devDependencies?.['electron-builder'], 'string');

  assert.equal(packageJson.build?.appId, 'dev.agentcfg.app');
  assert.equal(packageJson.build?.productName, 'agentcfg');
  assert.deepEqual(packageJson.build?.directories, { output: 'release' });
  assert.deepEqual(packageJson.build?.files, ['dist/**/*', 'package.json']);
  assert.deepEqual(packageJson.build?.extraResources, [{ from: 'web/dist', to: 'web/dist' }]);
  assert.deepEqual(packageJson.build?.mac?.target, ['dmg', 'zip']);
  assert.deepEqual(packageJson.build?.linux?.target, ['AppImage', 'deb']);
  assert.deepEqual(packageJson.build?.win?.target, ['nsis', 'zip']);
});

test('Electron asset resolver uses web dist in development and packaged resources in app builds', () => {
  assert.equal(
    resolveElectronAssetsDir({ appPath: '/repo/agentcfg', resourcesPath: '/unused', isPackaged: false }),
    join('/repo/agentcfg', 'web', 'dist'),
  );
  assert.equal(
    resolveElectronAssetsDir({ appPath: '/Applications/agentcfg.app/Contents/Resources/app.asar', resourcesPath: '/Applications/agentcfg.app/Contents/Resources', isPackaged: true }),
    join('/Applications/agentcfg.app/Contents/Resources', 'web', 'dist'),
  );
});

test('Electron main process keeps the embedded web server loopback-only', async () => {
  const mainSource = await readFile(join(process.cwd(), 'src', 'electron', 'main.ts'), 'utf8');

  assert.match(mainSource, /startWebServer\(\{\s*host: '127\.0\.0\.1',\s*port: 0,/s);
  assert.doesNotMatch(mainSource, /process\.env\.[A-Z0-9_]*HOST|--host/);
});
