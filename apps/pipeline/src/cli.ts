#!/usr/bin/env bun
// Bun loads .env from the cwd automatically — no dotenv package needed.
import path from 'node:path'
import { loadJob, type Job } from './job.ts'
import { artwork } from './steps/artwork.ts'
import { backgroundPlate } from './steps/background-plate.ts'
import { depth } from './steps/depth.ts'
import { init } from './steps/init.ts'
import { matte } from './steps/matte.ts'
import { upscale } from './steps/upscale.ts'

/**
 * Minimal CLI for running one pipeline step at a time against a job
 * directory — enough to test each step in isolation, per phase 3's scope.
 * A single `lysterfield generate` command that chains every step end to
 * end is phase 4's job, once compose.ts and client-manifest writing exist.
 *
 * Frame folders are addressed by name within `<job>/frames/` — `source`
 * and `alpha` are the well-known names `init`/`matte` write to; `artwork`/
 * `upscale` take an explicit --output name since they're called twice each
 * (once for the artwork panel, once for the background panel).
 */

const [step, ...rest] = process.argv.slice(2)
const flags = parseFlags(rest)

function requireFlag(name: string): string {
  const value = flags[name]
  if (!value) throw new Error(`--${name} is required for "${step}"`)
  return value
}

function frameDirFlag(job: Job, name: string, flag = 'input'): string {
  return path.join(job.dir, 'frames', flags[flag] ?? name)
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
    const croppedVideoPath = path.join(job.dir, 'video', 'cropped.mov')
    console.log(JSON.stringify(await matte(job, croppedVideoPath), null, 2))
    break
  }

  case 'background-plate': {
    const job = await loadJob(requireFlag('job'))
    const result = await backgroundPlate(
      job,
      frameDirFlag(job, 'source', 'source'),
      frameDirFlag(job, 'alpha', 'alpha'),
      concurrency
    )
    console.log(JSON.stringify(result, null, 2))
    break
  }

  case 'artwork': {
    const job = await loadJob(requireFlag('job'))
    const result = await artwork(
      job,
      frameDirFlag(job, 'source'),
      requireFlag('output'),
      concurrency
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

  default:
    console.error(
      `Usage: bun run src/cli.ts <init|matte|background-plate|artwork|depth|upscale> --job <dir> [options]`
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
