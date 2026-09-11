/**
 * The invoke handlers main has registered, so teardown can remove exactly those.
 *
 * `cleanupIpcHandlers` used to name every channel a second time, by hand, and the
 * two lists drifted: `changes:session-baseline` was registered and never removed.
 * Nothing notices that until the window is rebuilt — on macOS, closing the window
 * leaves the app running and clicking the dock icon calls `setupIpcHandlers` again,
 * at which point Electron throws `Attempted to register a second handler` from inside
 * an `activate` listener and the main process dies with an uncaught exception.
 *
 * Recording each channel as it is registered makes the removal list a consequence of
 * the registration list rather than a copy of it, so a new channel cannot be missed.
 */

/**
 * The part of `ipcMain` the registry drives.
 *
 * Structural rather than imported so a test can stand in for Electron, which cannot
 * be loaded outside it.
 */
export interface InvokeTarget<Listener> {
  /** Register a handler for an invoke channel. Throws if the channel has one. */
  handle(channel: string, listener: Listener): void
  /** Remove a channel's handler, if it has one. */
  removeHandler(channel: string): void
}

/**
 * Registers invoke handlers and remembers which, for removal as a set.
 */
export interface HandlerRegistry<Listener> {
  /** Register a handler on the target and record its channel. */
  handle(channel: string, listener: Listener): void
  /** Remove every handler registered through this registry, and forget them. */
  removeAll(): void
}

/**
 * Create a registry over an invoke target.
 *
 * A duplicate registration still throws, exactly as the target does: two handlers
 * for one channel inside a single setup is a real bug, and masking it would leave
 * whichever registered first silently answering.
 *
 * @param target - Where handlers are actually registered, `ipcMain` in the app
 * @returns A registry whose `handle` is safe to call unbound
 */
export function createHandlerRegistry<Listener>(
  target: InvokeTarget<Listener>
): HandlerRegistry<Listener> {
  const channels = new Set<string>()

  return {
    handle(channel: string, listener: Listener): void {
      // Recorded only once the target has accepted it: a registration that threw
      // left nothing behind to remove.
      target.handle(channel, listener)
      channels.add(channel)
    },
    removeAll(): void {
      for (const channel of channels) {
        target.removeHandler(channel)
      }
      channels.clear()
    }
  }
}
