/**
 * All gameplay tuning constants live here. This is the file that answers
 * "is the Color Cascade mechanic fun?" — expect to change these dozens of times.
 *
 * Nothing in here may depend on Phaser; it is imported by the pure core logic
 * and by the unit tests.
 */
export type NeighbourMode = 'orthogonal' | 'diagonal';

export const GAMEPLAY_CONFIG = {
  /**
   * Determinism (§2.2.1). In Phase 1 the client generates its own seed.
   * In Phase 2 the SERVER supplies it and the client never chooses one.
   * Fixed seeds also make playtest sessions reproducible and bugs repeatable.
   */
  DEFAULT_SEED: 0x5EED,

  BOARD_SIZE: 8,
  TRAY_SIZE: 3,
  PALETTE_SIZE: 5,

  // ── Cascade tuning — the critical knobs ────────────────────────────────
  /**
   * Maximum number of cascade generations after generation 0.
   *
   * Set to 64 — the cell count of an 8x8 board — so it can never bite: a
   * connected region cannot be longer than the board, so the whole blob always
   * detonates. A partially-eaten cluster reads as a bug to a player, and it is
   * indefensible to leave a visual lie in place for balance reasons.
   *
   * This retires the depth cap as a difficulty lever. Difficulty now comes from
   * POWERUP_CHARGE_COST and COLOUR_AFFINITY. The truncation logic stays in the
   * resolver, tested, because Phase 4 content variants (larger boards) may want
   * it back.
   */
  MAX_CASCADE_DEPTH: 64,
  /** 'orthogonal' = 4-way propagation. 'diagonal' = 8-way (much longer chains). */
  NEIGHBOUR_MODE: 'orthogonal' as NeighbourMode,

  /**
   * Colour spawn weighting.
   *   0.0 = uniform random colour for every spawned piece.
   *   1.0 = every spawned piece takes the most common colour currently on the board.
   * Tuned to 0 in Step 8. §2.2 warned that uniform random "makes cascades feel
   * arbitrary", but that was written for the whole-line rule, where the player
   * did not choose which colour detonated. Under colour-locked clearing the
   * player builds the cluster deliberately, so weighted spawning stops being a
   * legibility aid and becomes free help: at 0.45 games ran 454 placements and
   * only 15% ended. Revisit this against real playtesting — it is the value
   * most likely to need moving.
   */
  COLOUR_AFFINITY: 0.0,

  /**
   * Per-colour score multiplier, integers so scoring stays exact (rule 3).
   *
   * Lime (2) pays double because it is the one colour that charges no power-up.
   * Without this it was strictly the worst colour to clear, which made building
   * lime clusters a pure waste — now it is the greed option: no tool, more
   * points.
   */
  COLOUR_SCORE_MULTIPLIER: [1, 1, 2, 1, 1] as readonly number[],

  // ── Scoring ────────────────────────────────────────────────────────────
  /** Generation N cells score POINTS_PER_CELL_BASE × (N + 1) each. */
  POINTS_PER_CELL_BASE: 10,
  POINTS_PER_CELL_PLACED: 1,
  /** Cells removed by a power-up score a flat rate, with no generation bonus. */
  POINTS_PER_CELL_POWERUP: 5,

  // ── Power-ups ──────────────────────────────────────────────────────────
  POWERUPS_ENABLED: true,
  /**
   * Tiles of a colour you must clear to charge that colour's power-up.
   * Charging is per colour, so the colour you keep detonating is the tool you
   * keep earning — the cluster you build decides which ability you get.
   *
   * Raised 24 -> 36 after playtest round 1: meters refilled fast enough that a
   * player nearly out of moves could always buy their way out, so the board
   * never actually closed in.
   *
   * Raised 36 -> 72 in round 2, to pay for uncapping the cascade. Letting a
   * whole blob detonate handed a lot of board back, and measured at 600 games
   * it undid the difficulty gain: games reaching a game over fell 93.9% -> 72.7%
   * and the median game tripled. Charge cost is now the lever carrying that
   * load, and it is the right one — both rounds of playtest feedback said
   * power-ups were too available.
   *   cost 36: 75.0% of games end, median 202 placements, 6.0 power-ups/game
   *   cost 54: 82.3%, median 89, 4.1/game
   *   cost 72: 89.0%, median 56, 2.7/game
   *
   * Settled at 40 in round 3: 72 restored the difficulty on paper but made the
   * power-up rotation feel wrong in the hand, and rotation is the thing being
   * tuned. Difficulty is now carried by the obstacle mechanic below, which
   * limits game length without taxing the chain payoff the game is built on.
   */
  POWERUP_CHARGE_COST: 40,
  /** Every this many points, every meter tops up by POWERUP_MILESTONE_BONUS. */
  POWERUP_SCORE_MILESTONE: 2000,
  POWERUP_MILESTONE_BONUS: 8,

  /**
   * Relative spawn weight per colour id, as integers so selection stays exact
   * and reproducible (rule 3). Equal weights mean uniform.
   *
   * Violet (4) is held 10% below the rest because it charges Pluck, which
   * deletes a whole connected blob and was the strongest tool in playtesting.
   * Starving it slightly is a gentler lever than weakening the ability itself.
   */
  COLOUR_SPAWN_WEIGHTS: [100, 100, 100, 100, 90] as readonly number[],

  // ── Obstacles ──────────────────────────────────────────────────────────
  /**
   * Periodically a single grey cube joins the tray. Once placed it is part of
   * the wall forever: it counts as filled for completing a line, matches no
   * colour, and nothing removes it.
   *
   * This is the difficulty lever that does not fight the core loop. Capping
   * chain depth made the game harder by taking away the payoff players come
   * for; obstacles make it harder by shrinking the board they get to play on,
   * and each one is a real decision — spend it somewhere it will not sever a
   * cluster you are building.
   */
  OBSTACLES_ENABLED: true,
  /**
   * 'placements' grants one every N pieces; 'points' one every N points.
   *
   * A/B at 600 games each settled this. Every 100 placements barely registered
   * — 1.6 cubes in an average game, median length 159 against a control of
   * 169 — because a typical game never runs long enough to earn many. The
   * points trigger works, and it works for a reason worth keeping: a stronger
   * player scores faster, so they meet more walls. Difficulty tracks skill
   * instead of the clock, which no constant can do.
   *
   *   control (off)      75.5% of games end, median 169, 0 cubes
   *   /100 placements     86.8%, median 159, 1.6 cubes
   *   /1000 points        97.8%, median 103, 13.2 cubes
   *   /1500 points        91.3%, median 103, 8.5 cubes   <- chosen
   *   /2500 points        91.0%, median 127, 6.0 cubes
   *
   * 1000 ended nearly every game and buried a fifth of the board; 1500 keeps
   * the pressure while leaving a long run possible.
   */
  OBSTACLE_TRIGGER: 'points' as 'placements' | 'points',
  OBSTACLE_EVERY_PLACEMENTS: 100,
  OBSTACLE_EVERY_POINTS: 1500,

  /**
   * Escalation: once this many obstacles are on the board, the easy filler
   * shapes stop spawning. Playtesting spotted that walls cut both ways — a
   * grey cube permanently fills a cell, so the lines it sits in need fewer
   * coloured placements to complete, which makes clears MORE frequent and
   * speeds scoring. Since obstacles are earned per point, that compounds.
   * Removing the small shapes takes back the easy outs at the same moment.
   *
   * Measured at 500 games each:
   *   obstacles off        44.0% of placements clear, mean game 231
   *   obstacles on         50.3% clear, mean 158, 90.8% of games end
   *   + limit after 5      47.0% clear, mean 130, 96.6% of games end
   *
   * The middle row is the problem the playtest spotted: turning obstacles on
   * RAISED the clear rate by 6.3 points. The escalation pulls it back toward
   * baseline and cuts the mean game by 18% while barely moving the median
   * (106 -> 104), which is the right shape — it kills runaway games without
   * punishing an ordinary one.
   *
   * 0 disables the escalation entirely.
   */
  SHAPE_LIMIT_AFTER_OBSTACLES: 5,
  /** Shapes withdrawn once the threshold is reached. */
  SHAPE_LIMIT_WITHDRAWN: ['1x1', '1x2', '2x1'] as readonly string[],

  // ── Feel ───────────────────────────────────────────────────────────────
  /** Pause between cascade generations so the chain is watchable. */
  CASCADE_STEP_DELAY_MS: 90,
  /** Camera shake amplitude per generation (pixels). */
  SCREEN_SHAKE_PER_GENERATION: 2,
  /** Hard cap on shake amplitude regardless of generation. */
  SCREEN_SHAKE_MAX: 10,
};

export type GameplayConfig = typeof GAMEPLAY_CONFIG;
