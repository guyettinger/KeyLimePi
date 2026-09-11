/**
 * Chat component with inline tool bubbles and approvals.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { nanoid } from 'nanoid'
import { MessageBubble } from './MessageBubble'
import { InlineApproval } from './InlineApproval'
import { ElementContextBubble } from './ElementContextBubble'
import { PermissionModeControl, describePermissionMode } from './PermissionModeControl'
import {
  SkillMentionMenu,
  completeMention,
  trailingMention,
  useMentionCursor,
  useMentionMatches
} from './skills/SkillMentionMenu'
import { useSkills } from '../hooks/useSkills'
import { useContextReport } from '../hooks/useContextReport'
import { useSessionChanges } from '../hooks/useSessionChanges'
import { useDaemonHealth } from '../hooks/useDaemonHealth'
import { useTelemetry } from '../hooks/useTelemetry'
import { readableError } from '../lib/ipcError'
import { AgentGaugeRow } from './AgentGaugeRow'
import {
  beginTurn,
  endTurn,
  publishActivity,
  recordWrite,
  resetActivity,
  useAgentActivity
} from '../state/agentActivity'
import type { Message, ContentBlock } from './MessageBubble'
import type { WorkspacePanelName } from './workspace/catalog'
import type {
  PermissionMode,
  StreamChunk,
  ToolApprovalRequest,
  PersistedMessage
} from '../types/electron'
import type {
  SubApp,
  SerializedContentBlock,
  ElementContext,
  ChatHistoryPayload
} from '@keylimepi/core'

/**
 * Tools whose call means a file is being rewritten right now.
 *
 * Only used to name the file in the strip while the write is in flight. What was
 * *actually* changed comes from the patches on the result, which covers `refactor`'s
 * multi-file rewrites — files this list's single `input.path` never names.
 */
const WRITING_TOOLS = new Set(['write', 'edit', 'replace_lines', 'refactor'])

/**
 * An image the user attached to a message, staged in the composer.
 *
 * Its bytes are already base64 by the time they arrive here, so the field that
 * travels over IPC is the same one `assertImageBlock` accepts in main and the same
 * one `ImageBlock` renders. An image that is too large is downscaled before it gets
 * here, so what the bubble shows and what the model receives are the same bytes.
 */
interface ImageAttachment {
   /** Stable key, for removing a staged attachment. */
  id: string
   /** Base64 image bytes, with no `data:` URL prefix. */
  data: string
   /** MIME type of the image, for example `image/png`. */
  mimeType: string
   /** The file's name, for the thumbnail label. */
  name: string
}

/**
 * Read image files into staged attachments, in order.
 *
 * A read that fails rejects the promise, so the caller never turns a bad file into
 * an empty image; the error is surfaced as a failed send the way any error is. An
 * image larger than the caps is downscaled — see {@link stageImage} — before its
 * bytes are taken, so the attachment always fits.
 */

/**
 * The longest edge, in pixels, an attached image may have, and the ceiling its
 * base64 payload may reach before it is forced smaller.
 *
 * A picked, pasted, or dropped image is the only part of a message with no resize
 * step, so without a cap a full-resolution screenshot or a high-MP photo would push
 * a multi-megabyte payload into the transcript and the model's window. The
 * inspector's element screenshot already arrives small — it is resized before it is
 * sent — so only a user image is downscaled, and here it happens. The byte ceiling
 * mirrors main's `MAX_IMAGE_DATA_BYTES`: the base64 string bounded there is the same
 * string measured here as `payload.length`, and a renderer cap stricter than main's
 * can never let an oversized image through — the only direction that is dangerous.
 */
const MAX_IMAGE_EDGE = 2048
const MAX_ATTACHED_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Read an image and keep its bytes as-is.
 *
 * `readAsDataURL` yields `data:image/png;base64,XXXX`; the bytes are the part after
 * that prefix, which is the shape `ImageBlock` and main's validator expect.
 */
