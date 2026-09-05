import { NativeSocketLibrary } from './nativeSocketLibrary';
import { NativeWindowsSocketLibrary } from './nativeWindowsSocketLibrary';
import { NativePOSIXSocketLibrary } from './nativePOSIXSocketLibrary';

/**
 * Creates the native socket library for the current platform.
 *
 * @returns a library instance for polling sockets and opening test-only raw connections.
 * @throws {Error} If the current platform isn't supported.
 */
export function createNativeSocketLibrary(): NativeSocketLibrary {
  switch (process.platform) {
    case 'win32':
      return new NativeWindowsSocketLibrary();
    case 'darwin':
      return NativePOSIXSocketLibrary.forDarwin();
    case 'linux':
      return NativePOSIXSocketLibrary.forLinux();
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}
