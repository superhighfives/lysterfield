import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { forEachFrame, framesDir, keyframeIndices, listFrames, siblingFramePath, type Job } from '../job.ts'
import { reshapeMask } from '../mask.ts'
import { LEAK_SCORE_THRESHOLD, scoreLeak } from '../leak-detection.ts'
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
 *
 * The full-video pilot (frames 2001-2240, a wider fill area than the 15s
 * clip) still invented defined objects: a paved road with lane markings,
 * a red barn, a wind turbine, a power pole, a water channel, and one
 * signature-like scribble. Hence the explicit "only grass, sky and the
 * existing boardwalk" framing and the named exclusions at the end.
 *
 * The full run's commonest reject was an invented person: walkers on the
 * boardwalk where the subject walks away from camera (their real shadow
 * sits outside the mask and seems to cue flux into completing a figure),
 * and distant walkers at the far end. Bumping the seed alone reproduced
 * them almost exactly, hence the leading positive "empty, deserted, with
 * nobody on it" framing.
 *
 * "no text or signatures" was swapped for "a plain unsigned painting":
 * naming signatures seemed to prime them. ~75 full-run fills (mostly the
 * second clip) had a faint script signature inside the mask. The reworded
 * prompt removed it in 3/3 tests but shifts the look, so regenerate a
 * stretch as a whole rather than alternating prompts per keyframe.
 */
const FILL_PROMPT =
  'an empty, deserted landscape with nobody on the boardwalk, only open grassland, sky and the existing wooden boardwalk, soft hazy meadow, loose abstract watercolor wash, indistinct diffuse brushstrokes, no sharp edges or defined objects, muted washed-out palette, dreamlike atmospheric blur, natural continuation of the surrounding field, no buildings, no poles, no roads, no water, a plain unsigned painting'

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
 *
 * Only `background-stabilize`'s keyframes (every `fps/stepFps`-th frame)
 * are filled — the stabilized panel only ever shows fill held from those
 * frames, with panel 2's own frame as the base outside the mask, so
 * filling the rest was ~3/4 of this step's Replicate cost for nothing.
 * `stepFps` must match the value `background-stabilize` is run with.
 */
export async function backgroundPlate(
  job: Job,
  inputFramesDir: string,
  alphaFramesDir: string,
  outputName: string,
  concurrency: number,
  opts: { stepFps?: number; regenerateLeaks?: boolean } = {}
): Promise<BackgroundPlateResult> {
  const stepFps = opts.stepFps ?? 6
  if (job.fps % stepFps !== 0) {
    throw new Error(`job.fps (${job.fps}) must be an exact multiple of stepFps (${stepFps})`)
  }
  const inputFrames = await listFrames(inputFramesDir)
  const keyframes = new Set(keyframeIndices(inputFrames.length, job.fps / stepFps).map((i) => inputFrames[i]))

  const plateFramesDir = await framesDir(job, outputName)
  const rejectedDir = path.join(plateFramesDir, '..', `${path.basename(plateFramesDir)}-rejected`)
  await mkdir(rejectedDir, { recursive: true })
  const maskTmpDir = await mkdtemp(path.join(tmpdir(), 'lysterfield-background-plate-mask-'))
  const baseSeed = seedForJob(job)

  try {
    await forEachFrame(inputFramesDir, plateFramesDir, concurrency, async (inputPath, outputPath) => {
      const frameIndex = inputFrames.indexOf(path.basename(inputPath))
      const alphaPath = await siblingFramePath(inputPath, alphaFramesDir)
      // The mask covers the subject across this keyframe's whole hold
      // window *and* the next keyframe — `background-stabilize` shows this
      // fill for every frame until then, with a per-frame mask that moves
      // with the subject, so the fill has to be clean everywhere they go.
      const windowAlphaPaths = await Promise.all(
        inputFrames
          .slice(frameIndex, Math.min(inputFrames.length, frameIndex + job.fps / stepFps + 1))
          .map((f) => siblingFramePath(path.join(inputFramesDir, f), alphaFramesDir))
      )
      const frameBase = path.basename(inputPath, path.extname(inputPath))
      // Always PNG regardless of the source frame's format — this is a
      // freshly-generated temp mask (not a lookup), immediately fed to
      // flux-fill-pro and deleted, so there's no size benefit to making it
      // lossy and every reason to keep its blurred gradient exact.
      const reshapedMaskPath = path.join(maskTmpDir, `${frameBase}.png`)
      await reshapeMask(windowAlphaPaths, reshapedMaskPath)

      // Each earlier rejection of this frame (automatic below, or a manual
      // `mv` into the rejected folder after review) bumps the seed, so a
      // regeneration is a genuinely different fill. The seed stays
      // otherwise fixed per scene (see seedForJob).
      const priorRejections = async () =>
        (await readdir(rejectedDir)).filter((f) => f.startsWith(`${frameBase}.`)).length
      const generate = async (attempt: number) =>
        runModelToFile(
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
            seed: baseSeed + attempt,
          },
          outputPath,
          { jpegQuality: 90 }
        )

      const attempt = await priorRejections()
      await generate(attempt)

      // Free, local person-leak check on every fill as it lands. By default
      // it only logs: on full-video it flagged ~1 in 5 fills, and 11 of 12
      // sampled were false positives (planks and orange flowers read as
      // skin). It also can't see a figure from behind, the commonest real
      // leak, so visual review is what actually catches leaks.
      // `regenerateLeaks` opts back into one capped regeneration per frame
      // (the original goes to the rejected folder, and the redo uses the
      // next seed). A second failure is kept for stabilize's leak repair.
      const score = await scoreLeak(outputPath, alphaPath)
      if (score > LEAK_SCORE_THRESHOLD && !opts.regenerateLeaks) {
        console.warn(`background-plate: ${frameBase} leak score ${score.toFixed(3)} — flagged for review (not regenerated)`)
      } else if (score > LEAK_SCORE_THRESHOLD && attempt === 0) {
        await rename(outputPath, path.join(rejectedDir, `${frameBase}.${attempt}${path.extname(outputPath)}`))
        console.warn(`background-plate: ${frameBase} leak score ${score.toFixed(3)} — regenerating once with a new seed`)
        await generate(attempt + 1)
        const retryScore = await scoreLeak(outputPath, alphaPath)
        if (retryScore > LEAK_SCORE_THRESHOLD) {
          console.warn(`background-plate: ${frameBase} still scores ${retryScore.toFixed(3)} after regeneration — keeping it for stabilize's leak repair`)
        }
      }
    }, { only: (frame) => keyframes.has(frame) })
  } finally {
    await rm(maskTmpDir, { recursive: true, force: true })
  }

  return { plateFramesDir }
}
