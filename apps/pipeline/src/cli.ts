#!/usr/bin/env bun
// Bun loads .env from the cwd automatically — no dotenv package needed.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeClientAssets } from './client-manifest.ts'
import { compose } from './compose.ts'
import { loadJob, videoPath, type Job } from './job.ts'
import { backgroundPlate } from './steps/background-plate.ts'
import { stabilizeBackground } from './steps/background-stabilize.ts'
import { depth } from './steps/depth.ts'
import { dream } from './steps/dream.ts'
import { init } from './steps/init.ts'
import { matte } from './steps/matte.ts'
import { outline } from './steps/outline.ts'
import { portrait } from './steps/portrait.ts'
import { upscale } from './steps/upscale.ts'

const DEFAULT_CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client')

/**
 * Minimal CLI for running one pipeline step at a time against a job
 * directory — enough to test each step in isolation, per phase 3's scope.
 * A single `lysterfield generate` command that chains every step end to
 * end is phase 4's job, once compose.ts and client-manifest writing exist.
 *
 * Every step's input/output is addressed as a path relative to the job
 * root (see job.ts's `framesDir`/`videoPath`), following the numbered
 * per-panel folder layout: `source`/`alpha`/`video` are the job-level,
 * non-numbered folders `init`/`matte` write to; `2-portrait` through
 * `6-outline` are shared across every dream take; `7-dreams/<take>` holds
 * one take's dream frames plus its own composed/compressed output.
 * `--input`/`--output` (and per-step flags like `--background`/`--matte`/
 * etc. on `compose`) override the default path for that step; all defaults
 * below assume the previous step in the chain was run with its own
 * defaults.
 *
 * `dream`/`compose` take a `--take` name so a scene can carry several dream
 * attempts side by side under `<job>/7-dreams/<take>/`. `dream` composes
 * and publishes to apps/client automatically once its frames finish
 * generating (pass `--skip-client true` to opt a scratch/test take out of
 * that) — `compose` remains available to (re)publish a take on its own,
 * e.g. after tweaking an earlier panel without regenerating the dream.
 */

const [step, ...rest] = process.argv.slice(2)
const flags = parseFlags(rest)

function requireFlag(name: string): string {
  const value = flags[name]
  if (!value) throw new Error(`--${name} is required for "${step}"`)
  return value
}

/** Resolves a step's input frame directory: `--<flag>` overrides `defaultRelativePath`, both relative to the job root. */
function frameDirFlag(job: Job, defaultRelativePath: string, flag = 'input'): string {
  return path.join(job.dir, flags[flag] ?? defaultRelativePath)
}

/** Resolves a step's output name (passed straight to `framesDir`/`videoPath`, which join it onto the job root themselves): `--output` overrides `defaultRelativePath`. */
function outputFlag(defaultRelativePath: string): string {
  return flags.output ?? defaultRelativePath
}

const concurrency = Number(flags.concurrency ?? 4)

