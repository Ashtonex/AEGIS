/**
 * Cinematic clip registry — public website video slots
 * ─────────────────────────────────────────────────────────────────────────────
 * Every AI-generated (Seedance) or filmed clip on the public site is declared
 * here and nowhere else. A slot whose `src` is null renders its still image
 * only, so the site is complete with no video at all.
 *
 * To turn a clip on:
 *   1. Generate it with the prompt in docs/website/SEEDANCE_PROMPTS.md
 *   2. Encode it (commands in the same file) and drop it in /public/video/
 *   3. Set `src` below to its public path, e.g. "/video/hero-01.mp4"
 *
 * `poster` is the still shown before the clip is ready, under reduced motion,
 * on Save-Data connections, and whenever the clip fails to load.
 */

export interface CinematicClip {
  /** MP4 (H.264) path under /public, or null while the clip does not exist yet */
  src: string | null;
  /** Optional WebM (VP9/AV1) path — smaller, offered before the MP4 */
  webm?: string | null;
  /** Still image under /public — fallback and first frame */
  poster: string;
}

export const CLIPS = {
  /** Sequence 01 — hero background loop (8–10 s, seamless loop) */
  heroArrival: {
    src: null,
    webm: null,
    poster: "/arrival-01.jpg",
  },

  /**
   * Build sequence — scroll-scrubbed. Bare ground → finished building in one
   * continuous shot. MUST be encoded all-keyframe (see prompts doc) or
   * scrubbing will stutter.
   */
  buildScrub: {
    src: null,
    webm: null,
    poster: "/proj-earthworks.jpg",
  },

  /** Sequence 03 — one ambient loop per capability panel (5–6 s each) */
  capCivil: { src: null, webm: null, poster: "/cap-civil.jpg" },
  capPlant: { src: null, webm: null, poster: "/cap-plant.jpg" },
  capStructural: { src: null, webm: null, poster: "/cap-structural.jpg" },
  capAdvisory: { src: null, webm: null, poster: "/cap-advisory.jpg" },
} satisfies Record<string, CinematicClip>;

export type ClipId = keyof typeof CLIPS;
