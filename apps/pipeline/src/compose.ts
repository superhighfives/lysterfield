import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { compileFramesToVideo, dynamicPath, firstFrame, videoPath as jobVideoPath, type Job } from './job.ts'

const execFileAsync = promisify(execFile)

const PANEL_SIZE = 1024
const RESOURCES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources')

/**
 * Fixed, non-per-scene assets — one words.mov + one audio track shared by
 * every scene. Matches the legacy `generate-videos.sh`'s literal paths
 * (`resources/words/words.mov`, `resources/audio/lysterfield-lake.wav`).
 */
export const WORDS_VIDEO_PATH = path.join(RESOURCES_DIR, 'words', 'words.mov')
export const AUDIO_PATH = path.join(RESOURCES_DIR, 'audio', 'lysterfield-lake.wav')

export interface ComposeInput {
  /** upscale.ts output on the raw source frames */
  artworkFramesDir: string
  /** background-stabilize.ts output (background-plate.ts's raw fill, stepped + motion-compensated for temporal consistency — see background-stabilize.ts) */
  backgroundFramesDir: string
  matteFramesDir: string
  depthFramesDir: string
  outlineFramesDir: string
  /** Which dream attempt to composite — see job.ts's `dynamicPath`. Every output below is written under `dynamic/<take>/`. */
  take: string
  /** dream.ts output — a per-take frames folder, same shape as the other panels (see job.ts's `dynamicFramesDir`). */
  dreamFramesDir: string
  /** Overrides the real audio's duration for the final clip length — for a quick review render against a short test job's actual unique frame count, rather than looping/clipping to a full ~3.5min song. Real scenes should never set this. */
  durationSeconds?: number
}

export interface ComposeResult {
  /** The uncompressed 7-panel hstack + audio mux, before compression. */
  compositeVideoPath: string
  videoPath: string
  videoWebmPath: string
  videoSmallPath: string
  videoSmallWebmPath: string
  /** 5s loop clip cropped from the dream panel — apps/client's choose-screen asset. */
  loopPath: string
  /** apps/client's choose-screen thumbnail, from the artwork panel's first frame. */
  heroImagePath: string
}

/**
 * Ports generate-videos.sh: 7-panel hstack (words, artwork, background,
 * matte, depth, outline, dream — the exact order the client shader
 * expects) + audio mux, clipped to the audio's length, then the
 * video/video-small/loop/hero compression passes.
 */
export async function compose(job: Job, input: ComposeInput): Promise<ComposeResult> {
  const staticDir = path.join(job.dir, 'static')
  await mkdir(staticDir, { recursive: true })

  const audioDuration = input.durationSeconds ?? (await probeDuration(AUDIO_PATH))

  const artworkPanel = await normalizeFramesPanel(job, 'artwork', input.artworkFramesDir, 'jpg')
  const backgroundPanel = await normalizeFramesPanel(job, 'background', input.backgroundFramesDir, 'jpg')
  const mattePanel = await normalizeFramesPanel(job, 'matte', input.matteFramesDir, 'png')
  const depthPanel = await normalizeFramesPanel(job, 'depth', input.depthFramesDir, 'jpg')
  const outlinePanel = await normalizeFramesPanel(job, 'outline', input.outlineFramesDir, 'jpg')
  const dreamPanel = await normalizeDreamPanel(job, input.take, input.dreamFramesDir)

  const compositeVideoPath = await dynamicPath(job, input.take, 'composite')
  await hstackWithAudio(
    [WORDS_VIDEO_PATH, artworkPanel, backgroundPanel, mattePanel, depthPanel, outlinePanel, dreamPanel],
    compositeVideoPath,
    { fps: job.fps, duration: audioDuration }
  )

  const videoPath = await dynamicPath(job, input.take, 'video')
  const videoWebmPath = await dynamicPath(job, input.take, 'video', 'webm')
  await compress(compositeVideoPath, videoPath)
  await compress(compositeVideoPath, videoWebmPath)

  const videoSmallPath = await dynamicPath(job, input.take, 'video-small')
  const videoSmallWebmPath = await dynamicPath(job, input.take, 'video-small', 'webm')
  await compress(compositeVideoPath, videoSmallPath, { half: true })
  await compress(compositeVideoPath, videoSmallWebmPath, { half: true })

  const loopPath = await dynamicPath(job, input.take, 'loop')
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    '3',
    '-t',
    '5',
    '-i',
    dreamPanel,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '28',
    loopPath,
  ])

  // Take-independent — only depends on the artwork panel, so it lives under
  // static/ rather than dynamic/<take>/ even though compose() recomputes it
  // on every call (cheap local resize, not worth caching separately).
  const heroImagePath = path.join(staticDir, 'hero.jpg')
  await sharp(await firstFrame(input.artworkFramesDir))
    .resize(PANEL_SIZE, PANEL_SIZE)
    .jpeg({ quality: 85 })
    .toFile(heroImagePath)

  return {
    compositeVideoPath,
    videoPath,
    videoWebmPath,
    videoSmallPath,
    videoSmallWebmPath,
    loopPath,
    heroImagePath,
  }
}

/** Compiles a frame folder into a PANEL_SIZE² square panel video — every frame-based panel is already square, so this is a plain resize, no crop. Take-independent, so it's cached under static/ via jobVideoPath. `ext` must match the frame folder's actual format (alpha/matte stays png; everything else is jpg — see init.ts). */
async function normalizeFramesPanel(job: Job, name: string, framesDir: string, ext: 'png' | 'jpg'): Promise<string> {
  const out = await jobVideoPath(job, `panel-${name}`)
  await compileFramesToVideo(framesDir, out, { fps: job.fps, scale: `${PANEL_SIZE}:${PANEL_SIZE}`, ext })
  return out
}

/**
 * The dream panel is now a per-frame folder like every other panel (see
 * `dream.ts` — flux-kontext-dev called once per kept frame, with the
 * stepped/held cadence already baked into the frame sequence itself), the
 * one difference being it's take-specific so its compiled video lives
 * under `dynamic/<take>/` rather than the shared `static/video/` every
 * other panel's compile is cached under.
 */
async function normalizeDreamPanel(job: Job, take: string, framesDir: string): Promise<string> {
  const out = await dynamicPath(job, take, 'panel-dream')
  await compileFramesToVideo(framesDir, out, { fps: job.fps, scale: `${PANEL_SIZE}:${PANEL_SIZE}`, ext: 'jpg' })
  return out
}

async function hstackWithAudio(
  panels: string[],
  outputPath: string,
  opts: { fps: number; duration: number }
): Promise<void> {
  const inputArgs = panels.flatMap((p) => ['-i', p])
  const labels = panels.map((_, i) => `[${i}:v]`).join('')
  const filter = `${labels}hstack=inputs=${panels.length}[v]`

  await execFileAsync('ffmpeg', [
    '-y',
    ...inputArgs,
    '-i',
    AUDIO_PATH,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    `${panels.length}:a:0`,
    '-shortest',
    '-t',
    String(opts.duration),
    '-r',
    String(opts.fps),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  ])
}

async function compress(inputPath: string, outputPath: string, opts: { half?: boolean } = {}): Promise<void> {
  const isWebm = outputPath.endsWith('.webm')
  const args = ['-y', '-i', inputPath]
  if (opts.half) args.push('-vf', 'scale=iw/2:ih/2')
  if (isWebm) {
    args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '35', '-b:v', '0')
  } else {
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28')
  }
  args.push(outputPath)
  await execFileAsync('ffmpeg', args)
}

async function probeDuration(mediaPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    mediaPath,
  ])
  return Number(stdout.trim())
}
