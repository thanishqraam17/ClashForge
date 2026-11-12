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
- `src/game-data` — versioned, bundled game catalogue (`manifest.json`, `items.json`). Test-only synthetic data lives in `src/game-data/fixtures`.
- `src/services` — pure services built on domain data (e.g. the catalogue query service).

Every IPC call returns `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Timestamps cross the boundary as ISO 8601 UTC strings. Payloads are validated in main before reaching a repository, and only the app's own renderer is accepted as a sender.

## Game data

The catalogue in `src/game-data` is validated on load (`src/domain/catalogue-validation.ts`) and by tests, so a malformed dataset cannot ship.

- **Item IDs** are lowercase kebab-case, globally unique and never renamed once released. Builder Base items use the `bb-` prefix.
- **Every item cites at least one source** declared in `manifest.json`.
- **`validationStatus`** is `unverified`, `partial` or `verified`. Anything short of `verified` must list its `knownOmissions`; the app surfaces these instead of implying the data is complete.
- **Bump `datasetVersion`** and add a changelog entry for every data change.
- The app flags the dataset as stale after 90 days.

The bundled catalogue currently has **no items**: real values are only added after they have been cross-checked against at least two sources.

### Town Hall rules

`src/game-data/town-hall-rules.json` says what each Town Hall level allows for every catalogue item. Rules are written as **steps**: an entry at Town Hall N applies to N and every higher level until the item's next step, so only the Town Halls where something changes are listed.

```json
{
  "itemId": "example-defense",
  "steps": [
    { "townHall": 3, "maxLevel": 2, "maxQuantity": 1 },
    { "townHall": 5, "maxLevel": 4, "maxQuantity": 2 }
  ],
  "unlockRequires": []
}
```

Validation (`src/domain/town-hall-rules-validation.ts`) enforces that:

- every catalogue item has rules, and every rule refers to a catalogue item;
- the first step is at the item's `introducedAtTownHall`;
- steps are in ascending Town Hall order, never lower limits, and never repeat the previous step;
- non-upgradeable items stay at level 1, and non-repeatable items at quantity 1;
- `unlockRequires` points at another item in the same game mode that can reach the required level by the unlock Town Hall.

`maxTownHall` is set per game mode. It is `null` (unknown) until that mode has real data, and the app reports "no Town Hall data yet" instead of guessing.
