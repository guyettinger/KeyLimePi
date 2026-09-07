/**
 * Tests for what a sub-app is seeded with.
 *
 * `createApp` itself is not exercised here: `APPS_DIR` is resolved from `homedir()` at
 * module load, so calling it would write into the user's real `~/.keylimepi/apps`. What
 * the tests below cover instead is every piece of it that can be reached with an explicit
 * path — the placeholder substitution, and the property the whole memory design rests on,
 * through the real `initGitRepo`.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { AppManager } from './manager.js'
import {
  applyTemplateVars,
  DEFAULT_AGENTS_MD,
  DEFAULT_GITIGNORE,
  DEFAULT_MEMORY_INDEX
} from './templates.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'keylimepi-seed-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('applyTemplateVars', () => {
  test('substitutes every placeholder the templates use', () => {
    const out = applyTemplateVars('{{APP_NAME}} / {{APP_DESCRIPTION}} / {{APP_ID}}', {
      name: 'Moon Phase',
      description: 'Shows the phase of the moon',
      id: 'moon-phase'
    })

    expect(out).toBe('Moon Phase / Shows the phase of the moon / moon-phase')
  })

  test('leaves no placeholder in the seeded AGENTS.md', () => {
    // This file goes into every request. A literal `{{APP_NAME}}` in it is a permanent,
    // silent defect — nothing fails, the model is just told the app is called that.
    const out = applyTemplateVars(DEFAULT_AGENTS_MD, {
      name: 'Moon Phase',
      description: 'Shows the phase of the moon',
      id: 'moon-phase'
    })

    expect(out).toContain('# Moon Phase')
    expect(out).toContain('Shows the phase of the moon')
    expect(out).not.toContain('{{')
  })

  test('names the paths the compaction notice sends the model to', () => {
    // The notice in `agent/session.ts` and the seeded file have to agree, and nothing
    // else checks that they do.
    expect(DEFAULT_AGENTS_MD).toContain('memory/INDEX.md')
    expect(DEFAULT_AGENTS_MD).toContain('memory/task.md')
  })
})

describe('DEFAULT_MEMORY_INDEX', () => {
  test('is a usable index whose example is commented out', () => {
    // An uncommented example would be an index entry for a file that does not exist,
    // which is the one thing an index must never contain.
    expect(DEFAULT_MEMORY_INDEX).toContain('# Memory Index')
    expect(DEFAULT_MEMORY_INDEX).toContain('<!-- - api-shape.md')
    expect(DEFAULT_MEMORY_INDEX.split('\n').filter((line) => /^- /.test(line))).toEqual([])
  })
})

describe('the memory directory survives a rollback', () => {
  /**
   * Lay out an app the way `createApp` does, then initialise git over it.
   * @returns The app root
   */
  async function seedApp(): Promise<string> {
    await writeFile(join(root, '.gitignore'), DEFAULT_GITIGNORE)
    await writeFile(join(root, 'AGENTS.md'), DEFAULT_AGENTS_MD)
    await writeFile(join(root, 'index.js'), 'export const app = 1\n')
    await mkdir(join(root, 'memory'), { recursive: true })
    await writeFile(join(root, 'memory', 'INDEX.md'), DEFAULT_MEMORY_INDEX)
    await writeFile(join(root, 'memory', 'api-shape.md'), 'the note that must survive\n')

    await new AppManager().initGitRepo(root, 'Initial commit')
    return root
  }

  test('initGitRepo tracks AGENTS.md and nothing under memory/', async () => {
    // `rollback` is a `git checkout`: it restores tracked files and leaves untracked ones
    // alone. So the note explaining a failure survives the rollback that failure caused —
    // but only while nothing under `memory/` is in the tree.
    const dir = await seedApp()
    const tracked = await git.listFiles({ fs, dir, ref: 'HEAD' })

    expect(tracked).toContain('AGENTS.md')
    expect(tracked).toContain('.gitignore')
    expect(tracked.some((path) => path.startsWith('memory/'))).toBe(false)
  })

  test('git_status is clean and says nothing about memory/', async () => {
    // `statusMatrix` reports untracked files as modified, so an ignored-but-reported
    // `memory/` would put the agent's own notes into the first `git_status` of every
    // session — the failure DEFAULT_GITIGNORE exists to prevent, arriving from inside.
    const dir = await seedApp()
    const status = await git.statusMatrix({ fs, dir })

    const changed = status.filter(([, head, workdir, stage]) => head !== workdir || head !== stage)
    expect(changed).toEqual([])
    expect(status.some(([path]) => path.startsWith('memory/'))).toBe(false)
  })
})
