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
      showInformationMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(async () => undefined),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        append: vi.fn(),
        dispose: vi.fn(),
      })),
      withProgress: vi.fn(
        async (_opts: unknown, task: (p: unknown, t: unknown) => Promise<void>) =>
          await task({ report: vi.fn() }, { isCancellationRequested: false }),
      ),
    },
    commands: { executeCommand: vi.fn() },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    ProgressLocation: { Notification: 15 },
    __setConfigValue: (key: string, value: unknown) => {
      configValues[key] = value;
    },
    __resetConfig: () => {
      for (const k of Object.keys(configValues)) delete configValues[k];
    },
  };
});

import { ExportManager, claimSlot, writeOwner } from '../exportManager';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as vscode from 'vscode';
import { fakeActiveSession } from './fakeActiveSession';

function createMockSession(overrides?: Partial<GemStoneLogin>): ActiveSession {
  return fakeActiveSession({
    id: 1,
    gci: {},
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
  });
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

const setConfig = (key: string, value: unknown) =>
  (vscode as unknown as { __setConfigValue: (k: string, v: unknown) => void }).__setConfigValue(
    key,
    value,
  );

const setWorkspaceFolders = (paths: string[] | null) => {
  (vscode.workspace as unknown as { workspaceFolders: unknown }).workspaceFolders = paths
    ? paths.map((p) => ({ uri: { fsPath: p } }))
    : null;
};

// The setting name in a message is a link that opens it in Settings.
const MIRROR_SETTING_LINK =
  '[gemstone.mirrorFolder](command:workbench.action.openSettings?%5B%22gemstone.mirrorFolder%22%5D)';

function fakeMemento() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
}

