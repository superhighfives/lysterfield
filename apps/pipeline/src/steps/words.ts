import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { exists, extractFrames, listFrames, type Job } from '../job.ts'
import { WORDS_VIDEO_PATH } from '../resources.ts'

export interface WordsResult {
  framesDir: string
  frameCount: number
}

/**
 * Panel 1: extracts the shared lyrics video into `1-words/frames/` at the
 * job's fps, one frame per source frame, like every other panel. Free and
 * local; skipped once the frames exist.
 *
 * words.mov (202.7s) is shorter than the song (214.8s). Its lyrics end at
 * 197s and the rest is black, so the tail is padded by repeating its last
 * (black) frame — the same as the legacy per-frame words output. Extra
 * frames past the source's length (a short test job) are dropped.
 *
 * Frames are built in a temporary folder and only swapped in once complete.
 * An existing panel 1 with the wrong frame count is never replaced
 * automatically — it may have been reused or hand-fixed — so that throws.
 */
export async function words(job: Job, sourceFramesDir: string): Promise<WordsResult> {
  const outputDir = path.join(job.dir, '1-words', 'frames')
  const frameCount = (await listFrames(sourceFramesDir)).length
  if (frameCount === 0) throw new Error(`No frames found in ${sourceFramesDir}`)

  if (await exists(outputDir)) {
    const existing = (await listFrames(outputDir)).length
    if (existing === frameCount) return { framesDir: outputDir, frameCount }
    if (existing > 0) {
      throw new Error(
        `${outputDir} has ${existing} frames but the source has ${frameCount}. Not replacing it automatically; delete it to rebuild panel 1.`
      )
    }
  }

  const buildDir = `${outputDir}.building`
  await rm(buildDir, { recursive: true, force: true })
  await mkdir(buildDir, { recursive: true })
  await extractFrames(WORDS_VIDEO_PATH, buildDir, job.fps, 'jpg')
  const frames = await listFrames(buildDir)
  if (frames.length === 0) throw new Error(`Extracting ${WORDS_VIDEO_PATH} produced no frames`)

  for (const extra of frames.slice(frameCount)) await rm(path.join(buildDir, extra))
  const last = path.join(buildDir, frames[Math.min(frames.length, frameCount) - 1])
  for (let i = frames.length + 1; i <= frameCount; i++) {
    await copyFile(last, path.join(buildDir, `${String(i).padStart(4, '0')}.jpg`))
  }

  await rm(outputDir, { recursive: true, force: true })
  await rename(buildDir, outputDir)
  return { framesDir: outputDir, frameCount }
}
