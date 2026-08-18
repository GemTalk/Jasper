#!/usr/bin/env node
//
// Asserts that vendor/gci-headers/versions.md agrees with the header files
// actually committed under vendor/gci-headers/.
//
// That table is the load-bearing artifact of the whole snapshot: it is the only
// thing mapping a GemStone version to the folder whose headers it matches, and
// several patch releases deliberately share one folder because they ship
// byte-identical headers. Nothing else in the toolchain looks at it — Prettier's
// glob covers only ts/js, and no markdown processor is wired into ESLint — so a
// row added by hand with a mistyped digest, or pointed at the wrong folder, would
// sit there reading as authoritative. A reader (human or agent) that trusts a
// wrong row opens the wrong header and gets a confidently wrong answer about a
// GCI signature or struct layout, which is worse than having no snapshot at all.
// Hence a loud failure here rather than silent drift.
//
// The check runs in both directions, because a one-way check leaves three ways
// for the table to lie: a row can point at a folder that doesn't exist (caught
// by checkRows), a folder can exist that no row mentions (checkFolders) — how a
// half-finished "add a version" lands headers nobody can find via the map — and
// a folder can hold a file no column names (checkStrayFiles). That last one is
// the quiet case: every row passes, yet the folder carries an unhashed file, so
// a reader can open a header that nothing in the map vouches for. It is also how
// a stray copy lands (a build-tool leftover, or one of the includes versions.md
// says are deliberately not vendored), which would silently contradict the
// "closed under #include" claim that document makes.
//
// File names come from the table header rather than a hardcoded list, so adding
// a fifth header file to the snapshot means editing only the markdown. Absence is
// first-class: `gcits.ht` genuinely does not exist before 3.7.2, so an em-dash
// cell asserts the file is *not* on disk, and a file appearing where a row claims
// an em-dash is itself a failure.
//
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const HEADERS_DIR = 'vendor/gci-headers';
const VERSIONS_FILE = path.join(HEADERS_DIR, 'versions.md');

// The table truncates digests for readability, so compare on the same prefix
// length the document uses rather than on the full 64-char digest.
const DIGEST_LENGTH = 8;

// Cells are markdown, so unwrap the `code span` a digest is written in. An
// em-dash cell means "this file does not exist for this version" and may carry a
// trailing explanation (e.g. "— (not present before 3.7.2)"), so it is matched by
// leading character rather than by exact text.
function parseDigestCell(cell) {
  const code = cell.match(/`([0-9a-f]+)`/);
  if (code) {
    return code[1];
  }
  return cell.startsWith('—') ? null : undefined;
}

// The folder cell is a link (`[3.7.2](3.7.2/)`); the link target is the
// authoritative folder name, since the visible text could disagree with it.
function parseFolderCell(cell) {
  const link = cell.match(/\]\(([^)]+)\)/);
  return link ? link[1].replace(/\/$/, '') : null;
}

function splitRow(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

// Pulls the single pipe table out of the markdown: the header row names the files
// (columns 3 onward, after "GemStone version" and "Folder"), the delimiter row is
// skipped, and every remaining piped line is a version row. Returns null when the
// table can't be found at all, which is a failure in its own right rather than an
// empty pass — the whole point is that this file never silently checks nothing.
function parseTable(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line) => line.startsWith('| GemStone version') || line.startsWith('|GemStone version'),
  );
  if (start === -1) {
    return null;
  }

  const columns = splitRow(lines[start]);
  const files = columns.slice(2).map((column) => column.replace(/\s*sha256\s*$/, '').trim());

  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) {
      break;
    }
    const cells = splitRow(line);
    rows.push({ version: cells[0], folderCell: cells[1], digestCells: cells.slice(2) });
  }

  return { files, rows };
}

function truncatedDigest(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, DIGEST_LENGTH);
}

