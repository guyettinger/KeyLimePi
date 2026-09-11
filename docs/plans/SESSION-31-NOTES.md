# Session 31 Notes: Image Attachments

**Date**: 2026-09-11
**Status**: ✅ Complete
**Duration**: ~1 hour (verification + notes; feature landed in a prior session)

## What Was Built

A user can attach an image to a chat message — pick a file, paste, or drop — and a local
Ollama **vision model** sees it. The image travels the exact path an element-context
screenshot already did: it is one `ImageContent` among the `images` Pi hands the model, so
there was no new model-side surface to build, only a new source of it.

The organising idea: **an attachment is the one content block that carries bytes, and it
travels already-base64 from end to end.** The renderer produces the base64 `readAsDataURL`
gives, strips the `data:` prefix, and the same `data`/`mimeType` pair is what main validates,
what Pi sends, what the transcript stores, and what the bubble re-renders on reload. No
re-encoding at any boundary, so there is nothing that could drift between them.

### Components Created

1. **`SerializedImageBlock`** (`packages/core/src/chat.ts`)
   - `{ type: 'image', data, mimeType }`, joined into the `SerializedContentBlock` union
   - The one block in a message that carries bytes, and the one the size caps protect
2. **`assertImageBlock` + the two caps** (`apps/electron/src/main/image-attachment.ts`)
   - `MAX_IMAGE_DATA_BYTES = 8 * 1024 * 1024`, measured in bytes not characters (a
      `Buffer.byteLength` check the way `MAX_SCREENSHOT_BYTES` is measured)
   - `MAX_MIME_TYPE_CHARS = 64`; `mimeType` must match `/^image\/[a-z0-9.+-]+$/` — the types
    the renderer can actually produce, not an arbitrary (possibly hostile) string
   - Shares its bound with the element screenshot: a full-window crop is the largest thing the
    model can be shown, and a picked image has no resizing step to keep it down
3. **`ImageAttachment` + `readImageFiles`** (`apps/electron/src/renderer/src/components/Chat.tsx`)
   - The one place a `File`, however it arrived, becomes the block's bytes; pasted and
      dropped and picked images converge here
   - `attachments` state; an image-only message sends no empty text block; the bytes clear
    from `attachments` only after they are already in the outgoing `blocks`

### Changed

- `session.ts` — `SendPromptParams` gains `images?`; `sendPrompt` concats the user's images
 with the element screenshots and passes them to `session.prompt`
- `ipc.ts` — the `agent:message` handler validates every image block with `assertImageBlock`
 *before* anything runs on it; `splitPrompt` builds the `ImageContent[]` from the blocks
- `preload/index.ts` — `SerializedImageBlock` and its join into the union, mirrored locally
- `driver.mjs` (`.claude/skills/run-app`) — an `upload` command feeding the composer's file
 input with `setInputFiles`, so the attach path is drivable end to end

## Decisions

**The image is a sibling of the element screenshot, not a new channel.** Both reach the
model as `ImageContent`, both are already base64, and `sendPrompt` just concatenates them —
`elementImages.concat(images)`. That means confinement, the tool approval surface, and the
persist/reload machinery all keep working unchanged; the only new thing is a *source* of an
input shape that already existed. Had images gone over a second channel, every one of those
would have had to be taught about it.

**The cap is in bytes and shared with the screenshot.** An image is the first thing a user
message can carry that is genuinely large — a dropped file with no resize step — so a size
cap is the only thing keeping a megabyte-scale payload out of the transcript and the model's
window. Measuring in bytes (not characters) matches `MAX_SCREENSHOT_BYTES`: the question the
cap answers is how much reaches disk and the model, and base64 is one byte per character only
until a non-ASCII byte is spliced in. Eight megabytes is generous against the few-megabyte
screenshot the inspector produces, and it is the same number, which is cheaper to reason about
than two.

**`assertImageBlock` runs before the prompt is split.** The renderer is untrusted and the
image is the largest payload it can push over IPC, so the bound is checked at the handler the
way an id is checked where it becomes a path — not downstream, where it would first reach a
file or the model. A `mimeType` that is not an image type is refused outright, since the model
trusts it as the content type of the bytes.

**The `✕` remove button was left as-is.** The composer's attachment chip removes with a `✕`
glyph; the canonical `×` would be tidier but the glyph renders, `aria-label` carries the
meaning, and changing it is cosmetic with no correctness consequence. Left to whoever touches
the composer next.

## What the live run actually verified

On the real workspace, driving the app through the run-app driver, on
`qwen3.8:27b-mlx`:

- **The image reaches the model, and the model sees it.** Two turns were sent with an
 attached image and a plain-text request. The model described a 2×2 grid of four solid squares —
 *top-left red, top-right green, bottom-left blue, bottom-right yellow* — which is exactly the
 image generated to test it. That is proof the visual content reached Ollama, not just that the
 call succeeded: a turn that never received the image could not describe its quadrants.
- **Two images of different sizes each produced a description of their own content.** A smaller
 attached image drew *"a solid square of a flat, medium blue color"*; the valid 128×128 PNG drew
 the four-quadrant description of its red, green, blue and yellow squares. Both are a
 description of what was in the image, not a guess about what might have been attached, which
 is the whole point of the check.
