// Feature: kino-game
//
// The single user-editable Config_File module (Req 33.1-33.5, 33.9-33.16,
// 24.7, 24.9, 24.11, 38.1). This is the ONE place a developer edits to tune
// KINO: names, labels, animation-frame asset keys, obstacle categories, color
// palettes, mentor content, audio, starter assets, cinematics, skill unlock
// schedule / rarity, and the grouped, self-documenting `balance` block.
//
// PURE DATA — no Phaser import (this module lives in src/config, which is
// Phaser-free per src/README.md). Gameplay logic never reads these constants
// directly; it consumes them through BalanceTable / Asset_Registry so the
// config module stays the authoritative single source of truth (Req 26.8).
//
// Editing workflow: change a value here and reload the page — no rebuild step
// beyond the dev serve, and no change to gameplay logic required (Req 33.5).

// ---------------------------------------------------------------------------
// Type definitions — the concrete shape of Config_File
// ---------------------------------------------------------------------------

/** Generational-name composition scheme, e.g. "Kino III Junior" (Req 32.1-32.2). */
export interface GenerationalScheme {
  /** Template string; `{base}` `{roman}` `{suffix}` are substituted. */
  format: string;
  juniorSuffix: string;
  seniorSuffix: string;
  /** First iteration number (Generation 1). */
  startIteration: number;
}

/** Per-world string map keyed `world1`..`world5`. */
export interface PerWorld<T> {
  world1: T;
  world2: T;
  world3: T;
  world4: T;
  world5: T;
}

export interface NamesConfig {
  /** Base character name (Req 29.12, 32.2). */
  baseCharacterName: string;
  /** Generational naming scheme (Req 32.1-32.2). */
  generationalScheme: GenerationalScheme;
  /** Mentor display names per world (Req 29.2-29.6, 29.12). */
  mentors: PerWorld<string>;
  /** World display names (Req 27.1-27.5). */
  worlds: PerWorld<string>;
}

export interface LabelsConfig {
  startStory: string;
  continueStory: string;
  /** Permission-denied gag text in the opening cinematic (Req 21.12). */
  permissionGag: string;
  play: string;
  retry: string;
  menu: string;
  /** Run-HUD pause control label (Req 7.9). */
  pause: string;
  /** PauseScene resume control label (Req 7.13). */
  resume: string;
  /** PauseScene "Paused" heading. */
  paused: string;
  newWorldUnlocked: string;
  endlessStarting: string;
  endlessConfirm: string;
}

/**
 * Per-mode Animation_Frame asset keys (Req 30.7-30.12, 33.9-33.14). Each value
 * is a path; an empty string means "no real art" and triggers placeholder
 * fallback (Req 33.7, 24.10). Underwater_Buoyancy intentionally has NO frames
 * of its own — it reuses `flight` (Req 30.9, 33.11).
 */
export interface AnimationFramesConfig {
  /** Jumping: ground walk cycle + airborne jump arc (Req 30.13). */
  jumping: {
    'run-step-right': string;
    'run-step-left': string;
    'jump-go-up': string;
    'jump-apex': string;
    'jump-go-down': string;
  };
  /** Flight: reused by Underwater_Buoyancy (Req 30.9, 33.11). */
  flight: {
    'fly-up': string;
    'fly-apex': string;
    'fly-down': string;
  };
  /** Zigzag diagonal frames (Req 30.10). */
  zigzag: {
    'zigzag-up': string;
    'zigzag-down': string;
  };
  /** Transition spin cue, Flight<->Zigzag (Req 30.11). */
  spin: {
    'spin-1': string;
    'spin-2': string;
  };
  /** World 5 finale crawl cycle (Req 30.12, 30.14). */
  crawl: {
    'crawl-step-right': string;
    'crawl-step-left': string;
  };
}

/**
 * Obstacle_Category asset keys across every world (Req 24.11, 38.1-38.2).
 * Naming convention: `<world|context>_<descriptor>_[position]`. Underwater
 * categories are context-named (not world-numbered) because they are reused by
 * any underwater Sequence (Req 5.11, 38.2). Empty string => placeholder.
 */
export interface ObstacleCategoriesConfig {
  world1_ground_obstacle: string;
  world2_pillar_top: string;
  world2_pillar_bottom: string;
  world3_zigzag_wall: string;
  /** From the top while underwater (Req 5.11, 38.2). */
  ceiling_underwater_obstacle: string;
  /** From the bottom while underwater (Req 5.11, 38.2). */
  floor_underwater_obstacle: string;
  world5_barrier: string;
}

