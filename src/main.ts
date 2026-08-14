import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerIPCHandlers } from './main/ipc-handler';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function createTrayIcon(): Tray {
  let iconPath: string;
  if (app.isPackaged) {
    // exe is at <app>/Crystal Sync.exe, resources at <app>/resources/
    iconPath = path.join(path.dirname(app.getPath('exe')), 'resources', 'favicon.ico');
  } else {
    iconPath = path.resolve(__dirname, '../../assets/icon/favicon.ico');
  }

  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('icon empty');
  } catch {
    // Fallback green dot in case the icon file can't be loaded
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const cx = (i % size) - size / 2;
      const cy = Math.floor(i / size) - size / 2;
      if (Math.sqrt(cx * cx + cy * cy) < size / 2 - 1) {
        canvas[i * 4] = 0x2f;
        canvas[i * 4 + 1] = 0xa7;
        canvas[i * 4 + 2] = 0x00;
        canvas[i * 4 + 3] = 0xff;
      }
    }
    icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  const trayInstance = new Tray(icon);
  trayInstance.setToolTip('Crystal Sync');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  trayInstance.setContextMenu(contextMenu);
  trayInstance.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return trayInstance;
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#d31515ff',
      height: 48,
    },
    autoHideMenuBar: true,
    frame: false,
    hasShadow: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Explicit hardening: renderer never touches Node directly
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Intercept close → hide to tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  registerIPCHandlers(mainWindow);

  return mainWindow;
};

app.on('ready', () => {
  createWindow();
  tray = createTrayIcon();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  // Don't quit — the app lives in the tray
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});
