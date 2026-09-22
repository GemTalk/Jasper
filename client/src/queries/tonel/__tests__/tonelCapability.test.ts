// Unit tests for the Tonel capability probe — the single gate the whole feature
// hangs off. See `../tonelCapability` for the supported-configuration statement
// these tests enforce.
//
// The case that matters most to future readers is `asks no version question`:
// the probe must gate on the machinery being *present*, never on a version or an
// extent name, so the feature and its tests switch themselves on the day rowan3
// reaches CI or lands in the base extent. That is a requirement, not a detail.
import { describe, it, expect, vi } from 'vitest';

import { tonelCapability, TONEL_CAPABILITIES } from '../tonelCapability';

// The probe answers a newline-separated list of the capabilities that are
// MISSING, so the empty string means "everything is here".
const exec = (missing: string[] = []) => vi.fn().mockReturnValue(missing.join('\n'));
const codeOf = (fn: ReturnType<typeof exec>): string => fn.mock.calls[0][0] as string;

describe('tonelCapability', () => {
  it('probes every selector the feature actually sends', () => {
    const e = exec();
    tonelCapability(e);
    const code = codeOf(e);
    // Each of these is driven directly by the file-out or file-in glue. Probing
    // the exact selectors we send is what makes the gate survive Rowan changing
    // shape under us: a dropped selector fails here, by name.
    for (const name of [
      'RwModificationTonelWriterVisitorV2>>_writeClassDefinition:on:',
      'RwModificationTonelWriterVisitorV2>>_writeClassSideMethodDefinitions:on:',
      'RwModificationTonelWriterVisitorV2>>_writeInstanceSideMethodDefinitions:on:',
      'RwModificationTonelWriterVisitorV2>>methodSortBlock:',
      'RwRepositoryResolvedProjectTonelReaderVisitorV2>>currentProjectDefinition:',
      'RwTonelParser class>>on:filePath:forReader:',
      'RwResolvedProjectV2>>addPackageNamed:toComponentNamed:',
      'RwMethodDefinition class>>newForSelector:protocol:source:',
      'Class>>rwClassDefinitionInSymbolDictionaryNamed:',
      // Trait-provided methods are excluded from a file-out (traits are not a
      // supported Jasper feature), so the probe must confirm we can tell.
      'GsNMethod>>isFromTrait',
    ]) {
      expect(TONEL_CAPABILITIES).toContain(name);
      expect(code).toContain(name);
    }
  });

  it('is available when nothing is missing', () => {
    const result = tonelCapability(exec());
    expect(result.available).toBe(true);
    expect(result.missing).toEqual([]);
  });

  // One case per capability rather than a single "something missing" test: when a
  // future Rowan drops one, the failure names it instead of saying the gate broke.
  it.each(TONEL_CAPABILITIES)('is unavailable when %s is missing', (capability) => {
    const result = tonelCapability(exec([capability]));
    expect(result.available).toBe(false);
    expect(result.missing).toEqual([capability]);
  });

  it('is unavailable when Rowan does not resolve at all', () => {
    const result = tonelCapability(exec([...TONEL_CAPABILITIES]));
    expect(result.available).toBe(false);
    expect(result.missing).toEqual([...TONEL_CAPABILITIES]);
  });

  it('asks no version question', () => {
    const code = codeOf(
      (() => {
        const e = exec();
        tonelCapability(e);
        return e;
      })(),
    );
    // Gating on version would freeze the feature to the releases we happened to
    // know about, and would keep the rowan3 test tier dark forever after rowan3
    // reached CI. The probe must ask only what responds.
    expect(code).not.toContain('System _version');
    expect(code).not.toContain('versionString');
    expect(code).not.toMatch(/3\.7|3\.6/);
  });

  it('resolves the classes through the shared Rowan reach-through', () => {
    // Not `symbolList objectNamed:` on its own: on a rowan3 stone the Rowan
    // dictionaries are in SystemUser's symbol list only, so a DataCurator
    // session would find nothing and the feature would hide itself on a stone
    // that supports it. DataCurator is meant to see these commands.
    const e = exec();
    tonelCapability(e);
    const code = codeOf(e);
    expect(code).toContain('rwLookup :=');
    expect(code).toContain("AllUsers userWithId: 'SystemUser'");
    expect(code).toContain('rwLookup value: #');
  });

  it('tolerates whitespace and blank lines in the answer', () => {
    // GCI string answers pick up trailing newlines; a blank line must not become
    // a phantom missing capability that hides the feature on a good stone.
    const e = vi.fn().mockReturnValue('\n');
    expect(tonelCapability(e).available).toBe(true);
  });

  it('sends only ASCII to the stone', () => {
    // Generated Smalltalk must stay ASCII: 3.6.2's compiler mangles wide characters
    // (build them with `Character codePoint:` instead), and the probe runs on EVERY stone, including 3.6.2.
    // An em dash in a Smalltalk COMMENT is the easy way to break this -- it reads as
    // harmless prose in the editor and is invisible in review.
    const e = exec();
    tonelCapability(e);
    const code = codeOf(e);
    const wide = [...code].filter((c) => c.charCodeAt(0) > 127);
    expect(wide).toEqual([]);
  });
});