// Verifies each row against disk, and collects the set of folders the table
// references so checkFolders can spot unreferenced ones.
function checkRows(table, referenced) {
  let failed = false;

  for (const { version, folderCell, digestCells } of table.rows) {
    const folder = parseFolderCell(folderCell);
    if (!folder) {
      console.error(`✗ ${VERSIONS_FILE}: row '${version}' has no folder link in '${folderCell}'`);
      failed = true;
      continue;
    }
    referenced.add(folder);

    const folderPath = path.join(HEADERS_DIR, folder);
    if (!existsSync(folderPath)) {
      console.error(
        `✗ ${VERSIONS_FILE}: row '${version}' points at '${folder}/', which does not exist under ${HEADERS_DIR}/`,
      );
      failed = true;
      continue;
    }

    table.files.forEach((file, index) => {
      const expected = parseDigestCell(digestCells[index] ?? '');
      const filePath = path.join(folderPath, file);

      if (expected === undefined) {
        console.error(
          `✗ ${VERSIONS_FILE}: row '${version}' column '${file}' is neither a \`sha256\` prefix nor an em-dash: '${digestCells[index] ?? ''}'`,
        );
        failed = true;
        return;
      }

      if (expected === null) {
        if (existsSync(filePath)) {
          console.error(
            `✗ ${version}: table says ${file} is absent, but ${filePath} exists (hash is ${truncatedDigest(filePath)}) — replace the em-dash with that digest`,
          );
          failed = true;
        }
        return;
      }

      if (!existsSync(filePath)) {
        console.error(
          `✗ ${version}: table lists ${file} as ${expected}, but ${filePath} does not exist — copy the file in, or use an em-dash if the version genuinely lacks it`,
        );
        failed = true;
        return;
      }

      const actual = truncatedDigest(filePath);
      if (actual !== expected) {
        console.error(
          `✗ ${version}: ${filePath} hashes to ${actual}, but the table says ${expected} — fix the row, or point it at the folder whose headers this version really matches`,
        );
        failed = true;
      }
    });
  }

  if (!failed) {
    console.log(
      `✓ all ${table.rows.length} rows in ${VERSIONS_FILE} match the committed header files`,
    );
  }

  return failed;
}

// Every content folder committed under vendor/gci-headers/, in table order-independent
// disk order. Shared by the two reverse checks below.
function headerFolders() {
  return readdirSync(HEADERS_DIR).filter((entry) =>
    statSync(path.join(HEADERS_DIR, entry)).isDirectory(),
  );
}

// A folder no row mentions is unreachable through the map, so it may as well not
// be committed — this is what a half-finished "add a version" looks like.
function checkFolders(referenced) {
  const orphans = headerFolders().filter((folder) => !referenced.has(folder));

  for (const folder of orphans) {
    console.error(
      `✗ ${HEADERS_DIR}/${folder}/ is not referenced by any row in ${VERSIONS_FILE} — add a row for it, or remove the folder`,
    );
  }

  if (orphans.length === 0) {
    console.log(`✓ every folder under ${HEADERS_DIR}/ is referenced by at least one row`);
  }

  return orphans.length > 0;
}

// checkRows only ever looks at the files the table names, so a file the table is
// silent about is invisible to it: the row still passes while the folder carries
// an unhashed header. Walk the folders themselves and require that every file in
// them is accounted for by a column — nothing in the snapshot is unvouched-for.
// Directories are reported too rather than skipped, since the snapshot is flat by
// design and a nested one would hide files from this walk entirely.
function checkStrayFiles(table) {
  const named = new Set(table.files);
  let failed = false;

  for (const folder of headerFolders()) {
    const folderPath = path.join(HEADERS_DIR, folder);
    for (const entry of readdirSync(folderPath)) {
      if (named.has(entry)) {
        continue;
      }
      const kind = statSync(path.join(folderPath, entry)).isDirectory() ? 'directory' : 'file';
      console.error(
        `✗ ${HEADERS_DIR}/${folder}/${entry} is a ${kind} no column in ${VERSIONS_FILE} names — add a column for it, or remove it from the snapshot`,
      );
      failed = true;
    }
  }

  if (!failed) {
    console.log(
      `✓ every file under ${HEADERS_DIR}/*/ is one of the ${named.size} the table hashes`,
    );
  }

  return failed;
}

function main() {
  const table = parseTable(readFileSync(VERSIONS_FILE, 'utf8'));
  if (!table) {
    console.error(
      `✗ ${VERSIONS_FILE}: could not find the version table (expected a row starting '| GemStone version')`,
    );
    process.exit(1);
  }

  const referenced = new Set();
  const rowsFailed = checkRows(table, referenced);
  const foldersFailed = checkFolders(referenced);
  const strayFilesFailed = checkStrayFiles(table);

  if (rowsFailed || foldersFailed || strayFilesFailed) {
    process.exit(1);
  }
}

main();
