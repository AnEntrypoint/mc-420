import fs from "node:fs";
const TR = "/config/workspace/mc-420/docs/witness/pitch-2093-raw/traces";
const variants = ["p1q4_p2_4200","p1q2_p2_4200","p1q4_p2_2600","p1q2_p2_2600","p2_2600","p1q4","p1q2","base","c2100","c2150_q2","c2150","c2200"];
const explicit = {sine_220:57,sine_440:69,sine_1000:84,sine_1500:90,sine_2093:96,sine_3000:107,flute_high_C7:96,flute_trill_high_C7:96,glockenspiel_high_C7:96,piano_high_C7:96,crotale_high_C7:96,violin_high_sulE_C7E7:96,piano_mid_C4:60,piano_low_A1:33};
const rows = {};
for (const f of fs.readdirSync(TR)) {
  if (!f.startsWith("trace_") || !f.endsWith(".txt")) continue;
  const body = f.slice(6, -4);
  const v = variants.find(x => body.startsWith(x + "_"));
  if (!v) continue;
  const name = body.slice(v.length + 1);
  const vals = [];
  for (const line of fs.readFileSync(TR + "/" + f, "utf8").split("\n")) {
    const p = line.trim().split(/\s+/); if (p.length < 2) continue;
    const t = +p[0], hz = +p[1]; if (!(t >= 1.0) || !(hz > 0)) continue; vals.push(hz);
  }
  vals.sort((a,b)=>a-b);
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
