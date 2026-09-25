#!/usr/bin/env bun
// Bun loads .env from the cwd automatically — no dotenv package needed.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeClientAssets } from './client-manifest.ts'
import { compose } from './compose.ts'
import { dynamicFramesDir, loadJob, videoPath, type Job } from './job.ts'
import { artwork } from './steps/artwork.ts'
import { backgroundPlate } from './steps/background-plate.ts'
import { stabilizeBackground } from './steps/background-stabilize.ts'
import { depth } from './steps/depth.ts'
import { dream } from './steps/dream.ts'
import { init } from './steps/init.ts'
import { matte } from './steps/matte.ts'
import { outline } from './steps/outline.ts'
import { upscale } from './steps/upscale.ts'

const DEFAULT_CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client')

/**
 * Minimal CLI for running one pipeline step at a time against a job
 * directory — enough to test each step in isolation, per phase 3's scope.
 * A single `lysterfield generate` command that chains every step end to
 * end is phase 4's job, once compose.ts and client-manifest writing exist.
 *
 * Frame folders are addressed by name within `<job>/static/frames/` —
 * `source` and `alpha` are the well-known names `init`/`matte` write to.
 * Panel 2 (artwork): `artwork` → `upscale`. Panel 3 (background) is two
 * steps: `background-plate` runs directly on panel 2's `artwork-upscaled`
 * output (erase-then-stylize flickered on real footage — see
 * background-plate.ts) to produce a raw, still independently-flickery
 * per-frame fill; `background-stabilize` turns that into panel 3's actual
 * final frames via held-fill + motion-compensated-mask stepping (see
 * background-stabilize.ts and
 * plans/in-progress/panel-3-background-flicker-mitigation.md) —
 * `compose` defaults to reading its result from `background-stable`.
 * `dream`/`compose` additionally take a --take name so a scene can carry
 * several dream attempts under `<job>/dynamic/<take>/` side by side — see
 * job.ts's `dynamicPath`.
 */

const [step, ...rest] = process.argv.slice(2)
const flags = parseFlags(rest)

function requireFlag(name: string): string {
  const value = flags[name]
  if (!value) throw new Error(`--${name} is required for "${step}"`)
  return value
}

function frameDirFlag(job: Job, name: string, flag = 'input'): string {
  return path.join(job.dir, 'static', 'frames', flags[flag] ?? name)
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
    const croppedVideoPath = await videoPath(job, 'cropped')
    console.log(JSON.stringify(await matte(job, croppedVideoPath), null, 2))
    break
  }

  case 'background-plate': {
    const job = await loadJob(requireFlag('job'))
    const result = await backgroundPlate(
      job,
      frameDirFlag(job, 'artwork-upscaled', 'input'),
      frameDirFlag(job, 'alpha', 'alpha'),
      requireFlag('output'),
      concurrency
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'artwork': {
    const job = await loadJob(requireFlag('job'))
    const result = await artwork(job, frameDirFlag(job, 'source'), requireFlag('output'), concurrency)
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

  case 'upscale': {
    const job = await loadJob(requireFlag('job'))
    const result = await upscale(
      job,
      frameDirFlag(job, 'artwork'),
      requireFlag('output'),
      concurrency,
      flags.factor ? Number(flags.factor) : undefined
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
      frameDirFlag(job, 'depth', 'depth'),
      concurrency
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'background-stabilize': {
    const job = await loadJob(requireFlag('job'))
    const result = await stabilizeBackground(
      job,
      frameDirFlag(job, 'background-plate', 'input'),
      frameDirFlag(job, 'alpha', 'alpha'),
      requireFlag('output'),
      { stepFps: flags['step-fps'] ? Number(flags['step-fps']) : undefined, concurrency }
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'dream': {
    const job = await loadJob(requireFlag('job'))
    const result = await dream(job, frameDirFlag(job, 'source', 'source'), {
      prompt: requireFlag('prompt'),
      take: requireFlag('take'),
      stepFps: flags['step-fps'] ? Number(flags['step-fps']) : undefined,
      concurrency,
      seed: flags.seed ? Number(flags.seed) : undefined,
    })
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'compose': {
    const job = await loadJob(requireFlag('job'))
    const id = requireFlag('id')
    const take = requireFlag('take')
    const result = await compose(job, {
      artworkFramesDir: frameDirFlag(job, 'artwork-upscaled', 'artwork'),
      backgroundFramesDir: frameDirFlag(job, 'background-stable', 'background'),
      matteFramesDir: frameDirFlag(job, 'alpha', 'matte'),
      depthFramesDir: frameDirFlag(job, 'depth', 'depth'),
      outlineFramesDir: frameDirFlag(job, 'outline', 'outline'),
      take,
      dreamFramesDir: flags['dream-frames'] ?? (await dynamicFramesDir(job, take, 'dream')),
      durationSeconds: flags.duration ? Number(flags.duration) : undefined,
    })
    console.log(JSON.stringify(result, null, 2))

    if (flags['skip-client'] !== 'true') {
      const clientDir = path.resolve(flags['client-dir'] ?? DEFAULT_CLIENT_DIR)
      await writeClientAssets(clientDir, id, result)
      console.log(`Wrote client assets for "${id}" to ${clientDir}`)
    }
    break
  }

  default:
    console.error(
      `Usage: bun run src/cli.ts <init|matte|background-plate|background-stabilize|artwork|depth|upscale|outline|dream|compose> --job <dir> [options]`
    )
    process.exit(1)
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
