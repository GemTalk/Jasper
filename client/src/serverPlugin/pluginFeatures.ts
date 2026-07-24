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
 */
import * as path from 'path';
import { ActiveSession } from '../sessionManager';
import { checkRefactoringSupportAvailable } from '../browserQueries';
import { installRefactoringSupport } from '../refactoring/refactoringInstall';
import {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  supportsEnhancedInspector,
} from '../enhancedInspectorInstall';

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
}

/** Every feature the server plugin can install, in file-in order. */
export const PLUGIN_FEATURES: readonly PluginFeature[] = [
  {
    id: 'refactoring',
    label: 'Refactoring engine',
    payloadSubdir: path.join('resources', 'refactoring'),
    isApplicable: () => true,
    probe: checkRefactoringSupportAvailable,
    install: async (session, payloadDir, onProgress) => {
      const r = await installRefactoringSupport(session, payloadDir, onProgress);
      return { success: r.success, message: r.message, report: r.report };
    },
  },
  {
    id: 'enhancedInspector',
    label: 'Enhanced Inspector',
    payloadSubdir: path.join('resources', 'enhancedInspector'),
    isApplicable: (stoneVersion) => supportsEnhancedInspector(stoneVersion),
    probe: isEnhancedInspectorInstalled,
    install: async (session, payloadDir, onProgress) => {
      const r = await installEnhancedInspectorSupport(session, payloadDir, onProgress);
      return { success: r.success, message: r.message };
    },
  },
];

/**
 * The registry entry for `id`. Throws on an unknown id — the id set is closed
 * and compiled-in, so a miss is a programming error, not a runtime condition.
 */
export function pluginFeature(id: string): PluginFeature {
  const feature = PLUGIN_FEATURES.find((f) => f.id === id);
  if (!feature) {
    throw new Error(`Unknown plugin feature: ${id}`);
  }
  return feature;
}
