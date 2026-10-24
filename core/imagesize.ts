// An image file's size in pixels, read from its header: PNG, JPEG, GIF and WebP. The image viewer
// (ui/ImageViewer.tsx) shows a small picture at its own size instead of blowing it up to fill the
// window, and GPUIX's <img> doesn't report what it loaded.

import { closeSync, openSync, readSync } from 'node:fs'

export type Size = { width: number; height: number }

const HEAD = 64 * 1024

export function imageSize(file: string): Size | undefined {
  let buf: Buffer
  try {
    const fd = openSync(file, 'r')
    try {
      buf = Buffer.alloc(HEAD)
      buf = buf.subarray(0, readSync(fd, buf, 0, HEAD, 0))
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
  return sizeOf(buf)
}

export function sizeOf(b: Buffer): Size | undefined {
  // PNG: the IHDR chunk comes first.
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return valid(b.readUInt32BE(16), b.readUInt32BE(20))
  // GIF87a / GIF89a: the logical screen size.
  if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') return valid(b.readUInt16LE(6), b.readUInt16LE(8))
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return webp(b)
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b)
  return undefined
}

/** The first start-of-frame marker holds the size; everything before it is skipped segment by segment. */
function jpeg(b: Buffer): Size | undefined {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined
    const marker = b[i + 1]!
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return valid(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5))
    i += 2 + b.readUInt16BE(i + 2)
  }
  return undefined
}

function webp(b: Buffer): Size | undefined {
  const kind = b.toString('ascii', 12, 16)
  if (kind === 'VP8X') return valid(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3))
  if (kind === 'VP8 ') return valid(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  return undefined
}

const valid = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : undefined)