/** A tint overlay applied to a palette target (Req 38.3-38.4). */
export interface PaletteOverlay {
  name: string;
  /** What the overlay tints, e.g. "background" or "obstacles+kino" (atomic). */
  target: string;
  /** Hex tint color. */
  tint: string;
  /** Overlay alpha 0..1. */
  alpha: number;
  /** Optional gate condition, e.g. "underwaterSequence" (Req 38.4, 38.7). */
  appliesWhen?: string;
}

/** Element-level color treatment per world, not background-only (Req 27.13-27.14, 38.3). */
export interface ColorPalette {
  background: string;
  obstacles: string;
  kino: string;
  overlays: PaletteOverlay[];
}

/** A single mentor dialogue line with an alternating speaker (Req 42.1-42.6). */
export interface MentorDialogueLine {
  /** "mentor" or "kino". */
  speaker: string;
  text: string;
}

/** Credits / bloopers cinematic slots (Req 21.9). */
export interface CinematicsConfig {
  creditsSlots: string[];
  blooperSlots: string[];
}

/** Audio asset keys (Req 25.1-25.6, 24.7). Empty string => placeholder/none. */
export interface AudioConfig {
  jump: string;
  fly: string;
  zigzag: string;
  underwater: string;
  evolution: string;
  collision: string;
  ui: string;
  mentorReaction: string;
}

/** Existing starter art wired in up front (Req 24.7). */
export interface StarterAssetsConfig {
  kinoSprite: string;
  exampleUi: string;
}

/** Skill id union (display/flavor rarity keys use these, Req 36). */
export type SkillId =
  | 'secondChance'
  | 'timeErase'
  | 'dash'
  | 'timeSlow'
  | 'scoreMultiplier'
  | 'ultraInstinct'
  | 'nuke';

/** Which skill is unlocked by each milestone (Req 36.1-36.3). Editable. */
export interface SkillUnlockSchedule {
  world1First: SkillId;
  world2First: SkillId;
  world3First: SkillId;
  world4First: SkillId;
  world5First: SkillId;
  generation1Complete: SkillId;
  generation2Complete: SkillId;
}

/** Rarity tier string (display/flavor only, Req 36.4-36.6). */
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'legendary';

// ---------------------------------------------------------------------------
// Balance block types — grouped, self-documenting sub-sections (Req 33.x,
// 26.8). Organized by system so any tunable is easy to locate; see the inline
// unit / default / sensible-range comments on the default object below.
// ---------------------------------------------------------------------------

/** movement — per-mode physics (Req 2-6). */
export interface MovementBalance {
  jump: { impulse: number; gravity: number };
  flight: { impulse: number; gravity: number };
  underwater: { impulse: number; buoyancy: number };
  zigzag: { angleDeg: number; speed: number };
}

/** difficulty — scroll speed, obstacle density, thresholds (Req 7, 23, 45, 46). */
export interface DifficultyBalance {
  scrollSpeed: {
    base: number;
    rampPerObstacle: number;
    maxMultiplier: number;
  };
  obstacleDensity: {
    baseGapPx: number;
    minGapPx: number;
  };
  /** Points at which the next world unlocks (Req 7.1). */
  worldUnlockThreshold: number;
  /** Obstacle counts at which perk choices are offered (Req 10.1-10.2). */
  perkObstacleMilestones: number[];
}

/** skills — per-skill cooldown / duration / magnitude (Req 12-18, 35). */
export interface SkillsBalance {
  secondChance: { windowS: number };
  timeErase: { windowS: number };
  dash: { distancePx: number; durationS: number };
  timeSlow: { factor: number; durationS: number };
  scoreMultiplier: { factor: number; durationS: number };
  ultraInstinct: { durationS: number };
  cooldownS: { default: number };
}

/** perks — boost/cooldown percentages and cosmetic drop probability (Req 10-11). */
export interface PerksBalance {
  /** Speed Boost perk, percent (Req 11.2). */
  speedBoostPct: number;
  /** Reduced Skill Cooldown perk, percent (Req 11.1). */
  cooldownReductionPct: number;
  /** Probability of a cosmetic appearing at a perk slot (Req 11.5, 10.8). */
  cosmeticDropProbability: number;
}

