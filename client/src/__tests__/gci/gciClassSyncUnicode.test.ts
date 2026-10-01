import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// browserQueries → gciLog → vscode
vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as queries from '../../browserQueries';
import { boundLimitExecutor } from '../../browserQueries';
import { fetchBlob } from '../../sync/syncTransport';
import { contentBuildExpr, MANIFEST_BUILD_EXPR } from '../../sync/syncProtocol';
import { parseContent, parseManifest } from '../../sync/syncFraming';

const TEST_CLASS = 'VsCodeSyncUnicodeTest';
const EM_DASH = '—'; // — : a wide (Unicode16) char in GemStone

// Regression test for the bug where a class whose file-out contained any
// non-ASCII character (e.g. an em dash) widened the payload to a Unicode16
// string, which `GciTsExecuteFetchBytes` returned as non-UTF-8 bytes — corrupting
// the decode and desyncing the parser so ~25% of classes were silently dropped.
// The fix encodes each transport chunk as UTF-8 server-side; this drives the real
// GCI path end-to-end to prove the source round-trips intact.
describe('Class sync round-trip with non-ASCII source (integration)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let ugIndex: number;

  beforeAll(async () => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      stoneVersion: '3.7.2',
    };

    await queries.compileClassDefinition(
      session,
      `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
    );
    await queries.setClassComment(session, TEST_CLASS, `An em${EM_DASH}dash in the comment.`);
    await queries.compileMethod(
      session,
      TEST_CLASS,
      false,
      'testing',
      `answer\n  "another em${EM_DASH}dash here"\n  ^ 42`,
    );
    ugIndex = (await queries.getDictionaryNames(session)).indexOf('UserGlobals') + 1;
  });

  afterAll(() => {
    try {
      gci.GciTsAbort(session.handle);
    } catch {
      /* roll back the temp class */
    }
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci.close();
  });

  it('round-trips the file-out through the content transport with the em dash intact', () => {
    const exec = boundLimitExecutor(session);
    const payload = fetchBlob(
      exec,
      'content',
      contentBuildExpr([{ dictIndex: ugIndex, dictName: 'UserGlobals', className: TEST_CLASS }]),
    );
    const parsed = parseContent(payload);

    expect(parsed.error).toBeNull();
    expect(parsed.declaredCount).toBe(1);
    expect(parsed.records).toHaveLength(1);
    const src = parsed.records[0].source;
    expect(src).toContain(TEST_CLASS);
    expect(src).toContain(`An em${EM_DASH}dash`);
    expect(src).toContain(`another em${EM_DASH}dash`);
    // No replacement characters / mojibake from a bad decode.
    expect(src).not.toContain('�');
  });

  it('lists the class in the manifest with an integral count', () => {
    const exec = boundLimitExecutor(session);
    const payload = fetchBlob(exec, 'manifest', MANIFEST_BUILD_EXPR);
    const manifest = parseManifest(payload);

    const entry = manifest.classes.find((c) => c.className === TEST_CLASS);
    expect(entry).toBeDefined();
    expect(entry!.hash).toMatch(/^\d+$/); // decimal md5
    // The server's S-line count must agree with the parsed C lines (no truncation).
    expect(manifest.classCount).toBe(manifest.classes.length);
  });
});
