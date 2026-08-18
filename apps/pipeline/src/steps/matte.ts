import { readFile } from 'node:fs/promises'
import { exists, extractFrames, framesDir, hasFiles, videoPath, type Job } from '../job.ts'
import { MODELS } from '../models.ts'
import { runModelToFile } from '../replicate.ts'

export interface MatteResult {
  /** The alpha-mask video downloaded from Replicate. */
  alphaVideoPath: string
  /** Per-frame grayscale alpha mattes, same naming/fps as the source frames. */
  alphaFramesDir: string
}

/**
 * Robust Video Matting (arielreplicate/robust_video_matting) — one call for
 * the whole cropped video, not per-frame. `output_type: "alpha-mask"`
 * (the model's default, "green-screen", is wrong for this pipeline).
 */
export async function matte(job: Job, croppedVideoPath: string): Promise<MatteResult> {
  const alphaVideoPath = await videoPath(job, 'alpha-source', 'mp4')
  if (!(await exists(alphaVideoPath))) {
    await runModelToFile(
      MODELS.robustVideoMatting,
      {
        input_video: await readFile(croppedVideoPath),
        output_type: 'alpha-mask',
      },
      alphaVideoPath
    )
  }

  const alphaFramesDir = await framesDir(job, 'alpha')
  if (!(await hasFiles(alphaFramesDir))) {
    await extractFrames(alphaVideoPath, alphaFramesDir, job.fps)
  }

  return { alphaVideoPath, alphaFramesDir }
}
