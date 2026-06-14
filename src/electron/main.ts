import { app, BrowserWindow } from 'electron';
import { startWebServer, type AgentCfgWebServer } from '../server';
import { resolveElectronAssetsDir } from './paths';

let server: AgentCfgWebServer | undefined;
let mainWindow: BrowserWindow | undefined;

async function createMainWindow(): Promise<void> {
  if (server === undefined) {
    server = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      assetsDir: resolveElectronAssetsDir({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
      }),
    });
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  await mainWindow.loadURL(server.url);
}

app.whenReady().then(() => {
  void createMainWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server !== undefined) {
    const currentServer = server;
    server = undefined;
    void currentServer.close();
  }
});
