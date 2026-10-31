# KINO — source layout and the core↔engine boundary

The codebase is split into a **simulation core** (pure TypeScript, no Phaser)
and a **render/engine layer** (Phaser scenes, sprites, input, audio), exactly as
the design prescribes (Req 26.6, 24.4). Scenes drive the core each frame with a
fixed timestep and render an interpolated view.

## Folders

| Folder        | Role | Phaser? |
|---------------|------|---------|
| `src/core/`   | Pure simulation: movement state, scoring, collision, safe-reposition, progression, persistence serialization. Deterministic and property-testable without a browser. | **No** |
| `src/config/` | Single user-editable `Config_File`, `loadAndValidate`, and `BalanceTable`. Pure data/logic. | **No** |
| `src/assets/` | `Asset_Registry`: maps config asset keys → real art or geometric placeholder factories (single choke point via `resolve`). | No (registry data/logic; Phaser placeholder construction injected by the engine) |
| `src/engine/` | Phaser scenes (Boot, Preload, MainMenu, Gameplay, Cinematic, RunEnd, overlays), renderers, input mapping, audio. Drives the core each fixed step. | **Yes** |
| `test/`       | Property-based tests (fast-check, 100+ iterations) and unit tests targeting the core. | No (exercises pure core) |

Each folder has an `index.ts` barrel that re-exports its public surface as
modules are implemented.

## The boundary rule

> **Nothing under `src/core/**` may import `phaser` — directly or
> transitively.**

Keeping the core Phaser-free is what lets the 11 correctness properties be
property-tested without a canvas or DOM. Dependencies flow one way:

```
engine ──▶ core
engine ──▶ config ──▶ (core may read config/balance types)
engine ──▶ assets
core   ──▶ config        (balance tunables only; config imports no Phaser)
core   ──✗ engine        (never)
core   ──✗ phaser        (never)
```

- `src/engine/**` MAY import from `core`, `config`, and `assets`.
- `src/core/**` MAY import from `config` (pure) but MUST NOT import from
  `engine`, `assets` (Phaser placeholder construction), or `phaser`.

This boundary is enforced by an automated check added in task 1.3 (an
ESLint/boundary rule or test asserting `src/core/**` does not import `phaser`).
