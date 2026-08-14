---

# Session Log — 2026-08-14

## Summary

v0.4.0 — WebDAV Basic Auth + security hardening + correctness/performance fixes + leftover cleanup.

## v0.4.0 — WebDAV Basic Auth

### Feature
- Credentials set once via the gear button (top-right of the Sync panel) → modal → persisted through `webdav:getConfig` / `webdav:saveConfig`
- Password stored in `~/.crystal-sync/vaults.json` (vault-store), encrypted with Electron `safeStorage` (base64 fallback when the OS keychain is unavailable)
- `startServer(vaultPath, port, onSnapshot, credentials)` now configures `requireAuthentification: true`, HTTP Basic Auth, and per-user privileges via `SimplePathPrivilegeManager.setRights(user, '/', ['all'])`
- `WebDAVStatus` exposes an `auth` flag

### Bug: phone showed 401 despite correct credentials
Two stacked causes:

1. **Our bug — every login failed.** `SimpleUserManager.addUser(name, password, isAdmin)` takes positional args; passing a `SimpleUser` object keyed the store by `"[object Object]"` with an empty password, so no credential could ever match.
2. **Library bug — some passwords failed.** webdav-server 2.6.2's stock `HTTPBasicAuthentication` parses the header with `/^Basic \s*[a-zA-Z0-9]+=*\s*$/`, which rejects any base64 containing `+` or `/` (part of the standard base64 alphabet). Correct credentials were turned into 401 whenever the encoded `user:password` hit those characters.

Fixes: `addUser(username, password)`; new `CrystalBasicAuthentication` subclass in `webdav-service.ts` with a standards-compliant header regex (`/^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i`). Auth failures now log `[webdav] authentication failed for user "…"` to the app terminal.

Verified end-to-end against a live server: no-auth 401 / correct-credentials GET 200 / PROPFIND 207 / wrong password 401 / malformed header 401.

