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
  /** Frames per second to extract at. Matches the legacy pipeline's default. */
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
 * Crops the source video to a square (capped at 2160px, matching
 * `generate-init.sh`), extracts frames, and compiles two reference videos —
 * a 1024-wide "original" and a full-resolution "full". No Replicate calls.
 */
export async function init(jobDir: string, opts: InitOptions): Promise<InitResult> {
  const fps = opts.fps ?? 60
  const job = await createJob(jobDir, fps)

  const croppedVideoPath = await videoPath(job, 'cropped')
  if (!(await exists(croppedVideoPath))) {
    const args = ['-y']
    if (opts.offset !== undefined) args.push('-ss', String(opts.offset))
    args.push('-i', opts.sourceVideoPath)
    if (opts.length !== undefined) args.push('-t', String(opts.length))
    args.push(
      '-filter:v',
      "crop=w='min(min(iw\\,ih)\\,2160)':h='min(min(iw\\,ih)\\,2160)',scale=2160:2160,setsar=1",
      croppedVideoPath
    )
    await execFileAsync('ffmpeg', args)
  }

  const sourceFramesDir = await framesDir(job, 'source')
  if (!(await hasFiles(sourceFramesDir))) {
    await extractFrames(croppedVideoPath, sourceFramesDir, fps)
  }

  const originalVideoPath = await videoPath(job, 'original')
  if (!(await exists(originalVideoPath))) {
    await compileFramesToVideo(sourceFramesDir, originalVideoPath, {
      fps,
      scale: '1024:-1',
      crf: opts.crf,
    })
  }

  const fullVideoPath = await videoPath(job, 'full')
  if (!(await exists(fullVideoPath))) {
    await compileFramesToVideo(sourceFramesDir, fullVideoPath, { fps, crf: opts.crf })
  }

  return { job, croppedVideoPath, sourceFramesDir, originalVideoPath, fullVideoPath }
}