switch (step) {
  case 'init': {
    const result = await init(requireFlag('job'), {
      sourceVideoPath: requireFlag('source'),
      fps: flags.fps ? Number(flags.fps) : undefined,
      offset: flags.offset ? Number(flags.offset) : undefined,
      length: flags.length ? Number(flags.length) : undefined,
    })
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'matte': {
    const job = await loadJob(requireFlag('job'))
    const croppedVideoPath = await videoPath(job, 'video/cropped')
    console.log(JSON.stringify(await matte(job, croppedVideoPath), null, 2))
    break
  }

  case 'portrait': {
    const job = await loadJob(requireFlag('job'))
    const result = await portrait(job, frameDirFlag(job, 'source'), outputFlag('2-portrait/raw'), concurrency)
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'upscale': {
    const job = await loadJob(requireFlag('job'))
    const result = await upscale(
      job,
      frameDirFlag(job, '2-portrait/raw'),
      outputFlag('2-portrait/upscaled'),
      concurrency,
      flags.factor ? Number(flags.factor) : undefined
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'background-plate': {
    const job = await loadJob(requireFlag('job'))
    const result = await backgroundPlate(
      job,
      frameDirFlag(job, '2-portrait/upscaled', 'input'),
      frameDirFlag(job, 'alpha', 'alpha'),
      outputFlag('3-background/plate'),
      concurrency,
      { stepFps: flags['step-fps'] ? Number(flags['step-fps']) : undefined }
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'background-stabilize': {
    const job = await loadJob(requireFlag('job'))
    const result = await stabilizeBackground(
      job,
      frameDirFlag(job, '2-portrait/upscaled', 'base'),
      frameDirFlag(job, '3-background/plate', 'input'),
      frameDirFlag(job, 'alpha', 'alpha'),
      outputFlag('3-background/stable'),
      { stepFps: flags['step-fps'] ? Number(flags['step-fps']) : undefined, concurrency }
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'depth': {
    const job = await loadJob(requireFlag('job'))
    const result = await depth(
      job,
      frameDirFlag(job, 'source', 'source'),
      frameDirFlag(job, 'alpha', 'alpha'),
      concurrency
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'outline': {
    const job = await loadJob(requireFlag('job'))
    const result = await outline(
      job,
      frameDirFlag(job, 'source', 'source'),
      frameDirFlag(job, 'alpha', 'alpha'),
      frameDirFlag(job, '5-depth/frames', 'depth'),
      concurrency
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'dream': {
    const job = await loadJob(requireFlag('job'))
    const take = requireFlag('take')
    const result = await dream(job, frameDirFlag(job, 'source', 'source'), {
      prompt: requireFlag('prompt'),
      take,
      stepFps: flags['step-fps'] ? Number(flags['step-fps']) : undefined,
      concurrency,
      seed: flags.seed ? Number(flags.seed) : undefined,
    })
    console.log(JSON.stringify(result, null, 2))

    if (flags['skip-client'] !== 'true') {
      await composeAndPublish(job, take, {
        durationSeconds: flags.duration ? Number(flags.duration) : undefined,
        clientDir: flags['client-dir'] ? path.resolve(flags['client-dir']) : undefined,
      })
    }
    break
  }

  case 'compose': {
    const job = await loadJob(requireFlag('job'))
    const take = requireFlag('take')
    await composeAndPublish(job, take, {
      id: flags.id,
      durationSeconds: flags.duration ? Number(flags.duration) : undefined,
      skipClient: flags['skip-client'] === 'true',
      clientDir: flags['client-dir'] ? path.resolve(flags['client-dir']) : undefined,
    })
    break
  }

  default:
    console.error(
      `Usage: bun run src/cli.ts <init|matte|portrait|upscale|background-plate|background-stabilize|depth|outline|dream|compose> --job <dir> [options]`
    )
    process.exit(1)
}

/**
 * Shared by `dream` (auto-publish every take immediately once its frames
 * finish generating) and `compose` (re-publish a take on its own, e.g.
 * after tweaking an earlier shared panel). Published `id` defaults to the
 * take name itself — pass `--id` on `compose` to publish under a different
 * apps/client id without renaming the take.
 */
async function composeAndPublish(
  job: Job,
  take: string,
  opts: { id?: string; durationSeconds?: number; skipClient?: boolean; clientDir?: string }
): Promise<void> {
  const id = opts.id ?? take
  const result = await compose(job, {
    portraitFramesDir: frameDirFlag(job, '2-portrait/upscaled', 'portrait'),
    backgroundFramesDir: frameDirFlag(job, '3-background/stable', 'background'),
    matteFramesDir: frameDirFlag(job, 'alpha', 'matte'),
    depthFramesDir: frameDirFlag(job, '5-depth/frames', 'depth'),
    outlineFramesDir: frameDirFlag(job, '6-outline/frames', 'outline'),
    take,
    dreamFramesDir: path.join(job.dir, `7-dreams/${take}/frames`),
    durationSeconds: opts.durationSeconds,
  })
  console.log(JSON.stringify(result, null, 2))

  if (!opts.skipClient) {
    const clientDir = opts.clientDir ?? DEFAULT_CLIENT_DIR
    await writeClientAssets(clientDir, id, result)
    console.log(`Wrote client assets for "${id}" to ${clientDir}`)
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    if (!key.startsWith('--')) throw new Error(`Expected a --flag, got "${key}"`)
    flags[key.slice(2)] = args[i + 1]
  }
  return flags
}
