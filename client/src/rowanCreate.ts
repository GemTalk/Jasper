import * as fs from 'fs';
import * as path from 'path';

// Create a Rowan project by writing its files directly — no solo gem, no
// GemStone install required. The output matches createRowanProject.solo's
// default layout byte-for-byte (tonel, RowanHybrid, a Core load component,
// packages under src/), minus the `git init` it does (version control is the
// user's / VS Code's job). Templates use tabs; the .ston files have no trailing
// newline, properties.st ends with one — matching the shipped tool.

const PROJECT_STON = [
  'RwProjectSpecificationV3 {',
  "\t#specName : 'project',",
  "\t#projectVersion : '1.0.0',",
  "\t#projectSpecPath : 'rowan',",
  "\t#componentsPath : 'rowan/components',",
  "\t#packagesPath : 'src',",
  "\t#projectsPath : 'rowan/projects',",
  "\t#specsPath : 'rowan/specs',",
  "\t#packageFormat : 'tonel',",
  "\t#packageConvention : 'RowanHybrid',",
  "\t#comment : ''",
  '}',
].join('\n');

const CORE_COMPONENT_STON = [
  'RwLoadComponent {',
  "\t#name : 'Core',",
  '\t#projectNames : [ ],',
  '\t#componentNames : [ ],',
  '\t#packageNames : [ ],',
  "\t#comment : ''",
  '}',
].join('\n');

const PROPERTIES_ST = ['{ ', "\t#format : 'tonel',", "\t#convention : 'RowanHybrid'", '}', ''].join(
  '\n',
);

// STON single-quoted string escaping, matching GemStone's STONWriter: a
// backslash escapes a literal backslash and a literal quote (not Smalltalk-style
// quote doubling). Escape the backslash first so an escaped quote isn't
// re-escaped.
function escapeStonString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function loadSpecSton(projectName: string): string {
  return [
    'RwLoadSpecificationV2 {',
    `\t#projectName : '${escapeStonString(projectName)}',`,
    "\t#projectSpecFile : 'rowan/project.ston',",
    '\t#componentNames : [',
    "\t\t'Core'",
    '\t],',
    '\t#platformProperties : {',
    "\t\t'gemstone' : {",
    "\t\t\t'allusers' : {",
    "\t\t\t\t#defaultSymbolDictName : 'UserGlobals'",
    '\t\t\t}',
    '\t\t}',
    '\t},',
    "\t#comment : ''",
    '}',
  ].join('\n');
}

// Ensure the project ignores .gemstone/, where Jasper kept its class mirror
// before it moved out of the workspace — old checkouts still have one, and it
// is generated and can get large. Appends to an existing .gitignore rather
// than clobbering it.
function ensureGitignore(projectDir: string): void {
  const gitignorePath = path.join(projectDir, '.gitignore');
  const entry = '.gemstone/';
  let existing = '';
  try {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    /* no .gitignore yet */
  }
  if (existing.split(/\r?\n/).some((line) => line.trim() === entry)) return;
  const header = "# Jasper's local read-only class mirror of a connected stone (per user/stone).";
  const content =
    existing.trim().length > 0
      ? `${existing.replace(/\n*$/, '')}\n\n${header}\n${entry}\n`
      : `${header}\n${entry}\n`;
  fs.writeFileSync(gitignorePath, content);
}

export interface CreateRowanProjectResult {
  success: boolean;
  // Absolute path to the project directory (the one passed in).
  projectDir?: string;
  error?: string;
}

// Scaffold a Rowan project into `projectDir` (which must already exist). The
// load spec is named after `projectName` (its file and its #projectName). Writes
// files only. Refuses if the directory is already a Rowan project.
export function createRowanProject(
  projectDir: string,
  projectName: string,
): CreateRowanProjectResult {
  const rowan = path.join(projectDir, 'rowan');
  if (fs.existsSync(path.join(rowan, 'project.ston'))) {
    return { success: false, error: `"${projectDir}" is already a Rowan project.` };
  }
  try {
    fs.mkdirSync(path.join(rowan, 'specs'), { recursive: true });
    fs.mkdirSync(path.join(rowan, 'components'), { recursive: true });
    fs.mkdirSync(path.join(rowan, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });

    fs.writeFileSync(path.join(rowan, 'project.ston'), PROJECT_STON);
    fs.writeFileSync(path.join(rowan, 'specs', `${projectName}.ston`), loadSpecSton(projectName));
    fs.writeFileSync(path.join(rowan, 'components', 'Core.ston'), CORE_COMPONENT_STON);
    fs.writeFileSync(path.join(rowan, 'projects', 'README.md'), '');
    fs.writeFileSync(path.join(projectDir, 'src', 'properties.st'), PROPERTIES_ST);
    ensureGitignore(projectDir);
    return { success: true, projectDir };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
