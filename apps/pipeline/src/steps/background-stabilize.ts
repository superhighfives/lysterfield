import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { exists, framesDir, listFrames, siblingFramePath, type Job } from '../job.ts'
import { detectLeaks, LEAK_SCORE_THRESHOLD, scoreLeak } from '../leak-detection.ts'
import { reshapeMask } from '../mask.ts'

const execFileAsync = promisify(execFile)

export interface BackgroundStabilizeResult {
  framesDir: string
  /** Keyframes that had a detected person-leak and were repaired from a neighboring frame, for logging. */
  repairs: { frame: string; replacedWith: string }[]
}

/**
 * Turns `background-plate.ts`'s raw per-frame fill (independent flux-fill-pro
 * calls, genuinely flickery frame-to-frame) into the final panel-3 frames,
 * using the two techniques validated in
 * plans/in-progress/panel-3-background-flicker-mitigation.md against real
 * footage:
 *
 * 1. **Held fill**: only every `stepFps`-th real frame ("keyframe") is used
 *    at all — every frame in its ~`fps/stepFps`-frame window shows that one
 *    keyframe's fill, held rather than blended. Matches panel 7 (dream)'s
 *    stepped cadence — a deliberate stop-motion look rather than random
 *    per-frame flicker, and needs no per-clip tuning.
 * 2. **Motion-compensated mask**: the *content* is held, but the mask that
 *    gates it is NOT — it's built from only the keyframes' reshaped alpha
 *    masks, then motion-interpolated (ffmpeg `minterpolate mi_mode=mci`)
 *    back up to full fps, so the cutout boundary glides continuously with
 *    the subject's real motion instead of freezing solid for each hold and
 *    snapping to the next shape. An earlier version held the mask in
 *    lockstep with the fill (`mi_mode=dup`) — clean, but the boundary was
 *    visibly more static than warranted; the motion-compensated version was
 *    confirmed by the user as the better result of the two, watching both
 *    in motion.
 *
 * Keyframe selection is deterministic (own logic, not ffmpeg's implicit
 * frame-selection behavior) — `1, 1+interval, 1+2*interval, ...` — so every
 * run is exactly reproducible and doesn't depend on reverse-engineering
 * ffmpeg's internal PTS rounding (an earlier scratch-script version relied
 * on ffmpeg's `fps=` filter's implicit choice, which turned out to be
 * off-by-one from a naive reading and caused a real repair mistake — see
 * the plan doc's "Repair — first attempt, wrong, corrected" section).
 *
 * Person-leak detection (`leak-detection.ts`) runs only against the
 * keyframes actually used — non-keyframe frames never surface in the
 * output no matter what they contain, so checking/repairing them would be
 * wasted work (an earlier manual pass did exactly that and had to be
 * reverted after the user caught the resulting stutter — see the plan
 * doc). A leaked keyframe is repaired by substituting the nearest clean
 * frame's fill content, found by searching outward in both directions.
 */
