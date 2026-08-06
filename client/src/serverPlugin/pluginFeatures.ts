/**
 * Single source of truth for the plugin features the Jasper Server Plugin
 * files into a stone — today the refactoring engine and the Enhanced Inspector.
 *
 * Each entry answers the four questions every consumer needs: which feature is
 * this (`id`/`label`), where does its payload live (`payloadSubdir`, relative to
 * the extension/repo root), does this stone's version support it at all
 * (`isApplicable`), is it actually present right now (`probe`), and how is it
 * filed in (`install`, the bare engine-level installer over an already-elevated
 * SystemUser session).
 *
 * Deliberately `vscode`-free: the CI provisioning script
 * (`bin/install-server-plugin.mjs`) installs from this registry from a plain Node
 * process, and the optional-support offer (`optionalSupportOffer.ts`) and the
 * two install-command drivers point their `isApplicable`/`probe`/payload fields
 * at it, so the feature list is described in exactly one place. The VS Code
 * plumbing around each install (SystemUser prompt, progress UI, session refresh)
 * stays in the command modules — this registry only owns the per-feature facts.
 *
 * Consumers reach a feature directly off `pluginFeatures` (e.g.
 * `pluginFeatures.refactoring`), which keeps the reference typo-proof and
 * autocompleted; loops that touch every feature use the `PLUGIN_FEATURES` array.
 */
import * as path from 'path';
import { ActiveSession } from '../sessionManager';
import { checkRefactoringSupportAvailable } from '../browserQueries';
import { installRefactoringSupport } from '../refactoring/refactoringInstall';
import { uninstallRefactoringSupport } from '../refactoring/refactoringUninstall';
import {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  supportsEnhancedInspector,
} from '../enhancedInspector/enhancedInspectorInstall';
import { uninstallEnhancedInspectorSupport } from '../enhancedInspector/enhancedInspectorUninstall';

/** Reports incremental progress: a message plus a 0–100 increment for this step. */
export type ProgressReporter = (message: string, increment: number) => void;

/** The unified outcome of a plugin-feature install, flattened from the two
 *  installers' differently-shaped results down to what every consumer reads. */
export interface PluginInstallResult {
  /** True only when the feature is present and verified afterward. */
  success: boolean;
  /** Human-readable summary, suitable for a notification. */
  message: string;
  /** A completeness report to surface, when the installer produced one (the
   *  refactoring loader does; the Enhanced Inspector installer does not). */
  report?: string;
}

/** The unified outcome of a plugin-feature uninstall, flattened from the two
 *  removers' differently-shaped results down to what every consumer reads. */
export interface PluginUninstallResult {
  /** True only when the feature was removed and verified absent afterward. */
  success: boolean;
  /** Human-readable summary, suitable for a notification. */
  message: string;
}

export interface PluginFeature {
  /** Stable id, shared with the optional-support registry and test gating. */
  id: string;
  /** Human-readable name, for progress/log messages. */
  label: string;
  /** Payload location relative to the extension/repo root (e.g.
   *  `resources/refactoring`), readable by the gem (a local stone). */
  payloadSubdir: string;
  /** Does this stone's version support the feature at all? (The refactoring
   *  engine loads on every release; the Enhanced Inspector needs 3.7.5+.) */
  isApplicable(stoneVersion: string | undefined): boolean;
  /** Live presence check against the session — a fresh answer, not a cached flag. */
  probe(session: ActiveSession): boolean;
  /** File the feature in over a write-capable (SystemUser) session. */
  install(
    session: ActiveSession,
    payloadDir: string,
    onProgress?: ProgressReporter,
  ): Promise<PluginInstallResult>;
  /** Remove the feature from the stone over a write-capable (SystemUser)
   *  session. No payload directory: removal is expressed as inline Smalltalk,
   *  so it needs nothing from disk. */
  uninstall(session: ActiveSession, onProgress?: ProgressReporter): Promise<PluginUninstallResult>;
}

/**
 * Every feature the server plugin can install, keyed by id and in file-in order.
 *
 * This keyed record is the single source of truth. Consumers reference a feature
 * directly — `pluginFeatures.refactoring` — instead of passing an id string, so
 * the reference is autocompleted and a typo is a compile error rather than a
 * runtime miss. `as const satisfies …` does double duty: `satisfies` type-checks
 * that every entry is a well-formed `PluginFeature`, while `as const` keeps the
 * literal `id`s, which is what makes `PluginFeatureId`/`PluginFeatureRef` below
 * exact rather than widened to `string`.
 */
export const pluginFeatures = {
  refactoring: {
    id: 'refactoring',
    label: 'Refactoring engine',
    payloadSubdir: path.join('resources', 'refactoring'),
    // Loads on every release; the parameter is declared (not used) so the
    // signature matches `enhancedInspector.isApplicable` and version-passing callers.
    isApplicable: (_stoneVersion: string | undefined) => true,
    probe: checkRefactoringSupportAvailable,
    install: async (session: ActiveSession, payloadDir: string, onProgress?: ProgressReporter) => {
      const r = await installRefactoringSupport(session, payloadDir, onProgress);
      return { success: r.success, message: r.message, report: r.report };
    },
    uninstall: async (session: ActiveSession, onProgress?: ProgressReporter) => {
      const r = await uninstallRefactoringSupport(session, onProgress);
      return { success: r.success, message: r.message };
    },
  },
  enhancedInspector: {
    id: 'enhancedInspector',
    label: 'Enhanced Inspector',
    payloadSubdir: path.join('resources', 'enhancedInspector'),
    isApplicable: (stoneVersion: string | undefined) => supportsEnhancedInspector(stoneVersion),
    probe: isEnhancedInspectorInstalled,
    install: async (session: ActiveSession, payloadDir: string, onProgress?: ProgressReporter) => {
      const r = await installEnhancedInspectorSupport(session, payloadDir, onProgress);
      return { success: r.success, message: r.message };
    },
    uninstall: async (session: ActiveSession, onProgress?: ProgressReporter) => {
      const r = await uninstallEnhancedInspectorSupport(session, onProgress);
      return { success: r.success, message: r.message };
    },
  },
} as const satisfies Record<string, PluginFeature>;

/** The closed set of feature ids, derived from the registry keys. */
export type PluginFeatureId = keyof typeof pluginFeatures;

/**
 * A reference to an actual registry entry. Because the registry is `as const`,
 * each member carries its literal `id`, so this type accepts `pluginFeatures.x`
 * but rejects an ad-hoc object that merely matches `PluginFeature`'s shape.
 */
export type PluginFeatureRef = (typeof pluginFeatures)[PluginFeatureId];

/** The registry as an array, in file-in order — for install/verify loops that
 *  iterate every feature rather than reaching for a specific one. */
export const PLUGIN_FEATURES: readonly PluginFeature[] = Object.values(pluginFeatures);
