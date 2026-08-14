import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Fake GemStone server ─────────────────────────────────────────────────────
// ExportManager runs the real sync transport/framing/diff against this in-memory
// image (only the GCI executor is mocked), then writes real files to a temp dir.
const h = vi.hoisted(() => {
  interface FakeClass {
    dictIndex: number;
    className: string;
    source: string;
  }
  interface FakeImage {
    dicts: { index: number; name: string }[];
    classes: FakeClass[];
  }

  const state: {
    image: FakeImage;
    contentPrepares: number;
    fetchedClasses: string[];
    drop: Set<string>; // className(s) the fake server silently omits from content
  } = {
    image: { dicts: [], classes: [] },
    contentPrepares: 0,
    fetchedClasses: [],
    drop: new Set(),
  };

  const fakeHash = (s: string): string => {
    let n = 0;
    for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    return String(n);
  };

  const manifestPayload = (img: FakeImage): string => {
    let body = '';
    let classCount = 0;
    for (const d of img.dicts) {
      body += `D\t${d.index}\t${d.name}\n`;
      for (const c of img.classes.filter((c) => c.dictIndex === d.index)) {
        classCount++;
        body += `C\t${d.index}\t${c.className}\t${fakeHash(c.source)}\n`;
      }
    }
    return `S\t${classCount}\t0\n${body}`;
  };

  const contentPayload = (
    img: FakeImage,
    refs: { dictIndex: number; className: string }[],
  ): string => {
    let body = '';
    let count = 0;
    for (const r of refs) {
      if (state.drop.has(r.className)) continue; // simulate server omitting a class
      const c = img.classes.find((c) => c.dictIndex === r.dictIndex && c.className === r.className);
      if (!c) continue;
      count++;
      body += `${r.dictIndex}\t${r.className}\t${[...c.source].length}\n${c.source}`;
    }
    return `N\t${count}\t0\n${body}`;
  };

  const dictNameOf = (img: FakeImage, idx: number) => img.dicts.find((d) => d.index === idx)?.name;

  // syncClassBuildExpr: resolve dict by name, return `idx \t hash \n source`.
  const classPayload = (img: FakeImage, code: string): string => {
    const dn = code.match(/name asString asSymbol == #'((?:[^']|'')*)'/);
    const cn = code.match(/at: #'((?:[^']|'')*)'/);
    // This fake tracks the generated class-build idiom by hand. If it drifts (e.g. syncClassBuildExpr
    // changes how it names the dictionary or class), fail loudly HERE rather than returning '' — an
    // empty payload silently reads as "class not found" and surfaces as a puzzling sync result several
    // assertions later. classPayload is only called for 'class'-labeled codes, so a miss is a harness
    // bug, not a valid input.
    if (!dn || !cn)
      throw new Error(
        `exportManager test fake: class-build idiom not recognized — retarget classPayload's regex to match syncClassBuildExpr. Code was:\n${code}`,
      );
    const dictName = dn[1].replace(/''/g, "'");
    const className = cn[1].replace(/''/g, "'");
    const c = img.classes.find(
      (c) => c.className === className && dictNameOf(img, c.dictIndex) === dictName,
    );
    if (!c) return '';
    return `${c.dictIndex}\t${fakeHash(c.source)}\n${c.source}`;
  };

  const makeExecutor = () => {
    let stored: string | null = null;
    return (label: string, code: string, _max: number): string => {
      if (label.endsWith(':prepare')) {
        let payload: string;
        if (label.startsWith('manifest')) {
          payload = manifestPayload(state.image);
        } else if (label.startsWith('class')) {
          payload = classPayload(state.image, code);
        } else {
          state.contentPrepares++;
          const refs: { dictIndex: number; className: string }[] = [];
          const re = /\((\d+) '((?:[^']|'')*)'\)/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(code)) !== null) {
            const className = m[2].replace(/''/g, "'");
            refs.push({ dictIndex: parseInt(m[1], 10), className });
            state.fetchedClasses.push(className);
          }
          payload = contentPayload(state.image, refs);
        }
        const cm = code.match(/min: (\d+)/);
        const chunk = cm ? parseInt(cm[1], 10) : payload.length;
        const cps = [...payload];
        if (cps.length > chunk) stored = payload;
        // prepare → `serverMs \t total \n <firstChunk>`
        return `0\t${cps.length}\n${cps.slice(0, Math.min(chunk, cps.length)).join('')}`;
      }
      if (label.endsWith(':fetch')) {
        const m = code.match(/copyFrom: (\d+) to: (\d+)/)!;
        // fetch → `serverMs \n <chunk>`
        return `0\n${[...(stored ?? '')].slice(parseInt(m[1], 10) - 1, parseInt(m[2], 10)).join('')}`;
      }
      if (label.endsWith(':release')) {
        stored = null;
        return '';
      }
      return '';
    };
  };

  return {
    setImage: (img: FakeImage) => {
      state.image = img;
    },
    setClassSource: (dictIndex: number, className: string, source: string) => {
      const c = state.image.classes.find(
        (c) => c.dictIndex === dictIndex && c.className === className,
      );
      if (c) c.source = source;
    },
    removeClass: (dictIndex: number, className: string) => {
      state.image.classes = state.image.classes.filter(
        (c) => !(c.dictIndex === dictIndex && c.className === className),
      );
    },
    addClass: (dictIndex: number, className: string, source: string) => {
      state.image.classes.push({ dictIndex, className, source });
    },
    renameDict: (index: number, name: string) => {
      const d = state.image.dicts.find((d) => d.index === index);
      if (d) d.name = name;
    },
    dropClass: (className: string) => state.drop.add(className),
    reset: () => {
      state.contentPrepares = 0;
      state.fetchedClasses = [];
      state.drop.clear();
    },
    contentPrepares: () => state.contentPrepares,
    fetchedClasses: () => state.fetchedClasses,
    boundLimitExecutor: vi.fn(() => makeExecutor()),
  };
});

