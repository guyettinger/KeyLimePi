/**
 * Validation for the image blocks the renderer attaches to a message.
 *
 * An image is the one part of a user message that carries bytes of a size the text
 * bounds never cover: a picked, pasted, or dropped image arrives base64 and can run
 * into the megabytes. `MAX_PROMPT_BLOCKS` bounds how many, but nothing bounds each
 * one, so an untrusted renderer could push an unbounded payload through IPC, into the
 * transcript, and into the model's window.
 */

import type { SerializedImageBlock } from '@keylimepi/core'

/**
 * The largest accepted image, in bytes of its base64 payload.
 *
 * The element screenshot uses the same bound (`MAX_SCREENSHOT_BYTES`): a full-window
 * crop, resized down and base64-inflated by a third, lands in the low megabytes, and
 * eight is generous by several times over and still bounded. A user-picked image has
 * no such resizing, so this is the only thing keeping a dropped 200 MB file out of the
 * session.
 */
const MAX_IMAGE_DATA_BYTES = 8 * 1024 * 1024

/** The longest accepted MIME type. A few are `image/x-icon`; long ones are not. */
const MAX_MIME_TYPE_CHARS = 64

/**
 * Reject an image block the renderer should never have sent.
 *
 * @param block - The value received over IPC
 * @throws {Error} If it is not a well-formed, bounded image block
 */
export function assertImageBlock(block: unknown): asserts block is SerializedImageBlock {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('Invalid image block')
    }

  const { data, mimeType } = block as { data?: unknown; mimeType?: unknown }

  // `mimeType` reaches the UI in a `data:` URL and is trusted by the model as the
  // content type the bytes are, so it must be one of the image types the renderer can
  // actually produce rather than an arbitrary (possibly hostile) string.
  if (typeof mimeType !== 'string' || mimeType.length > MAX_MIME_TYPE_CHARS) {
    throw new Error('Invalid image block: mimeType')
    }
   if (!/^image\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new Error('Invalid image block: mimeType is not an image type')
    }

  if (typeof data !== 'string') {
    throw new Error('Invalid image block: data')
    }
   // Measured in bytes rather than characters, matching `MAX_SCREENSHOT_BYTES`: the
   // question a size cap answers is how much reaches disk and the model, and base64 is
   // one byte per character only until something non-ASCII is spliced in.
  if (Buffer.byteLength(data, 'utf-8') > MAX_IMAGE_DATA_BYTES) {
    throw new Error('Invalid image block: image too large')
    }
}
