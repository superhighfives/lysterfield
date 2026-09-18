import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { forEachFrame, framesDir, siblingFramePath, type Job } from '../job.ts'
import { reshapeMask } from '../mask.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

export interface BackgroundPlateResult {
  /** Per-frame stills with the subject erased. */
  plateFramesDir: string
}

/**
 * Softened from an earlier version that explicitly asked for "a lone tree"
 * — that produced a crisp, hard-shadowed focal tree that was the single
 * biggest source of visible per-frame identity flicker on real footage (see
 * plans/in-progress/panel-3-background-flicker-mitigation.md). Comparing
 * against the legacy pipeline's own background plates showed the real fix
 * isn't "no tree" specifically, it's an overall softer, more abstract style
 * with no crisp edges anywhere — nothing sharp enough to read as
 * "identity-shifted" between frames. A 3-frame test confirmed this prompt
 * plus a lower `guidance` (see the call site below) reliably drops the
 * discrete-tree problem as a side effect, without a separate negative
 * prompt (flux-fill-pro's schema doesn't have one).
 */
const FILL_PROMPT =
  'soft hazy meadow, loose abstract watercolor wash, indistinct diffuse brushstrokes, no sharp edges or defined objects, muted washed-out palette, dreamlike atmospheric blur, natural continuation of the surrounding field'

/**
 * Mask reshaping itself (dilate + blur, `reshapeMask` in `../mask.ts`) is
 * what stops flux-fill-pro reconstructing a person: at max guidance it did
 * so on ~30% of a 20-frame sample (see models.ts) when given the exact
 * person-shaped alpha mask — the shape itself, not just prompt weight, was
 * pulling the model toward "there's a person here". A same-model retest on
 * those exact failure frames plus 8 fresh ones (11/11 clean) confirmed the
 * heavily dilated + blurred mask, which no longer reads as a person
 * silhouette, removes that pull. Two alternatives were tried and rejected:
 * an SDXL-inpainting hybrid primed with LaMa's fill regenerated the same
 * ghost-person artifact (LaMa's own silhouette-shaped shading was enough
 * of a shape cue), and negative-prompt suppression alone (no reshaping)
 * avoided people but was visibly less temporally consistent frame-to-frame
 * (tree size/color varying more) and produced at least one off-palette
 * result (a purple-blossomed tree).
 */

/**
 * With no seed, flux-fill-pro's per-frame independence showed up as real
 * flicker across a clip — a dirt path appearing/disappearing and tree
 * sharpness shifting between adjacent frames just ~0.7s apart. A fixed
 * seed across every frame in a scene (still one independent call per
 * frame — no actual temporal conditioning) cut that dramatically in a
 * 10-frame side-by-side: tree shape/size/position held steady and the
 * path stayed consistently present. Hashing `job.dir` keeps the seed
 * stable for a given scene while still varying between scenes.
 */
function seedForJob(job: Job): number {
  let hash = 0
  for (let i = 0; i < job.dir.length; i++) {
    hash = (hash * 31 + job.dir.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * Erases the subject from each frame, driven by the matte's alpha frames
 * instead of the legacy pipeline's manual click-to-select SAM step
 * (`pc-settings/script.sh`).
 *
 * Originally implemented against `jd7h/propainter` (a temporally-consistent
 * *video* object-removal model) to avoid frame-to-frame flicker — but that
 * model's Cog wrapper fails its own mask-extension validation against every
 * Replicate-hosted file URL we could produce (`mask.suffix` check in its
 * `predict.py`; reproduced with clean, freshly-uploaded `.mp4`/`.png` URLs
 * via a raw API call, so it's a bug in that model, not our upload). Fell
 * back to per-frame `allenhooo/lama` (image + mask) as the phase 3 spec
 * anticipated, but its prompt-free fill hallucinated a woven-fabric texture
 * over the subject instead of continuing the meadow — see `models.ts` for
 * the side-by-side that replaced it with prompt-guided flux-fill-pro,
 * `reshapeMask` above for why the mask itself also needed reshaping, and
 * `seedForJob` below for the frame-to-frame flicker fix within this step.
 *
 * Originally ran on the raw *source* frames, with panel 3 built by running
 * `artwork()` again on this step's output (erase, then stylize). On real
 * footage that produced severe frame-to-frame flicker — DiffusionCLIP is
 * genuinely deterministic (confirmed by re-running it on identical input),
 * but small, visually-negligible per-frame differences in flux-fill-pro's
 * *generated* fill texture got chaotically amplified into large, visible
 * instability (a whole tree appearing/disappearing between frames). Neither
 * piece was unstable on its own — flux-fill-pro's raw fill was stable
 * frame-to-frame, and DiffusionCLIP was equally stable on real photographic
 * source (panel 2) — the instability was specific to DiffusionCLIP
 * processing flux-fill-pro's synthetic content.
 *
 * Fix: run this step *after* styling instead of before, on panel 2's
 * already-generated, already-stable `artwork-upscaled` frames — confirmed
 * to fix the flicker in a side-by-side test. This also means panel 3 no
 * longer needs its own `artwork()`/`upscale()` calls at all: fed an
 * already-1024px input, flux-fill-pro's own output lands at 1024px too,
 * exactly `compose.ts`'s `PANEL_SIZE`, so this step's output is panel 3's
 * final frames directly.
 */
export async function backgroundPlate(
  job: Job,
  inputFramesDir: string,
  alphaFramesDir: string,
  outputName: string,
  concurrency: number
): Promise<BackgroundPlateResult> {
  const plateFramesDir = await framesDir(job, outputName)
  const maskTmpDir = await mkdtemp(path.join(tmpdir(), 'lysterfield-background-plate-mask-'))
  const seed = seedForJob(job)

  try {
    await forEachFrame(inputFramesDir, plateFramesDir, concurrency, async (inputPath, outputPath) => {
      const alphaPath = await siblingFramePath(inputPath, alphaFramesDir)
      const frameBase = path.basename(inputPath, path.extname(inputPath))
      // Always PNG regardless of the source frame's format — this is a
      // freshly-generated temp mask (not a lookup), immediately fed to
      // flux-fill-pro and deleted, so there's no size benefit to making it
      // lossy and every reason to keep its blurred gradient exact.
      const reshapedMaskPath = path.join(maskTmpDir, `${frameBase}.png`)
      await reshapeMask(alphaPath, reshapedMaskPath)

      await runModelToFile(
        MODELS.backgroundInpaint,
        {
          image: await readFileAsInput(inputPath),
          mask: await readFileAsInput(reshapedMaskPath),
          prompt: FILL_PROMPT,
          // Lower than flux-fill-pro's max (100) on purpose — less strict
          // prompt adherence gives the model room to actually be loose/
          // abstract instead of defaulting to a crisp, detailed object. See
          // FILL_PROMPT's comment above.
          guidance: 35,
          seed,
        },
        outputPath,
        { jpegQuality: 90 }
      )
    })
  } finally {
    await rm(maskTmpDir, { recursive: true, force: true })
  }

  return { plateFramesDir }
}