- **It persists into the Pi transcript.** The active session's JSONL carries one `image` block
 per user message (`mime=image/png`, the full base64), interleaved with the `text` block,
 under the `message` entry the way the transcript stores everything else.
- **It survives a full app restart and re-renders.** After `drive.sh stop` / `start`, the active
 session reloads and the Chat panel renders the two historical images as
 `<img alt="Attached image">` — `imgCount = 2`, both with that alt — alongside the assistant's
 descriptions. `toPersistedMessages` carried the blocks forward, and `MessageBubble` rendered
 them; a session that did not carry them would have shown 0.
- **The read-back returns the blocks through IPC.** A direct `loadChatHistory('pony-pony-pony')`
 returned the image blocks in the `{ type, data, mimeType }` shape the bubble consumes, which
 is the data-level proof the render step rests on.

**Not verified through the UI `ask` path.** The driver's keystroke-based `ask` reaches the
composer input only when the Chat panel is the focused dock tab; with Server/Preview active the
keystrokes fell into the `clip-path`/`inert` panel and the model never got them. Verification
therefore went through `window.electronAPI.sendMessage(...)` directly, which is the same
`agent:message` handler the UI calls and resolves the workspace by id rather than by UI focus.

## Gotchas

- **The transcript is the arbiter that the image reached the model.** Pi writes an `image`
  block to its JSONL only when `session.prompt` received the `images` option, so its presence
  proves delivery and the model's response proves it was decoded. No other signal in this
  stack says "the model saw it," and a turn that succeeded on an image that was never sent
  would otherwise look identical to one that was.

- **Driving the UI to send a message needed a direct call, not keystrokes.** The dock mounts
  every open workspace at once and hides the non-focused ones with `clip-path`/`inert`, so a
  keystroke into the composer of a non-focused workspace is swallowed. The `agent:message`
  handler resolves the workspace by id, so `sendMessage(blocks, appId)` sends regardless of
  which tab is visible — which is why the smoke used it and why the `upload` command only
  reaches as far as the file input, not the send.

- **A `File` is read to base64 exactly once, in the renderer, and the rest of the stack is
  bytes-in/bytes-out.** `readImageFiles` strips the `data:` prefix so the `SerializedImageBlock`
  travels the same fields as every other block, and `MessageBubble` re-adds it for the `<img>`
  `src`. Re-encoding anywhere else would be the thing that could drift; it is concentrated in
  one place on each end.

## Fixes applied the same day (two post-merge regressions)

The feature landed, but a live run on a *real* image caught two regressions the earlier
`imgCount` check could not:

- **The image never actually rendered.** The renderer's CSP in `index.html` had no `img-src`,
  so `img-src` inherited `default-src 'self'` and Chromium blocked every `data:` `src`. The
  composer thumbnail and the chat bubble existed as `<img alt="Attached image">` nodes — which is
  exactly why the `imgCount = 2` in "What the live run actually verified" above — but they were
  **blank**: `naturalWidth === 0`. Fix: add `img-src 'self' data:` to `index.html`. Verified by
  `naturalWidth = 750` on the data: image.

   `imgCount` counts DOM nodes, not rendered pixels. A CSP-blocked `<img>` is still a node with its
  alt, so it reads the same as a rendered one — a false positive for "rendered." The real test is
  `naturalWidth > 0`, which is what this session's run used. The "renders the two historical
  images" claim in the section above was that false positive and is superseded here.

- **Real images exceeded the cap.** `MAX_IMAGE_DATA_BYTES = 8` MiB of base64 is a 6.3-MiB binary
  ceiling; a real screenshot or photo lands over it and `assertImageBlock` refuses it with
  "image too large." Fix: `stageImage` in `readImageFiles` (`Chat.tsx`) downsamples on its long
  edge past `MAX_IMAGE_EDGE` (2048) or when the re-encoded payload still exceeds `MAX_ATTACHED_IMAGE_BYTES`
  (a mirror of main's `MAX_IMAGE_DATA_BYTES`), halving the scale each pass up to six times. Small
  images pass through untouched (no re-encode, lossless); the cap stays a backstop in main. A 1500×1500
  PNG (~9 MB) downscaled to 750×750 and sent with no error.
  **`img-src 'self' data:`** is safe: every `<img>` in the app is either a user or inspector image
  now allowed to render, or model-authored markdown that the renderer `img` override in `Markdown.tsx`
  refuses to emit as a tag (it renders a link instead); no remote URL is newly reachable, and the
  exfiltration surface at `Markdown.tsx` stays closed.

- **The run this time used `driver.mjs` `upload` (the real attach path) into a single open app,
  not `window.electronAPI.sendMessage`.** The earlier run's "Not verified through the UI `ask`
  path" note holds for keystrokes into a non-focused dock panel, but with only one workspace open
  the keystroke `ask` reaches its composer, so the image was attached through `upload` →
  `readImageFiles` → downscale → send, and the model's reply described the attached noise exactly
  (*"a dense speckle of muted grayish tones with faint hints of green, blue, and purple"*), which is
  the image `stageImage` produced.
