// World 4 — Flight -> Zigzag -> Underwater chained sequence (spec Req 5.5).
// Thin wrapper over SequenceRunner with World 4's mode cycle.

import { SequenceRunner } from './SequenceRunner.ts';
import { WORLD4_SEQUENCE } from './config.ts';

export class World4Scene extends SequenceRunner {
  constructor() {
    super('World4');
  }

  init(): void {
    super.init({ seq: WORLD4_SEQUENCE });
  }
}
