# In-game Data Export: Observed Format

Status: **based on one sample.** Supercell does not document this format. Everything below is what the sample actually contains. Anything about what a field *means* is marked **Hypothesis** until a second export (or in-game check) confirms it. The importer must parse only what is listed here and must tolerate new or missing sections.

## Source

| | |
|---|---|
| Where | In game: Settings → More Settings → Data Export. The game copies JSON to the clipboard. |
| Scope | The village open at the time of export. The sample was taken from the Home Village. |
| Sample | `samples/private/export-1.json` (5,467 bytes, a single line of minified JSON). The file is git-ignored. |
| Sample taken | `timestamp` = 1794481225 → 2026-11-12T11:00:25Z |
| Game version | Not present in the export. |

## Privacy

`tag` is the player tag (format `#` followed by uppercase letters and digits). It identifies the account. Raw exports stay in `samples/private/`, which is git-ignored. Test fixtures must remove or replace the tag. The importer must not store or log it unless the user explicitly chooses to.

## Top level

A single JSON object. Keys appear in this order in the sample:

| Key | Type | Observed |
|---|---|---|
| `tag` | string | Player tag (see Privacy) |
| `timestamp` | integer | Unix time in **seconds** when the export was made |
| `helpers` | entry array | 1 entry |
| `buildings` | entry array | 33 entries, 29 distinct ids |
| `traps` | entry array | 16 entries, 6 distinct ids |
| `decos` | entry array | 7 entries (no `lvl`) |
| `obstacles` | entry array | empty |
| `units` | entry array | 19 entries |
| `siege_machines` | entry array | empty |
| `heroes` | entry array | 3 entries |
| `spells` | entry array | 11 entries |
| `pets` | entry array | empty |
| `equipment` | entry array | 35 entries |
| `house_parts` | number array | 8 bare ids |
| `skins` | number array | 1 bare id |
| `sceneries` | array | empty |
| `buildings2` | entry array | 20 entries |
| `traps2` | entry array | 7 entries |
| `decos2` | array | empty |
| `obstacles2` | entry array | 11 entries (no `lvl`) |
| `units2` | entry array | 6 entries |
| `heroes2` | array | empty |
| `skins2` | array | empty |
| `sceneries2` | array | empty |
| `boosts` | object | empty `{}`. Its shape is unknown. |

Empty arrays tell us that the key exists, but not what its entries look like. `obstacles`, `siege_machines`, `pets`, `sceneries`, `decos2`, `heroes2`, `skins2`, `sceneries2` and `boosts` therefore have **unknown entry shapes**.

**Hypothesis:** the `…2` sections are the Builder Base. This is consistent with `obstacles2` being populated and with the separate `units2`/`traps2`, but it is not confirmed.

## Entry object

Every observed entry has a numeric `data` id plus some of the following fields:

| Field | Type | Seen in | Observed |
|---|---|---|---|
| `data` | integer | all entry arrays | Game data id (see "Ids" below) |
| `lvl` | integer | all except `decos`, `obstacles2` | Level, 1–33 in the sample |
| `cnt` | integer | `buildings`, `traps`, `decos`, `buildings2`, `traps2`, `obstacles2` | Number of instances, 1–275 in the sample |
| `timer` | integer | `traps`, `units`, `heroes`, `units2` | Seconds, 4,594–72,643 in the sample |
| `gear_up` | integer | `buildings` (1 entry) | Value `1` |
| `helper_cooldown` | integer | `helpers` | Seconds |
| `helper_recurrent` | boolean | `units` (1 entry) | Only on the entry that also has `timer` |

Field combinations actually seen:

| Section | Field sets (count) |
|---|---|
| `buildings` | `data,lvl,cnt` (32) · `data,lvl,gear_up` (1) |
| `traps` | `data,lvl,cnt` (12) · `data,lvl,timer` (4) |
| `decos`, `obstacles2` | `data,cnt` |
| `units` | `data,lvl` (18) · `data,lvl,timer,helper_recurrent` (1) |
| `heroes` | `data,lvl` (2) · `data,lvl,timer` (1) |
| `spells`, `equipment` | `data,lvl` |
| `units2` | `data,lvl` (5) · `data,lvl,timer` (1) |
| `buildings2`, `traps2` | `data,lvl,cnt` |
| `helpers` | `data,lvl,helper_cooldown` |

## Grouping

