const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = process.argv[2];
const outJson = process.argv[3];
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 << 20 });
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const fileSet = new Set(files);

const buildRoots = [/^src\//, /^dsp\//, /^effects\//, /^kernel\//, /^image\//, /^config\//, /^vendor\//, /^ci\//, /^\.github\/workflows\//];
const docRoots = new Set(['AGENTS.md', 'README.md', 'CLAUDE.md', 'LICENSE', '.gitignore', '.gitattributes', 'docs/PENDING_VALIDATION.md']);
const runtimeRoots = [/^\.gm\//, /^closes\//, /^\.vscode\//];
const operatorTools = new Map([
  ['tools/stage-readiness/check-stage.mjs', 'operate: owner-requested pre-set readiness command (2026-11-14); no doc names it yet'],
  ['tools/press-latency/press-latency.js', 'operate: press-to-beep harness behind archive#final-rig-timing; no doc names it yet'],
]);
const dirReachRoots = [/^test-audio-corpus\//, /^vendor\//, /^docs\/demo\//, /^tools\//];
const includeRoots = ['src', 'effects/home/faust', 'dsp', 'effects/home', 'vendor/include'];

const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const text = new Map();
const blob = new Map();
const size = new Map();
for (const f of files) {
  const full = path.join(root, f);
  let st;
  try { st = fs.statSync(full); } catch { continue; }
  size.set(f, st.size);
  const buf = fs.readFileSync(full);
  blob.set(f, crypto.createHash('sha1').update(buf).digest('hex'));
  if (st.size <= 4 << 20 && isText(buf) && !f.startsWith('specs/')) text.set(f, buf.toString('utf8'));
}

const baseCount = new Map();
for (const f of files) baseCount.set(path.basename(f), (baseCount.get(path.basename(f)) || 0) + 1);

const resolveRel = (from, spec, exts) => {
  const dirs = [path.dirname(from)];
  const out = [];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.normalize(path.join(d, spec + e));
      if (fileSet.has(p)) out.push(p);
    }
  }
  return out;
};
const resolveInclude = (from, spec) => {
  const cands = [path.join(path.dirname(from), spec), ...includeRoots.map((r) => path.join(r, spec))].map((p) => path.normalize(p));
  return cands.filter((p) => fileSet.has(p));
};

const edges = new Map();
const addEdge = (from, to, why) => {
  if (from === to) return;
  if (!edges.has(from)) edges.set(from, new Map());
  if (!edges.get(from).has(to)) edges.get(from).set(to, why);
};

const dirs = new Set();
for (const f of files) { let d = path.dirname(f); while (d !== '.') { dirs.add(d); d = path.dirname(d); } }

for (const [f, t] of text) {
  for (const m of t.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const spec = m[1] || m[2] || m[3];
    for (const p of resolveRel(f, spec, ['', '.js', '.cjs', '.mjs', '.json', '/index.js'])) addEdge(f, p, 'require ' + spec);
  }
  for (const m of t.matchAll(/#\s*include\s*[<"]([^>"]+)[>"]/g)) {
    for (const p of resolveInclude(f, m[1])) addEdge(f, p, 'include ' + m[1]);
  }
  if (f.endsWith('.py')) {
    for (const m of t.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] || m[2]).split('.')[0];
      for (const p of resolveRel(f, './' + mod, ['.py', '/__init__.py'])) addEdge(f, p, 'python import ' + mod);
    }
  }
  for (const m of t.matchAll(/(?:^|[\s;(&|])(?:source|\.|bash|sh|python3?|node)\s+["']?([\w./-]+\.(?:sh|py|js|cjs|mjs))/gm)) {
    for (const p of [path.normalize(path.join(path.dirname(f), m[1])), path.normalize(m[1])]) if (fileSet.has(p)) addEdge(f, p, 'runs ' + m[1]);
  }
  for (const m of t.matchAll(/(?:import|library|component)\s*\(\s*"([^"]+\.(?:dsp|lib))"\s*\)/g)) {
    for (const p of resolveInclude(f, m[1])) addEdge(f, p, 'faust import ' + m[1]);
  }
}

for (const target of files) {
  const base = path.basename(target);
  const distinctive = base.length >= 6 && base.includes('.') && baseCount.get(base) === 1;
  const parts = target.split('/');
  const suffix2 = parts.length >= 2 ? parts.slice(-2).join('/') : null;
  for (const [f, t] of text) {
    if (f === target) continue;
    if (t.includes(target)) { addEdge(f, target, 'path ' + target); continue; }
    if (suffix2 && parts.length > 2 && t.includes(suffix2)) { addEdge(f, target, 'path suffix ' + suffix2); continue; }
    if (distinctive && t.includes(base)) addEdge(f, target, 'basename ' + base);
  }
}

const dirNamedBy = new Map();
for (const d of dirs) {
  if (!dirReachRoots.some((r) => r.test(d + '/'))) continue;
  for (const [f, t] of text) {
    if (f.startsWith(d + '/')) continue;
    if (t.includes(d + '/') || t.includes("'" + d + "'") || t.includes('"' + d + '"') || t.includes(d.split('/').slice(-1)[0] + "'")) {
      if (!dirNamedBy.has(d)) dirNamedBy.set(d, []);
      dirNamedBy.get(d).push(f);
    }
  }
}

const reason = new Map();
const queue = [];
const keep = (f, why) => { if (!reason.has(f)) { reason.set(f, why); queue.push(f); } };
for (const f of files) {
  if (buildRoots.some((r) => r.test(f))) keep(f, 'architecture: device build or CI tree');
  else if (docRoots.has(f)) keep(f, 'architecture: owner root document');
  else if (f.startsWith('specs/')) keep(f, 'sweep record: the YAGNI and DRY classes and their generator');
  else if (operatorTools.has(f)) keep(f, operatorTools.get(f));
}
const reachDirs = (f) => {
  for (const [d, by] of dirNamedBy) {
    if (by.includes(f)) for (const g of files) if (g.startsWith(d + '/') && path.dirname(g) === d) keep(g, 'directory ' + d + '/ read by ' + f);
  }
};
while (queue.length) {
  const f = queue.shift();
  if (runtimeRoots.some((r) => r.test(f))) continue;
  const out = edges.get(f);
  if (out) for (const [to, why] of out) keep(to, why + ' in ' + f);
  reachDirs(f);
}

const builtins = new Set(require('module').builtinModules);
for (const manifest of files.filter((f) => path.basename(f) === 'package.json' && text.has(f))) {
  const dir = path.dirname(manifest) === '.' ? '' : path.dirname(manifest) + '/';
  const deps = Object.keys(JSON.parse(text.get(manifest)).dependencies || {});
  const user = files.find((f) => reason.has(f) && !runtimeRoots.some((r) => r.test(f)) && f.startsWith(dir) && /\.(c|m)?js$/.test(f)
    && [...(text.get(f) || '').matchAll(/require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)].some((m) => deps.includes(m[1]) && !builtins.has(m[1])));
  if (!user) continue;
  keep(manifest, 'npm manifest: ' + user + ' requires its dependencies');
  const lock = dir + 'package-lock.json';
  if (fileSet.has(lock)) keep(lock, 'npm lock file of kept ' + manifest);
}

for (const ig of files.filter((f) => path.basename(f) === '.gitignore' && f.includes('/'))) {
  const dir = path.dirname(ig) + '/';
  const sibling = files.find((f) => f !== ig && f.startsWith(dir) && reason.has(f));
  if (sibling) keep(ig, 'ignore rules for the kept directory of ' + sibling);
}

const byBlob = new Map();
for (const f of files) { const b = blob.get(f); if (!byBlob.has(b)) byBlob.set(b, []); byBlob.get(b).push(f); }

const result = [];
for (const f of files) {
  let cls;
  let proof;
  if (runtimeRoots.some((r) => r.test(f))) { cls = 'runtime'; proof = 'gm runtime or editor state (' + f.split('/')[0] + ')'; }
  else if (reason.has(f)) { cls = 'keep'; proof = reason.get(f); }
  else {
    const twins = byBlob.get(blob.get(f)).filter((g) => g !== f);
    const keptTwin = twins.find((g) => reason.has(g));
    if (keptTwin) { cls = 'duplicate'; proof = 'same blob as kept ' + keptTwin; }
    else if (twins.length && twins.sort()[0] < f) { cls = 'duplicate'; proof = 'same blob as ' + twins.sort()[0]; }
    else if (/^docs\/witness\//.test(f)) { cls = 'generated'; proof = 'witness output, no reference from the build, CI, a kept witness or a kept doc'; }
    else {
      const anyRef = [...edges].filter(([from, m]) => m.has(f)).map(([from]) => from);
      cls = 'dead';
      proof = anyRef.length ? 'named only by unkept ' + anyRef.slice(0, 3).join(', ') : 'no reference anywhere in tracked text';
    }
  }
  result.push({ path: f, cls, size: size.get(f) || 0, proof });
}

const keptDup = [];
for (const [b, group] of byBlob) {
  const kept = group.filter((g) => reason.has(g) && !runtimeRoots.some((r) => r.test(g)));
  if (kept.length > 1 && (size.get(group[0]) || 0) > 0) keptDup.push(kept);
}

const ciAndWitness = files.filter((f) => /^\.github\/workflows\//.test(f) || f === 'docs/PENDING_VALIDATION.md' || f === 'AGENTS.md');
const redDead = [];
for (const r of result) {
  if (r.cls !== 'dead') continue;
  for (const w of ciAndWitness) if ((text.get(w) || '').includes(r.path)) redDead.push({ path: r.path, namedBy: w });
}

fs.writeFileSync(outJson, JSON.stringify({ total: files.length, result, keptDup, redDead }, null, 1));
const counts = {};
for (const r of result) counts[r.cls] = (counts[r.cls] || 0) + 1;
const bytes = {};
for (const r of result) bytes[r.cls] = (bytes[r.cls] || 0) + r.size;
console.log(JSON.stringify({ total: files.length, counts, sum: Object.values(counts).reduce((a, b) => a + b, 0), bytes, keptDuplicateGroups: keptDup.length, redDead: redDead.length }));

const outMd = process.argv[4];
if (outMd) {
  const keptText = result.filter((r) => r.cls === 'keep' && text.has(r.path)).map((r) => r.path);
  const deadNamedByKept = result.filter((r) => r.cls === 'dead').flatMap((r) => keptText.filter((k) => text.get(k).includes(r.path)).map((k) => r.path + ' named by ' + k));
  const unclassified = result.filter((r) => !['keep', 'runtime', 'generated', 'duplicate', 'dead'].includes(r.cls)).length;
  const head = git(['rev-parse', '--short', 'HEAD']).trim();
  const byDir = new Map();
  for (const r of result) {
    const p = r.path.split('/');
    const d = p.length > 2 ? p.slice(0, 2).join('/') : p.length > 1 ? p[0] : '(root)';
    const k = d + '\t' + r.cls;
    byDir.set(k, (byDir.get(k) || 0) + 1);
  }
  const lines = [];
  lines.push('# mc-420 YAGNI and DRY: S1 path classes', '');
  lines.push(`Generated by \`node specs/yagni-classify.cjs <repo> <json> specs/mc-420-yagni-classes.md\` at HEAD ${head}.`, '');
  lines.push('## Witness and red checks', '');
  lines.push(`- Tracked total at the start of S1: ${files.length}. Class counts: ${Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', ')}. Sum ${Object.values(counts).reduce((a, b) => a + b, 0)}.`);
  lines.push(`- Bytes per class: ${Object.entries(bytes).map(([k, v]) => k + ' ' + v).join(', ')}.`);
  lines.push(`- Red check, unclassified paths: ${unclassified}.`);
  lines.push(`- Red check, dead paths named by a workflow, AGENTS.md or docs/PENDING_VALIDATION.md: ${redDead.length}; dead paths named by any kept file: ${deadNamedByKept.length}.`);
  lines.push(`- Identical-blob groups inside the kept set: ${keptDup.length}, all under docs/witness.`, '');
  lines.push('## Rules', '');
  lines.push('- keep: under src, dsp, effects, kernel, image, config, vendor, ci or .github/workflows; an owner root document (AGENTS.md, README.md, CLAUDE.md, LICENSE, .gitignore, .gitattributes, docs/PENDING_VALIDATION.md); an operator tool listed below; or reached from a kept file by its repo path, a two-component path suffix, a unique basename, a require/import, a C/C++ include, a Faust import, a Python import, a script run (source, sh, bash, python, node), or a directory under test-audio-corpus, vendor, docs/demo or tools that a kept file names; a nested .gitignore beside kept files; an npm manifest and its lock file when a kept script under it requires one of its dependencies.');
  lines.push('- runtime: .gm, closes and .vscode state.');
  lines.push('- duplicate: the same blob as another path, the kept or lexically first copy being canonical.');
  lines.push('- generated: a docs/witness output that nothing kept reaches.');
  lines.push('- dead: nothing kept reaches it.', '');
  lines.push('## Operator-tool overrides', '');
  for (const [p, why] of operatorTools) lines.push(`- ${p}: ${why}`);
  lines.push('', '## Counts by directory', '', '| directory | class | files |', '| --- | --- | --- |');
  for (const [k, v] of [...byDir].sort()) { const [d, c] = k.split('\t'); lines.push(`| ${d} | ${c} | ${v} |`); }
  for (const cls of ['dead', 'runtime', 'duplicate', 'generated']) {
    lines.push('', `## ${cls} paths`, '');
    for (const r of result.filter((x) => x.cls === cls)) lines.push(`- ${r.path} (${r.size} B): ${r.proof}`);
  }
  lines.push('', '## keep paths', '');
  for (const r of result.filter((x) => x.cls === 'keep')) lines.push(`- ${r.path}: ${r.proof}`);
  fs.writeFileSync(outMd, lines.join('\n') + '\n');
}
