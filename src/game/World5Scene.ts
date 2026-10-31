// World 5 — same chained sequence as World 4 (Flight -> Zigzag -> Underwater).
// Thin wrapper over SequenceRunner with World 5's mode cycle.

import { SequenceRunner } from './SequenceRunner.ts';
import { WORLD5_SEQUENCE } from './config.ts';

export class World5Scene extends SequenceRunner {
  constructor() {
    super('World5');
  }

  init(): void {
    super.init({ seq: WORLD5_SEQUENCE });
  }
}
