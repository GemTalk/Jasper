import { NativeSocketLibrary } from './nativeSocketLibrary';
import { NativeWindowsSocketLibrary } from './nativeWindowsSocketLibrary';
import { NativePOSIXSocketLibrary } from './nativePOSIXSocketLibrary';

export function createNativeSocketLibrary(): NativeSocketLibrary {
  switch (process.platform) {
    case 'win32':
      return createNativeWindowsSocketLibrary();
    case 'darwin':
      return NativePOSIXSocketLibrary.forDarwin();
    case 'linux':
      return NativePOSIXSocketLibrary.forLinux();
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

export function createNativeWindowsSocketLibrary() {
  return new NativeWindowsSocketLibrary();
}
