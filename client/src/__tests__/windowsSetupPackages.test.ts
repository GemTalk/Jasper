import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Windows CI must not depend on Ubuntu's package servers: on 2026-11-25 their
// package lists downloaded so slowly that the Windows GemStone setup hit its
// time limit on about one job in six (#999).

// __dirname is client/src/__tests__, so the repo root is three levels up.
const ACTION = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'actions',
  'setup-gemstone-in-windows',
  'action.yml',
);

// Full-line comments may name the commands this guards against, to say why.
function actionWithoutComments(): string {
  return fs
    .readFileSync(ACTION, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

describe('Windows CI setup', () => {
  it('never downloads Ubuntu package lists', () => {
    const action = actionWithoutComments();
    expect(action).not.toMatch(/^\s*additional-packages:/m);
    expect(action).not.toMatch(/^\s*update:\s*['"]?true/m);
    expect(action).not.toMatch(/\bapt(-get)?\s+(update|install)\b/);
  });

  it('installs unzip from one pinned version, checked against a SHA-256', () => {
    const action = actionWithoutComments();
    const debFiles = new Set(action.match(/unzip_[^_\s]+_amd64\.deb/g));
    expect(debFiles.size).toBe(1);
    const version = [...debFiles][0].split('_')[1];
    expect(action).toMatch(new RegExp(`key:\\s*\\S*unzip-${version.replace(/\./g, '\\.')}\\b`));
    expect(action).toMatch(/UNZIP_DEB_SHA256:\s*[0-9a-f]{64}\s*$/m);
    expect(action).toMatch(/Get-FileHash -Algorithm SHA256/);
  });

  it('installs an unzip package built for the same Ubuntu release WSL runs', () => {
    const action = actionWithoutComments();
    const distribution = action.match(/^\s*distribution:\s*Ubuntu-(\S+)\s*$/m)?.[1];
    expect(distribution).toBeDefined();
    expect(action).toMatch(
      new RegExp(`key:\\s*ubuntu-${distribution!.replace(/\./g, '\\.')}-unzip-`),
    );
  });

  it('installs unzip inside WSL without the network', () => {
    expect(actionWithoutComments()).toMatch(/run:\s*dpkg -i "\$UNZIP_DEB"/);
  });
});