/** hitboxes — per-mode body-sprite hitbox scale, < 1 to favor the player (Req 41). */
export interface HitboxesBalance {
  scale: {
    default: number;
    jumping: number;
    flight: number;
    zigzag: number;
    underwater: number;
  };
}

/** transitions — telegraph lead distance (Req 6.3). */
export interface TransitionsBalance {
  telegraph: { leadPx: number };
}

/** The tunable balance block, split into clearly labeled sub-sections. */
export interface BalanceConfig {
  movement: MovementBalance;
  difficulty: DifficultyBalance;
  skills: SkillsBalance;
  perks: PerksBalance;
  hitboxes: HitboxesBalance;
  transitions: TransitionsBalance;
}

/** The complete Config_File shape. */
export interface ConfigFileData {
  names: NamesConfig;
  labels: LabelsConfig;
  animationFrames: AnimationFramesConfig;
  /** "menu-equip-jiggle" asset key (Req 33.15-33.16, 43.4-43.5). */
  menuEquipJiggle: string;
  obstacleCategories: ObstacleCategoriesConfig;
  colorPalettes: PerWorld<ColorPalette>;
  mentorImages: PerWorld<string>;
  mentorDialogue: PerWorld<MentorDialogueLine[]>;
  mentorSymbols: PerWorld<string>;
  worldBackgrounds: PerWorld<string>;
  worldMusic: PerWorld<string>;
  audio: AudioConfig;
  starterAssets: StarterAssetsConfig;
  cinematics: CinematicsConfig;
  /** Evolution visual style key (Req 29.9). */
  evolutionStyle: string;
  skillUnlockSchedule: SkillUnlockSchedule;
  skillRarity: Record<SkillId, RarityTier>;
  cosmeticRarityColors: Record<RarityTier, string>;
  balance: BalanceConfig;
}

// ---------------------------------------------------------------------------
// The default Config_File — sensible starting values, fully populated so every
// required key exists (Req 33.6 fallback target, 47.1). Asset paths default to
// "" (placeholder fallback) except the starter art that already ships.
// ---------------------------------------------------------------------------

