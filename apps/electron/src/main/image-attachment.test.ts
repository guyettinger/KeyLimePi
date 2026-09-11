/**
 * Tests for the image-attachment validator.
 *
 * Two properties matter. A well-formed block — `splitPrompt` builds exactly this from
 * a serialized payload the renderer sent — must pass unchanged, because the validator
 * sits on the path a real attached image takes and a false rejection breaks the feature
 * outright. And every field the prompt builder dereferences without guarding must be
 * refused here, because the bytes ride straight into Ollama and the base64 string is
 * what the UI later re-stitches into a `data:` URL.
 */

import { describe, expect, test } from 'bun:test'
import { assertImageBlock } from './image-attachment'

/** A block shaped exactly as `splitPrompt` produces one from a valid serialized image. */
function valid(): Record<string, unknown> {
  return {
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from('PNG-bytes').toString('base64')
  }
}

describe('assertImageBlock', () => {
  test('accepts what splitPrompt actually produces', () => {
    expect(() => assertImageBlock(valid())).not.toThrow()
   })

  test('accepts other image mime types', () => {
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 'image/jpeg', data: 'AAAA' })
    ).not.toThrow()
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 'image/webp', data: 'AAAA' })
     ).not.toThrow()
   })

  test('refuses anything that is not an object', () => {
    expect(() => assertImageBlock(null)).toThrow()
    expect(() => assertImageBlock('image/png')).toThrow()
    expect(() => assertImageBlock({})).toThrow()
    expect(() => assertImageBlock([{}])).toThrow()
   })

  test('refuses a missing mimeType', () => {
    expect(() => assertImageBlock({ type: 'image', data: 'AAAA' })).toThrow()
   })

  test('refuses a mimeType that is not a string', () => {
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 42, data: 'AAAA' })
    ).toThrow()
   })

  test('refuses a mimeType that is not an image, since content-type reaches the model', () => {
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 'text/plain', data: 'AAAA' })
    ).toThrow()
   })

  test('refuses an empty mimeType', () => {
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: '', data: 'AAAA' })
     ).toThrow()
   })

  test('refuses a missing data, which the model and the UI both dereference', () => {
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 'image/png' })
    ).toThrow()
   })

  test('refuses data that is not a string', () => {
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 'image/png', data: 42 })
    ).toThrow()
   })

  test('refuses data past the byte cap', () => {
    const oversized = 'A'.repeat(8 * 1024 * 1024 + 10)
    expect(() =>
      assertImageBlock({ type: 'image', mimeType: 'image/png', data: oversized })
    ).toThrow()
   })
})
