// World 3 — Flight <-> Zigzag chained sequence (spec Req 4.4-4.7).
// Thin wrapper over SequenceRunner with World 3's mode cycle.

import { SequenceRunner } from './SequenceRunner.ts';
import { WORLD3_SEQUENCE } from './config.ts';

export class World3Scene extends SequenceRunner {
  constructor() {
    super('World3');
  }

  init(): void {
    super.init({ seq: WORLD3_SEQUENCE });
  }
}
