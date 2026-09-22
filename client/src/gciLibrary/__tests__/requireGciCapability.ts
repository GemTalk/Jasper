import type { TestContext } from 'vitest';
import type { GciLibrary } from '../../gciLibrary';
import { absenceHazard } from '../absenceHazard';
import { GCI_OPTIONAL_FUNCTIONS, type GciOptionalFunctionName } from '../optionalFunctions';

/**
 * Gate keyed off a loaded GCI library's own optional-function bindings. Call at
 * the top of a test that only applies when `name` is available in the connected
 * `gci`, and skip it, with a reason, when the loaded library doesn't have it.
 *
 * Optionality here is a property of the loaded library, not the stone, so no
 * session parameter is needed.
 */
export function requireGciCapability(
  name: GciOptionalFunctionName,
  ctx: TestContext,
  gci: GciLibrary,
): void {
  ctx.skip(
    !gci.isAvailable(name),
    `skipping: ${name} is not in this GCI library (${absenceHazard(name, GCI_OPTIONAL_FUNCTIONS[name])})`,
  );
}
