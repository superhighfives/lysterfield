/**
 * Pinned Replicate model versions. Pinning is required, not just best
 * practice — the "owner/name" latest-version shorthand 404s on every model
 * this pipeline uses (confirmed against the live API), so every call must
 * go through the explicit "owner/name:version" form.
 *
 * Re-check these against `https://api.replicate.com/v1/models/<owner>/<name>`
 * (`latest_version.id`) periodically; a model owner publishing a new
 * version doesn't change these until bumped here deliberately.
 */
export const MODELS = {
  /**
   * Artwork step — replaced `gwang-kim/diffusionclip` (a 2022, cog 0.4.1
   * community model) after it hit a 3-hour boot hang mid-pipeline; see
   * phase 3's plan for that diagnosis. First replacement was Google's
   * `nano-banana-2` (matched the watercolor style convincingly, given the
   * frame plus a style-reference image via `image_input`) but at
   * $0.07/call and two calls per frame (artwork + background panels),
   * cost was the dominant line item — phase 5's real-footage cost check
   * put a full scene at ~$80+ even at a modest 2fps, ~$1,800+ at the
   * legacy pipeline's 60fps. Replaced again with `black-forest-labs/
   * flux-kontext-dev`: an official, open-weights image-editing model that
   * preserves the source frame's identity/composition while applying the
   * watercolor look purely from a text prompt — no separate style-
   * reference image needed, unlike nano-banana-2. See phase 5's plan for
   * the cost/quality comparison.
   */
  artwork:
    'black-forest-labs/flux-kontext-dev:85723d503c17da3f9fd9cecfb9987a8bf60ef747fd8f68a25d7636f88260eb59',
  zoedepth: 'cjwbw/zoedepth:6375723d97400d3ac7b88e3022b738bf6f433ae165c4a2acd1955eaa6b8fcb62',
  realEsrgan: 'cjwbw/real-esrgan:d0ee3d708c9b911f122a4ad90046c5d26a0293b99476d697f6bb7f2e251ce2d4',
  robustVideoMatting:
    'arielreplicate/robust_video_matting:73d2128a371922d5d1abf0712a1d974be0e4e2358cc1218e4e34714767232bac',
  /**
   * Per-frame image inpainting for the background-plate step. Originally
   * tried `jd7h/propainter` (temporally-consistent video inpainting) — its
   * Cog wrapper's mask-extension validation fails against every
   * Replicate-hosted file URL, reproduced via raw API calls with clean
   * URLs, so it's a bug in that model, not fixable from our side.
   */
  lama: 'allenhooo/lama:cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72',
  /** Dreaming step — see phase 2's prototyping for why this was picked over Grok Imagine. */
  dream:
    'kwaivgi/kling-v3-omni-video:460d4f46adf3c29abbcd8f42cf5434570da6b50a39ec4593f2006486b1dd3fba',
  /**
   * Outline step — the packaged ArtLine model from `models/outline/`
   * (phase 2), no public port exists. Runs on CPU, not GPU — a `gpu: true`
   * build of this same checkpoint boots fine locally but reliably failed to
   * boot on Replicate's actual GPU workers (stuck in "starting", every
   * hardware tier, across a week and several fresh pushes). See phase 3b's
   * plan for the full diagnosis; the fix was dropping GPU entirely, not a
   * code change — CPU predict time is ~0.8s per frame anyway.
   */
  outline:
    'superhighfives/lysterfield-outline:0731a7247a52e0578f5b92ea6e6cbf763bcaa411d1927c40d86582514c9d0bb9',
} as const satisfies Record<string, `${string}/${string}:${string}`>
