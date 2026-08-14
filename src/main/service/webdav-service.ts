import {
  WebDAVServer,
  SimpleUser,
  SimpleUserManager,
  HTTPBasicAuthentication,
  SimplePathPrivilegeManager,
  Errors,
} from 'webdav-server/lib/index.v2';
import { networkInterfaces } from 'os';
import * as net from 'net';
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

export interface WebDAVCredentials {
  username: string;
  password: string;
}

export interface WebDAVStatus {
  running: boolean;
  port: number;
  vaultPath: string;
  ips: CategorizedIPs;
  auth: boolean;
  error?: string;
}

export type SnapshotHandler = (event: SnapshotEvent) => void;

const AUTH_REALM = 'Crystal Sync';

/**
 * Basic Auth with a corrected Authorization-header parser.
 *
 * webdav-server 2.6.2's stock HTTPBasicAuthentication rejects any header whose
 * base64 contains '+' or '/' (regex only allows [a-zA-Z0-9]=), which turns
 * correct credentials into 401 for a large share of real passwords. This
 * subclass replaces getUser() with a standards-compliant check.
 */
class CrystalBasicAuthentication extends HTTPBasicAuthentication {
  override getUser(ctx: any, callback: any): void {
    const authHeader = ctx?.headers?.find?.('Authorization');
    if (!authHeader) {
      this.fail(callback, Errors.MissingAuthorisationHeader);
      return;
    }
    // Standard base64: A-Z a-z 0-9 + / with up to two '=' padding chars.
    const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(authHeader);
    if (!match) {
      this.fail(callback, Errors.WrongHeaderFormat);
      return;
    }
    const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx < 0) {
      this.fail(callback, Errors.WrongHeaderFormat);
      return;
    }
    const username = decoded.slice(0, idx);
    const password = decoded.slice(idx + 1);
    (this.userManager as any).getUserByNamePassword(username, password, (e: any, user: any) => {
      if (e) {
        console.warn(`[webdav] authentication failed for user "${username}"`);
        this.fail(callback, Errors.BadAuthentication);
      } else {
        callback(null, user);
      }
    });
  }

  private fail(callback: any, error: any): void {
    (this.userManager as any).getDefaultUser((defaultUser: any) => {
      callback(error, defaultUser);
    });
  }
}

let server: WebDAVServer | null = null;
let versionedFS: VersionedFileSystem | null = null;
let currentPort = 8080;
let currentVaultPath = '';
let authEnabled = false;
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
    auth: authEnabled,
  };
}

/**
 * Probe whether a TCP port is already bound. The WebDAVServer emits
 * EADDRINUSE asynchronously from listen(), which the start() callback
 * cannot reliably observe — probing first gives a deterministic result.
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => {
      probe.close(() => resolve(false));
    });
    probe.listen(port, '0.0.0.0');
  });
}

function emptyStatus(port: number, vaultPath: string, error?: string): WebDAVStatus {
  return {
    running: false,
    port,
    vaultPath,
    ips: { lan: [], tailscale: [], other: [] },
    auth: false,
    error,
  };
}

export async function startServer(
  vaultPath: string,
  port: number = 8080,
  onSnapshot?: SnapshotHandler,
  credentials?: WebDAVCredentials,
): Promise<WebDAVStatus> {
  if (server) {
    await stopServer();
    await new Promise(r => setTimeout(r, 500));
  }

  if (await isPortInUse(port)) {
    return emptyStatus(port, vaultPath, `Port ${port} is already in use`);
  }

  versionedFS = new VersionedFileSystem(vaultPath, vaultPath);

  storedSnapshotCallback = onSnapshot;
  if (onSnapshot) {
    versionedFS.setOnSnapshot(onSnapshot);
  }

  const hasCredentials = !!(credentials && credentials.username && credentials.password);
  const opts: any = {
    rootFileSystem: versionedFS,
    port,
    serverName: 'Crystal Sync',
  };

  if (hasCredentials) {
    // Basic Auth + per-user rights.
    // NOTE: SimpleUserManager.addUser(name, password, isAdmin) takes positional
    // args — passing a SimpleUser object would key the store by "[object Object]"
    // and fail every login with 401.
    const user = new SimpleUser(credentials!.username, credentials!.password);
    const userManager = new SimpleUserManager();
    userManager.addUser(credentials!.username, credentials!.password);
    const privilegeManager = new SimplePathPrivilegeManager();
    privilegeManager.setRights(user, '/', ['all']);

    opts.requireAuthentification = true;
    opts.httpAuthentication = new CrystalBasicAuthentication(userManager, AUTH_REALM);
    opts.privilegeManager = privilegeManager;
  } else {
    opts.requireAuthentification = false;
  }

  server = new WebDAVServer(opts);
  authEnabled = hasCredentials;

  return new Promise((resolve) => {
    try {
      server!.start(port, () => {
        currentPort = port;
        currentVaultPath = vaultPath;
        console.log(`WebDAV server started on port ${port}, serving ${vaultPath} (auth: ${hasCredentials})`);
        resolve(getStatus());
      });
    } catch (e: any) {
      server = null;
      versionedFS = null;
      authEnabled = false;
      resolve(emptyStatus(port, vaultPath, String(e?.message || e)));
    }
  });
}

export async function stopServer(): Promise<void> {
  if (!server) return;

  const srv = server;
  server = null;
  versionedFS = null;
  currentVaultPath = '';
  authEnabled = false;

  return new Promise((resolve) => {
    srv.stop(() => {
      console.log('WebDAV server stopped');
      resolve();
    });
    setTimeout(() => resolve(), 5000);
  });
}
