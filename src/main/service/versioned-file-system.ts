import { PhysicalFileSystem } from 'webdav-server/lib/index.v2';
import * as fs from 'fs';
import * as path from 'path';

export interface SnapshotEvent {
  filePath: string;
  localPath: string;
  snapshotPath: string;
  timestamp: number;
}

type SnapshotCallback = (event: SnapshotEvent) => void;

const EXCLUDED_NAMES = new Set(['.sync-history', '.obsidian']);

function timestampId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export class VersionedFileSystem extends PhysicalFileSystem {
  private onSnapshot: SnapshotCallback | null = null;

  constructor(rootPath: string) {
    super(rootPath);
  }

  setOnSnapshot(cb: SnapshotCallback): void {
    this.onSnapshot = cb;
  }

  _openWriteStream(webPath: any, ctx: any, callback: any): void {
    const segments = webPath.toString().replace(/^\/+/, '').split('/');
    if (segments.length > 0 && EXCLUDED_NAMES.has(segments[0])) {
      return callback(new Error('Resource not found'));
    }

    const { realPath } = (this as any).getRealPath(webPath);
    const filePath = webPath.toString();

    fs.stat(realPath, (err: NodeJS.ErrnoException | null) => {
      if (err) {
        return super._openWriteStream(webPath, ctx, callback);
      }

      const relativePath = filePath.replace(/^\/+/, '');
      const snapshotDir = path.join(this.rootPath, '.sync-history', path.dirname(relativePath));
      // Preserve the original file extension so non-markdown files keep a
      // correct snapshot name (was hardcoded to '.md').
      const ext = path.extname(relativePath) || '.md';
      const snapshotName = timestampId() + ext;
      const snapshotPath = path.join(snapshotDir, path.basename(relativePath), snapshotName);

      const readStream = fs.createReadStream(realPath);
      fs.mkdir(path.dirname(snapshotPath), { recursive: true }, (_mkdirErr) => {
        const snapshotStream = fs.createWriteStream(snapshotPath);
        readStream.pipe(snapshotStream);

        snapshotStream.on('finish', () => {
          if (this.onSnapshot) {
            this.onSnapshot({
              filePath,
              localPath: realPath,
              snapshotPath,
              timestamp: Date.now(),
            });
          }
          console.log(`SNAPSHOT: ${filePath} → ${snapshotPath}`);
        });

        snapshotStream.on('error', (e) => {
          console.error('Snapshot write failed:', e);
        });
      });

      super._openWriteStream(webPath, ctx, callback);
    });
  }

  _readDir(path: any, ctx: any, callback: any): void {
    const realPath = (this as any).getRealPath(path).realPath;
    fs.readdir(realPath, (e: NodeJS.ErrnoException | null, files: string[]) => {
      if (e) return callback(e);
      const filtered = files.filter((f) => !EXCLUDED_NAMES.has(f));
      callback(null, filtered);
    });
  }
}
