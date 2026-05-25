import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { shellExec, getCurrentChildProcess } from './service/shell-service';
import { startServer, stopServer, getStatus, getCurrentVaultPath, getCurrentPort, getStoredSnapshotCallback } from './service/webdav-service';
import { listVaults, saveVault, deleteVault, setActiveVault, getActiveVault } from './service/vault-store';

export function registerIPCHandlers(mainWindow: BrowserWindow) {
  /// --------------------------------------- invoke -----------------------------------

  // shell
  ipcMain.handle('shell:exec', async (_event, command: string) => {
    shellExec(mainWindow, command);
    return { ok: true, from: 'shell:exec' };
  });

  ipcMain.handle('shell:interrupt', async () => {
    try {
      const child = getCurrentChildProcess();
      if (child && !child.killed) {
        console.log('Interrupting current command');
        if (process.platform === 'win32') {
          child.kill();
        } else {
          process.kill(child.pid, 'SIGINT');
        }
        return { ok: true, message: 'Command interrupted' };
      }
      return { ok: false, message: 'No active command to interrupt' };
    } catch (error) {
      console.error('Failed to interrupt command:', error);
      return { ok: false, error: String(error) };
    }
  });

  // window
  ipcMain.handle('sys:closeWindow', async () => {
    mainWindow.close();
    return { ok: true, status: 'close' };
  });

  ipcMain.handle('sys:maximizeWindow', async () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return { ok: true, status: 'unmaximize' };
    } else {
      mainWindow.maximize();
      return { ok: true, status: 'maximize' };
    }
  });

  ipcMain.handle('sys:minimizeWindow', async () => {
    mainWindow.minimize();
    return { ok: true, status: 'minimize' };
  });

  ipcMain.handle('app:showWindow', async () => {
    mainWindow.show();
    mainWindow.focus();
    return { ok: true };
  });

  ipcMain.handle('app:quit', async () => {
    app.quit();
    return { ok: true };
  });

  // webdav
  ipcMain.handle('webdav:start', async (_event, vaultPath: string, port?: number) => {
    const status = await startServer(vaultPath, port || 8080, (snapshot) => {
      mainWindow.webContents.send('sync:snapshot', snapshot);
    });
    mainWindow.webContents.send('webdav:statusChanged', status);
    return { ok: true, status };
  });

  ipcMain.handle('webdav:stop', async () => {
    await stopServer();
    const status = getStatus();
    mainWindow.webContents.send('webdav:statusChanged', status);
    return { ok: true, status };
  });

  ipcMain.handle('webdav:status', async () => {
    return { ok: true, status: getStatus() };
  });

  // vault management
  ipcMain.handle('vault:list', async () => {
    const data = listVaults();
    return { ok: true, presets: data.presets, activeId: data.activeId };
  });

  ipcMain.handle('vault:save', async (_event, name: string, vaultPath: string) => {
    const preset = saveVault(name, vaultPath);
    return { ok: true, preset };
  });

  ipcMain.handle('vault:delete', async (_event, id: string) => {
    deleteVault(id);
    return { ok: true };
  });

  ipcMain.handle('vault:setActive', async (_event, id: string) => {
    const preset = setActiveVault(id);
    if (preset && getStatus().running) {
      await startServer(preset.path, getCurrentPort(), getStoredSnapshotCallback());
    }
    return { ok: true, preset };
  });

  ipcMain.handle('vault:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  // sync history
  ipcMain.handle('sync:listSnapshots', async () => {
    let vaultPath = getCurrentVaultPath();
    if (!vaultPath) {
      const active = getActiveVault();
      if (active) vaultPath = active.path;
    }
    if (!vaultPath) return { ok: true, files: [] };
    const historyDir = path.join(vaultPath, '.sync-history');
    const files: { filePath: string; currentPath: string; snapshots: { name: string; path: string; mtime: number }[] }[] = [];

    function walk(dir: string, relPath: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const snapshots: { name: string; path: string; mtime: number }[] = [];
      const subDirs: string[] = [];

      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          snapshots.push({
            name: e.name,
            path: path.join(dir, e.name),
            mtime: fs.statSync(path.join(dir, e.name)).mtimeMs,
          });
        } else if (e.isDirectory()) {
          subDirs.push(e.name);
        }
      }

      if (snapshots.length > 0) {
        files.push({
          filePath: relPath,
          currentPath: path.join(vaultPath, relPath),
          snapshots: snapshots.sort((a, b) => b.mtime - a.mtime),
        });
      }

      for (const sub of subDirs) {
        walk(path.join(dir, sub), path.join(relPath, sub));
      }
    }

    walk(historyDir, '');
    return { ok: true, files };
  });

  ipcMain.handle('sync:readFile', async (_event, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('sync:restoreSnapshot', async (_event, snapshotPath: string, targetPath: string) => {
    try {
      fs.copyFileSync(snapshotPath, targetPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('sync:deleteSnapshot', async (_event, snapshotPath: string) => {
    try {
      fs.unlinkSync(snapshotPath);
      let dir = path.dirname(snapshotPath);
      const historyDir = path.join(getCurrentVaultPath(), '.sync-history');
      while (dir.startsWith(historyDir) && dir !== historyDir) {
        try {
          if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
          else break;
        } catch { break; }
        dir = path.dirname(dir);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  /// --------------------------------------- on ---------------------------------------

  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow.webContents.send('webdav:statusChanged', getStatus());
    } catch (e) {
      console.warn('failed to send webdav:statusChanged', e);
    }
  });
}
