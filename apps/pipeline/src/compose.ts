import { execFile } from 'node:child_process'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { compileFramesToVideo, exists, firstFrame, videoPath, type Job } from './job.ts'

const execFileAsync = promisify(execFile)

const PANEL_SIZE = 1024
const RESOURCES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources')

/**
 * Fixed, non-per-scene assets — one words.mov + one audio track shared by
 * every scene. Matches the legacy `generate-videos.sh`'s literal paths
 * (`resources/words/words.mov`, `resources/audio/lysterfield-lake.wav`).
 * `WORDS_VIDEO_PATH` is the single source file; compose() copies it into
 * each job's own `1-words/` folder (see `ensureWordsPanel`) so every job
 * directory holds a folder per panel 1-7, panel 1 included, even though
 * its content never varies between jobs or takes.
 */
export const WORDS_VIDEO_PATH = path.join(RESOURCES_DIR, 'words', 'words.mov')
export const AUDIO_PATH = path.join(RESOURCES_DIR, 'audio', 'lysterfield-lake.wav')

export interface ComposeInput {
  /** upscale.ts output on the raw portrait (panel 2) frames */
  portraitFramesDir: string
  /** background-stabilize.ts output (background-plate.ts's raw fill, stepped + motion-compensated for temporal consistency — see background-stabilize.ts) */
  backgroundFramesDir: string
  matteFramesDir: string
  depthFramesDir: string
  outlineFramesDir: string
  /** Which dream attempt to composite — every output below is written under `7-dreams/<take>/`. */
  take: string
  /** dream.ts output — a per-take frames folder, same shape as every other panel. */
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
  /** apps/client's choose-screen thumbnail, from the dream panel's first frame. */
  heroImagePath: string
}

/**
 * Ports generate-videos.sh: 7-panel hstack (words, portrait, background,
 * matte, depth, outline, dream — the exact order the client shader
 * expects) + audio mux, clipped to the audio's length, then the
 * video/video-small/loop/hero compression passes.
 *
 * Each panel's compiled video lives under that panel's own numbered folder
 * (`2-portrait/video/panel.mov`, etc.) — shared across every take for
 * panels 1-6, since their frame inputs don't depend on which dream take is
 * selected; panel 7's compile and every output below it lives under
 * `7-dreams/<take>/` instead, since the dream frames themselves are the
 * one thing that varies per take.
 */
export async function compose(job: Job, input: ComposeInput): Promise<ComposeResult> {
  const audioDuration = input.durationSeconds ?? (await probeDuration(AUDIO_PATH))

  const wordsPanel = await ensureWordsPanel(job)
  const portraitPanel = await normalizePanel(job, '2-portrait', input.portraitFramesDir, 'jpg')
  const backgroundPanel = await normalizePanel(job, '3-background', input.backgroundFramesDir, 'jpg')
  const mattePanel = await normalizePanel(job, '4-matte', input.matteFramesDir, 'png')
  const depthPanel = await normalizePanel(job, '5-depth', input.depthFramesDir, 'jpg')
  const outlinePanel = await normalizePanel(job, '6-outline', input.outlineFramesDir, 'jpg')
  const dreamPanel = await normalizePanel(job, `7-dreams/${input.take}`, input.dreamFramesDir, 'jpg')

  const compositeVideoPath = await videoPath(job, `7-dreams/${input.take}/composite`)
  await hstackWithAudio(
    [wordsPanel, portraitPanel, backgroundPanel, mattePanel, depthPanel, outlinePanel, dreamPanel],
    compositeVideoPath,
    { fps: job.fps, duration: audioDuration }
  )

  const finalVideoPath = await videoPath(job, `7-dreams/${input.take}/video`)
  const videoWebmPath = await videoPath(job, `7-dreams/${input.take}/video`, 'webm')
  await compress(compositeVideoPath, finalVideoPath)
  await compress(compositeVideoPath, videoWebmPath)

  const videoSmallPath = await videoPath(job, `7-dreams/${input.take}/video-small`)
  const videoSmallWebmPath = await videoPath(job, `7-dreams/${input.take}/video-small`, 'webm')
  await compress(compositeVideoPath, videoSmallPath, { half: true })
  await compress(compositeVideoPath, videoSmallWebmPath, { half: true })

  const loopPath = await videoPath(job, `7-dreams/${input.take}/loop`)
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
    '-movflags',
    '+faststart',
    loopPath,
  ])

  // Sourced from the dream panel, not the (take-independent) portrait
  // panel — a job's takes can look completely different from each other
  // (that's the whole point of a take), so the choose-screen thumbnail
  // needs to show each take's own dream style, not one shared image every
  // take of the same job would otherwise have in common.
  const heroImagePath = await videoPath(job, `7-dreams/${input.take}/hero`, 'jpg')
  await sharp(await firstFrame(input.dreamFramesDir))
    .resize(PANEL_SIZE, PANEL_SIZE)
    .jpeg({ quality: 85 })
    .toFile(heroImagePath)

  return {
    compositeVideoPath,
    videoPath: finalVideoPath,
    videoWebmPath,
    videoSmallPath,
    videoSmallWebmPath,
    loopPath,
    heroImagePath,
  }
}

/** Copies the fixed, shared words.mov into this job's own `1-words/` folder (if not already there), so panel 1 has a real per-job folder like every other panel even though its content is always identical. */
async function ensureWordsPanel(job: Job): Promise<string> {
  const out = path.join(job.dir, '1-words', 'words.mov')
  if (!(await exists(out))) {
    await mkdir(path.dirname(out), { recursive: true })
    await copyFile(WORDS_VIDEO_PATH, out)
  }
  return out
}

/** Compiles a frame folder into a PANEL_SIZE² square panel video — every frame-based panel is already square, so this is a plain resize, no crop. `panelDir` is the panel's own folder relative to the job root (e.g. `2-portrait`, or `7-dreams/<take>` for the one per-take panel) — its compiled video lands at `<panelDir>/video/panel.mov`. `ext` must match the frame folder's actual format (alpha/matte stays png; everything else is jpg — see init.ts). */
async function normalizePanel(job: Job, panelDir: string, framesDir: string, ext: 'png' | 'jpg'): Promise<string> {
  const out = await videoPath(job, `${panelDir}/video/panel`)
  await compileFramesToVideo(framesDir, out, { fps: job.fps, scale: `${PANEL_SIZE}:${PANEL_SIZE}`, ext })
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
    // Without +faststart, ffmpeg's default mp4/mov muxer writes moov (the
    // index a browser needs before it can start playback) after mdat — the
    // full media payload. A browser without WebM support (Safari) falls
    // back to this .mov source, and must then download the entire file
    // before playback can begin at all: indistinguishable from "stuck at
    // 0:00" on anything but a tiny clip.
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart')
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