- **Grouped by id and level.** An entry covers every instance with the same `data` and `lvl`. A building with instances at three levels appears as three entries with the same `data`.
- **No `cnt` means one instance (hypothesis).** Every entry without `cnt` also has `timer` or `gear_up`. Those instances are listed one per entry, not grouped.
  - The `gear_up` building appears once without `cnt`, next to a regular entry with the same `data` and `lvl` and `cnt: 5`.
  - Four `traps` entries share the same `data` and `lvl`, each with its own `timer`, alongside a grouped entry for that id/level with `cnt: 2`.
- **Instances have no identity.** Two instances of the same item at the same level can't be told apart. Nothing links an instance in one export to the same instance in the next.

## Ids

`data` ids are integers. They appear to follow the pattern *type code × 1,000,000 + index* (**hypothesis**):

| Prefix | Section(s) | Observed range |
|---|---|---|
| 1 | `buildings`, `buildings2` | 1000000–1000093 |
| 4 | `units`, `units2` | 4000000–4000041 |
| 8 | `obstacles2` | 8000041–8000064 |
| 12 | `traps`, `traps2` | 12000000–12000014 |
| 18 | `decos` | 18000003–18000239 |
| 26 | `spells` | 26000000–26000028 |
| 28 | `heroes` | 28000000–28000006 |
| 52 | `skins` | 52000062 |
| 82 | `house_parts` | 82000000–82000059 |
| 90 | `equipment` | 90000000–90000061 |
| 93 | `helpers` | 93000001 |

**The export contains no names.** Mapping an id to a catalogue item requires a verified id table. No such table exists in ClashForge, and it must not be guessed from memory or from a single unofficial list.

## Timers (unconfirmed)

- **Hypothesis:** `timer` is the number of seconds remaining at `timestamp`, which would make the expected completion `timestamp + timer`. Confirming this needs two exports of the same in-progress upgrade, taken some minutes apart.
- **Hypothesis:** an entry with `timer` is upgrading from `lvl` to `lvl + 1`. The export has no target level.
- The export has **no start time**, so the start of an upgrade can't be derived.
- **Unexplained:** four `traps` entries with the same id and level have timers within 7 seconds of each other (4,601, 4,599, 4,596, 4,594). It is unclear whether these are simultaneous builder upgrades, a different mechanism (for example a helper), or something else. Don't treat `timer` on traps as a builder upgrade until this is understood.
- The single `units` timer carries `helper_recurrent: true`. Its meaning is unknown.

## Not present in the export

These matter for the importer because ClashForge can't get them from an export:

- Gold, elixir and dark elixir balances, and storage capacities
- Number of builders, or which builder is working on what
- An explicit Town Hall level. It is presumably one of the `buildings` entries, but which `data` id is the Town Hall is not known without an id table.
- Upgrade start times and target levels
- Laboratory level or Laboratory state, separate from the research `timer` on units
- Game version, and village or account name

## How ClashForge uses this

The importer's interpretation of each field is recorded, with a status (`observed`, `inferred`, `unverified` or `verified`) and evidence, in `src/game-data/export-semantics.json`. To change how a field is used, change that file and update the evidence; don't change code. See the README section "Data export import".

## Implications for the importer (decided in Phase 6)

1. **Catalogue mapping.** Catalogue items need a verified game `data` id field. The bundled catalogue is empty and has no such field, so an import can parse and preview an export but can't map any item yet. Unmapped ids must be reported, never guessed.
2. **Upgrades without a builder.** The village state model requires every active upgrade to have a builder (schema version 3). The export never says which builder is busy. Importing an upgrade therefore needs a decision on how to handle this.
3. **Instance matching.** Instances have no identity, so imports must be reconciled by item and level counts, not by instance.
4. **Partial data.** Resources and builder count are absent, so an import must leave those values unchanged rather than zero them.
5. **Out of current scope:** equipment, pets, helpers, decorations, obstacles, skins, sceneries, house parts and the `…2` sections. They are parsed and validated as structure only, and are reported as ignored.

## Open questions for a second sample

- Does `timer` decrease between two exports of the same upgrade by exactly the elapsed time?
- After an upgrade completes, does its entry merge back into the grouped `cnt` entry?
- What do `gear_up`, `helper_recurrent`, `helper_cooldown` and `boosts` look like when non-trivial?
- What do entries in `siege_machines` and `pets` look like when populated?
- Is the `…2` data really the Builder Base? An export taken while the Builder Base is open would show this.