function originalAttachment(url: string, file: File): ImageAttachment {
  return {
   id: nanoid(),
   data: url.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, ''),
   mimeType: file.type || 'image/png',
   name: file.name || 'image'
    }
}

/**
 * Read a file, downscaling it to `MAX_IMAGE_EDGE` on its long edge when it is too
 * large to keep.
 *
 * A small image passes through byte-for-byte, so nothing below the caps pays for a
 * re-encode. One that does not fit — or whose re-encode still exceeds the byte
 * ceiling — is drawn to a canvas and re-encoded smaller until it is under
 * `MAX_ATTACHED_IMAGE_BYTES`, halving the scale each pass. JPEG and WebP inputs keep
 * their type and shrink by quality; everything else becomes PNG. The MIME that
 * comes back is one the canvas actually produced, so the bytes `MessageBubble`
 * renders are the same ones the model receives.
 *
 * @param file - The image to stage
 * @returns A promise resolving to the one staged attachment
 */
function stageImage(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      if (!url) { reject(new Error('Could not read image')); return }
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode image'))
      img.onload = () => {
        const w = img.naturalWidth
        const h = img.naturalHeight
        const original = url.split(',')[1] ?? ''
          // A zero-dimension image decodes to nothing to scale; and one that already
          // fits both caps needs no re-encode, so it stays byte-identical.
        if (
          w === 0 ||
          h === 0 ||
          (w <= MAX_IMAGE_EDGE && h <= MAX_IMAGE_EDGE && original.length <= MAX_ATTACHED_IMAGE_BYTES)
        ) {
          resolve(originalAttachment(url, file))
          return
          }
        const outType =
          file.type === 'image/jpeg' || file.type === 'image/webp'
             ? file.type
             : 'image/png'
        const quality = outType === 'image/jpeg' || outType === 'image/webp' ? 0.85 : undefined
        let fit = Math.min(1, MAX_IMAGE_EDGE / w, MAX_IMAGE_EDGE / h)
        for (let attempt = 0; ; attempt += 1) {
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(w * fit))
          canvas.height = Math.max(1, Math.round(h * fit))
          const ctx = canvas.getContext('2d')
          if (!ctx) { reject(new Error('No 2D canvas context')); return }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          let encoded: string
          try {
            encoded = quality === undefined ? canvas.toDataURL(outType) : canvas.toDataURL(outType, quality)
          } catch {
            encoded = canvas.toDataURL()
            }
          const [meta, payload = ''] = encoded.split(',')
            // Six halvings reach a 32×32 image, far under the ceiling, so past that a
            // re-encode is pointless — return the smallest made rather than a blank.
          if (payload.length <= MAX_ATTACHED_IMAGE_BYTES || attempt >= 6) {
            resolve({
              id: nanoid(),
              data: payload,
              mimeType: meta.slice('data:'.length).split(';')[0] || 'image/png',
              name: file.name || 'image'
              })
            return
            }
          fit *= 0.5
          }
         }
      img.src = url
      }
        reader.readAsDataURL(file)
        })
}

function readImageFiles(files: FileList | File[]): Promise<ImageAttachment[]> {
  const list: File[] = Array.isArray(files) ? [...files] : Array.from(files)
  return Promise.all(
    list
    .filter((file) => file.type.startsWith('image/'))
    .map((file) => stageImage(file))
     )
}
/**
 * Props for the Chat component.
 */
interface ChatProps {
  /** The focused app this conversation is about. */
  app: SubApp
  /** Current permission mode. Set from this conversation's composer. */
  permissionMode: PermissionMode
  /** Change how much the agent is allowed to do. */
  onModeChange: (mode: PermissionMode) => void
  /** Currently active session ID. */
  activeSessionId: string | null
  /** Open the Skills page, from the context breakdown's fixed-cost blocks. */
  onOpenSkills: () => void
  /** Open one of the app's files in its own Code panel. */
  onOpenFile: (path: string) => void
  /** Open one of the instrument panels, from the gauge that summarizes it. */
  onOpenPanel: (panel: WorkspacePanelName) => void
  /**
   * Bumped when something outside this conversation moves HEAD.
   *
   * A rollback or a branch switch happens in the History panel, and the strip would
   * otherwise go on asserting changes that no longer exist — the one kind of wrong a
   * feature about trust cannot afford. Turn-by-turn refreshes stay local to this
   * component so they never re-render the rest of the dock.
   */
  changesRevision: number
}

