import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { shellExec, getCurrentChildProcess } from './service/shell-service';
import {
  startServer,
  stopServer,
  getStatus,
  getCurrentVaultPath,
  getCurrentPort,
  getStoredSnapshotCallback,
  WebDAVCredentials,
} from './service/webdav-service';
import {
  listVaults,
  saveVault,
  deleteVault,
  setActiveVault,
  getActiveVault,
  getWebDAVCredentials,
  saveWebDAVCredentials,
} from './service/vault-store';

/**
 * Resolve the currently active vault path (running server wins, otherwise the
 * stored active vault). Returns '' when no vault is known.
 */
function resolveVaultPath(): string {
  const running = getCurrentVaultPath();
  if (running) return running;
  return getActiveVault()?.path || '';
}

/**
 * IPC path validation: only paths inside the active vault are allowed.
 * This blocks a compromised renderer from reading/overwriting arbitrary
 * files on disk through sync:readFile / sync:restoreSnapshot / sync:deleteSnapshot.
 */
function isPathInsideVault(target: string): boolean {
  const vaultPath = resolveVaultPath();
  if (!vaultPath) return false;
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

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
  ipcMain.handle('webdav:start', async (_event, vaultPath: string, port?: number, credentials?: WebDAVCredentials) => {
    const status = await startServer(vaultPath, port || 8080, (snapshot) => {
      mainWindow.webContents.send('sync:snapshot', snapshot);
    }, credentials);
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

  ipcMain.handle('webdav:getConfig', async () => {
    return { ok: true, ...getWebDAVCredentials() };
  });

  ipcMain.handle('webdav:saveConfig', async (_event, credentials: WebDAVCredentials) => {
    if (credentials && typeof credentials === 'object') {
      saveWebDAVCredentials(credentials);
    }
    return { ok: true };
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
      await startServer(preset.path, getCurrentPort(), getStoredSnapshotCallback(), getWebDAVCredentials());
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
    const vaultPath = resolveVaultPath();
    if (!vaultPath) return { ok: true, files: [] };
    const historyDir = path.join(vaultPath, '.sync-history');
    const files: { filePath: string; currentPath: string; snapshots: { name: string; path: string; mtime: number }[] }[] = [];

    // Snapshot dirs are named after the original file (with extension), so all
    // snapshot files are collected regardless of extension (not just .md).
    async function walk(dir: string, relPath: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const snapshots: { name: string; path: string; mtime: number }[] = [];
      const subDirs: string[] = [];

      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isFile()) {
          try {
            const st = await fs.stat(full);
            snapshots.push({ name: e.name, path: full, mtime: st.mtimeMs });
          } catch {
            // skip unreadable file
          }
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
        await walk(path.join(dir, sub), path.join(relPath, sub));
      }
    }

    await walk(historyDir, '');
    return { ok: true, files };
  });

  ipcMain.handle('sync:readFile', async (_event, filePath: string) => {
    if (!isPathInsideVault(filePath)) {
      return { ok: false, error: 'Access denied: path is outside the active vault' };
    }
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('sync:restoreSnapshot', async (_event, snapshotPath: string, targetPath: string) => {
    if (!isPathInsideVault(snapshotPath) || !isPathInsideVault(targetPath)) {
      return { ok: false, error: 'Access denied: path is outside the active vault' };
    }
    try {
      await fs.copyFile(snapshotPath, targetPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('sync:deleteSnapshot', async (_event, snapshotPath: string) => {
    if (!isPathInsideVault(snapshotPath)) {
      return { ok: false, error: 'Access denied: path is outside the active vault' };
    }
    try {
      await fs.unlink(snapshotPath);
      // Clean up empty parent dirs (up to but not including the history root)
      const vaultPath = resolveVaultPath();
      const historyDir = vaultPath ? path.join(vaultPath, '.sync-history') : '';
      let dir = path.dirname(snapshotPath);
      while (historyDir && dir.startsWith(historyDir) && dir !== historyDir) {
        try {
          const remaining = await fs.readdir(dir);
          if (remaining.length === 0) {
            await fs.rmdir(dir);
          } else {
            break;
          }
        } catch {
          break;
        }
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
