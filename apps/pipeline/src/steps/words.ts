import { copyFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { extractFrames, framesDir, listFrames, type Job } from '../job.ts'
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
 */
export async function words(job: Job, sourceFramesDir: string): Promise<WordsResult> {
  const outputDir = await framesDir(job, '1-words/frames')
  const frameCount = (await listFrames(sourceFramesDir)).length
  if (frameCount === 0) throw new Error(`No frames found in ${sourceFramesDir}`)

  let frames = await listFrames(outputDir)
  if (frames.length !== frameCount) {
    await rm(outputDir, { recursive: true, force: true })
    await extractFrames(WORDS_VIDEO_PATH, outputDir, job.fps, 'jpg')
    frames = await listFrames(outputDir)
    for (const extra of frames.slice(frameCount)) await rm(path.join(outputDir, extra))
    const last = path.join(outputDir, frames[Math.min(frames.length, frameCount) - 1])
    for (let i = frames.length + 1; i <= frameCount; i++) {
      await copyFile(last, path.join(outputDir, `${String(i).padStart(4, '0')}.jpg`))
    }
  }

  return { framesDir: outputDir, frameCount }
}
