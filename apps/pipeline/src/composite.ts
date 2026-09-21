import sharp from 'sharp'

export interface ImageAndMaskRaw {
  rgb: Buffer
  alpha: Buffer
}

/** Loads `imagePath`'s RGB and `maskPath`'s greyscale alpha, both resized to `size`x`size`, as raw buffers. */
export async function loadImageAndMaskRaw(
  imagePath: string,
  maskPath: string,
  size: number
): Promise<ImageAndMaskRaw> {
  const [{ data: rgb }, { data: alpha }] = await Promise.all([
    sharp(imagePath).resize(size, size).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(maskPath).resize(size, size).greyscale().raw().toBuffer({ resolveWithObject: true }),
  ])
  return { rgb, alpha }
}
