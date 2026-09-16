import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { forEachFrame, framesDir, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { readFileAsInput, runModelToFile } from '../replicate.ts'

const execFileAsync = promisify(execFile)

export interface BackgroundPlateResult {
  /** Per-frame stills with the subject erased. */
  plateFramesDir: string
}

const FILL_PROMPT =
  'open grass field with wildflowers, a lone tree, and trees in the far distance, natural continuation of the surrounding meadow, photorealistic'

/**
 * Growing/feathering the mask well past the matte's precise silhouette.
 * flux-fill-pro at max guidance still reconstructed a person on ~30% of a
 * 20-frame sample (see models.ts) when given the exact person-shaped alpha
 * mask — the shape itself, not just prompt weight, was pulling the model
 * toward "there's a person here". A same-model retest on those exact
 * failure frames plus 8 fresh ones (11/11 clean) confirmed a heavily
 * dilated + blurred mask — which no longer reads as a person silhouette —
 * removes that pull. Two alternatives were tried and rejected: an
 * SDXL-inpainting hybrid primed with LaMa's fill regenerated the same
 * ghost-person artifact (LaMa's own silhouette-shaped shading was enough
 * of a shape cue), and negative-prompt suppression alone (no reshaping)
 * avoided people but was visibly less temporally consistent frame-to-frame
 * (tree size/color varying more) and produced at least one off-palette
 * result (a purple-blossomed tree).
 */
const MASK_DILATION_PASSES = 100
const MASK_BLUR_SIGMA = 30

async function reshapeMask(alphaPath: string, outputPath: string): Promise<void> {
  const dilations = Array(MASK_DILATION_PASSES).fill('dilation').join(',')
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    alphaPath,
    '-vf',
    `format=gray,${dilations},gblur=sigma=${MASK_BLUR_SIGMA}`,
    outputPath,
  ])
}

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
 * `seedForJob` below for the frame-to-frame flicker fix.
 */
export async function backgroundPlate(
  job: Job,
  sourceFramesDir: string,
  alphaFramesDir: string,
  concurrency: number
): Promise<BackgroundPlateResult> {
  const plateFramesDir = await framesDir(job, 'background-plate')
  const maskTmpDir = await mkdtemp(path.join(tmpdir(), 'lysterfield-background-plate-mask-'))
  const seed = seedForJob(job)

  try {
    await forEachFrame(sourceFramesDir, plateFramesDir, concurrency, async (inputPath, outputPath) => {
      const alphaPath = path.join(alphaFramesDir, path.basename(inputPath))
      const reshapedMaskPath = path.join(maskTmpDir, path.basename(inputPath))
      await reshapeMask(alphaPath, reshapedMaskPath)

      await runModelToFile(
        MODELS.backgroundInpaint,
        {
          image: await readFileAsInput(inputPath),
          mask: await readFileAsInput(reshapedMaskPath),
          prompt: FILL_PROMPT,
          guidance: 100,
          seed,
          // flux-fill-pro defaults to jpg — force png so the bytes actually
          // match the .png extension forEachFrame/ffmpeg expect downstream.
          output_format: 'png',
        },
        outputPath
      )
    })
  } finally {
    await rm(maskTmpDir, { recursive: true, force: true })
  }

  return { plateFramesDir }
}
