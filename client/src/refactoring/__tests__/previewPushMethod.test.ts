import { describe, it, expect, vi } from 'vitest';
import {
  pushEngineClass,
  analyzePushMethod,
  startPushMethodPreview,
  pagePushMethodPreview,
  applyPushMethod,
  clearPushMethodPreview,
} from '../queries/previewPushMethod';

describe('push-method query builders', () => {
  it('maps the direction to the right engine class', () => {
    expect(pushEngineClass('up')).toBe('GsPushUpMethodRefactoring');
    expect(pushEngineClass('down')).toBe('GsPushDownMethodRefactoring');
  });

  describe('analyzePushMethod', () => {
    it('addresses the push-up engine with the source class, selectors, and side', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzePushMethod(exec, 'up', 'Sub', ['foo', 'bar:'], false, 2);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('GsPushUpMethodRefactoring');
      expect(code).toContain('analyzeForClass: cls');
      expect(code).toContain("{#'foo'. #'bar:'}");
      expect(code).toContain('meta: false');
    });

    it('uses the push-down engine and marks the class side', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzePushMethod(exec, 'down', 'Base', ['makeOne'], true);

      const [label, code] = exec.mock.calls[0];
      expect(code).toContain('GsPushDownMethodRefactoring');
      expect(code).toContain('meta: true');
      expect(label).toContain('Base class');
    });

    it('returns a source-not-found envelope guard in the generated code', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await analyzePushMethod(exec, 'up', 'Missing', ['foo'], false);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('cls isNil ifTrue:');
      expect(code).toContain('Source class not found: Missing');
    });
  });

  describe('startPushMethodPreview', () => {
    it('builds the refactoring and starts a token preview', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await startPushMethodPreview(exec, 'up', 'Sub', ['foo'], false, 'tok1', 4096, 'UserGlobals');

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('GsPushUpMethodRefactoring');
      expect(code).toContain('sourceClass: cls');
      expect(code).toContain("startPreviewToken: 'tok1' maxBytes: 4096");
    });
  });

  describe('pagePushMethodPreview / applyPushMethod / clearPushMethodPreview', () => {
    it('pages by token against the matching engine', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await pagePushMethodPreview(exec, 'down', 'tok2', 3, 4096);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('GsPushDownMethodRefactoring pageForToken:');
      expect(code).toContain("'tok2'");
      expect(code).toContain('from: 3 maxBytes: 4096');
    });

    it('applies by token, passing the deselected ids', async () => {
      const exec = vi.fn().mockResolvedValue('{}');

      await applyPushMethod(exec, 'up', 'tok3', ['5', '7']);

      const [, code] = exec.mock.calls[0];
      expect(code).toContain('GsPushUpMethodRefactoring applyForToken:');
      expect(code).toContain("deselected: #('5' '7')");
    });

    it('clears the preview session by token', () => {
      const exec = vi.fn().mockReturnValue('ok');

      const out = clearPushMethodPreview(exec, 'down', 'tok4');

      expect(out).toBe('ok');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining("GsPushDownMethodRefactoring clearToken: 'tok4'"),
      );
    });
  });
});
