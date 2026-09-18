import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  compileFramesToVideo,
  createJob,
  exists,
  extractFrames,
  framesDir,
  hasFiles,
  videoPath,
  type Job,
} from '../job.ts'

const execFileAsync = promisify(execFile)

export interface InitOptions {
  sourceVideoPath: string
  /**
   * Frames per second to extract at. Default 24, not the legacy pipeline's
   * 60 — every per-frame step (background-plate, artwork, depth, outline,
   * upscale) is one Replicate call per frame, so fps is a direct cost
   * multiplier. 24fps reads as smooth motion and cuts a full-length scene's
   * per-frame call count by more than half.
   */
  fps?: number
  /** ffmpeg `-ss` — seconds to skip from the start. */
  offset?: number
  /** ffmpeg `-t` — seconds to process. */
  length?: number
  crf?: number
}

export interface InitResult {
  job: Job
  croppedVideoPath: string
  sourceFramesDir: string
  originalVideoPath: string
  fullVideoPath: string
}

/**
 * Crops the source video to a square (capped at 1280px — no model this
 * pipeline calls needs more: DiffusionCLIP works at 512px, flux-fill-pro
 * caps its own output around 1264px; the legacy pipeline's 2160px cap was
 * pure waste, ~3x the pixels for no visible benefit), extracts frames, and
 * compiles two reference videos — a 1024-wide "original" and a
 * full-resolution "full". No Replicate calls.
 *
 * Source frames are extracted as JPEG, not PNG — they're large,
 * photographic, and (bar `dream`'s single start-frame read) only ever feed
 * models that already tolerate real-world recompression. Every other
 * frame format decision follows from this one, since sibling directories
 * (alpha excepted — masks need exact pixel values) inherit whatever
 * extension their own source input uses.
 */
export async function init(jobDir: string, opts: InitOptions): Promise<InitResult> {
  const fps = opts.fps ?? 24
  const job = await createJob(jobDir, fps)

  const croppedVideoPath = await videoPath(job, 'cropped')
  if (!(await exists(croppedVideoPath))) {
    const args = ['-y']
    if (opts.offset !== undefined) args.push('-ss', String(opts.offset))
    args.push('-i', opts.sourceVideoPath)
    if (opts.length !== undefined) args.push('-t', String(opts.length))
    args.push(
      '-filter:v',
      "crop=w='min(min(iw\\,ih)\\,1280)':h='min(min(iw\\,ih)\\,1280)',scale=1280:1280,setsar=1",
      croppedVideoPath
    )
    await execFileAsync('ffmpeg', args)
  }

  const sourceFramesDir = await framesDir(job, 'source')
  if (!(await hasFiles(sourceFramesDir))) {
    await extractFrames(croppedVideoPath, sourceFramesDir, fps, 'jpg')
  }

  const originalVideoPath = await videoPath(job, 'original')
  if (!(await exists(originalVideoPath))) {
    await compileFramesToVideo(sourceFramesDir, originalVideoPath, {
      fps,
      scale: '1024:-1',
      crf: opts.crf,
      ext: 'jpg',
    })
  }

  const fullVideoPath = await videoPath(job, 'full')
  if (!(await exists(fullVideoPath))) {
    await compileFramesToVideo(sourceFramesDir, fullVideoPath, { fps, crf: opts.crf, ext: 'jpg' })
  }

  return { job, croppedVideoPath, sourceFramesDir, originalVideoPath, fullVideoPath }
}
