import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRowanProject } from '../rowanCreate';
import { onSupportedPosixIt } from './platformGates';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rowan-create-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// Independent copies of createRowanProject.solo's captured output (3.7.5), so a
// drift in the module's templates is caught.
const EXPECTED_PROJECT = [
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

const EXPECTED_CORE = [
  'RwLoadComponent {',
  "\t#name : 'Core',",
  '\t#projectNames : [ ],',
  '\t#componentNames : [ ],',
  '\t#packageNames : [ ],',
  "\t#comment : ''",
  '}',
].join('\n');

const EXPECTED_PROPERTIES = [
  '{ ',
  "\t#format : 'tonel',",
  "\t#convention : 'RowanHybrid'",
  '}',
  '',
].join('\n');

function expectedLoadSpec(name: string): string {
  return [
    'RwLoadSpecificationV2 {',
    `\t#projectName : '${name}',`,
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

describe('createRowanProject', () => {
  it('writes the full project layout', () => {
    const dir = tmp();

    const result = createRowanProject(dir, 'MyApp');

    expect(result).toEqual({ success: true, projectDir: dir });
    for (const p of [
      'rowan/project.ston',
      'rowan/specs/MyApp.ston',
      'rowan/components/Core.ston',
      'rowan/projects/README.md',
      'src/properties.st',
    ]) {
      expect(fs.existsSync(path.join(dir, p))).toBe(true);
    }
  });

  it('matches the solo tool output byte-for-byte', () => {
    const dir = tmp();
    createRowanProject(dir, 'MyApp');
    const read = (p: string) => fs.readFileSync(path.join(dir, p), 'utf8');

    expect(read('rowan/project.ston')).toBe(EXPECTED_PROJECT);
    expect(read('rowan/components/Core.ston')).toBe(EXPECTED_CORE);
    expect(read('src/properties.st')).toBe(EXPECTED_PROPERTIES);
    expect(read('rowan/specs/MyApp.ston')).toBe(expectedLoadSpec('MyApp'));
    expect(read('rowan/projects/README.md')).toBe('');
  });

  it('names the load spec file and #projectName after the project, verbatim', () => {
    const dir = tmp();

    createRowanProject(dir, 'seaside-app');

    const spec = fs.readFileSync(path.join(dir, 'rowan', 'specs', 'seaside-app.ston'), 'utf8');
    expect(spec).toContain("#projectName : 'seaside-app',");
  });

  it('backslash-escapes a single quote in the project name', () => {
    const dir = tmp();

    createRowanProject(dir, "O'Hara");

    const spec = fs.readFileSync(path.join(dir, 'rowan', 'specs', "O'Hara.ston"), 'utf8');
    expect(spec).toContain("#projectName : 'O\\'Hara',");
  });

  // A backslash is a plain filename character on POSIX but a path separator
  // on Windows, so a name containing one can't be used as a spec's filename
  // there. Not a real-world gap: every caller of createRowanProject already
  // rejects '\' and '/' in the name before it gets here (see
  // extension.ts's rowanNewProject input validation and rowanInitHere's use
  // of path.basename).
  onSupportedPosixIt('backslash-escapes a backslash in the project name', () => {
    const dir = tmp();

    createRowanProject(dir, 'a\\b');

    const spec = fs.readFileSync(path.join(dir, 'rowan', 'specs', 'a\\b.ston'), 'utf8');
    expect(spec).toContain("#projectName : 'a\\\\b',");
  });

  it('refuses to overwrite an existing Rowan project', () => {
    const dir = tmp();
    createRowanProject(dir, 'MyApp');

    const again = createRowanProject(dir, 'MyApp');

    expect(again.success).toBe(false);
    expect(again.error).toContain('already a Rowan project');
  });

  it('gitignores the local .gemstone class mirror', () => {
    const dir = tmp();

    createRowanProject(dir, 'MyApp');

    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('.gemstone/');
  });

  it('appends to an existing .gitignore instead of clobbering it', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');

    createRowanProject(dir, 'MyApp');

    const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.gemstone/');
  });
});
