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

### Item artwork

Read [docs/asset-licensing.md](docs/asset-licensing.md) before adding any image. **No game artwork is bundled yet**: whether official icons may be redistributed inside the app is still an open licensing question.

How the asset system works once images are added:

1. Put the file in `src/game-data/assets/<folder>/<file>.png` (lowercase kebab-case, `png` or `webp`).
2. Add an entry to `src/game-data/assets.json` with `itemId`, `level` (`null` for the item's standard image), `assetPath`, `sourceName`, `sourceUrl`, `attribution`, the file's SHA-256 `checksum` and `lastVerifiedAt`.
3. Tests validate the manifest against the catalogue and Town Hall rules.

At runtime, images are served over the `clashforge-asset://` protocol. Only files listed in the manifest are served, and each file must match its checksum. Verified files are cached in memory.

The `ItemImage` component shows:

- the exact-level image when one exists;
- the item's standard image labelled **Generic** when the requested level has no artwork (art from a different level is never used);
- a neutral placeholder when there is no image.

The unofficial-content notice required by Supercell's Fan Content Policy is always visible in the sidebar and on the Settings page, which also lists every artwork source.

## Village state

Schema version 3 (`src/database/migrations/003_village_state.sql`) stores the player's village. Business rules live in `src/services/village-state-service.ts`; repositories only persist.

| Table | Holds |
|---|---|
| `villages` | Town Hall level and resources (single local village) |
| `builders` | One row per builder slot; a builder is busy when an item instance points at it |
| `village_items` | One row per owned instance (buildings, defenses, traps, walls, heroes), keyed by catalogue `item_id` and `instance_number` |
| `research` | Laboratory level per troop, spell or siege machine; at most one active research |
| `village_snapshots` | Immutable JSON snapshots of the whole state, newest = last confirmed baseline |
| `legacy_*` | Pre-version-3 records, archived unchanged with a reconciliation status |

**Provenance.** Village, builder, item and research rows carry `source` (`manual`, `data-export`, `screenshot`, `live-capture`, `timer-estimate`), `confidence` (0–1) and `confirmed_at`. A null `confirmed_at` means the value is unconfirmed or estimated and must be shown that way.

**Upgrades.** An instance is upgrading when `target_level` is set. It must be exactly `level + 1` and assigned to a builder from the same village, and each builder can work on one upgrade. The database enforces these rules as well as the service.

**Catalogue coverage.** Items and research must reference real catalogue IDs and respect the village's Town Hall limits. While the bundled catalogue has no items, or the village's Town Hall is newer than the data, `villageState.getCoverage()` reports `canRecordItems: false` with a reason, and item/research saves return `CATALOGUE_INCOMPLETE`. The village row, builders and snapshots keep working. No catalogue entries are invented.

**Snapshots** are append-only. A database trigger rejects updates, and each read returns a fresh copy, so a snapshot always shows the state at its capture time.

**Legacy records.** Migration 3 archived the old free-text buildings, heroes and research instead of deleting them, and turned the old builder count into builder rows (the original counts are kept in `legacy_village_builder_counts`). On startup, `reconcileLegacyRecords` converts a record only when:

- its name matches exactly one Home Village catalogue item of the right kind;
- it was not mid-upgrade;
- the result passes normal validation.

A multi-building record converts completely or not at all. Converted values are marked unconfirmed. Every other record stays `pending` with a note, available through `legacy.list()` for manual reconciliation. Nothing is discarded.

## Data export import

Imports the in-game Data Export (Settings → More Settings → Data Export). The observed format is documented in [docs/data-export-format.md](docs/data-export-format.md).

**Flow:** parse → plan → preview → apply.

1. **Parse** (`src/import/export-parser.ts`): checks structure and types, and keeps known fields exactly as exported. A missing `cnt` stays empty here, never 1. Unknown fields and sections are reported by name and location only; their values are not kept. The player tag is never stored or logged.
2. **Plan** (`src/import/import-planner.ts`): maps entries to catalogue items through verified `gameDataId`s only, and proposes changes. The rules for interpreting export fields live in `src/game-data/export-semantics.json`, each with a status:
   - `observed`: `lvl`, an explicit `cnt`;
   - `inferred`: a missing `cnt` means one instance. Changes that rely on it are marked `basis: inferred` and listed in the preview;
   - `unverified`: `timer`. An unverified timer is recorded but never becomes an upgrade.
3. **Preview**: stores the import (`export_imports`) and every entry as observed (`export_observations`, which can't be edited), including the original export timestamp and raw timers.
4. **Apply** (`src/services/import-service.ts`): one transaction, with a snapshot before and after. It applies only the changes you accept:
   - removals must be accepted individually;
   - **every change that touches an active upgrade or research is a conflict** and needs `keep-current` or `apply-export`, whatever the record's source;
   - applied values get `source: data-export`, the confidence of the rules they relied on, and `confirmed_at` set when you accept them;
   - if the village changed since the preview, apply fails with `STALE_PREVIEW`.

An import never changes resources, storage capacities or the builder count.

**Builder assignment.** The export never says which builder is busy. An upgrade that comes from imported data can therefore record its builder as `unknown`; manual upgrades always need a confirmed, free builder. While any upgrade has an unknown builder, no builder is reported as free: availability is given as a `freeMin`–`freeMax` range with `isConfirmed: false`.

**Current limits.** The bundled catalogue has no verified `gameDataId`s and every timer rule is unverified. A real export therefore previews as "parsed, nothing mapped" and changes nothing. Raw exports belong in `samples/private/`, which is git-ignored. `src/import/fixtures/export-redacted.json` keeps the real structure with every value fabricated.
