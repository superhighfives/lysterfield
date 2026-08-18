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
  diffusionclip:
    'gwang-kim/diffusionclip:a64682eb3defe354c15ffdd1afb0790c7644d83e8439964d1249f24ac9e998ad',
  zoedepth: 'cjwbw/zoedepth:6375723d97400d3ac7b88e3022b738bf6f433ae165c4a2acd1955eaa6b8fcb62',
  realEsrgan: 'cjwbw/real-esrgan:d0ee3d708c9b911f122a4ad90046c5d26a0293b99476d697f6bb7f2e251ce2d4',
  robustVideoMatting:
    'arielreplicate/robust_video_matting:73d2128a371922d5d1abf0712a1d974be0e4e2358cc1218e4e34714767232bac',
  propainter: 'jd7h/propainter:e5ea7ae04e97c96a0e14c70d8e4cb899abdf326a377c01f1c10966ccd6c6bae4',
} as const satisfies Record<string, `${string}/${string}:${string}`>
