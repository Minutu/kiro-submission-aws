// Feature: kino-game
//
// Boundary check (Req 26.6, Req 24.4): nothing under `src/core/**` may import
// `phaser` — directly OR transitively. The simulation core must stay
// Phaser-free so the 11 correctness properties can be property-tested without a
// browser, canvas, or DOM. See `src/README.md`.
//
// This test is the automated enforcement promised by task 1.3. It performs a
// static import scan: starting from every module under `src/core/**`, it walks
// the transitive closure of relative imports and fails if any reachable module
// imports `phaser` (as a bare specifier `phaser` or a `phaser/...` subpath).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', 'src');
const CORE = join(SRC, 'core');

/** Recursively list every `.ts` file under a directory. */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Match the module specifier of every static/dynamic import and re-export. */
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function extractSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

/** Is this specifier the phaser package (bare or subpath)? */
function isPhaser(spec: string): boolean {
  return spec === 'phaser' || spec.startsWith('phaser/');
}

/** Is this a relative (same-repo) import we should follow transitively? */
function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../');
}

/** Resolve a relative import to an on-disk `.ts` file, if one exists. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    join(base, 'index.ts'),
    // Allow explicit `.ts`/`.js` specifiers to map to the `.ts` source.
    base.replace(/\.js$/, '.ts'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Walk the transitive relative-import closure starting from `entry`.
 * Returns the first offending `phaser` import found, or null if clean.
 */
function findPhaserInClosure(
  entry: string,
): { file: string; via: string[] } | null {
  const visited = new Set<string>();
  // Stack holds [file, pathOfFilesThatLedHere].
  const stack: Array<{ file: string; via: string[] }> = [{ file: entry, via: [entry] }];

  while (stack.length > 0) {
    const { file, via } = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf8');
    for (const spec of extractSpecifiers(source)) {
      if (isPhaser(spec)) {
        return { file, via };
      }
      if (isRelative(spec)) {
        const next = resolveRelative(file, spec);
        if (next && !visited.has(next)) {
          stack.push({ file: next, via: [...via, next] });
        }
      }
    }
  }
  return null;
}

describe('core↔engine boundary', () => {
  it('src/core exists', () => {
    expect(existsSync(CORE)).toBe(true);
  });

  const coreFiles = existsSync(CORE) ? listTsFiles(CORE) : [];

  it.each(coreFiles.map((f) => [f] as const))(
    'core module does not import phaser (directly or transitively): %s',
    (file) => {
      const offender = findPhaserInClosure(file);
      if (offender) {
        const rel = offender.via
          .map((p) => p.replace(SRC, 'src').replace(/\\/g, '/'))
          .join(' -> ');
        throw new Error(
          `src/core must not import phaser. Found a phaser import reachable via: ${rel}`,
        );
      }
      expect(offender).toBeNull();
    },
  );

  it('scans at least the core barrel', () => {
    // Guard against the glob silently matching nothing (which would make the
    // boundary check vacuously pass).
    expect(coreFiles.length).toBeGreaterThan(0);
  });
});
