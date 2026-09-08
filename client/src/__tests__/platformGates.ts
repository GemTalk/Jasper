import { describe, it } from 'vitest';
import { isWindows } from '../wslBridge';

const isSupportedPosixPlatform = process.platform === 'linux' || process.platform === 'darwin';

/**
 * Wraps a `describe` block that only makes sense on a POSIX platform we've
 * validated on (Linux/macOS): behavior backed by real Unix domain sockets or
 * filesystem paths that have no equivalent on Windows (named pipes instead of
 * sockets; `\` as a path separator instead of a legal filename character).
 * This is an allow-list, not a POSIX-detection check: other POSIX platforms
 * (freebsd, aix, sunos, ...) are deliberately excluded because we haven't
 * validated this behavior there, not because they aren't POSIX. Runs the
 * block's tests normally on Linux/macOS; reports them as skipped elsewhere.
 */
export const onSupportedPosixDescribe: ReturnType<typeof describe.runIf> =
  describe.runIf(isSupportedPosixPlatform);

/** Same as {@link onSupportedPosixDescribe}, for a single `it` rather than a whole block. */
export const onSupportedPosixIt: ReturnType<typeof it.runIf> = it.runIf(isSupportedPosixPlatform);

/**
 * Wraps a `describe` block that only makes sense on Windows: behavior backed
 * by Win32-specific primitives (e.g. a raw `SOCKET` opened via `ws2_32.dll`)
 * that have no POSIX equivalent. Runs the block's tests normally on Windows;
 * reports them as skipped elsewhere.
 */
export const onSupportedWindowsDescribe: ReturnType<typeof describe.runIf> =
  describe.runIf(isWindows());
