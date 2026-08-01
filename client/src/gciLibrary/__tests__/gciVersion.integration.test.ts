import { describe, it, expect } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';

/**
 * The version the loaded library's filename carries, if it carries one. Read at
 * collection time (not inside a test) so the comparison below can be *skipped*
 * where there is nothing to compare against — a client library, or an
 * unversioned filename — rather than running and quietly asserting nothing.
 */
const versionInFilename =
  process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH?.match(/libgcits-([\d.]+)-64\./)?.[1];

/**
 * GciTsVersion reports the product and version of the loaded GCI shared
 * library. It takes no session, but which library gets loaded depends on the
 * GemStone release under test, so this only says anything real against a
 * provisioned stone — hence the harness rather than a mock.
 */
describe('GciTsVersion (integration)', () => {
  let gci: GciLibrary;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
  });

  it('identifies the product as GemStone/S 64', () => {
    const { product } = gci.GciTsVersion();

    expect(product).toBe(3);
  });

  it('reports a dotted version number', () => {
    const { version } = gci.GciTsVersion();

    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.skipIf(!versionInFilename)('reports the same version the library filename carries', () => {
    const { version } = gci.GciTsVersion();

    expect(version).toContain(versionInFilename);
  });
});
