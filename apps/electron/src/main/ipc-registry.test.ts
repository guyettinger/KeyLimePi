/**
 * Tests for the invoke-handler registry.
 *
 * The property under test is the one macOS depends on: the window can be closed
 * and rebuilt, so every handler `setupIpcHandlers` registers must be gone before it
 * runs again, or Electron throws and takes the main process with it.
 */

import { describe, expect, test } from 'bun:test'
import { createHandlerRegistry, type InvokeTarget } from './ipc-registry'

/** A listener shape for the fake; the registry never calls it. */
type Listener = () => void

/** Stands in for `ipcMain`, including its refusal of a second handler. */
function makeTarget(): InvokeTarget<Listener> & { channels: Map<string, Listener> } {
  const channels = new Map<string, Listener>()
  return {
    channels,
    handle(channel: string, listener: Listener): void {
      if (channels.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      channels.set(channel, listener)
    },
    removeHandler(channel: string): void {
      channels.delete(channel)
    }
  }
}

/** Registers the same set of channels a window's setup would. */
function setup(register: (channel: string, listener: Listener) => void): void {
  register('apps:list', () => {})
  register('changes:session-baseline', () => {})
}

describe('createHandlerRegistry', () => {
  test('a window can be closed and rebuilt', () => {
    const target = makeTarget()
    const registry = createHandlerRegistry(target)

    setup(registry.handle)
    registry.removeAll()

    // The dock-icon `activate` path: setup runs a second time in the same process.
    expect(() => setup(registry.handle)).not.toThrow()
    expect([...target.channels.keys()].sort()).toEqual(['apps:list', 'changes:session-baseline'])
  })

  test('removes every channel it registered, and nothing else', () => {
    const target = makeTarget()
    target.handle('owned:elsewhere', () => {})
    const registry = createHandlerRegistry(target)

    setup(registry.handle)
    registry.removeAll()

    expect([...target.channels.keys()]).toEqual(['owned:elsewhere'])
  })

  test('a duplicate within one setup still throws', () => {
    const registry = createHandlerRegistry(makeTarget())
    registry.handle('apps:list', () => {})
    expect(() => registry.handle('apps:list', () => {})).toThrow(/second handler/)
  })

  test('a registration the target refused is not removed later', () => {
    const target = makeTarget()
    target.handle('apps:list', () => {})
    const registry = createHandlerRegistry(target)

    expect(() => registry.handle('apps:list', () => {})).toThrow()
    registry.removeAll()

    // The handler belongs to whoever registered it first, not to this registry.
    expect(target.channels.has('apps:list')).toBe(true)
  })
})
