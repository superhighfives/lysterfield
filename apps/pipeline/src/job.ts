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
 * Ensures `<job.dir>/static/frames/<name>/` exists and returns its path.
 * "static" because every per-frame intermediate (source, alpha, artwork,
 * background-plate, depth, outline, and their upscales) is independent of
 * which dream take eventually gets composited — generate once, reuse
 * across every take. See `dynamicPath` for the per-take counterpart.
 */
export async function framesDir(job: Job, name: string): Promise<string> {
  const dir = path.join(job.dir, 'static', 'frames', name)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Ensures `<job.dir>/static/video/` exists and returns the path for
 * `<name>.<ext>` (default `mov`) — take-independent video intermediates:
 * `init`'s cropped/original/full source compiles, `matte`'s alpha-source,
 * and compose.ts's per-panel compiles (panel-artwork etc). See
 * `dynamicPath` for outputs that depend on which dream take is selected.
 */
export async function videoPath(job: Job, name: string, ext = 'mov'): Promise<string> {
  const dir = path.join(job.dir, 'static', 'video')
  await mkdir(dir, { recursive: true })
  return path.join(dir, `${name}.${ext}`)
}

/**
 * Ensures `<job.dir>/dynamic/<take>/` exists and returns the path for
 * `<name>.<ext>` (default `mov`) — everything downstream of one specific
 * dream generation: the raw clip itself, its normalized panel, the
 * composite, and every final export. `take` is a caller-chosen name (e.g.
 * `take-1`), so a scene can carry several dream attempts side by side
 * without re-running steps 1-6 or colliding with each other.
 */
export async function dynamicPath(job: Job, take: string, name: string, ext = 'mov'): Promise<string> {
  const dir = path.join(job.dir, 'dynamic', take)
  await mkdir(dir, { recursive: true })
  return path.join(dir, `${name}.${ext}`)
}

/**
 * Ensures `<job.dir>/dynamic/<take>/frames/<name>/` exists and returns its
 * path — the per-take counterpart of `framesDir`. Only the dream panel
 * needs this: unlike every other panel (generated once from the source
 * footage, shared across every take), dream frames are themselves the
 * thing that differs between takes, so they can't live under the
 * take-independent `static/frames/`.
 */
export async function dynamicFramesDir(job: Job, take: string, name: string): Promise<string> {
  const dir = path.join(job.dir, 'dynamic', take, 'frames', name)
  await mkdir(dir, { recursive: true })
  return dir
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
  const frames = (await readdir(inputDir)).filter(isFramePath).sort()

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