/**
 * Convert serialized content blocks from persistence to UI blocks.
 */
function convertToUIBlocks(blocks: SerializedContentBlock[]): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    if (block.type === 'text') {
      return { type: 'text', content: block.content }
    } else if (block.type === 'tool') {
      return {
        type: 'tool',
        tool: block.name,
        toolCallId: block.toolCallId,
        status: block.status,
        input: block.input,
        output: block.output,
        error: block.error,
        // Main persists a write's diff and restores it (`chat/manager.ts`), and
        // dropping it here is what made a reopened session render every write as a
        // JSON dump: the diffs were only ever visible in the session that watched
        // them happen.
        patches: block.patches
      }
    } else if (block.type === 'approval') {
      return {
        type: 'approval',
        tool: block.tool,
        input: block.input,
        approved: block.approved
      }
    } else if (block.type === 'element') {
      return {
        type: 'element',
        content: '',
        elementContext: block.elementContext
      }
     } else if (block.type === 'image') {
      return {
        type: 'image',
        data: block.data,
        mimeType: block.mimeType
       }
     }
    // Fallback for unknown types
    return { type: 'text', content: '' }
  })
}

/**
 * Convert UI content blocks to serialized blocks for persistence.
 */
function convertToSerializedBlocks(blocks: ContentBlock[]): SerializedContentBlock[] {
  return blocks.map((block): SerializedContentBlock => {
    if (block.type === 'text') {
      return { type: 'text', content: block.content }
    } else if (block.type === 'tool') {
      return {
        type: 'tool',
        name: block.tool,
        toolCallId: block.toolCallId,
        status: block.status,
        input: block.input,
        output: block.output,
        error: block.error,
        patches: block.patches
      }
    } else if (block.type === 'approval') {
      return {
        type: 'approval',
        tool: block.tool,
        input: block.input,
        approved: block.approved
      }
    } else if (block.type === 'element') {
      return {
        type: 'element',
        elementContext: block.elementContext!
      }
      } else if (block.type === 'image') {
      return {
        type: 'image',
        data: block.data,
        mimeType: block.mimeType
        }
      }
    // Fallback for unknown types
    return { type: 'text', content: '' }
  })
}

/**
 * Convert a persisted transcript into the messages the transcript view renders.
 * @param history - The persisted messages, in order
 * @returns The same messages as UI messages
 */
function toUIMessages(history: PersistedMessage[]): Message[] {
  return history.map((msg) => ({
    id: msg.id,
    role: msg.role,
    blocks: convertToUIBlocks(msg.blocks)
  }))
}

/**
 * Record a failure against the assistant message in flight.
 *
 * A failure lands on the tool that was running when it arrived, because a tool left
 * `running` reads as a call still in progress; with no such tool it becomes a text
 * block instead. Written once and used twice — the `error` chunk and a send that never
 * reached the agent are the same event to a reader, and two copies of this would drift.
 *
 * Exported for its tests: it is the only part of the failure path that a test can
 * reach without a renderer, and the two callers differ only in where the error came
 * from.
 *
 * @param messages - The transcript as it stands
 * @param error - What went wrong
 * @returns The transcript with the failure recorded, or unchanged when there is no
 *   assistant message to record it against
 */
