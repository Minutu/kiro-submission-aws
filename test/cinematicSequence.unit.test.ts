// Feature: kino-game
//
// UNIT tests for task 10.1 — the PURE CinematicSequence player
// (`src/core/cinematicSequence.ts`; design: "Cinematics System (Req 21, 29,
// 42)"; Req 21.3, 21.18, 21.21).
//
// These pin the config-driven, skippable, panel-by-panel state machine the
// Phaser CinematicScene defers ALL sequencing to:
//   - starts on panel 0 (Req 21.21);
//   - advance() walks panels in order and reports 'done' / isComplete at the
//     end (Req 21.21);
//   - skip() immediately completes from ANY index (Req 21.3, 21.18);
//   - advancing past the end (and a double skip) stays complete — idempotent;
//   - an EMPTY panels array is immediately complete (the generic scene / first
//     boot resolves and hands back with no content).
//
// Pure TypeScript, no Phaser — the player lives in core precisely so its
// sequencing is testable in plain Node.

import { describe, it, expect } from 'vitest';
import {
  createCinematicPlayer,
  type CinematicPanel,
} from '../src/core/cinematicSequence.ts';

/** A small fixture of three distinct Comic_Panels. */
function panels3(): CinematicPanel[] {
  return [
    { id: 'p0', caption: 'one' },
    { id: 'p1', caption: 'two' },
    { id: 'p2', caption: 'three' },
  ];
}

describe('createCinematicPlayer — start state (Req 21.21)', () => {
  it('starts positioned on panel 0 for a non-empty sequence', () => {
    const player = createCinematicPlayer(panels3());
    expect(player.index).toBe(0);
    expect(player.length).toBe(3);
    expect(player.isComplete()).toBe(false);
    expect(player.current()?.id).toBe('p0');
  });

  it('defaults to an empty, already-complete sequence when given no panels', () => {
    const player = createCinematicPlayer();
    expect(player.length).toBe(0);
    expect(player.isComplete()).toBe(true);
    expect(player.current()).toBeNull();
  });
});

describe('advance() walks panels in order and completes at the end (Req 21.21)', () => {
  it('returns each next panel in order, then "done" past the last', () => {
    const player = createCinematicPlayer(panels3());

    const a = player.advance();
    expect(a).not.toBe('done');
    expect((a as CinematicPanel).id).toBe('p1');
    expect(player.index).toBe(1);
    expect(player.current()?.id).toBe('p1');
    expect(player.isComplete()).toBe(false);

    const b = player.advance();
    expect((b as CinematicPanel).id).toBe('p2');
    expect(player.index).toBe(2);
    expect(player.isComplete()).toBe(false);

    // Advancing off the last panel completes the sequence.
    const c = player.advance();
    expect(c).toBe('done');
    expect(player.isComplete()).toBe(true);
    expect(player.current()).toBeNull();
    expect(player.index).toBe(3); // parked at length
  });

  it('visits every panel exactly once in array order', () => {
    const src = panels3();
    const player = createCinematicPlayer(src);

    const visited: string[] = [player.current()!.id!];
    for (let r = player.advance(); r !== 'done'; r = player.advance()) {
      visited.push(r.id!);
    }
    expect(visited).toEqual(['p0', 'p1', 'p2']);
  });
});

describe('advancing past the end is idempotent (stays complete)', () => {
  it('repeated advance() after completion keeps returning "done"', () => {
    const player = createCinematicPlayer(panels3());
    player.advance(); // p1
    player.advance(); // p2
    expect(player.advance()).toBe('done'); // complete

    expect(player.advance()).toBe('done');
    expect(player.advance()).toBe('done');
    expect(player.isComplete()).toBe(true);
    expect(player.index).toBe(3);
    expect(player.current()).toBeNull();
  });
});

describe('skip() completes immediately from any index (Req 21.3, 21.18)', () => {
  it('skips from the very start', () => {
    const player = createCinematicPlayer(panels3());
    expect(player.isComplete()).toBe(false);
    player.skip();
    expect(player.isComplete()).toBe(true);
    expect(player.current()).toBeNull();
    expect(player.index).toBe(3);
    expect(player.advance()).toBe('done');
  });

  it('skips from the middle', () => {
    const player = createCinematicPlayer(panels3());
    player.advance(); // on p1
    expect(player.index).toBe(1);
    player.skip();
    expect(player.isComplete()).toBe(true);
    expect(player.index).toBe(3);
    expect(player.current()).toBeNull();
  });

  it('is idempotent — a double skip stays complete', () => {
    const player = createCinematicPlayer(panels3());
    player.skip();
    player.skip();
    expect(player.isComplete()).toBe(true);
    expect(player.index).toBe(3);
  });

  it('skipping an already-empty sequence is a no-op', () => {
    const player = createCinematicPlayer([]);
    expect(player.isComplete()).toBe(true);
    player.skip();
    expect(player.isComplete()).toBe(true);
    expect(player.index).toBe(0);
    expect(player.current()).toBeNull();
  });
});

describe('determinism — the player snapshots its panels', () => {
  it('ignores later mutation of the caller\'s input array', () => {
    const src = panels3();
    const player = createCinematicPlayer(src);
    // Mutate the caller's array AFTER construction.
    src.push({ id: 'p3', caption: 'four' });
    src[0] = { id: 'mutated' };

    expect(player.length).toBe(3);
    expect(player.current()?.id).toBe('p0');

    const seen: string[] = [player.current()!.id!];
    for (let r = player.advance(); r !== 'done'; r = player.advance()) {
      seen.push(r.id!);
    }
    expect(seen).toEqual(['p0', 'p1', 'p2']);
  });

  it('handles a single-panel sequence', () => {
    const player = createCinematicPlayer([{ id: 'only' }]);
    expect(player.current()?.id).toBe('only');
    expect(player.isComplete()).toBe(false);
    expect(player.advance()).toBe('done');
    expect(player.isComplete()).toBe(true);
  });
});
