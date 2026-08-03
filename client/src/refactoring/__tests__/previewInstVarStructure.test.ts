import { describe, it, expect, vi } from 'vitest';
import {
  analyzeInstVarStructure,
  startInstVarStructurePreview,
  pageInstVarStructurePreview,
  applyInstVarStructure,
  clearInstVarStructurePreview,
} from '../queries/previewInstVarStructure';

describe('instance-variable structure query builders', () => {
  describe('analyzeInstVarStructure', () => {
    it('builds a push-up send addressed by the ivar name', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'pushUp', 'Sub', 'x', 2);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('GsInstVarStructureRefactoring class: cls pushUpInstVar:');
      expect(code).toContain("'x'");
      expect(code).toContain('analysisJsonString');
    });

    it('parenthesizes the refactoring send so the unary analysis message binds to it, not the ivar-name string', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'pushUp', 'Sub', 'x', 2);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain(
        "(GsInstVarStructureRefactoring class: cls pushUpInstVar: 'x') analysisJsonString",
      );
      expect(code).not.toContain("'x' analysisJsonString");
    });

    it('builds a push-down send', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'pushDown', 'Base', 'y');

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('pushDownInstVar:');
    });

    it('builds a convert-temporary send carrying the method and side', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'convertTemp', 'Base', 't', undefined, {
        selector: 'compute:',
        isMeta: false,
        varName: 't',
      });

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('convertTemporary:');
      expect(code).toContain("inMethod: #'compute:'");
      expect(code).toContain('meta: false');
    });

    it('emits a class-not-found guard', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'pushUp', 'Missing', 'x');

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('cls isNil ifTrue:');
      expect(code).toContain('Class not found: Missing');
    });

    it('opts into moving accessors when asked, still addressing the analysis to the refactoring', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'pushUp', 'Sub', 'x', 2, undefined, true);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain(
        "((GsInstVarStructureRefactoring class: cls pushUpInstVar: 'x') moveAccessors: true) analysisJsonString",
      );
    });

    it('omits the accessor opt-in by default', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'pushUp', 'Sub', 'x', 2);

      const [, code] = exec.mock.calls[0];
      expect(code).not.toContain('moveAccessors:');
    });

    it('never opts into accessors for convert-temporary (V5)', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'convertTemp', 'Base', 't', undefined, {
        selector: 'compute',
        isMeta: false,
        varName: 't',
      });

      const [, code] = exec.mock.calls[0];
      expect(code).not.toContain('moveAccessors:');
    });

    it('builds a move send carrying the destination classes and the direction', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'move', 'Mid', 'x', 2, undefined, false, {
        targets: ['LeafA', 'LeafB'],
        direction: 'down',
      });

      const [, code] = exec.mock.calls[0];
      expect(code).toContain(
        "GsInstVarStructureRefactoring class: cls moveInstVar: 'x' toClasses: #('LeafA' 'LeafB') direction: #down",
      );
    });

    it('opts into moving accessors on a move when asked', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzeInstVarStructure(exec, 'move', 'Sub', 'x', 2, undefined, true, {
        targets: ['Base'],
        direction: 'up',
      });

      const [, code] = exec.mock.calls[0];
      expect(code).toContain(
        "(GsInstVarStructureRefactoring class: cls moveInstVar: 'x' toClasses: #('Base') direction: #up) moveAccessors: true",
      );
    });
  });

  describe('startInstVarStructurePreview', () => {
    it('builds the ref and starts a token preview', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await startInstVarStructurePreview(
        exec,
        'pushDown',
        'Base',
        'y',
        'tok1',
        4096,
        'UserGlobals',
      );

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('pushDownInstVar:');
      expect(code).toContain("startPreviewToken: 'tok1' maxBytes: 4096");
    });

    it('sends moveAccessors to the ref before starting the preview when opted in', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await startInstVarStructurePreview(
        exec,
        'pushUp',
        'Sub',
        'x',
        'tok1',
        4096,
        2,
        undefined,
        true,
      );

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('ref moveAccessors: true.');
      expect(code).toContain("startPreviewToken: 'tok1'");
    });

    it('answers a decline envelope (not a bare string) when the class is missing', () => {
      const exec = vi.fn().mockResolvedValue('{}');

      void startInstVarStructurePreview(exec, 'pushUp', 'Ghost', 'x', 'tok1', 4096, 2);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('{"decline":"Class not found: Ghost"}');
    });

    it('builds a move preview send with the destinations and direction', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await startInstVarStructurePreview(
        exec,
        'move',
        'Mid',
        'x',
        'tok2',
        4096,
        2,
        undefined,
        true,
        { targets: ['LeafA'], direction: 'down' },
      );

      const [, code] = exec.mock.calls[0];
      expect(code).toContain("moveInstVar: 'x' toClasses: #('LeafA') direction: #down");
      expect(code).toContain('ref moveAccessors: true.');
      expect(code).toContain("startPreviewToken: 'tok2'");
    });
  });

  describe('page / apply / clear', () => {
    it('pages by token', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await pageInstVarStructurePreview(exec, 'tok2', 3, 4096);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('GsInstVarStructureRefactoring pageForToken:');
      expect(code).toContain('from: 3 maxBytes: 4096');
    });

    it('applies by token with no deselection (all-or-nothing)', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await applyInstVarStructure(exec, 'tok3');

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('applyForToken:');
      expect(code).toContain('deselected: #()');
      expect(code).toContain('migrateInstances: false');
      expect(code).toContain('removeOldFromHistory: false');
    });

    it('passes the migrate / remove-history options through to the apply send', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await applyInstVarStructure(exec, 'tok3', true, true);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('migrateInstances: true');
      expect(code).toContain('removeOldFromHistory: true');
    });

    it('clears the preview session by token', () => {
      const exec = vi.fn().mockReturnValue('ok');

      const out = clearInstVarStructurePreview(exec, 'tok4');

      expect(out).toBe('ok');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining("GsInstVarStructureRefactoring clearToken: 'tok4'"),
      );
    });
  });
});
