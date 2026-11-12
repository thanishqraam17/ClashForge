# Asset Licensing Audit

Status: **no game artwork is bundled yet.** This document records what has been checked and what must be resolved before any is added.

## Supercell Fan Content Policy

Source: <https://supercell.com/en/fan-content-policy/> (page states "Last updated: September 27, 2023"; reviewed 2026-11-12).

What applies to ClashForge:

| Topic | Policy position | ClashForge consequence |
|---|---|---|
| Type of content | Guide apps are listed as normal, permitted fan content. | A companion/planning app fits this category. |
| Charging money | No fee of any kind, including for in-app functionality, without Supercell's approval. Ads, pure donations and coaching are the only exceptions. | ClashForge must be free, with no paid features. Donations, if ever added, must unlock nothing. |
| Interfering with the game | Content promoting cheats, bots, automation, mods or unauthorised third-party software that interferes with a game is prohibited. | Reinforces the plan's rule: no memory reading, injection, input automation or network interception. |
| Endorsement | Must not give the impression Supercell sponsors, created or endorses the content. | No "official" wording; the app's own branding must not use game logos. |
| Logos and modification | Must not imitate Supercell logos/trademarks or modify Supercell assets without permission. | Images are shown as-is: no recolouring or edits. Cropping/resizing for display should be kept to scaling only. |
| Disclaimer | Required, legible, wherever Supercell assets are used. | Shown permanently in the app shell (see below). |
| Revocation | The licence can be revoked at any time without warning. | Assets must be removable without breaking the app; the image fallback covers this. |

Required notice, used verbatim in the app:

> This material is unofficial and is not endorsed by Supercell. For more information see Supercell's Fan Content Policy: www.supercell.com/fan-content-policy.

## Open questions (must be resolved before bundling artwork)

1. **Redistributing artwork in an installer.** The policy does not say whether icons may be packaged inside a distributed desktop app. Ask Supercell in writing, or confirm via the fan kit terms.
2. **Supercell fan kit** (<https://fankit.supercell.com/>). Linked from the policy and may carry its own terms. Not yet reviewed. It is the preferred source if its terms allow app use, because it is official.
3. **Community asset repositories.** Any community source must be checked for its own licence and attribution requirements, and must not be extracted game files of unclear origin.
4. **Using game data in a companion app.** The policy does not address apps built on game data. Low risk for static reference data, but worth confirming in the same request as item 1.

## Rules the asset system enforces

- Every asset is listed in `src/game-data/assets.json` with its source, source URL, attribution and SHA-256 checksum. Files not in the manifest are never served.
- Asset file paths are fixed in the manifest and never derived from user input or item names.
- If exact-level artwork is missing, the item's canonical image is shown and labelled as a generic image. Artwork from a different level is never presented as exact.
- If no image exists, a neutral placeholder is shown. The app never uses AI-generated substitutes for real game items.
- The unofficial-content disclaimer is always visible.
