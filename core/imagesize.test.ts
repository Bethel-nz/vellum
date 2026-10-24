import { expect, test } from 'bun:test'
import path from 'node:path'
import { imageSize, sizeOf } from './imagesize'

test('a PNG on disk', () => {
  expect(imageSize(path.join(import.meta.dir, '../assets/icon.png'))).toEqual({ width: 1024, height: 1024 })
  expect(imageSize('/nonexistent.png')).toBeUndefined()
})

test('GIF and JPEG headers', () => {
  const gif = Buffer.from('GIF89a\x40\x01\xf0\x00', 'latin1')
  expect(sizeOf(gif)).toEqual({ width: 320, height: 240 })
  // SOI, an APP0 segment to skip, then SOF0 with height 480 and width 640.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0])
  expect(sizeOf(jpeg)).toEqual({ width: 640, height: 480 })
  expect(sizeOf(Buffer.from('not an image'))).toBeUndefined()
})
