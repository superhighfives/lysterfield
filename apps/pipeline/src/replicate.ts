import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import Replicate from 'replicate'

let client: Replicate | undefined

function getClient(): Replicate {
  if (client) return client

  const auth = process.env.REPLICATE_API_TOKEN
  if (!auth) {
    throw new Error(
      'REPLICATE_API_TOKEN is not set — copy .env.example to .env and fill it in.'
    )
  }

  client = new Replicate({ auth })
  return client
}

/**
 * Runs a Replicate model to completion and returns its output.
 * `identifier` is "owner/name" (latest version) or "owner/name:version" (pinned).
 */
export async function runModel<Output = unknown>(
  identifier: `${string}/${string}` | `${string}/${string}:${string}`,
  input: Record<string, unknown>
): Promise<Output> {
  const output = await getClient().run(identifier, { input })
  return output as Output
}

/** Every model this pipeline calls returns a single FileOutput. */
type FileOutputLike = { blob: () => Promise<Blob> }

/**
 * Runs a model that returns a single file output (image or video) and
 * writes it to `outputPath`.
 */
export async function runModelToFile(
  identifier: `${string}/${string}` | `${string}/${string}:${string}`,
  input: Record<string, unknown>,
  outputPath: string
): Promise<void> {
  const output = await runModel<FileOutputLike>(identifier, input)
  await saveFileOutput(output, outputPath)
}

async function saveFileOutput(output: FileOutputLike, outputPath: string): Promise<void> {
  const blob = await output.blob()
  await writeFile(outputPath, Buffer.from(await blob.arrayBuffer()))
}

/**
 * Reads a local file for use as a model input, preserving its filename and
 * extension. A raw Buffer uploads as `buffer_<timestamp>` with no
 * extension and `application/octet-stream` — several models (ProPainter's
 * `mask` field, confirmed) validate the uploaded filename's extension
 * server-side and reject that. Always read local files through this, not
 * `readFile` directly, when passing them as Replicate input.
 */
export async function readFileAsInput(filePath: string): Promise<File> {
  const buffer = await readFile(filePath)
  return new File([new Uint8Array(buffer)], path.basename(filePath))
}
