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
