<p align="center"><img src="assets/icon/favicon.ico" width="64"></p>

# Crystal Sync

A Windows desktop app that runs a WebDAV server on your PC, so you can sync an Obsidian vault with your phone over the local network (or Tailscale) using the [Remotely Save](https://github.com/remotely-save/remotely-save) plugin.

Every time your phone pushes a file, the current version on the PC gets snapshotted into `.sync-history/` before the write goes through. If something gets overwritten by accident, you can browse old versions and restore them.

## How it works

1. Launch the app, add a vault folder in the Vaults panel
2. Start the server — it'll show you IPs you can reach it at
3. In Remotely Save on your phone, point it at `http://<ip>:8080`
4. Sync. Snapshots land in `.sync-history/` inside your vault

IPs are grouped so you know which one to use:
- **LAN** — your local network (192.168.x.x, 10.x.x.x)
- **Tailscale** — if you have Tailscale running, those 100.x.x.x addresses work from anywhere
- **Other** — everything else

## Security

`.sync-history/` and `.obsidian/` directories are **excluded** from the WebDAV server entirely — they won't appear in listings or be accessible via GET/PUT. This prevents Remotely Save from syncing snapshot files and eliminates 409 Conflict errors caused by sync loops.

## Version snapshots

Snapshots live in `<vault>/.sync-history/<file-path>/<timestamp>.md`. The History panel groups them by date, shows a diff against the current file, and lets you restore or delete old versions.

## Build from source

```
pnpm install
pnpm run make
```

Output lands in `out/`.

## Tech stack

Electron + Vue 3 + webdav-server + Monaco Editor. Windows only (haven't tested elsewhere).
