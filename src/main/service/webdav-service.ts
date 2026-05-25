import { WebDAVServer } from 'webdav-server/lib/index.v2';
import { networkInterfaces } from 'os';
import { VersionedFileSystem, SnapshotEvent } from './versioned-file-system';

export interface IPEntry {
  address: string;
  ifName: string;
}

export interface CategorizedIPs {
  lan: IPEntry[];
  tailscale: IPEntry[];
  other: IPEntry[];
}

export interface WebDAVStatus {
  running: boolean;
  port: number;
  vaultPath: string;
  ips: CategorizedIPs;
  error?: string;
}

export type SnapshotHandler = (event: SnapshotEvent) => void;

let server: WebDAVServer | null = null;
let versionedFS: VersionedFileSystem | null = null;
let currentPort = 8080;
let currentVaultPath = '';
let storedSnapshotCallback: SnapshotHandler | undefined;

function getLocalIPs(): CategorizedIPs {
  const result: CategorizedIPs = { lan: [], tailscale: [], other: [] };
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const addr = iface.address;
        const entry: IPEntry = { address: addr, ifName: name };
        if (addr.startsWith('100.')) {
          result.tailscale.push(entry);
        } else if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(addr)) {
          result.lan.push(entry);
        } else {
          result.other.push(entry);
        }
      }
    }
  }
  return result;
}

export function getCurrentVaultPath(): string {
  return currentVaultPath;
}

export function getCurrentPort(): number {
  return currentPort;
}

export function getStoredSnapshotCallback(): SnapshotHandler | undefined {
  return storedSnapshotCallback;
}

export function getStatus(): WebDAVStatus {
  return {
    running: server !== null,
    port: currentPort,
    vaultPath: currentVaultPath,
    ips: getLocalIPs(),
  };
}

export async function startServer(
  vaultPath: string,
  port: number = 8080,
  onSnapshot?: SnapshotHandler,
): Promise<WebDAVStatus> {
  if (server) {
    await stopServer();
    await new Promise(r => setTimeout(r, 500));
  }

  versionedFS = new VersionedFileSystem(vaultPath, vaultPath);

  storedSnapshotCallback = onSnapshot;
  if (onSnapshot) {
    versionedFS.setOnSnapshot(onSnapshot);
  }

  server = new WebDAVServer({
    rootFileSystem: versionedFS,
    port,
    requireAuthentification: false,
    serverName: 'Crystal Sync',
  });

  return new Promise((resolve, reject) => {
    try {
      server!.start(port, () => {
        currentPort = port;
        currentVaultPath = vaultPath;
        console.log(`WebDAV server started on port ${port}, serving ${vaultPath}`);
        resolve(getStatus());
      });
    } catch (e: any) {
      server = null;
      versionedFS = null;
      if (e.code === 'EADDRINUSE') {
        resolve({
          running: false, port, vaultPath,
          ips: { lan: [] as IPEntry[], tailscale: [], other: [] },
          error: `Port ${port} is already in use`,
        });
      } else {
        reject(e);
      }
    }
    setTimeout(() => {
      if (server) {
        currentPort = port;
        currentVaultPath = vaultPath;
        resolve(getStatus());
      }
    }, 2000);
  });
}

export async function stopServer(): Promise<void> {
  if (!server) return;

  const srv = server;
  server = null;
  versionedFS = null;
  currentVaultPath = '';

  return new Promise((resolve) => {
    srv.stop(() => {
      console.log('WebDAV server stopped');
      resolve();
    });
    setTimeout(() => resolve(), 5000);
  });
}