export const defaultConfig: ConfigFileData = {
  names: {
    baseCharacterName: 'Kino', // Req 29.12, 32.2
    generationalScheme: {
      format: '{base} {roman} {suffix}', // -> "Kino III Junior"
      juniorSuffix: 'Junior',
      seniorSuffix: 'Senior',
      startIteration: 1,
    },
    mentors: {
      world1: 'Officer Kino-Route-53',
      world2: 'Engineer Kino-EC2',
      world3: 'Archivist Kino',
      world4: 'Storage Keeper Kino',
      world5: 'Commander Kino-IAM',
    },
    worlds: {
      world1: 'Desert',
      world2: 'Foundry',
      world3: 'Memory Jungle',
      world4: 'Ice & Underwater',
      world5: 'Security Citadel',
    },
  },

  labels: {
    startStory: 'Start Story',
    continueStory: 'Continue Story',
    permissionGag: 'aws:button:not-allowed', // Req 21.12
    play: 'Play',
    retry: 'Retry',
    menu: 'Menu',
    pause: 'Pause', // Req 7.9 run-HUD pause control
    resume: 'Resume', // Req 7.13 PauseScene resume control
    paused: 'Paused', // PauseScene heading
    newWorldUnlocked: 'New world unlocked!',
    endlessStarting: 'Endless mode starting...',
    endlessConfirm: 'Endless Mode is outside story progression.',
  },

  animationFrames: {
    jumping: {
      'run-step-right': '',
      'run-step-left': '',
      'jump-go-up': '',
      'jump-apex': '',
      'jump-go-down': '',
    },
    flight: {
      'fly-up': '',
      'fly-apex': '',
      'fly-down': '',
    },
    // Underwater_Buoyancy REUSES flight frames (Req 30.9, 33.11) — no separate keys.
    zigzag: {
      'zigzag-up': '',
      'zigzag-down': '',
    },
    spin: {
      'spin-1': '', // transition spin (Req 30.11)
      'spin-2': '',
    },
    crawl: {
      'crawl-step-right': '', // W5 finale (Req 30.12)
      'crawl-step-left': '',
    },
  },
  menuEquipJiggle: '', // "menu-equip-jiggle" key (Req 33.15-33.16, 43.4-43.5)

  obstacleCategories: {
    world1_ground_obstacle: '',
    world2_pillar_top: '',
    world2_pillar_bottom: '',
    world3_zigzag_wall: '',
    ceiling_underwater_obstacle: '', // Req 5.11, 38.2
    floor_underwater_obstacle: '', // Req 5.11, 38.2
    world5_barrier: '',
  },

  colorPalettes: {
    world1: {
      background: '#E8A33D',
      obstacles: '#C77D2E',
      kino: '#F5E6C8',
      overlays: [],
    },
    world2: {
      background: '#B5451F',
      obstacles: '#6E6E6E',
      kino: '#F0C27B',
      overlays: [
        { name: 'lavaGlow', target: 'background', tint: '#FF6A00', alpha: 0.25 },
      ],
    },
    world3: {
      background: '#123A5E',
      obstacles: '#2E7D4F',
      kino: '#CFECCC',
      overlays: [],
    },
    world4: {
      background: '#7FD3E0',
      obstacles: '#D7F2F7',
      kino: '#EAFBFF',
      overlays: [
        {
          name: 'underwaterBlue',
          target: 'obstacles+kino', // atomic (Req 38.4)
          tint: '#1E6FB0',
          alpha: 0.35,
          appliesWhen: 'underwaterSequence',
        },
      ],
    },
    world5: {
      background: '#2B2F36',
      obstacles: '#4A4F57',
      kino: '#E6E6E6',
      overlays: [
        { name: 'redAlert', target: 'background', tint: '#C81E1E', alpha: 0.2 },
      ],
    },
  },

  mentorImages: {
    world1: '',
    world2: '',
    world3: '',
    world4: '',
    world5: '',
  },
  mentorDialogue: {
    world1: [
      { speaker: 'mentor', text: '' },
      { speaker: 'kino', text: '' },
    ],
    world2: [
      { speaker: 'mentor', text: '' },
      { speaker: 'kino', text: '' },
    ],
    world3: [
      { speaker: 'mentor', text: '' },
      { speaker: 'kino', text: '' },
    ],
    world4: [
      { speaker: 'mentor', text: '' },
      { speaker: 'kino', text: '' },
    ],
    world5: [
      { speaker: 'mentor', text: '' },
      { speaker: 'kino', text: '' },
    ],
  },
  mentorSymbols: {
    world1: 'Route53',
    world2: 'EC2',
    world3: 'Databases',
    world4: 'Glacier',
    world5: 'IAM',
  },

  worldBackgrounds: {
    world1: '',
    world2: '',
    world3: '',
    world4: '',
    world5: '',
  },
  worldMusic: {
    world1: '',
    world2: '',
    world3: '',
    world4: '',
    world5: '',
  },
  audio: {
    jump: 'assets/jump.wav',
    fly: '',
    zigzag: '',
    underwater: '',
    evolution: '',
    collision: 'assets/game_over.wav',
    ui: '',
    mentorReaction: '',
  },
  starterAssets: {
    kinoSprite: 'assets/ghosty.png', // Req 24.7
    exampleUi: 'img/example-ui.png',
  },

  cinematics: {
    creditsSlots: [],
    blooperSlots: [],
  },

  evolutionStyle: 'electric-zap-glow-burst', // Req 29.9

  skillUnlockSchedule: {
    // fixed list order matched to world order; gen1->6th, gen2->7th (Req 36.1-36.3)
    world1First: 'secondChance',
    world2First: 'timeErase',
    world3First: 'dash',
    world4First: 'timeSlow',
    world5First: 'scoreMultiplier',
    generation1Complete: 'ultraInstinct',
    generation2Complete: 'nuke',
  },
  skillRarity: {
    secondChance: 'common',
    timeErase: 'rare',
    dash: 'common',
    timeSlow: 'uncommon',
    scoreMultiplier: 'rare',
    ultraInstinct: 'legendary',
    nuke: 'legendary',
  },
  cosmeticRarityColors: {
    common: '#B0B0B0',
    uncommon: '#49A94A',
    rare: '#2E7CD6',
    legendary: '#C9931F',
  },

  // -------------------------------------------------------------------------
  // balance — the ONE home for tunable constants (Req 26.8, 33.1-33.5).
  // Split into labeled sub-sections; every value carries unit / default /
  // sensible min-max so an edit stays within safe bounds without reading code.
  // -------------------------------------------------------------------------
  balance: {
    // --- movement: per-mode physics (Req 2-6) ---
    movement: {
      jump: {
        impulse: 520, // px/s up — default 520, sensible 350–700 (Req 2.1)
        gravity: 1600, // px/s² down — default 1600, sensible 1000–2200 (Req 2.2)
      },
      flight: {
        impulse: 300, // px/s up — default 300, sensible 180–480 (Req 3.1)
        gravity: 900, // px/s² down — default 900, sensible 500–1400 (Req 3.2)
      },
      underwater: {
        impulse: 300, // px/s down (inverted) — default 300, sensible 180–480 (Req 5.2)
        buoyancy: 900, // px/s² up — default 900, sensible 500–1400 (Req 5.1)
      },
      zigzag: {
        angleDeg: 30, // degrees from horizontal — default 30, sensible 20–45 (Req 4.1)
        speed: 260, // px/s along diagonal — default 260, sensible 160–380 (Req 4.8)
      },
    },

    // --- difficulty: scroll speed, density, thresholds (Req 7, 23, 45, 46) ---
    difficulty: {
      scrollSpeed: {
        base: 220, // px/s — default 220, sensible 140–320 (Req 45, 7.6)
        rampPerObstacle: 2.5, // px/s per cleared obstacle — default 2.5, sensible 0–6 (Req 7.6, 23.3)
        maxMultiplier: 2.2, // × base — default 2.2, sensible 1.2–3.0 (Req 7.6)
      },
      obstacleDensity: {
        baseGapPx: 360, // px between units — default 360, sensible 260–520 (Req 46, 23.3)
        minGapPx: 210, // px floor as difficulty ramps — default 210, sensible 150–300 (Req 23.3)
      },
      worldUnlockThreshold: 50, // points — default 50, sensible 30–100 (Req 7.1)
      perkObstacleMilestones: [20, 40], // obstacle counts — default [20,40], sensible pairs 10–60 (Req 10.1-10.2)
    },

    // --- skills: per-skill cooldown / duration / magnitude (Req 12-18, 35) ---
    skills: {
      secondChance: {
        windowS: 3, // s protective window — default 3, sensible 1–5 (Req 13.1)
      },
      timeErase: {
        windowS: 4, // s armed window — default 4, sensible 2–6 (Req 14.1)
      },
      dash: {
        distancePx: 260, // px burst — default 260, sensible 150–420 (Req 15.2)
        durationS: 0.25, // s burst duration — default 0.25, sensible 0.1–0.5 (Req 15.2)
      },
      timeSlow: {
        factor: 0.5, // × speed — default 0.5, sensible 0.3–0.8 (Req 16.2)
        durationS: 5, // s — default 5, sensible 2–8 (Req 16.2)
      },
      scoreMultiplier: {
        factor: 2, // × credited score — default 2, sensible 2–5 (Req 17.1)
        durationS: 10, // s — default 10, sensible 5–20 (Req 17.1)
      },
      ultraInstinct: {
        durationS: 10, // s auto-evasion — default 10, sensible 5–20 (Req 18.1)
      },
      cooldownS: {
        default: 12, // s default skill cooldown — default 12, sensible 6–30 (Req 12.3)
      },
    },

    // --- perks: boost/cooldown percentages, cosmetic drop (Req 10-11) ---
    perks: {
      speedBoostPct: 12, // % faster — default +12, sensible 5–30 (Req 11.2)
      cooldownReductionPct: 20, // % shorter cooldown — default -20, sensible 10–50 (Req 11.1)
      cosmeticDropProbability: 0.35, // probability at a perk slot — default 0.35, sensible 0–1 (Req 11.5, 10.8)
    },

    // --- hitboxes: per-mode body-sprite scale, < 1 favors player (Req 41) ---
    hitboxes: {
      scale: {
        default: 0.7, // × sprite — default 0.70, sensible 0.5–0.9 (Req 41.1)
        jumping: 0.72, // × sprite — default 0.72, sensible 0.5–0.9 (Req 41.2)
        flight: 0.68, // × sprite — default 0.68, sensible 0.5–0.9 (Req 41.2)
        zigzag: 0.75, // × sprite — default 0.75, sensible 0.5–0.9 (Req 41.2)
        underwater: 0.68, // × sprite — default 0.68, sensible 0.5–0.9 (Req 41.2)
      },
    },

    // --- transitions: telegraph lead (Req 6.3) ---
    transitions: {
      telegraph: {
        leadPx: 500, // px before a transition — default 500, sensible 300–800 (Req 6.3)
      },
    },
  },
};
