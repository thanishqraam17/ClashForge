# ClashForge

Desktop companion for Clash of Clans (Windows). Local-first; no account required.

## Development

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — Electron + Vite dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run test` — unit tests

## Architecture

- `src/main` — Electron main process. Owns SQLite, the filesystem and IPC handlers (`src/main/ipc`).
- `src/preload` — exposes the typed `window.clashForge` API via `contextBridge`. Built as CommonJS (`index.cjs`) so it runs in a sandboxed renderer.
- `src/renderer` — React UI. Must not import `better-sqlite3`, Node modules or repositories; it talks to main only through `window.clashForge`.
- `src/shared/ipc` — the IPC contract (channel names, DTOs, `IpcResult` error codes) and payload validation, shared by all three processes.
- `src/domain` — pure domain types and validation.
- `src/database` — SQLite client, migrations and repositories (main process only).

Every IPC call returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Timestamps cross the boundary as ISO 8601 UTC strings. Payloads are validated in main before reaching a repository, and only the app's own renderer is accepted as a sender.
