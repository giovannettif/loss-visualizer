/**
 * Manim / 3Blue1Brown identity palette — exact hexes from the project visual bar.
 *
 * Background is near-black #0b0d10; light exists only as glowing strokes,
 * terrain and text. Panels are flat with 1px hairline borders. These constants
 * are the single source of truth for every view in the project.
 */

export const MANIM = {
  blue: 0x58c4dd,
  teal: 0x5cd0b3,
  green: 0x83c167,
  yellow: 0xf4d345,
  gold: 0xf0ac5f,
  red: 0xfc6255,
  purple: 0x9a72ac,
  /** Learner / ball identity color. */
  white: 0xffffff,
  /** Captions and secondary UI text. */
  greyText: 0x9aa4b2,
  /** Page / viewport background. */
  background: 0x0b0d10,
} as const;

/**
 * Optimizer identity colors (visual bar):
 * vanilla GD = RED, momentum = BLUE, Adam = YELLOW, learner/ball = WHITE,
 * and the §8 workbench's assembled rule = PURPLE.
 */
export const OPTIMIZER_COLORS = {
  gd: MANIM.red,
  momentum: MANIM.blue,
  adam: MANIM.yellow,
  learner: MANIM.white,
  custom: MANIM.purple,
} as const;

/** CSS twins for DOM scorecards/labels (kept next to the numeric palette). */
export const OPTIMIZER_CSS_COLORS = {
  gd: "#FC6255",
  momentum: "#58C4DD",
  adam: "#F4D345",
  learner: "#FFFFFF",
  custom: "#9A72AC",
} as const;

