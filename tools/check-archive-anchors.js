'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] ?? path.join(__dirname, '..'));
const pointerFiles = ['AGENTS.md', 'docs/DECISIONS.md'];
const archiveFile = 'docs/measurements-archive.md';

function readLines(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
}

function references(file, lines) {
  const found = [];
  lines.forEach((line, index) => {
    const pattern = /archive#([a-z0-9-]+)/g;
    let match = pattern.exec(line);
    while (match !== null) {
      found.push({ name: match[1], source: `${file}:${index + 1}` });
      match = pattern.exec(line);
    }
  });
  return found;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function definitions(lines) {
  const found = new Map();
  lines.forEach((line, index) => {
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (!heading) return;
    const names = [slug(heading[1].trim())];
    const marker = /\(archive#([a-z0-9-]+)\)/g;
    let match = marker.exec(heading[1]);
    while (match !== null) {
      names.push(match[1]);
      match = marker.exec(heading[1]);
    }
    for (const name of names) {
      if (name.length === 0) continue;
      if (!found.has(name)) found.set(name, []);
      found.get(name).push(index + 1);
    }
  });
  return found;
}

function main() {
  const refs = pointerFiles.flatMap((file) => references(file, readLines(file)));
  const defined = definitions(readLines(archiveFile));
  const unresolved = [];
  const ambiguous = [];
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref.name)) continue;
    seen.add(ref.name);
    const hits = defined.get(ref.name) ?? [];
    if (hits.length === 0) unresolved.push(`${ref.name} (${ref.source})`);
    if (hits.length > 1) ambiguous.push(`${ref.name} -> lines ${hits.join(', ')}`);
  }
  console.log(`archive anchors: ${seen.size} distinct references, ${defined.size} defined names, ${unresolved.length} unresolved, ${ambiguous.length} ambiguous`);
  unresolved.forEach((entry) => console.log(`unresolved ${entry}`));
  ambiguous.forEach((entry) => console.log(`ambiguous ${entry}`));
  if (unresolved.length > 0 || ambiguous.length > 0) process.exit(1);
  console.log('archive anchors: zero unresolved references');
}

main();