vi.mock('../browserQueries', () => ({ boundLimitExecutor: h.boundLimitExecutor }));

vi.mock('vscode', () => {
  const configValues: Record<string, unknown> = {};
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue),
      })),
      workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
    },
    window: {
      showWarningMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        append: vi.fn(),
        dispose: vi.fn(),
      })),
      withProgress: vi.fn(async (_opts: unknown, task: (p: unknown, t: unknown) => Promise<void>) =>
        task({ report: vi.fn() }, { isCancellationRequested: false }),
      ),
    },
    ProgressLocation: { Notification: 15 },
    __setConfigValue: (key: string, value: unknown) => {
      configValues[key] = value;
    },
    __resetConfig: () => {
      for (const k of Object.keys(configValues)) delete configValues[k];
    },
  };
});

import { ExportManager } from '../exportManager';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as vscode from 'vscode';

function createMockSession(overrides?: Partial<GemStoneLogin>): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
      ...overrides,
    },
    stoneVersion: '3.7.2',
  };
}

function defaultImage() {
  return {
    dicts: [
      { index: 1, name: 'UserGlobals' },
      { index: 2, name: 'Globals' },
    ],
    classes: [
      { dictIndex: 1, className: 'MyClass', source: '! fileout of MyClass\n' },
      { dictIndex: 1, className: 'OtherClass', source: '! fileout of OtherClass\n' },
      { dictIndex: 2, className: 'Array', source: '! fileout of Array\n' },
      { dictIndex: 2, className: 'String', source: '! fileout of String\n' },
    ],
  };
}

