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
   * The cascade is a flood fill of ONE colour, so the depth cap is what stops a
   * big cluster paying out in full.
   *
   * Tuned in Step 8 by sweeping 5 depths x 4 affinities, 1000 games at the
   * finalists. At 3 a typical game runs 129 placements (mean 185) and 89% of
   * games reach a game over. Raising it to 6 pushed length to 430 and dropped
   * the end rate to 22%: the game stopped being able to kill a competent
   * player. Dropping it to 2 shortens games further but caps the chain at a
   * single extra ring, which risks making the differentiating mechanic
   * invisible (§3.1's "too stingy" failure).
   */
  MAX_CASCADE_DEPTH: 3,
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
   */
  POWERUP_CHARGE_COST: 24,
  /** Every this many points, every meter tops up by POWERUP_MILESTONE_BONUS. */
  POWERUP_SCORE_MILESTONE: 2000,
  POWERUP_MILESTONE_BONUS: 8,

  // ── Feel ───────────────────────────────────────────────────────────────
  /** Pause between cascade generations so the chain is watchable. */
  CASCADE_STEP_DELAY_MS: 90,
  /** Camera shake amplitude per generation (pixels). */
  SCREEN_SHAKE_PER_GENERATION: 2,
  /** Hard cap on shake amplitude regardless of generation. */
  SCREEN_SHAKE_MAX: 10,
};

export type GameplayConfig = typeof GAMEPLAY_CONFIG;
