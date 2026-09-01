import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Every Explorer affordance that drives the server-side refactoring engine must
// be gated on `gemstone.rbSupportAvailable`, so it disappears when the engine is
// not installed in the connected stone (never installed, or uninstalled mid-
// session via "Uninstall Server Support"). Without the gate the rename pencils,
// superclass items, etc. linger after an uninstall and fail on click. The engine
// availability latch drives the context key on connect / selection / (un)install,
// so the menus follow the stone's actual state.
//
// Three Explorer commands are deliberately NOT engine-gated: deleting a method,
// recategorizing a method, and removing a class variable are plain image operations
// that work without the engine.
//
// One command needs the engine but is gated in CODE rather than by its `when` —
// see ENGINE_GATED_IN_CODE below.

interface MenuItem {
  command?: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const itemContext: MenuItem[] = pkg.contributes.menus['view/item/context'];

// Commands that require the refactoring engine.
const ENGINE_DEPENDENT = [
  'gemstone.explorer.renameIvar',
  'gemstone.explorer.moveUpInstVar',
  'gemstone.explorer.moveDownInstVar',
  'gemstone.explorer.removeInstVar',
  'gemstone.explorer.renameClassVariable',
  'gemstone.explorer.renameMethod',
  'gemstone.explorer.moveMethodToClass',
  'gemstone.explorer.moveMethodToOtherSide',
  'gemstone.explorer.changeSignature',
  'gemstone.explorer.pushUpMethod',
  'gemstone.explorer.pushDownMethod',
  'gemstone.explorer.renameClass',
  'gemstone.explorer.classHistory',
  'gemstone.explorer.insertSuperclass',
  'gemstone.explorer.extractSuperclass',
] as const;

// Adding an instance variable DOES reshape the class and so does need the engine,
// but hiding it is the wrong way to say so: the empty "instance variables" row
// exists for no other reason than to host that "+", so a `when` gate turns the row
// into a visible dead end — one line under a class row whose own "+" offers the very
// same add and routes it to the install prompt. The gate lives in
// `addInstVarOnClass` instead, as `ensureRbSupport`, which every route in goes
// through and which offers to install rather than failing on click.
// Pinned behaviourally in explorerAddVariableFromClassRow.test.ts.
const ENGINE_GATED_IN_CODE = ['gemstone.explorer.addInstVar'] as const;

// Engine-independent Explorer commands that must stay available without it.
const ENGINE_INDEPENDENT = [
  'gemstone.explorer.removeMethod',
  'gemstone.explorer.renameMethodCategory',
  // Removing a class variable is a base-image operation (removeClassVarName:) that
  // reshapes nothing — the mirror of Add Class Variable, which is ungated too.
  'gemstone.explorer.removeClassVar',
] as const;

describe('Explorer refactoring menu gating', () => {
  for (const command of ENGINE_DEPENDENT) {
    const entries = itemContext.filter((m) => m.command === command);

    it(`contributes ${command} to the Explorer context menu`, () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it(`gates every ${command} entry on the refactoring engine being available`, () => {
      for (const entry of entries) {
        expect(entry.when ?? '').toContain('gemstone.rbSupportAvailable');
      }
    });
  }

  for (const command of ENGINE_GATED_IN_CODE) {
    it(`leaves ${command} on the menu and asks about the engine when clicked`, () => {
      // A menu gate here would take the button off the row that exists to carry it.
      const entries = itemContext.filter((m) => m.command === command);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.when ?? '').not.toContain('gemstone.rbSupportAvailable');
      }
    });
  }

  for (const command of ENGINE_INDEPENDENT) {
    it(`leaves ${command} available even without the refactoring engine`, () => {
      const entries = itemContext.filter((m) => m.command === command);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.when ?? '').not.toContain('gemstone.rbSupportAvailable');
      }
    });
  }
});
