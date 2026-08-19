import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface Job {
  /** Root working directory for this run, e.g. `.jobs/<scene-id>/`. */
  dir: string
  /** Frame rate used throughout this job — matches the source video's extraction rate. */
  fps: number
}

/** Creates a new job, persisting its metadata to `<dir>/job.json` so `loadJob` can pick it up later. */
export async function createJob(dir: string, fps = 60): Promise<Job> {
  await mkdir(dir, { recursive: true })
  const job = { dir, fps }
  await writeFile(path.join(dir, 'job.json'), JSON.stringify({ fps }))
  return job
}

/** Loads a job previously created with `createJob` — for CLI invocations that run one step at a time. */
export async function loadJob(dir: string): Promise<Job> {
  const { fps } = JSON.parse(await readFile(path.join(dir, 'job.json'), 'utf8'))
  return { dir, fps }
}

/** Ensures `<job.dir>/frames/<name>/` exists and returns its path. */
export async function framesDir(job: Job, name: string): Promise<string> {
  const dir = path.join(job.dir, 'frames', name)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Ensures `<job.dir>/video/` exists and returns the path for `<name>.<ext>` (default `mov`). */
export async function videoPath(job: Job, name: string, ext = 'mov'): Promise<string> {
  const dir = path.join(job.dir, 'video')
  await mkdir(dir, { recursive: true })
  return path.join(dir, `${name}.${ext}`)
}

/**
 * Runs `fn` once per frame found in `inputDir`, writing to the matching path
 * in `outputDir` — skipping any frame whose output already exists, mirroring
 * the legacy scripts' `[ -f ... ] ||` / `if not os.path.exists()` checks.
 * Runs up to `concurrency` frames at once.
 */
export async function forEachFrame(
  inputDir: string,
  outputDir: string,
  concurrency: number,
  fn: (inputPath: string, outputPath: string) => Promise<void>
): Promise<void> {
  const frames = (await readdir(inputDir)).filter((f) => f.endsWith('.png')).sort()

  let cursor = 0
  async function worker() {
    while (cursor < frames.length) {
      const frame = frames[cursor++]
      const inputPath = path.join(inputDir, frame)
      const outputPath = path.join(outputDir, frame)
      if (await exists(outputPath)) continue
      await fn(inputPath, outputPath)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
}

/** Path to the first (lowest-numbered) frame in a frame directory. */
export async function firstFrame(dir: string): Promise<string> {
  const frames = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort()
  if (frames.length === 0) throw new Error(`No frames found in ${dir}`)
  return path.join(dir, frames[0])
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** True if `dir` exists and contains at least one entry. */
export async function hasFiles(dir: string): Promise<boolean> {
  if (!(await exists(dir))) return false
  return (await readdir(dir)).length > 0
}

/** Extracts `videoPath` into `<outputDir>/0001.png`, `0002.png`, ... at `fps`. */
export async function extractFrames(
  sourceVideoPath: string,
  outputDir: string,
  fps: number
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    sourceVideoPath,
    '-r',
    String(fps),
    path.join(outputDir, '%04d.png'),
  ])
}

/**
 * Compiles a frame folder into a reference `.mov` — the pattern every
 * per-frame step in the legacy pipeline used to produce a scrubbable
 * preview (`generate-*.sh`'s recurring `ffmpeg -framerate ... -i %04d.png`
 * block). `scale` matches the legacy scripts' `-vf scale=1024:-1`; omit for
 * a full-resolution compile.
 */
export async function compileFramesToVideo(
  inputFramesDir: string,
  outputVideoPath: string,
  opts: { fps: number; scale?: string; crf?: number }
): Promise<void> {
  const args = [
    '-y',
    '-framerate',
    String(opts.fps),
    '-i',
    path.join(inputFramesDir, '%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
  ]
  if (opts.scale) args.push('-vf', `scale=${opts.scale}`)
  if (opts.crf !== undefined) args.push('-crf', String(opts.crf))
  args.push(outputVideoPath)
  await execFileAsync('ffmpeg', args)
}