export function withFailure(messages: Message[], error: string | undefined): Message[] {
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return messages

  const blocks = last.blocks ?? []
  const runningIdx = blocks.findIndex((b) => b.type === 'tool' && b.status === 'running')

  if (runningIdx >= 0) {
    const newBlocks = [...blocks]
    const toolBlock = newBlocks[runningIdx]
    if (toolBlock.type === 'tool') {
      newBlocks[runningIdx] = { ...toolBlock, status: 'complete' as const, error }
    }
    return [...messages.slice(0, -1), { ...last, blocks: newBlocks }]
  }

  const newBlocks: ContentBlock[] = [
    ...blocks,
    { type: 'text' as const, content: `\n**Error:** ${error}` }
  ]
  return [...messages.slice(0, -1), { ...last, blocks: newBlocks }]
}

/**
 * Main chat interface with streaming messages and tool approval.
 */
export function Chat({
  app,
  permissionMode,
  onModeChange,
  activeSessionId,
  onOpenSkills,
  onOpenFile,
  onOpenPanel,
  changesRevision
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
        // Images the user has staged to attach, read from files, paste, or drops.
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null)
  const [model, setModel] = useState('')

  // What the agent is doing, in the one place the instrument panels can read it too.
  //
  // This used to be five `useState` calls here. The panels could not subscribe to
  // `agent:stream` themselves — the bridge's `off` was `removeAllListeners`, so a
  // second subscriber tore this one down on unmount; the bridge removes the exact
  // handler now, but the reason to keep one consumer stands — they must not read it off
  // `WorkspaceContext`, whose value is memoized precisely so a per-turn change does not
  // re-render every panel including this transcript. So the stream is still consumed
  // here, exactly once, and published into a store the panels subscribe to.
  //
  // `turnRevision` is the whole point of that: it is bumped when a turn completes, and
  // it is what both this composer and the Changes panel key their git read on.
  const activity = useAgentActivity(app.id)
  const { isStreaming, turnRevision } = activity

  const daemonHealth = useDaemonHealth()
  const { snapshot: telemetry } = useTelemetry(app.id)

  // The model's name, for the daemon gauge's resting label. Read once: changing it
  // goes through Settings, which disposes the agent host and remounts this panel.
  useEffect(() => {
    let cancelled = false
    void window.electronAPI
      .getConfig()
      .then((config) => {
        if (!cancelled) setModel(config.ollamaModel ?? '')
      })
      .catch(() => {
        // A label. Not worth an error state in the composer.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sessionChanges = useSessionChanges({
    appId: app.id,
    sessionId: activeSessionId,
    revision: turnRevision + changesRevision
  })
  const {
    report: contextReport,
    compact: compactContext,
    isCompacting,
    error: compactError
  } = useContextReport(app.id, activeSessionId, turnRevision)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Track current tool being used for input data
  const currentToolRef = useRef<{ name: string; input?: Record<string, unknown> } | null>(null)
  
  // Track latest messages for saving assistant message on complete
  const messagesRef = useRef<Message[]>([])
  messagesRef.current = messages
  

  // Mention completion. The skills come from the same libraries the manifest is built
  // from, so a name the menu offers is a name `load_skill` can resolve.
  const { library: skillLibrary } = useSkills(app.id)
  const mentionableSkills = useMemo(
    () =>
      [...skillLibrary.app, ...skillLibrary.workspace].filter(
        (skill) => skill.enabled && !skill.shadowed && skill.description.length > 0
      ),
    [skillLibrary]
  )
  const mentionQuery = trailingMention(input)
  const mentionMatches = useMentionMatches(mentionableSkills, mentionQuery)
  const [mentionIndex, setMentionIndex] = useMentionCursor(mentionQuery, mentionMatches.length)

  const pickMention = useCallback(
    (name: string) => {
      setInput(completeMention(input, name))
      inputRef.current?.focus()
    },
    [input, inputRef, setInput]
  )

  // Scroll to bottom when messages change or pending approval appears
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingApproval])

  // The session this component is currently showing, readable from the IPC
  // listener below without making it re-subscribe on every switch.
  const activeSessionIdRef = useRef<string | null>(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  // Reset messages when active session changes, then load that session's own.
  //
  // The reset and the load have to live together. Main sends the session change and
  // the transcript as two events, and this effect used to only clear — so a
  // transcript that arrived first was wiped by the clear that followed it, and
  // opening a chat took two clicks: the first showed an empty transcript, the
  // second changed no session id and so left the history alone.
  useEffect(() => {
    setMessages([])
    setPendingApproval(null)
    // The optimistic half of the gauges belongs to the conversation that produced it,
    // and so does the last turn's cost. The committed half is re-read from git for the
    // new session by `useSessionChanges`.
    resetActivity(app.id)

    if (!activeSessionId) return
    let cancelled = false

    window.electronAPI
      .loadChatHistory(app.id)
      .then((payload) => {
        // A transcript for a session we have since switched away from is not ours.
        if (cancelled || payload.sessionId !== activeSessionId) return
        setMessages(toUIMessages(payload.messages))
      })
      .catch(() => {
        // No active app yet is the normal case, not an error worth surfacing.
      })

    return () => {
      cancelled = true
    }
  }, [app.id, activeSessionId])


  // Listen for transcripts pushed from main — on app switch, session switch, and
  // after a delete resolves to a different session.
  //
  // The effect below owns the mount-time load, so this only handles the push. The
  // session tag is what makes it safe: a payload for a session that is no longer
  // active belongs to a switch this component has already moved past.
  useEffect(() => {
    const handleHistoryLoaded = (payload: ChatHistoryPayload) => {
      if (payload.sessionId !== activeSessionIdRef.current) return
      setMessages(toUIMessages(payload.messages))
    }

    return window.electronAPI.onChatHistoryLoaded(app.id, handleHistoryLoaded)
  }, [app.id])

  // Setup IPC listeners.
  //
  // Every subscription names this workspace's app. The pushes carry the app they
  // are about, so a transcript only ever renders its own turn — with several
  // workspaces mounted, an untagged subscription would splice another app's
  // stream into this conversation, and show its approval prompts here.
  useEffect(() => {
    // Listen for agent stream
    const unsubscribeStream = window.electronAPI.onAgentStream(app.id, (chunk: StreamChunk) => {
      if (chunk.type === 'text' && chunk.text) {
        // Add text to current or create new text block
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev
          
          const blocks = last.blocks ?? []
          const lastBlock = blocks[blocks.length - 1]
          
          if (lastBlock?.type === 'text') {
            // Append to existing text block
            const newBlocks: ContentBlock[] = [...blocks.slice(0, -1), {
              ...lastBlock,
              content: lastBlock.content + chunk.text
            }]
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          } else {
            // Create new text block
            const newBlocks: ContentBlock[] = [...blocks, { type: 'text' as const, content: chunk.text! }]
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
        })
      } else if (chunk.type === 'thinking' && chunk.text) {
        // The model's reasoning, which on Ollama arrives on every request whether or
        // not Key Lime Pi asked for it. Appended to its own trailing block so it stays
        // separate from the answer and can be folded away once the answer starts.
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev

          const blocks = last.blocks ?? []
          const lastBlock = blocks[blocks.length - 1]

          if (lastBlock?.type === 'thinking') {
            const newBlocks: ContentBlock[] = [...blocks.slice(0, -1), {
              ...lastBlock,
              content: lastBlock.content + chunk.text
            }]
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }

          const newBlocks: ContentBlock[] = [...blocks, { type: 'thinking' as const, content: chunk.text! }]
          return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
        })
      } else if (chunk.type === 'tool_start' && chunk.tool) {
        // Store tool info
        currentToolRef.current = { name: chunk.tool, input: chunk.input }

        const target = chunk.input?.path
        if (WRITING_TOOLS.has(chunk.tool) && typeof target === 'string') {
          publishActivity(app.id, { writingPath: target })
        }

        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant') return prev

          const blocks = last.blocks ?? []

          // The agent emits exactly one tool_start per call, carrying complete
          // arguments, so this is always a fresh block.
          const newBlocks: ContentBlock[] = [...blocks, {
            type: 'tool' as const,
            tool: chunk.tool!,
            toolCallId: chunk.toolCallId,
            status: 'running' as const,
            input: chunk.input
          }]
          return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
        })
      } else if (chunk.type === 'tool_end') {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role !== 'assistant' || !last.blocks) return prev

          const blocks = last.blocks
          // Match on the call id so parallel tool calls resolve to the right
          // bubble. Fall back to the first running block only for chunks that
          // predate the id.
          const idx = chunk.toolCallId
            ? blocks.findIndex(b => b.type === 'tool' && b.toolCallId === chunk.toolCallId)
            : blocks.findIndex(b => b.type === 'tool' && b.status === 'running')

          if (idx >= 0) {
            const newBlocks = [...blocks]
            const toolBlock = newBlocks[idx]
            if (toolBlock.type === 'tool') {
              newBlocks[idx] = {
                ...toolBlock,
                status: chunk.error ? ('error' as const) : ('complete' as const),
                output: chunk.output,
                error: chunk.error,
                patches: chunk.patches
              }
            }
            return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
          }
          return prev
        })

        // The patches on the result are the uniform source: main puts them on
        // `details` for `write`, `edit` and `replace_lines`, and `refactor` builds its
        // own for every file it rewrote. Nothing else has to know which tool wrote what.
        if (chunk.patches && chunk.patches.length > 0) {
          for (const patch of chunk.patches) recordWrite(app.id, patch.path)
        }

        publishActivity(app.id, { writingPath: null })
        currentToolRef.current = null
      } else if (chunk.type === 'complete') {
        currentToolRef.current = null
        // One call closes the turn, and its revision bump does three jobs that used to
        // be three pieces of state. It re-reads the context report — the turn is the
        // only moment the conversation's share of the window changes, and the chunk
        // carries a usage number but not the attribution, so taking half the answer
        // from each source is how the two drift. It reconciles the changed files
        // against git, which is the only version that survives the same file being
        // written twice. And it tells the Activity panel there is something new to
        // read.
        endTurn(app.id, chunk.turn ? { turn: chunk.turn, cache: chunk.cache ?? 'unknown' } : null)
        // The agent persists its own transcript; nothing to save here.
      } else if (chunk.type === 'status') {
        // Compaction, retries and long prefills are most of the wall-clock time on a
        // local model. Without this they render as a hang.
        publishActivity(app.id, {
          status: chunk.status?.kind === 'settled' ? null : (chunk.status ?? null)
        })
      } else if (chunk.type === 'error') {
        // Without clearing the status the gauge keeps saying "…retrying" after the
        // run it described has failed, which reads as a run still in progress. A
        // failed turn has no cost to report, so nothing is shown rather than a
        // summary of zero.
        endTurn(app.id, null)
        setMessages((prev) => withFailure(prev, chunk.error))
      }
    })

    // Listen for tool approval requests
    const unsubscribeApproval = window.electronAPI.onToolApproval(
      app.id,
      (request: ToolApprovalRequest) => {
        setPendingApproval(request)
      }
    )

    // Listen for element context events
    const unsubscribeElementContext = window.electronAPI.onElementContextAdded(
      app.id,
      (context: ElementContext) => {
        // Add a new user message with element context
        const message: Message = {
          id: nanoid(),
          role: 'user',
          blocks: [
            {
              type: 'text' as const,
              content: 'Please help me modify this element:'
            },
            {
              type: 'element' as const,
              content: '',
              elementContext: context
            }
          ]
        }

        setMessages((prev) => [...prev, message])
      }
    )

    // Cleanup listeners
    return () => {
      unsubscribeStream()
      unsubscribeApproval()
      unsubscribeElementContext()
    }
    // `app.id` is stable for the life of this component — the workspace is keyed
    // by it — but the subscriptions filter on it now, so it is a real dependency
    // and listing it is what keeps that true if the keying ever changes.
  }, [app.id])

  const sendMessage = useCallback(async () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming || !activeSessionId) return

    const blocks: ContentBlock[] = []
         // The text rides as its own block only when there is some, so an image-only
        // message does not lead with an empty text block the model would see as noise.
    if (input.trim()) blocks.push({ type: 'text' as const, content: input })
     for (const attachment of attachments) {
      blocks.push({
        type: 'image' as const,
        data: attachment.data,
        mimeType: attachment.mimeType
         })
       }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      blocks
      }

    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      blocks: []   // Use blocks instead of content for new messages
       }

    setMessages(prev => [...prev, userMessage, assistantMessage])
    setInput('')
         // The bytes are already in `userMessage.blocks`, so clearing the staged list
        // now cannot drop what is about to be sent.
    setAttachments([])
    beginTurn(app.id)

     // Convert message blocks to serialized format for agent
    const serializedBlocks = convertToSerializedBlocks(userMessage.blocks || [])

     // The turn is open from `beginTurn` until a `complete` chunk closes it, and a
     // rejected invoke produces no chunks at all. `agent:message` validates the prompt
     // *before* the try block whose catch emits the compensating error and completion,
     // so a rejection here is the one failure nothing downstream reports — it would
     // leave the composer disabled behind a turn that never started. This is also the
     // only handler for the rejection: `sendMessage` is passed straight to `onClick`.
    try {
      await window.electronAPI.sendMessage(serializedBlocks, app.id)
       } catch (caught) {
      endTurn(app.id, null)
      setMessages((prev) => withFailure(prev, readableError(caught)))
       }
   }, [app.id, input, isStreaming, setInput, setAttachments, activeSessionId, attachments])

  /**
   * Cancel the in-flight agent run.
   */
  const stopStreaming = useCallback(async () => {
    try {
      await window.electronAPI.abortAgent(app.id)
    } catch (err) {
      console.error('Failed to abort agent:', err)
    } finally {
      // Aborting denies any approval still waiting in the main process, so the card
      // asking for it is answered and must not stay on screen.
      setPendingApproval(null)
      endTurn(app.id, null)
    }
  }, [])

   /**
    * Add images picked, pasted, or dropped to the composer.
    */
  const addImageFiles = useCallback((files: FileList | File[]) => {
    void readImageFiles(files)
      .then((read) => {
        if (read.length > 0) setAttachments((prev) => [...prev, ...read])
        })
      .catch((error) => console.error('Failed to read image:', error))
       }, [setAttachments])

   /**
    * Remove a staged attachment from the composer.
    */
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
    }, [setAttachments])

  const handleApproval = useCallback((approved: boolean) => {
    if (!pendingApproval) return
    
    // Record the approval decision as a block in the message
    setMessages(prev => {
      const last = prev[prev.length - 1]
      if (last?.role !== 'assistant') return prev
      
      const blocks = last.blocks ?? []
      const newBlocks: ContentBlock[] = [...blocks, {
        type: 'approval' as const,
        tool: pendingApproval.tool,
        input: pendingApproval.input,
        approved
      }]
      return [...prev.slice(0, -1), { ...last, blocks: newBlocks }]
    })
    
    window.electronAPI.respondToolApproval({ 
      id: pendingApproval.id, 
      approved 
    })
    setPendingApproval(null)
  }, [pendingApproval])

  const clearHistory = useCallback(async () => {
    await window.electronAPI.clearHistory(app.id)
    // Also clear persisted chat history
    try {
      await window.electronAPI.clearChatHistory(app.id)
    } catch {
      // Ignore errors (e.g., no active app)
    }
    setMessages([])
  }, [app.id])

  const mode = describePermissionMode(permissionMode)

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center text-center">
            <p className="text-[15px] text-bone">
              Ask the agent to read or change{' '}
              <span className="font-semibold">{app.name}</span>.
            </p>
            <p className="mt-2 max-w-sm text-[13px] text-ash">
              It&rsquo;s set to <span className="text-bone">{mode.label}</span> — {mode.hint}
            </p>
            <p className="mt-4 text-[12px] text-ash">
              Type <span className="font-mono text-bone">@</span> to hand it a skill.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={
                  isStreaming &&
                  msg.role === 'assistant' &&
                  msg === messages[messages.length - 1]
                }
              />
            ))}

            {/* Inline approval - appears in the message flow */}
            {pendingApproval && (
              <InlineApproval
                request={pendingApproval}
                onApprove={() => handleApproval(true)}
                onDeny={() => handleApproval(false)}
              />
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-line px-6 py-4">
        {/* Four gauges in one fixed-height row. Nothing in it appears or disappears,
            which is the property the four strips it replaces did not have: each of
            them rendered conditionally, so the box below moved as the agent worked. */}
        <AgentGaugeRow
          activity={activity}
          telemetry={telemetry}
          health={daemonHealth}
          model={model}
          report={contextReport}
          changes={sessionChanges}
          onCompact={compactContext}
          isCompacting={isCompacting}
          compactError={compactError}
          onOpenSkills={onOpenSkills}
          onOpenFile={onOpenFile}
          onOpenPanel={onOpenPanel}
        />

        <div
          className="mx-auto max-w-3xl"
           // Images may arrive by paste, the file picker, or a drop anywhere on the
           // composer. `preventDefault` on `dragover` is what lets a drop fire.
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
           e.preventDefault()
            addImageFiles(e.dataTransfer.files)
            }}
        >
          <SkillMentionMenu
            skills={mentionableSkills}
            query={mentionQuery}
            activeIndex={mentionIndex}
            onPick={pickMention}
          />
             {/* Staged attachments, shown above the input until the message is sent. */}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
               {attachments.map((attachment) => (
                 <div key={attachment.id} className="relative">
                   <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.name}
                    className="h-20 w-20 rounded-lg border border-line object-cover"
                    />
                   <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rust text-xs font-bold text-ground"
                    aria-label={`Remove ${attachment.name}`}
                    >
                    ✕
                    </button>
                   </div>
                 ))}
              </div>
            )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => addImageFiles(e.clipboardData.files)}
              onKeyDown={(e) => {
                // While the menu is up the arrows and Enter belong to it, or Enter
                // would send a message with a half-typed skill name in it.
                if (mentionMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setMentionIndex((mentionIndex + 1) % mentionMatches.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIndex(
                      (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length
                    )
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    pickMention(mentionMatches[mentionIndex].name)
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setInput(`${input} `)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) sendMessage()
              }}
              placeholder={`Ask the agent about ${app.name}…`}
              disabled={isStreaming || !activeSessionId}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-4 text-bone placeholder-ash transition-colors hover:border-ash disabled:opacity-50"
            />
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="h-11 shrink-0 rounded-lg bg-rust px-5 font-medium text-ground transition-opacity hover:opacity-90"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={(!input.trim() && attachments.length === 0) || !activeSessionId}
                className="h-11 shrink-0 rounded-lg bg-keylime px-5 font-medium text-ground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>

          {/* Always rendered: the mode is set here, so it has to be reachable
              in an empty conversation too. `Clear this chat` is the part that
              depends on there being something to clear. */}
          <div className="mt-2 flex items-center justify-between gap-3">
            <PermissionModeControl mode={permissionMode} onModeChange={onModeChange} />

            <div className="flex items-center gap-3">
              {/* The context meter used to live here. It is a gauge now, in the row
                  above, beside the other three — this row is the two things you *do*
                  to a conversation rather than the four you read off it. */}
              {messages.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="rounded px-2 py-0.5 text-[11px] text-ash transition-colors hover:bg-raised hover:text-bone"
                >
                  Clear this chat
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
