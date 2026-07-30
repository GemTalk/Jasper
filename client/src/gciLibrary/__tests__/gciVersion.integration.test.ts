import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH } from '../../__tests__/gci/gciTestConfig';

describe('GciTsVersion', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);

  afterAll(() => {
    gci.close();
  });

  it('returns product id 3 (GemStone/S 64)', () => {
    const { product } = gci.GciTsVersion();
    expect(product).toBe(3);
  });

  it('returns a version string matching x.y.z pattern', () => {
    const { version } = gci.GciTsVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns a version string consistent with the library filename', () => {
    const { version } = gci.GciTsVersion();
    const filenameMatch = GCI_LIBRARY_PATH.match(/libgcits-([\d.]+)-64\./);
    if (filenameMatch) {
      expect(version).toContain(filenameMatch[1]);
    }
  });
});