describe('ExportManager (incremental sync)', () => {
  let manager: ExportManager;
  let tmpDir: string;
  let mirrorDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    h.setImage(defaultImage());
    h.reset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemstone-export-test-'));
    mirrorDir = path.join(tmpDir, 'storage', 'mirror');
    workspaceDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceDir);
    setWorkspaceFolders([workspaceDir]);
    manager = new ExportManager({ defaultMirrorDir: mirrorDir, memento: fakeMemento() });
  });

  afterEach(() => {
    manager.dispose();
    (vscode as unknown as { __resetConfig: () => void }).__resetConfig();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const root = (s: ActiveSession) => manager.getSessionRoot(s)!;

  describe('path layout', () => {
    it('keys the mirror by host/stone/user under the private storage folder', () => {
      const session = createMockSession();
      expect(root(session)).toBe(path.join(mirrorDir, 'localhost', 'gs64stone', 'DataCurator'));
    });

    it('sanitizes unusual segments', () => {
      const session = createMockSession({ stone: 'weird/stone..name' });
      expect(root(session)).toBe(
        path.join(mirrorDir, 'localhost', 'weird_stone..name', 'DataCurator'),
      );
    });

    it('ignores the open folder', async () => {
      const session = createMockSession();
      await manager.exportSession(session);
      expect(fs.existsSync(path.join(workspaceDir, '.gemstone'))).toBe(false);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'))).toBe(true);
    });

    it('syncs with no folder open', async () => {
      setWorkspaceFolders(null);
      const session = createMockSession();
      await manager.exportSession(session);
      expect(fs.existsSync(path.join(root(session), '1-UserGlobals', 'MyClass.gs'))).toBe(true);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });
  });

  describe('mirrorFolder setting', () => {
    it('puts the mirror under a plain path, with Jasper adding host/stone/user', () => {
      const custom = path.join(tmpDir, 'my-mirror');
      setConfig('mirrorFolder', custom);
      expect(root(createMockSession())).toBe(
        path.join(custom, 'localhost', 'gs64stone', 'DataCurator'),
      );
    });

    it('expands a leading ~ to the home directory', () => {
      setConfig('mirrorFolder', '~/mirror');
      expect(root(createMockSession())).toBe(
        path.join(os.homedir(), 'mirror', 'localhost', 'gs64stone', 'DataCurator'),
      );
    });

    it('reads a relative path against the home directory, not the open folder', () => {
      setConfig('mirrorFolder', 'mirror');
      expect(root(createMockSession())).toBe(
        path.join(os.homedir(), 'mirror', 'localhost', 'gs64stone', 'DataCurator'),
      );
    });

    it('takes placeholders literally', () => {
      const custom = path.join(tmpDir, '{session}');
      setConfig('mirrorFolder', custom);
      expect(root(createMockSession())).toBe(
        path.join(custom, 'localhost', 'gs64stone', 'DataCurator'),
      );
    });

    it('no longer reads the retired exportPath setting', () => {
      setConfig('exportPath', '{workspaceRoot}/smalltalk/{dictName}');
      expect(root(createMockSession())).toBe(
        path.join(mirrorDir, 'localhost', 'gs64stone', 'DataCurator'),
      );
    });
  });

  describe('a mirror folder already in use', () => {
    const second = () => fakeActiveSessionWithId(2);

    function fakeActiveSessionWithId(id: number): ActiveSession {
      const s = createMockSession();
      return Object.assign(s, { id });
    }

    it('gives a second live session with the same login the next free _N folder', () => {
      const first = createMockSession();
      const base = root(first);
      expect(root(second())).toBe(`${base}_2`);
    });

    it('keeps a session on the folder it was given', () => {
      const first = createMockSession();
      const s2 = second();
      const assigned = root(s2);
      root(first);
      expect(root(s2)).toBe(assigned);
    });

    it('reuses the lowest free folder once its session is released', () => {
      const first = createMockSession();
      const base = root(first);
      expect(root(second())).toBe(`${base}_2`);
      manager.releaseSession(first.id);
      expect(root(fakeActiveSessionWithId(3))).toBe(base);
    });

    it('skips a folder held by another live process', () => {
      const base = path.join(mirrorDir, 'localhost', 'gs64stone', 'DataCurator');
      fs.mkdirSync(base, { recursive: true });
      // The test runner's parent is alive and is not this process.
      fs.writeFileSync(
        path.join(base, '.jasper-owner.json'),
        JSON.stringify({ pid: process.ppid, host: os.hostname(), sessionId: 1 }),
      );
      expect(root(createMockSession())).toBe(`${base}_2`);
    });

    // 2**22 is Linux's largest possible pid_max, so this pid can never be live.
    it('takes over a folder whose holder has exited', () => {
      const base = path.join(mirrorDir, 'localhost', 'gs64stone', 'DataCurator');
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(
        path.join(base, '.jasper-owner.json'),
        JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), sessionId: 1 }),
      );
      expect(root(createMockSession())).toBe(base);
    });

    it('treats an unreadable holder record as held', () => {
      const base = path.join(mirrorDir, 'localhost', 'gs64stone', 'DataCurator');
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(path.join(base, '.jasper-owner.json'), '{not json');
      expect(root(createMockSession())).toBe(`${base}_2`);
    });

    it('does not overwrite a holder record that appears after the check', () => {
      // Two windows logging in at once: the other one writes its record between
      // our check and our write. An exclusive create loses that race cleanly.
      const dir = path.join(tmpDir, 'race');
      fs.mkdirSync(dir);
      const theirs = JSON.stringify({ pid: process.ppid, host: os.hostname(), sessionId: 9 });
      fs.writeFileSync(path.join(dir, '.jasper-owner.json'), theirs);
      expect(writeOwner(dir, 1)).toBe(false);
      expect(fs.readFileSync(path.join(dir, '.jasper-owner.json'), 'utf-8')).toBe(theirs);
    });

    it('moves a live session to a new mirrorFolder once the setting changes', async () => {
      // The "can't write" error tells the user to change the setting; that has to work
      // for the session it was shown about, without logging out.
      const blocker = path.join(tmpDir, 'blocked');
      fs.writeFileSync(blocker, '');
      setConfig('mirrorFolder', blocker);
      const session = createMockSession();
      await manager.exportSession(session, true);
      const fixed = path.join(tmpDir, 'fixed');
      setConfig('mirrorFolder', fixed);
      manager.mirrorFolderChanged();
      await manager.refreshSession(session);
      const r = path.join(fixed, 'localhost', 'gs64stone', 'DataCurator');
      expect(root(session)).toBe(r);
      expect(fs.existsSync(path.join(r, '1-UserGlobals', 'MyClass.gs'))).toBe(true);
      expect(fs.existsSync(path.join(r, '.jasper-owner.json'))).toBe(true);
    });

    it('does not keep a folder it could not claim', async () => {
      // A fallback folder has no holder record, so caching it would let another
      // window's session take it too once it becomes writable.
      const blocker = path.join(tmpDir, 'blocked');
      fs.writeFileSync(blocker, '');
      setConfig('mirrorFolder', blocker);
      const session = createMockSession();
      await manager.exportSession(session, true);
      fs.rmSync(blocker);
      await manager.refreshSession(session);
      const r = path.join(blocker, 'localhost', 'gs64stone', 'DataCurator');
      expect(fs.existsSync(path.join(r, '.jasper-owner.json'))).toBe(true);
    });

    it('does not claim a folder again for a session that has logged out', async () => {
      // A refresh queued just before logout fires after it.
      vi.useFakeTimers();
      try {
        const first = createMockSession();
        const base = root(first);
        manager.scheduleRefresh(first);
        manager.releaseSession(first.id);
        await vi.runAllTimersAsync();
        expect(fs.existsSync(path.join(base, '.jasper-owner.json'))).toBe(false);
        expect(manager.getSessionRoot(first)).toBeUndefined();
        expect(root(fakeActiveSessionWithId(3))).toBe(base);
      } finally {
        vi.useRealTimers();
      }
    });

    it('moves on to _2 when another window takes over the same stale record first', () => {
      // Both windows read the dead holder's record; only one may replace it.
      const base = path.join(mirrorDir, 'localhost', 'gs64stone', 'DataCurator');
      fs.mkdirSync(base, { recursive: true });
      const dead = JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), sessionId: 1 });
      fs.writeFileSync(path.join(base, '.jasper-owner.json'), dead);
      const theirs = JSON.stringify({ pid: process.ppid, host: os.hostname(), sessionId: 9 });
      expect(
        claimSlot(base, 1, () => fs.writeFileSync(path.join(base, '.jasper-owner.json'), theirs)),
      ).toBe(false);
      expect(fs.readFileSync(path.join(base, '.jasper-owner.json'), 'utf-8')).toBe(theirs);
    });

    it('releases its holder record on release', () => {
      const first = createMockSession();
      const base = root(first);
      expect(fs.existsSync(path.join(base, '.jasper-owner.json'))).toBe(true);
      manager.releaseSession(first.id);
      expect(fs.existsSync(path.join(base, '.jasper-owner.json'))).toBe(false);
    });

    it('shows no message when it moves a session to _N', async () => {
      root(createMockSession());
      await manager.exportSession(second(), true);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('a mirror folder that cannot be written', () => {
    let blocker: string;

    beforeEach(() => {
      // A file where a directory has to go: mkdir fails for every user, root included.
      blocker = path.join(tmpDir, 'blocked');
      fs.writeFileSync(blocker, '');
      setConfig('mirrorFolder', blocker);
    });

    it('says so plainly, even on an automatic sync', async () => {
      await manager.exportSession(createMockSession(), true);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(blocker),
        expect.anything(),
      );
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining(MIRROR_SETTING_LINK),
        expect.anything(),
      );
    });

    it('says it once per session, not on every sync', async () => {
      const session = createMockSession();
      await manager.exportSession(session, true);
      await manager.refreshSession(session);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
    });

    it('does not throw', async () => {
      await expect(manager.exportSession(createMockSession(), true)).resolves.toBeUndefined();
    });
  });

  describe('first-login notice', () => {
    const infoCalls = () =>
      (vscode.window.showInformationMessage as unknown as { mock: { calls: unknown[][] } }).mock
        .calls;
    const noticeCalls = () => infoCalls().filter((c) => String(c[0]).includes('read-only copy'));

    it('says where the mirror is and what it is for, once', async () => {
      const session = createMockSession();
      await manager.exportSession(session, true);
      await manager.refreshSession(session);
      expect(noticeCalls()).toHaveLength(1);
      const [text, ...buttons] = noticeCalls()[0];
      expect(text).toContain(mirrorDir);
      expect(text).toContain(MIRROR_SETTING_LINK);
      expect(buttons).toEqual(['Open Folder', 'Change…']);
    });

    it('waits until the sync has finished, so it is not buried among the login messages', async () => {
      const order: string[] = [];
      vi.mocked(vscode.window.withProgress).mockImplementationOnce(async (_opts, task) => {
        order.push('sync started');
        await task({ report: vi.fn() }, { isCancellationRequested: false } as never);
        order.push('sync finished');
      });
      vi.mocked(vscode.window.showInformationMessage).mockImplementation(async (text: string) => {
        if (text.includes('read-only copy')) order.push('notice');
        return undefined;
      });
      await manager.exportSession(createMockSession(), true);
      expect(order).toEqual(['sync started', 'sync finished', 'notice']);
    });

    it('is not repeated by a new manager sharing the same stored state', async () => {
      const memento = fakeMemento();
      const a = new ExportManager({ defaultMirrorDir: mirrorDir, memento });
      await a.exportSession(createMockSession(), true);
      a.dispose();
      const b = new ExportManager({ defaultMirrorDir: mirrorDir, memento });
      await b.exportSession(createMockSession(), true);
      b.dispose();
      expect(noticeCalls()).toHaveLength(1);
    });

    it('mentions an old .gemstone folder in the open folder, without deleting it', async () => {
      fs.mkdirSync(path.join(workspaceDir, '.gemstone'));
      await manager.exportSession(createMockSession(), true);
      expect(noticeCalls()[0][0]).toContain(path.join(workspaceDir, '.gemstone'));
      expect(fs.existsSync(path.join(workspaceDir, '.gemstone'))).toBe(true);
    });

    it('does not mention an old folder when there is none', async () => {
      await manager.exportSession(createMockSession(), true);
      expect(noticeCalls()[0][0]).not.toContain('.gemstone');
    });

    it('is not shown when class sync is off for the login', async () => {
      await manager.exportSession(createMockSession({ sync_classes: false }), true);
      expect(noticeCalls()).toHaveLength(0);
    });
  });

  describe('retired exportPath setting', () => {
    const retiredCalls = () =>
      (
        vscode.window.showInformationMessage as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.filter((c) => String(c[0]).includes('gemstone.exportPath'));

    it('says once that the old value is no longer used', async () => {
      setConfig('exportPath', '{workspaceRoot}/smalltalk/{dictName}');
      const session = createMockSession();
      await manager.exportSession(session, true);
      await manager.refreshSession(session);
      expect(retiredCalls()).toHaveLength(1);
      expect(retiredCalls()[0][0]).toContain(MIRROR_SETTING_LINK);
    });

    it('says nothing when exportPath was never set', async () => {
      await manager.exportSession(createMockSession(), true);
      expect(retiredCalls()).toHaveLength(0);
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
      // localhost/gs64stone now empty → cleaned up, but not the mirror folder itself
      expect(fs.existsSync(path.join(mirrorDir, 'localhost'))).toBe(false);
      expect(fs.existsSync(mirrorDir)).toBe(true);
    });

    it('is a no-op when the mirror does not exist', () => {
      expect(() => manager.deleteSessionFiles(createMockSession())).not.toThrow();
    });
  });

  describe('package.json', () => {
    const settings = () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8'),
      );
      const group = pkg.contributes.configuration.find(
        (g: { properties?: Record<string, unknown> }) => g.properties?.['gemstone.mirrorFolder'],
      );
      return group.properties as Record<
        string,
        { description?: string; markdownDescription?: string; markdownDeprecationMessage?: string }
      >;
    };

    it('describes mirrorFolder as a plain folder, with no placeholders', () => {
      const s = settings()['gemstone.mirrorFolder'];
      const text = s.markdownDescription ?? s.description ?? '';
      expect(text).not.toMatch(/\{\w+\}/);
      expect(text).not.toContain('Go to Definition');
    });

    it('marks exportPath as no longer used, pointing at mirrorFolder', () => {
      expect(settings()['gemstone.exportPath'].markdownDeprecationMessage).toContain(
        'gemstone.mirrorFolder',
      );
    });
  });
});