## Security Hardening
- CSP meta tag added to `src/renderer/slotPanelFront/index.html` (`default-src 'self'`, no `unsafe-eval`)
- IPC path validation: `sync:readFile` / `sync:restoreSnapshot` / `sync:deleteSnapshot` now reject any path outside the active vault
- Electron Fuses re-enabled in `forge.config.ts` (RunAsNode off, OnlyLoadAppFromAsar, cookie encryption, node options/inspect args disabled)
- `main.ts` webPreferences made explicit: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`

## Correctness
- Snapshots preserve the original file extension (`versioned-file-system.ts`); previously hardcoded to `.md`
- `sync:listSnapshots` no longer filters snapshot files to `.md` only
- `TabManager.getNextActiveIdAfterClose` now honors the `allCurrentIds` param and drops stale history; the dead fallback branch in `sessionStore.closeSession` removed
- Port-in-use is probed before starting the server, replacing the unreliable async EADDRINUSE catch

## Performance
- `sync:listSnapshots` / `sync:readFile` / `sync:restoreSnapshot` / `sync:deleteSnapshot` converted from blocking `fs` calls to `fs/promises`

## Cleanup
- Deleted leftover `conflict-server.js`, `terminalEditor/test.vue`, `terminalEditor/style.scss`, `npminstall-debug.log`
- `shell-service.ts` hardcoded cwd `C:/Program Files (X86)` → `os.homedir()`

## UI
- Sync panel: bulky credential form replaced with a top-right gear button + one-time settings modal
- Snapshot browser: version labels strip any extension (not just `.md`)

## Files Changed

| Action | File |
|--------|------|
| Modify | `src/main/service/webdav-service.ts` |
| Modify | `src/main/service/vault-store.ts` |
| Modify | `src/main/service/versioned-file-system.ts` |
| Modify | `src/main/service/shell-service.ts` |
| Modify | `src/main/ipc-handler.ts` |
| Modify | `src/main.ts` |
| Modify | `forge.config.ts` |
| Modify | `package.json` (0.3.0 → 0.4.0) |
| Modify | `src/renderer/slotPanelFront/index.html` |
| Modify | `src/renderer/slotPanelFront/workbench/syncPanel/index.vue` |
| Modify | `src/renderer/slotPanelFront/workbench/snapshotBrowser/index.vue` |
| Modify | `src/renderer/slotPanelFront/store/sessionStore.ts` |
| Modify | `src/renderer/slotPanelFront/core/tab/TabManager.ts` |
| Delete | `src/main/service/conflict-server.js` |
| Delete | `src/renderer/slotPanelFront/editors/terminalEditor/test.vue` |
| Delete | `src/renderer/slotPanelFront/editors/terminalEditor/style.scss` |

## Build Status
- Renderer `vite build` clean
- No TypeScript errors in `src/` (`tsc --noEmit --skipLibCheck`)
- Version bumped to 0.4.0

## Next Steps
- Verify packaged build with Fuses enabled
- Observe phone-side 401 fix in real use

---

# Session Log — 2026-05-11

## Summary

Sprint 3 conflict detection testing phase. Discovered that Remotely Save's GET-before-PUT behavior can overwrite phone-side edits before they reach our server.

## Findings

### Conflict Detection Works Correctly
- `ConflictFileSystem._openWriteStream` with 5s mtime tolerance and baseline recording is functioning
- Sync cache (`.sync-cache/`) is created when a PUT arrives and the local file was modified since last sync
- IPC channel `sync:conflict` correctly sends conflict events to renderer

### Remotely Save Behavior Limitation
- Remotely Save does **PROPFIND → GET → PUT** in that order
- If server file has newer mtime, GET pulls it down first → overwrites phone local edits → phone no longer has changes to PUT
- Our conflict detector can only intercept at PUT time — edits lost before PUT never reach us

### Conflict Test Flow (correct procedure)
1. Sync once (establishes baseline on both sides)
2. Edit the SAME file on BOTH PC and phone
3. Sync from phone → PUT arrives → conflict detected → mobile version cached to `.sync-cache/`

## Project Status

| Sprint | Status |
|--------|--------|
| Sprint 1: Infrastructure | Done |
| Sprint 2: WebDAV Engine | Done |
| Sprint 3: Conflict Interceptor | Done (with noted limitation) |
| Sprint 4: UI + Monaco Diff Editor | Pending |

## Key Files

- `src/main/service/conflict-file-system.ts` — Conflict detection via `_openWriteStream` override
- `src/main/service/sync-record-store.ts` — JSON-persisted sync state per file
- `src/main/service/webdav-service.ts` — Server lifecycle management
- `src/main/ipc-handler.ts` — IPC wiring with `sync:conflict` event
- `src/main/service/conflict-server.js` — Standalone test server (not committed)

## Session Update 2 — Pivot to Version Snapshot

### Decision
Remotely Save's GET-before-PUT order makes real-time conflict interception unreliable. Pivoted to **passive version snapshot strategy**: every PUT snapshots the current local file to `.sync-history/{path}/{timestamp}.md` before writing, regardless of conflict status.

### Code Changes
- `ConflictFileSystem` → `VersionedFileSystem` — always snapshot, no mtime logic
- `.sync-cache/` → `.sync-history/` with timestamped naming
- `ConflictHandler` → `SnapshotHandler`, `sync:conflict` → `sync:snapshot`
- `SyncRecordStore` no longer needed (removed from import chain)

### Test Result
Server restarted with new logic. Phone synced → snapshot created at `.sync-history/daliy/Welcome.md/2026-05-10T18-21-37-328Z.md`. Mechanism confirmed working.

## Session Update 3 — Sprint 4 Implementation

### Changes Made

**IPC Handlers (main process)**
- Added `sync:listSnapshots` — walks `.sync-history/`, returns file tree with absolute paths
- Added `sync:readFile` — reads any file at given absolute path
- Added `sync:restoreSnapshot` — copies snapshot to target path (restore)
- Added `getCurrentVaultPath()` to `webdav-service.ts`

**Monaco Editor**
- Installed `monaco-editor` + `vite-plugin-monaco-editor`
- Fixed `vite.renderer.config.ts` outDir to use relative path (plugin bug)
- Worker bundling configured for editorWorkerService

**New Vue Components**
- `SyncPanel.vue` — server status indicator, IP:port list, start/stop button
- `SnapshotBrowser.vue` — file tree (left) + version timeline (right) + inline diff
- `DiffEditor.vue` — Monaco diff view (snapshot vs current), restore button

**Wiring**
- Sidebar Gauge icon → opens SyncPanel as Extension panel
- Sidebar Upload icon → opens SnapshotBrowser as Extension panel
- `sync:snapshot` event auto-refreshes snapshot list

**Cleanup**
- Deleted `conflict-file-system.ts` and `sync-record-store.ts` (replaced by `versioned-file-system.ts`)

### Build Status
- `electron-forge package` — all targets build successfully
- Monaco Editor bundled (~4MB chunk, expected)

## Next Steps

- Run the Electron app and test all UI flows
- Push to GitHub

---

# Session Log — 2026-05-12

## Summary

v0.2.0 implementation complete. Three features delivered: vault preset management, IP categorization display, and snapshot management with date grouping + delete.

## v0.2.0 Implementation

### Feature 1: Vault Preset Management

**New Files:**
- `src/main/service/vault-store.ts` — CRUD for vault presets, persisted to `~/.crystal-sync/vaults.json`
- `src/renderer/slotPanelFront/workbench/vaultSwitcher/index.vue` — Vault management panel

**IPC Handlers Added:**
- `vault:list` — list all presets + active ID
- `vault:save` — save new preset (name, path)
- `vault:delete` — delete preset by ID
- `vault:setActive` — set active vault, hot-restart server if running
- `vault:selectFolder` — system folder picker dialog

**Key Decisions:**
- VaultSwitcher uses FolderOpen icon as first sidebar item
- Active vault highlighted with purple left border (#5e6ad2)
- Delete button (X icon) visible on hover for each preset
- Clicking preset = setActive + auto hot-switch server

### Feature 2: IP Categorization

**Changes in `webdav-service.ts`:**
- `getLocalIPs()` returns `CategorizedIPs` instead of `string[]`
- Categories: LAN (192.168./10./172.16-31.), Tailscale (100.x), Other
- `WebDAVStatus.ips` type changed to `CategorizedIPs`

**Display in SyncPanel:**
- LAN / Tailscale / Other sections with labels
- Tailscale IPs verified working for remote sync over WireGuard

### Feature 3: Snapshot Management

**Date Grouping:**
- Snapshots grouped by latest version date: Today / Yesterday / YYYY-MM-DD
- Date groups are collapsible with file count badges
- Each file shows version count badge

**Delete:**
- `sync:deleteSnapshot` IPC — deletes single snapshot, cleans empty parent dirs
- Per-file "delete all" button (Trash2 icon) + per-version "delete single" (X icon)
- Lists auto-refresh after delete, selection cleared if deleted item was selected

### Bug Fixes

- **EADDRINUSE on vault hot-switch**: `stopServer()` now immediately nulls server ref, `startServer()` waits 500ms after stop for OS port release
- **vault:setActive handler**: Fixed undeclared `server`/`currentPort`/`onSnapshotCallback()` references — now uses `getStatus().running`, `getCurrentPort()`, `getStoredSnapshotCallback()`

## Files Changed

| Action | File |
|--------|------|
| Create | `src/main/service/vault-store.ts` |
| Create | `src/renderer/slotPanelFront/workbench/vaultSwitcher/index.vue` |
| Modify | `src/main/service/webdav-service.ts` |
| Modify | `src/main/ipc-handler.ts` |
| Modify | `src/renderer/slotPanelFront/workbench/sideBar/index.vue` |
| Modify | `src/renderer/slotPanelFront/workbench/syncPanel/index.vue` |
| Modify | `src/renderer/slotPanelFront/workbench/snapshotBrowser/index.vue` |

## Build Status

- Renderer build: clean (Monaco ~4MB chunk)
- No TypeScript errors in source files
- Main/preload build via Electron Forge (not standalone Vite)

## Next Steps

- Test vault hot-switch with actual Tailscale remote sync
- Consider port customization UI
- Consider diff editor with editing capability

## Session Update — v0.2.0 Release

- Bumped version to 0.2.0 in package.json
- Added README.md — setup instructions, tech stack, how sync works
- Tagged `v0.2.0` and created GitHub release
- Release artifact: `Crystal Sync-win32-x64-0.1.0.zip` (Electron Forge make output)
- Release published at https://github.com/NAOXUAN4/crystal-sync/releases/tag/v0.2.0

---

# Session Log — 2026-05-26

## Summary

v0.3.1 — SnapshotBrowser empty after app restart fix.

## Fix: SnapshotBrowser shows empty list when server isn't running

### Root Cause
`sync:listSnapshots` called `getCurrentVaultPath()` which returns null when the WebDAV server isn't running. After app restart, the vault name is known but the server hasn't been started yet, so the snapshot browser showed "No snapshots yet."

### Changes

**`src/main/ipc-handler.ts`**:
- `sync:listSnapshots` now falls back to `getActiveVault().path` when `getCurrentVaultPath()` returns null
- Added early return `{ ok: true, files: [] }` if both sources are null, preventing a crash on `path.join(null, ...)`

**`src/renderer/slotPanelFront/workbench/snapshotBrowser/index.vue`**:
- Added `cleanupStatus` listener for `webdav:statusChanged` event, so snapshot list refreshes when server starts/stops
- Fixed missing cleanup (the old listener was never cleaned up in `onBeforeUnmount`)

## Build Status

- Version bumped to 0.3.1
- Commit `561374d`

---

## Summary

v0.3.0 — 409 Conflict fix + sidebar tab activation fix.

## Fix 1: 409 Conflict — .sync-history/.obsidian excluded from WebDAV

### Root Cause
The `.sync-history/` directory was visible through WebDAV (inside the vault root). Remotely Save's PROPFIND would list it, try to sync snapshot files, creating a feedback loop that caused 409 Conflict errors.

### Changes in `versioned-file-system.ts`
- Added `EXCLUDED_NAMES = new Set(['.sync-history', '.obsidian'])` — directories invisible to WebDAV
- Overridden `_readDir` to filter excluded names from directory listings
- Overridden `_openWriteStream` to reject writes to excluded paths

## Fix 2: Sidebar tab activation

### Root Cause
Each sidebar icon click called `createTab()` unconditionally, creating a new tab every time even if one was already open.

### Changes in `sideBar/index.vue`
- New `activateOrCreateTab(name, component)` helper
- Checks if an Extension tab with the same name already exists in the session store
- If found, calls `activateSession(id)` instead of creating a new one
- Terminal tabs still always create new (each terminal is independent)

## Sub-path experiment (reverted)
subPath support was attempted but reverted due to continued 409 issues. The vault root on PC and phone must match. The `.sync-history`/`.obsidian` exclusion alone was sufficient for the 409 fix.

## Build Status
- Version bumped to 0.3.0
