// Shrinks photos on the device before upload: meal photos and progress
// photos don't need full camera resolution and the free storage tier is small.

export interface CompressOptions {
  maxSize?: number // longest edge, px
  quality?: number // 0–1
  type?: 'image/jpeg' | 'image/webp'
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<Blob> {
  const { maxSize = 1600, quality = 0.82, type = 'image/jpeg' } = opts
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
  )
}

/** Storage path: <client_id>/<kind>/<yyyy-mm-dd>-<random>.jpg — RLS keys on the first segment. */
export function storagePath(clientId: string, kind: 'meals' | 'progress', date: string) {
  return `${clientId}/${kind}/${date}-${crypto.randomUUID().slice(0, 8)}.jpg`
}