describe('ExportManager (incremental sync)', () => {
  let manager: ExportManager;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    h.setImage(defaultImage());
    h.reset();
    manager = new ExportManager();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemstone-export-test-'));
    (
      vscode.workspace as unknown as { workspaceFolders: { uri: { fsPath: string } }[] }
    ).workspaceFolders = [{ uri: { fsPath: tmpDir } }];
  });

  afterEach(() => {
    manager.dispose();
    (vscode as unknown as { __resetConfig: () => void }).__resetConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const root = (s: ActiveSession) => manager.getSessionRoot(s)!;

  describe('path layout', () => {
    it('keys the mirror by host/stone/user', () => {
      const session = createMockSession();
      expect(root(session)).toBe(
        path.join(tmpDir, '.gemstone', 'localhost', 'gs64stone', 'DataCurator'),
      );
    });

    it('sanitizes unusual segments', () => {
      const session = createMockSession({ stone: 'weird/stone..name' });
      expect(root(session)).toBe(
        path.join(tmpDir, '.gemstone', 'localhost', 'weird_stone..name', 'DataCurator'),
      );
    });
  });

  describe('first sync', () => {
    it('creates dictionary directories with class files', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      const r = root(session);
      expect(fs.readFileSync(path.join(r, '1-UserGlobals', 'MyClass.gs'), 'utf-8')).toBe(
        '! fileout of MyClass\n',
      );
      expect(fs.readFileSync(path.join(r, '1-UserGlobals', 'OtherClass.gs'), 'utf-8')).toBe(
        '! fileout of OtherClass\n',
      );
      expect(fs.readFileSync(path.join(r, '2-Globals', 'Array.gs'), 'utf-8')).toBe(
        '! fileout of Array\n',
      );
      expect(fs.readFileSync(path.join(r, '2-Globals', 'String.gs'), 'utf-8')).toBe(
        '! fileout of String\n',
      );
    });

    it('marks class files read-only', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      const stat = fs.statSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'));
      expect(stat.mode & 0o222).toBe(0);
    });

    it('persists a manifest state file', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      expect(fs.existsSync(path.join(root(session), '.manifest.json'))).toBe(true);
    });

    it('fetches every class', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      expect(h.fetchedClasses().sort()).toEqual(['Array', 'MyClass', 'OtherClass', 'String']);
    });
  });

  describe('incremental re-sync', () => {
    it('fetches nothing when the image is unchanged', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      h.reset();
      await manager.refreshSession(session);
      expect(h.contentPrepares()).toBe(0);
      expect(h.fetchedClasses()).toEqual([]);
    });

    it('re-fetches only a changed class', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      h.reset();
      h.setClassSource(1, 'MyClass', '! fileout of MyClass v2\n');
      await manager.refreshSession(session);
      expect(h.fetchedClasses()).toEqual(['MyClass']);
      expect(
        fs.readFileSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'), 'utf-8'),
      ).toBe('! fileout of MyClass v2\n');
    });

    it('deletes a class removed from the image', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      const file = path.join(root(session), '1-UserGlobals', 'OtherClass.gs');
      expect(fs.existsSync(file)).toBe(true);
      h.reset();
      h.removeClass(1, 'OtherClass');
      await manager.refreshSession(session);
      expect(fs.existsSync(file)).toBe(false);
      expect(h.fetchedClasses()).toEqual([]); // nothing fetched, only a delete
    });

    it('fetches a newly added class only', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      h.reset();
      h.addClass(1, 'BrandNew', '! fileout of BrandNew\n');
      await manager.refreshSession(session);
      expect(h.fetchedClasses()).toEqual(['BrandNew']);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals', 'BrandNew.gs'))).toBe(true);
    });

    it('handles a dictionary rename: prunes the old dir, populates the new', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals'))).toBe(true);
      h.reset();
      h.renameDict(1, 'Renamed');
      await manager.refreshSession(session);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals'))).toBe(false);
      expect(fs.readFileSync(path.join(root(session), '1-Renamed', 'MyClass.gs'), 'utf-8')).toBe(
        '! fileout of MyClass\n',
      );
    });
  });

  describe('per-login gate', () => {
    it('does nothing when sync_classes is false', async () => {
      const session = createMockSession({ sync_classes: false });
      await manager.exportSession(session);
      expect(fs.existsSync(root(session))).toBe(false);
      expect(h.fetchedClasses()).toEqual([]);
    });

    it('syncs when sync_classes is true', async () => {
      const session = createMockSession({ sync_classes: true });
      await manager.exportSession(session);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'))).toBe(true);
    });
  });

  describe('no workspace', () => {
    it('warns on an explicit (non-silent) sync', async () => {
      (vscode.workspace as unknown as { workspaceFolders: null }).workspaceFolders = null;
      await manager.exportSession(createMockSession());
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No workspace folder'),
      );
    });

    it('stays silent on an automatic (silent) sync', async () => {
      (vscode.workspace as unknown as { workspaceFolders: null }).workspaceFolders = null;
      await manager.refreshSession(createMockSession());
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });
  });

  describe('syncClass (targeted single-class update)', () => {
    it('rewrites a changed class file and updates persisted state', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      const file = path.join(root(session), '1-UserGlobals', 'MyClass.gs');
      h.setClassSource(1, 'MyClass', '! fileout of MyClass edited\n');

      await manager.syncClass(session, 'UserGlobals', 'MyClass');

      expect(fs.readFileSync(file, 'utf-8')).toBe('! fileout of MyClass edited\n');
      // State now matches the new content, so a follow-up sync fetches nothing.
      h.reset();
      await manager.refreshSession(session);
      expect(h.contentPrepares()).toBe(0);
    });

    it('creates the file and dir for a class not yet mirrored', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      h.addClass(1, 'FreshClass', '! fileout of FreshClass\n');

      await manager.syncClass(session, 'UserGlobals', 'FreshClass');

      expect(
        fs.readFileSync(path.join(root(session), '1-UserGlobals', 'FreshClass.gs'), 'utf-8'),
      ).toBe('! fileout of FreshClass\n');
    });

    it('writes a read-only file', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      h.setClassSource(1, 'MyClass', '! v2\n');
      await manager.syncClass(session, 'UserGlobals', 'MyClass');
      const stat = fs.statSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'));
      expect(stat.mode & 0o222).toBe(0);
    });

    it('is a no-op when the class is not found', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      await expect(manager.syncClass(session, 'UserGlobals', 'Ghost')).resolves.toBeUndefined();
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals', 'Ghost.gs'))).toBe(false);
    });

    it('does nothing when sync is disabled for the login', async () => {
      const session = createMockSession({ sync_classes: false });
      await manager.syncClass(session, 'UserGlobals', 'MyClass');
      expect(fs.existsSync(root(session))).toBe(false);
    });
  });

  describe('removeClassFile (targeted delete)', () => {
    it('deletes the file and drops the persisted hash', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      const file = path.join(root(session), '1-UserGlobals', 'MyClass.gs');
      expect(fs.existsSync(file)).toBe(true);

      manager.removeClassFile(session, 1, 'UserGlobals', 'MyClass');

      expect(fs.existsSync(file)).toBe(false);
      // Drop it from the image too; a follow-up sync should not flag a deletion.
      h.removeClass(1, 'MyClass');
      h.reset();
      await manager.refreshSession(session);
      expect(h.contentPrepares()).toBe(0);
    });

    it('does not create a state file when sync is disabled', () => {
      const session = createMockSession({ sync_classes: false });
      manager.removeClassFile(session, 1, 'UserGlobals', 'MyClass');
      expect(fs.existsSync(path.join(root(session), '.manifest.json'))).toBe(false);
    });
  });

  describe('scheduleRefresh (debounced structural re-sync)', () => {
    it('coalesces rapid calls into a single refresh', async () => {
      vi.useFakeTimers();
      try {
        const session = createMockSession();
        const spy = vi.spyOn(manager, 'refreshSession').mockResolvedValue();
        manager.scheduleRefresh(session, 100);
        manager.scheduleRefresh(session, 100);
        manager.scheduleRefresh(session, 100);
        expect(spy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(120);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not schedule when sync is disabled', async () => {
      vi.useFakeTimers();
      try {
        const session = createMockSession({ sync_classes: false });
        const spy = vi.spyOn(manager, 'refreshSession').mockResolvedValue();
        manager.scheduleRefresh(session, 100);
        await vi.advanceTimersByTimeAsync(200);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('audit (missing classes are surfaced, not silently dropped)', () => {
    it('warns and skips the success toast when the server omits a requested class', async () => {
      const session = createMockSession();
      h.dropClass('Array'); // server silently omits Array from the content batch
      await manager.exportSession(session);

      expect(fs.existsSync(path.join(root(session), '2-Globals', 'Array.gs'))).toBe(false);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'))).toBe(true);
      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('could not be written'),
      );
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
        expect.stringContaining('Synced GemStone classes'),
      );
    });

    it('does not record a missing class in state, so the next sync re-fetches it', async () => {
      const session = createMockSession();
      h.dropClass('Array');
      await manager.exportSession(session);
      h.reset(); // stop dropping
      await manager.refreshSession(session);
      expect(fs.existsSync(path.join(root(session), '2-Globals', 'Array.gs'))).toBe(true);
      expect(h.fetchedClasses()).toEqual(['Array']); // only the previously-missing one
    });
  });

  describe('readOnlyMirror setting', () => {
    it('writes writable files when disabled (fewer syscalls on slow filesystems)', async () => {
      (vscode as unknown as { __setConfigValue: (k: string, v: unknown) => void }).__setConfigValue(
        'classSync.readOnlyMirror',
        false,
      );
      const session = createMockSession();
      await manager.exportSession(session);
      const stat = fs.statSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'));
      expect(stat.mode & 0o222).not.toBe(0); // writable
    });

    it('overwrites an existing read-only file on the next sync', async () => {
      const session = createMockSession();
      await manager.exportSession(session); // writes read-only files
      h.setClassSource(1, 'MyClass', '! fileout of MyClass v2\n');
      await manager.refreshSession(session); // must make it writable, rewrite, re-lock
      expect(
        fs.readFileSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'), 'utf-8'),
      ).toBe('! fileout of MyClass v2\n');
    });
  });

  describe('deleteSessionFiles', () => {
    it('removes the mirror and empty ancestors', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      const r = root(session);
      expect(fs.existsSync(r)).toBe(true);
      manager.deleteSessionFiles(session);
      expect(fs.existsSync(r)).toBe(false);
      // .gemstone/localhost/gs64stone now empty → cleaned up
      expect(fs.existsSync(path.join(tmpDir, '.gemstone'))).toBe(false);
    });

    it('is a no-op when the mirror does not exist', () => {
      expect(() => manager.deleteSessionFiles(createMockSession())).not.toThrow();
    });
  });

  describe('exportPath setting', () => {
    it('uses a custom template with variable substitution', async () => {
      (vscode as unknown as { __setConfigValue: (k: string, v: unknown) => void }).__setConfigValue(
        'exportPath',
        '{workspaceRoot}/smalltalk/{dictName}',
      );
      const session = createMockSession();
      await manager.exportSession(session);
      const r = root(session);
      expect(r).toBe(path.join(tmpDir, 'smalltalk'));
      expect(fs.existsSync(path.join(r, 'UserGlobals', 'MyClass.gs'))).toBe(true);
    });

    it('lists all variables and documents the default in package.json', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'),
      );
      const group = pkg.contributes.configuration.find(
        (g: { properties?: Record<string, unknown> }) => g.properties?.['gemstone.exportPath'],
      );
      const desc = group.properties['gemstone.exportPath'].description;
      for (const v of [
        '{workspaceRoot}',
        '{session}',
        '{host}',
        '{stone}',
        '{user}',
        '{index}',
        '{dictName}',
      ]) {
        expect(desc).toContain(v);
      }
      expect(desc).toContain('.gemstone');
    });
  });
});
