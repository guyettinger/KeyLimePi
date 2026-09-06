/**
 * Tests for the always-on half of the memory protocol.
 *
 * Four things have to name the same two paths or the recovery path fails silently: the
 * system prompt, the post-compaction notice, the seeded `AGENTS.md`, and the `remember`
 * skill. The other three are covered where they live; this pins the first two, which are
 * the pair with no other check between them.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import type { SubApp } from '@keylimepi/core'
import { getSystemPrompt } from './system-prompt.js'

const APP: SubApp = {
  id: 'moon-phase',
  name: 'Moon Phase',
  description: 'Shows the phase of the moon',
  template: 'react-vite',
  status: 'ready',
  path: '/tmp/apps/moon-phase',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z'
}

describe('getSystemPrompt', () => {
  test('sends the model to the memory index, not to a NOTES.md', () => {
    const prompt = getSystemPrompt({ app: APP })

    expect(prompt).toContain('memory/INDEX.md')
    expect(prompt).toContain('memory/task.md')
    expect(prompt).not.toContain('NOTES.md')
  })

  test('names the skills that carry the rest of the protocol', () => {
    // The prompt deliberately holds only the trigger; the method is in the skills, whose
    // bodies cost nothing until loaded. Naming ones that are not seeded would advertise
    // a `load_skill` call that fails.
    const prompt = getSystemPrompt({ app: APP })

    for (const name of ['plan', 'implement', 'remember']) {
      expect(prompt).toContain(`\`${name}\``)
    }
  })
})

describe('the post-compaction notice', () => {
  /**
   * `COMPACTION_NOTICE` is module-private and the call site is deep inside session
   * construction, so this reads the source — the same approach `APP_ACCENTS` uses to keep
   * a value honest that cannot be reached from a test.
   * @returns The text of `session.ts`
   */
  async function sessionSource(): Promise<string> {
    return readFile(join(import.meta.dirname, 'session.ts'), 'utf-8')
  }

  test('names both files the prompt names', async () => {
    const source = await sessionSource()
    const notice = /const COMPACTION_NOTICE =([\s\S]*?)\n\n/.exec(source)?.[1] ?? ''

    expect(notice).toContain('memory/INDEX.md')
    expect(notice).toContain('memory/task.md')
    expect(notice).not.toContain('NOTES.md')
  })

  test('keeps the transcript marker under its original name', async () => {
    // `anyapp-compaction-notice` is written into Pi's session transcripts on disk.
    // Renaming it with the text above would orphan every notice in a conversation the
    // user can still open — the rule the repo's AGENTS.md states for persisted strings.
    expect(await sessionSource()).toContain("customType: 'anyapp-compaction-notice'")
  })
})
