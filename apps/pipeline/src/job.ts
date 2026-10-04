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
export async function createJob(dir: string, fps = 24): Promise<Job> {
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

/**
 * Ensures `<job.dir>/<relativePath>/` exists and returns its path. Callers
 * pass the full path relative to the job root, e.g. `framesDir(job,
 * 'source')`, `framesDir(job, '2-portrait/raw')`,
 * `framesDir(job, `7-dreams/${take}/frames`)` — the numbered `N-<panel>/`
 * prefix is what makes panels 1-6 naturally shared across every dream take
 * (their paths don't mention a take at all) while panel 7 naturally isn't
 * (its path always includes one), without this helper needing to know
 * anything about "static" vs "dynamic" itself. See
 * plans/done/ (pipeline-folder-numbering doc) for the full layout.
 */
export async function framesDir(job: Job, relativePath: string): Promise<string> {
  const dir = path.join(job.dir, relativePath)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Ensures the parent directory of `<job.dir>/<relativePath>.<ext>` exists
 * and returns that full file path — same "caller specifies the full
 * relative path" shape as `framesDir`, for compiled videos instead of
 * frame folders (e.g. `videoPath(job, 'video/cropped')`,
 * `videoPath(job, '2-portrait/video/panel')`,
 * `videoPath(job, `7-dreams/${take}/composite`)`).
 */
export async function videoPath(job: Job, relativePath: string, ext = 'mov'): Promise<string> {
  const fullPath = path.join(job.dir, `${relativePath}.${ext}`)
  await mkdir(path.dirname(fullPath), { recursive: true })
  return fullPath
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
  fn: (inputPath: string, outputPath: string) => Promise<void>,
  opts: { only?: (frame: string, index: number) => boolean } = {}
): Promise<void> {
  const frames = (await readdir(inputDir))
    .filter(isFramePath)
    .sort()
    .filter((frame, i) => opts.only?.(frame, i) ?? true)

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

/**
 * Indices (0-based, into a sorted frame list) of a stepped sequence's
 * keyframes — `0, interval, 2*interval, ...`. Shared by `background-plate`
 * (which only generates fill at these frames) and `background-stabilize`
 * (which only ever shows fill from them), so the two can't drift apart.
 */
export function keyframeIndices(frameCount: number, interval: number): number[] {
  const indices: number[] = []
  for (let i = 0; i < frameCount; i += interval) indices.push(i)
  return indices
}

/** Path to the first (lowest-numbered) frame in a frame directory. */
export async function firstFrame(dir: string): Promise<string> {
  const frames = await listFrames(dir)
  if (frames.length === 0) throw new Error(`No frames found in ${dir}`)
  return path.join(dir, frames[0])
}

/** Sorted list of frame filenames (not full paths) in a frame directory. */
export async function listFrames(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter(isFramePath).sort()
}

function isFramePath(f: string): boolean {
  return f.endsWith('.png') || f.endsWith('.jpg')
}

/**
 * Resolves the frame in `siblingDir` matching `inputPath`'s frame number,
 * regardless of extension. Different frame directories can use different
 * formats now (alpha masks stay lossless PNG while photographic frames are
 * lossy JPEG for size), so a sibling frame isn't guaranteed to share
 * `inputPath`'s extension the way it shares its frame number.
 */
export async function siblingFramePath(inputPath: string, siblingDir: string): Promise<string> {
  const base = path.basename(inputPath, path.extname(inputPath))
  for (const ext of ['png', 'jpg']) {
    const candidate = path.join(siblingDir, `${base}.${ext}`)
    if (await exists(candidate)) return candidate
  }
  throw new Error(`No matching frame for "${base}" in ${siblingDir}`)
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

/**
 * Extracts `videoPath` into `<outputDir>/0001.<ext>`, `0002.<ext>`, ... at
 * `fps`. `ext: 'jpg'` is used for frames that are large, photographic, and
 * either terminal or tolerant of recompression (source); lossless `png`
 * (the default) is for anything that needs exact pixel values preserved,
 * like alpha mattes.
 */
export async function extractFrames(
  sourceVideoPath: string,
  outputDir: string,
  fps: number,
  ext: 'png' | 'jpg' = 'png'
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  const args = ['-y', '-i', sourceVideoPath, '-r', String(fps)]
  if (ext === 'jpg') args.push('-q:v', '2')
  args.push(path.join(outputDir, `%04d.${ext}`))
  await execFileAsync('ffmpeg', args)
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
  opts: { fps: number; scale?: string; crf?: number; ext?: 'png' | 'jpg' }
): Promise<void> {
  const args = [
    '-y',
    '-framerate',
    String(opts.fps),
    '-i',
    path.join(inputFramesDir, `%04d.${opts.ext ?? 'png'}`),
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
