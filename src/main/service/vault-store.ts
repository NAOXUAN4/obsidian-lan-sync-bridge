import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { safeStorage } from 'electron';

export interface VaultPreset {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface WebDAVCredentials {
  username: string;
  password: string;
}

interface VaultData {
  activeId: string | null;
  presets: VaultPreset[];
  webdav?: { username: string; password: string };
}

const STORE_DIR = path.join(os.homedir(), '.crystal-sync');
const STORE_PATH = path.join(STORE_DIR, 'vaults.json');

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function read(): VaultData {
  ensureDir();
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    }
  } catch {}
  return { activeId: null, presets: [] };
}

function write(data: VaultData): void {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export function listVaults(): VaultData {
  return read();
}

export function saveVault(name: string, vaultPath: string): VaultPreset {
  const data = read();
  const preset: VaultPreset = {
    id: crypto.randomUUID(),
    name,
    path: vaultPath,
    createdAt: Date.now(),
  };
  data.presets.push(preset);
  if (!data.activeId) {
    data.activeId = preset.id;
  }
  write(data);
  return preset;
}

export function deleteVault(id: string): void {
  const data = read();
  data.presets = data.presets.filter(p => p.id !== id);
  if (data.activeId === id) {
    data.activeId = data.presets[0]?.id || null;
  }
  write(data);
}

export function setActiveVault(id: string): VaultPreset | null {
  const data = read();
  const preset = data.presets.find(p => p.id === id);
  if (preset) {
    data.activeId = id;
    write(data);
  }
  return preset || null;
}

export function getActiveVault(): VaultPreset | null {
  const data = read();
  return data.presets.find(p => p.id === data.activeId) || null;
}

// ---------------------------------------------------------------------------
// WebDAV credentials
//
// The password is encrypted with Electron's safeStorage when the OS keychain
// is available, otherwise stored as base64 (obfuscation only). Decrypt tries
// safeStorage first and falls back to plain base64, so a store written in one
// environment can still be read in another.
// ---------------------------------------------------------------------------

function encryptSecret(plain: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plain).toString('base64');
    }
  } catch {}
  return Buffer.from(plain, 'utf-8').toString('base64');
}

function decryptSecret(encoded: string): string {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(encoded, 'base64');
      return safeStorage.decryptString(buf);
    }
  } catch {}
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

export function getWebDAVCredentials(): WebDAVCredentials {
  const data = read();
  const c = data.webdav;
  if (c && c.username) {
    return {
      username: c.username,
      password: c.password ? decryptSecret(c.password) : '',
    };
  }
  return { username: '', password: '' };
}

export function saveWebDAVCredentials(credentials: WebDAVCredentials): void {
  const data = read();
  data.webdav = {
    username: (credentials.username || '').trim(),
    password: credentials.password ? encryptSecret(credentials.password) : '',
  };
  write(data);
}
