import fs from "node:fs";
const DIR = new URL(".", import.meta.url).pathname;
const truth = JSON.parse(fs.readFileSync(DIR + "note_change.truth.json", "utf8"));
const variant = process.argv[2];
const rows = [];
for (const line of fs.readFileSync(DIR + variant + "__note_change.txt", "utf8").split("\n")) {
  const p = line.trim().split(/\s+/);
  if (p.length < 2) continue;
  const t = +p[0], hz = +p[1];
  if (isFinite(t) && isFinite(hz)) rows.push([t, hz]);
}
const cents = (a, b) => 1200 * Math.log2(a / b);
const out = ["variant " + variant + " frames " + rows.length];
let prevF = null;
truth.segments.forEach((s, k) => {
  const inSeg = rows.filter(([t]) => t >= s.t0 + 0.3 && t < s.t1);
  const zero = inSeg.filter(([, h]) => h === 0).length;
  const within25 = inSeg.filter(([, h]) => h > 0 && Math.abs(cents(h, s.f)) <= 25).length;
  const within10 = inSeg.filter(([, h]) => h > 0 && Math.abs(cents(h, s.f)) <= 10).length;
  const stale = prevF === null ? 0 : inSeg.filter(([, h]) => h > 0 && Math.abs(cents(h, prevF)) <= 5 && Math.abs(cents(h, s.f)) > 50).length;
  const first = rows.find(([t, h]) => t >= s.t0 && h > 0 && Math.abs(cents(h, s.f)) <= 25);
  const lat = first ? (first[0] - s.t0).toFixed(3) : "NEVER";
  out.push([s.name, s.f.toFixed(2), "frames=" + inSeg.length, "zero=" + (inSeg.length ? (zero / inSeg.length).toFixed(3) : "NA"), "within10c=" + (inSeg.length ? (within10 / inSeg.length).toFixed(3) : "NA"), "within25c=" + (inSeg.length ? (within25 / inSeg.length).toFixed(3) : "NA"), "stale_prev=" + stale, "release_s=" + lat].join("\t"));
  prevF = s.f;
});
console.log(out.join("\n"));