export async function stabilizeBackground(
  job: Job,
  fillFramesDir: string,
  alphaFramesDir: string,
  outputName: string,
  opts: { stepFps?: number; concurrency?: number } = {}
): Promise<BackgroundStabilizeResult> {
  const stepFps = opts.stepFps ?? 6
  const concurrency = opts.concurrency ?? 4
  if (job.fps % stepFps !== 0) {
    throw new Error(`job.fps (${job.fps}) must be an exact multiple of stepFps (${stepFps})`)
  }
  const interval = job.fps / stepFps

  const outputDir = await framesDir(job, outputName)
  const frames = await listFrames(fillFramesDir)
  if (frames.length === 0) throw new Error(`No frames found in ${fillFramesDir}`)

  const keyframeIndices: number[] = []
  for (let i = 0; i < frames.length; i += interval) keyframeIndices.push(i)

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'lysterfield-background-stabilize-'))
  try {
    // --- Leak detection + repair, keyframes only ---
    const keyframeCandidates = await Promise.all(
      keyframeIndices.map(async (i) => ({
        frame: frames[i],
        fillPath: path.join(fillFramesDir, frames[i]),
        alphaPath: await siblingFramePath(path.join(fillFramesDir, frames[i]), alphaFramesDir),
      }))
    )
    const leaks = await detectLeaks(keyframeCandidates)
    const leakedFrames = new Set(leaks.map((l) => l.frame))
    const repairs: { frame: string; replacedWith: string }[] = []
    const contentSource = new Map<number, string>() // keyframe index -> frame filename to actually use

    for (const i of keyframeIndices) {
      const frame = frames[i]
      if (!leakedFrames.has(frame)) {
        contentSource.set(i, frame)
        continue
      }
      const replacement = await findCleanNeighbor(i, frames, fillFramesDir, alphaFramesDir, leakedFrames)
      contentSource.set(i, replacement)
      repairs.push({ frame, replacedWith: replacement })
    }

    // --- Build the motion-compensated mask sequence from keyframes only ---
    const keyframeMaskDir = path.join(tmpDir, 'keyframe-masks')
    await mkdir(keyframeMaskDir, { recursive: true })
    for (let k = 0; k < keyframeIndices.length; k++) {
      const i = keyframeIndices[k]
      const alphaPath = await siblingFramePath(path.join(fillFramesDir, frames[i]), alphaFramesDir)
      await reshapeMask(alphaPath, path.join(keyframeMaskDir, `${String(k + 1).padStart(4, '0')}.png`))
    }

    const keyframeMaskVideo = path.join(tmpDir, 'keyframe-masks.mp4')
    await execFileAsync('ffmpeg', [
      '-y',
      '-framerate',
      String(stepFps),
      '-i',
      path.join(keyframeMaskDir, '%04d.png'),
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '15',
      '-c:v',
      'libx264',
      keyframeMaskVideo,
    ])

    const mciMaskVideo = path.join(tmpDir, 'mci-mask.mp4')
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      keyframeMaskVideo,
      '-vf',
      `minterpolate='mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:fps=${job.fps}'`,
      '-pix_fmt',
      'yuv420p',
      mciMaskVideo,
    ])

    const mciMaskFramesDir = path.join(tmpDir, 'mci-mask-frames')
    await mkdir(mciMaskFramesDir, { recursive: true })
    await execFileAsync('ffmpeg', ['-y', '-i', mciMaskVideo, '-q:v', '2', path.join(mciMaskFramesDir, '%04d.jpg')])
    const mciMaskFrameNames = await listFrames(mciMaskFramesDir)

    if (mciMaskFrameNames.length < frames.length) {
      const shortfall = frames.length - mciMaskFrameNames.length
      if (shortfall > interval) {
        console.warn(
          `background-stabilize: mci-interpolated mask produced ${mciMaskFrameNames.length} frames, expected ${frames.length} (short by ${shortfall}, more than one keyframe interval) — padding tail by repeating the last frame. This is a bigger gap than the small ffmpeg rounding drift normally seen; worth investigating if it recurs.`
        )
      }
    }

    // --- Composite ---
    const firstMeta = await sharp(path.join(fillFramesDir, frames[0])).metadata()
    const width = firstMeta.width!
    const height = firstMeta.height!
    const channels = 3

    const fillCache = new Map<string, Buffer>()
    async function loadFillRaw(frame: string): Promise<Buffer> {
      const cached = fillCache.get(frame)
      if (cached) return cached
      const buf = await sharp(path.join(fillFramesDir, frame)).resize(width, height).raw().toBuffer()
      fillCache.set(frame, buf)
      return buf
    }

    let cursor = 0
    async function worker() {
      while (cursor < frames.length) {
        const i = cursor++
        const frame = frames[i]
        const outputPath = path.join(outputDir, frame)
        if (await exists(outputPath)) continue

        const keyframeIndex = Math.floor(i / interval) * interval
        const heldFrame = contentSource.get(keyframeIndex) ?? frames[keyframeIndex]

        const baseRaw = await loadFillRaw(frame)
        const heldRaw = await loadFillRaw(heldFrame)

        const maskFrameName = mciMaskFrameNames[Math.min(i, mciMaskFrameNames.length - 1)]
        const maskRaw = await sharp(path.join(mciMaskFramesDir, maskFrameName))
          .resize(width, height)
          .greyscale()
          .raw()
          .toBuffer()

        const out = Buffer.alloc(width * height * channels)
        for (let p = 0; p < width * height; p++) {
          const a = maskRaw[p] / 255
          for (let c = 0; c < channels; c++) {
            const idx = p * channels + c
            out[idx] = Math.round(heldRaw[idx] * a + baseRaw[idx] * (1 - a))
          }
        }

        await sharp(out, { raw: { width, height, channels } }).jpeg({ quality: 90 }).toFile(outputPath)
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))

    return { framesDir: outputDir, repairs }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Searches outward (alternating +1/-1) from `index` for the nearest frame
 * that isn't itself a leak. Candidates are re-scored individually (not just
 * checked against the keyframe-only leak set) since a repair target doesn't
 * have to be a keyframe, and non-keyframe frames were never scored earlier.
 */
async function findCleanNeighbor(
  index: number,
  frames: string[],
  fillFramesDir: string,
  alphaFramesDir: string,
  knownBad: Set<string>
): Promise<string> {
  for (let d = 1; d < frames.length; d++) {
    for (const candidate of [index - d, index + d]) {
      if (candidate < 0 || candidate >= frames.length) continue
      const frame = frames[candidate]
      if (knownBad.has(frame)) continue
      const fillPath = path.join(fillFramesDir, frame)
      const alphaPath = await siblingFramePath(fillPath, alphaFramesDir)
      const score = await scoreLeak(fillPath, alphaPath)
      if (score <= LEAK_SCORE_THRESHOLD) return frame
      knownBad.add(frame)
    }
  }
  throw new Error(`No clean neighbor found for frame at index ${index} — every frame appears to be a leak`)
}
