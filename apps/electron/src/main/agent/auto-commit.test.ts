/**
 * Tests for what auto-commit refuses to commit.
 *
 * The case that motivated these: `git.add` on an ignored path is a silent no-op, so the
 * `git.commit` that follows succeeds and produces an **empty** commit carrying a message
 * that names a file it does not contain. Found in a real app after Session 30 made
 * `memory/` ignored — five empty commits, one per note the agent had written.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { autoCommitToolResult, autoCommitRefactor } from './auto-commit'

let root: string

/** The commit oids on the current branch, newest first. */
async function commits(): Promise<string[]> {
  return (await git.log({ fs, dir: root })).map((entry) => entry.oid)
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'keylimepi-autocommit-'))

  await writeFile(join(root, '.gitignore'), 'node_modules/\nmemory/\ndist/\n')
  await writeFile(join(root, 'index.ts'), 'export const value = 1\n')
  await mkdir(join(root, 'memory'), { recursive: true })
  await writeFile(join(root, 'memory', 'INDEX.md'), '# Memory Index\n')

  await git.init({ fs, dir: root, defaultBranch: 'main' })
  await git.add({ fs, dir: root, filepath: '.gitignore' })
  await git.add({ fs, dir: root, filepath: 'index.ts' })
  await git.commit({
    fs,
    dir: root,
    message: 'initial',
    author: { name: 'Test', email: 'test@example.com' }
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('autoCommitToolResult', () => {
  test('commits a source file the agent wrote', async () => {
    const before = await commits()
    await writeFile(join(root, 'index.ts'), 'export const value = 2\n')

    const outcome = await autoCommitToolResult({
      result: { toolName: 'write', input: { path: 'index.ts' }, isError: false },
      rootPath: root,
      enabled: true,
      absolutePath: join(root, 'index.ts')
    })

    expect(outcome.committed).toBe(true)
    expect(await commits()).toHaveLength(before.length + 1)
  })

  test('makes no commit at all for a path the repository ignores', async () => {
    // Not "an empty commit is harmless": a commit that expands to nothing in the History
    // panel reads as a commit with a small diff, not as one with no diff.
    const before = await commits()
    await writeFile(join(root, 'memory', 'task.md'), '# Goal\n')

    const outcome = await autoCommitToolResult({
      result: { toolName: 'write', input: { path: 'memory/task.md' }, isError: false },
      rootPath: root,
      enabled: true,
      absolutePath: join(root, 'memory', 'task.md')
    })

    expect(outcome.committed).toBe(false)
    expect(outcome.note).toBeUndefined()
    expect(await commits()).toEqual(before)
  })

  test('asks git rather than knowing about memory/', async () => {
    // The defect is older and more general than the directory that exposed it: any
    // ignored path the agent writes to did this, `dist/` included.
    const before = await commits()
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist', 'bundle.js'), 'x\n')

    const outcome = await autoCommitToolResult({
      result: { toolName: 'write', input: { path: 'dist/bundle.js' }, isError: false },
      rootPath: root,
      enabled: true,
      absolutePath: join(root, 'dist', 'bundle.js')
    })

    expect(outcome.committed).toBe(false)
    expect(await commits()).toEqual(before)
  })
})

describe('autoCommitRefactor', () => {
  test('commits the tracked files of a rename and drops the ignored one', async () => {
    // Filtering rather than refusing: the other files in the rename still have to be
    // committed together, which is the whole reason this function exists.
    await writeFile(join(root, 'index.ts'), 'export const renamed = 1\n')
    await writeFile(join(root, 'memory', 'notes.md'), 'x\n')

    const outcome = await autoCommitRefactor({
      rootPath: root,
      relativePaths: ['index.ts', 'memory/notes.md'],
      description: 'rename value to renamed',
      enabled: true
    })

    expect(outcome.committed).toBe(true)

    const head = (await git.log({ fs, dir: root, depth: 1 }))[0]
    const files = await git.listFiles({ fs, dir: root, ref: head.oid })
    expect(files).toContain('index.ts')
    expect(files.some((path) => path.startsWith('memory/'))).toBe(false)
  })

  test('makes no commit when every path is ignored', async () => {
    const before = await commits()
    await writeFile(join(root, 'memory', 'notes.md'), 'x\n')

    const outcome = await autoCommitRefactor({
      rootPath: root,
      relativePaths: ['memory/notes.md'],
      description: 'nothing committable',
      enabled: true
    })

    expect(outcome.committed).toBe(false)
    expect(await commits()).toEqual(before)
  })
})
