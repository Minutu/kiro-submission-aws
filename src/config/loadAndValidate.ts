// Feature: kino-game
//
// ConfigFile.loadAndValidate — the guarded entry point that turns an untrusted
// raw Config_File into a structurally-complete `ConfigFileData` the rest of the
// game can rely on (Req 47.1, 47.3, 33.6).
//
// Contract: this is a STRUCTURAL guard, not a balance-value guard. It ensures
// every required key exists with the right *shape*; out-of-range numeric
// balance values are handled downstream by BalanceTable (Req 47.2), which is
// the single choke point for range validation. The two checks run in addition
// to each other (Req 47.4) and in every case the game stays startable and
// playable against defaults (Req 47.3).
//
// Behavior:
//   - Accepts an optional raw/partial/untrusted config input (unknown).
//   - If the input is absent, unparseable, or structurally invalid, it returns
//     the full built-in `defaultConfig` and emits a developer warning via
//     console.warn — it never throws/crashes (Req 47.1, 33.6).
//   - If the input is a structurally-complete config, it is returned merged
//     over the defaults so any key the author omitted still resolves.
//
// PURE TypeScript — no Phaser import (src/config is Phaser-free per
// src/README.md).

import { defaultConfig } from './config.ts';
import type { ConfigFileData } from './config.ts';

/** Prefix for every developer-facing warning this module emits. */
const WARN_PREFIX = '[KINO][ConfigFile]';

/** True for a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively verify that `candidate` is structurally compatible with the
 * `reference` default: every key present on the reference must exist on the
 * candidate with a matching structural type. Extra keys on the candidate are
 * ignored (forward-compatible). Arrays are checked for array-ness only — their
 * element contents are author data and are not structurally constrained here.
 */
function isStructurallyValid(candidate: unknown, reference: unknown): boolean {
  // Arrays: the candidate must also be an array (contents left to the author).
  if (Array.isArray(reference)) {
    return Array.isArray(candidate);
  }

  // Plain objects: recurse over every required key on the reference.
  if (isPlainObject(reference)) {
    if (!isPlainObject(candidate)) {
      return false;
    }
    for (const key of Object.keys(reference)) {
      if (!(key in candidate)) {
        return false;
      }
      if (!isStructurallyValid(candidate[key], reference[key])) {
        return false;
      }
    }
    return true;
  }

  // Primitives: require a matching typeof (string/number/boolean).
  return typeof candidate === typeof reference;
}

/**
 * Deep-merge `candidate` over `reference`, so a structurally-valid config that
 * omits optional keys still resolves to a complete `ConfigFileData`. Only keys
 * defined on the reference are carried; arrays and primitives are taken from
 * the candidate wholesale when present.
 */
function mergeOverDefaults<T>(reference: T, candidate: unknown): T {
  if (Array.isArray(reference)) {
    return (Array.isArray(candidate) ? candidate : reference) as T;
  }

  if (isPlainObject(reference)) {
    const source = isPlainObject(candidate) ? candidate : {};
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(reference as Record<string, unknown>)) {
      result[key] =
        key in source
          ? mergeOverDefaults(
              (reference as Record<string, unknown>)[key],
              source[key],
            )
          : (reference as Record<string, unknown>)[key];
    }
    return result as T;
  }

  // Primitive reference: take the candidate when present, else the default.
  return (candidate === undefined ? reference : (candidate as T)) as T;
}

/**
 * Load and structurally validate a raw Config_File, falling back to the full
 * built-in default set on any problem (Req 47.1, 47.3, 33.6).
 *
 * @param rawConfig Optional raw/partial/untrusted config input. When omitted or
 *   invalid the complete `defaultConfig` is returned.
 * @returns A structurally-complete `ConfigFileData`, never throwing.
 */
export function loadAndValidate(rawConfig?: unknown): ConfigFileData {
  // No config supplied at all — use defaults silently (this is the normal
  // first-boot path, not an error worth warning about).
  if (rawConfig === undefined || rawConfig === null) {
    return defaultConfig;
  }

  try {
    // A raw string is treated as serialized JSON and parsed defensively.
    const parsed: unknown =
      typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;

    if (!isStructurallyValid(parsed, defaultConfig)) {
      console.warn(
        `${WARN_PREFIX} Config_File is structurally invalid; falling back to built-in defaults.`,
      );
      return defaultConfig;
    }

    // Structurally valid: merge over defaults so any omitted key still resolves.
    return mergeOverDefaults(defaultConfig, parsed);
  } catch (error) {
    console.warn(
      `${WARN_PREFIX} Config_File could not be parsed; falling back to built-in defaults.`,
      error,
    );
    return defaultConfig;
  }
}
