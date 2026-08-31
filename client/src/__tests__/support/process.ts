import { SyncThunk } from '../../types';

/**
 * Runs `callback` with `process.platform` temporarily set to `newPlatform`,
 * restoring the original value afterward even if `callback` throws.
 *
 * @param newPlatform - The platform value to report while `callback` runs.
 * @param callback - Runs while `process.platform` reports `newPlatform`.
 */
export function changeProcessPlatformDuring<T>(
  newPlatform: NodeJS.Platform,
  callback: SyncThunk<T>,
) {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', {
    value: newPlatform,
    configurable: true,
  });

  try {
    callback();
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
}
