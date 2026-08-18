import { writeFile } from 'node:fs/promises'
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

/** Every model this pipeline calls returns either a FileOutput or an array of them. */
type FileOutputLike = { blob: () => Promise<Blob> }

/**
 * Runs a model that returns a single file output (image or video) and
 * writes it to `outputPath`. Covers every step except background-plate,
 * which uses `runModelToFiles` for ProPainter's array output.
 */
export async function runModelToFile(
  identifier: `${string}/${string}` | `${string}/${string}:${string}`,
  input: Record<string, unknown>,
  outputPath: string
): Promise<void> {
  const output = await runModel<FileOutputLike>(identifier, input)
  await saveFileOutput(output, outputPath)
}

/** For models (like ProPainter) whose output is an array of files. */
export async function runModelToFiles(
  identifier: `${string}/${string}` | `${string}/${string}:${string}`,
  input: Record<string, unknown>,
  outputPaths: string[]
): Promise<void> {
  const outputs = await runModel<FileOutputLike[]>(identifier, input)
  if (outputs.length !== outputPaths.length) {
    throw new Error(
      `Expected ${outputPaths.length} output file(s) from ${identifier}, got ${outputs.length}`
    )
  }
  await Promise.all(outputs.map((output, i) => saveFileOutput(output, outputPaths[i])))
}

async function saveFileOutput(output: FileOutputLike, outputPath: string): Promise<void> {
  const blob = await output.blob()
  await writeFile(outputPath, Buffer.from(await blob.arrayBuffer()))
}
