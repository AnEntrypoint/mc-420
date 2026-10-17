import fs from "node:fs";
const TR = "/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/pt/out";
const variants = ["base","v1","v2"];
const explicit = {sine_220:57,sine_440:69,sine_1000:84,sine_1500:90,sine_2093:96,sine_3000:107,flute_high_C7:96,flute_trill_high_C7:96,glockenspiel_high_C7:96,piano_high_C7:96,crotale_high_C7:96,marimba_mid_C5B5:74,violin_high_sulE_C7E7:96,piano_mid_C4:60,piano_low_A1:33};
const rows = {};
for (const f of fs.readdirSync(TR)) {
  if (!f.startsWith("trace_") || !f.endsWith(".txt")) continue;
  const body = f.slice(6, -4);
  const v = variants.find(x => body.startsWith(x + "_"));
  if (!v) continue;
  const name = body.slice(v.length + 1);
  const pts = [];
  for (const line of fs.readFileSync(TR + "/" + f, "utf8").split("\n")) {
    const p = line.trim().split(/\s+/); if (p.length < 2) continue;
    const t = +p[0], hz = +p[1]; if (!(hz > 0) || !isFinite(t)) continue; pts.push([t, hz]);
  }
  if (!pts.length) continue;
  const tmax = pts[pts.length-1][0];
  const vals = pts.filter(([t]) => t >= 1.0).map(([,h]) => h).sort((a,b)=>a-b);
  const med = vals.length ? vals[vals.length>>1] : NaN;
  (rows[name] ??= {})[v] = {med, n: vals.length};
}
const out = [];
for (const name of Object.keys(rows).sort()) {
  const b = rows[name].base?.med;
  const note = explicit[name] ?? (b > 0 ? Math.round(69 + 12*Math.log2(b/440)) : 60);
  out.push([name, note, ...variants.map(v => rows[name][v]?.med?.toFixed(4) ?? "NA")].join("\t"));
}
fs.writeFileSync("/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lk/table.tsv", "name\tnote\t" + variants.join("\t") + "\n" + out.join("\n") + "\n");
console.log(out.length, "names");
