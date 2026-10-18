import fs from "node:fs";
const SRC = "/config/workspace/mc-420/effects/pitchtracker-src/pitchtracker_ac.dsp";
const DST = "/config/workspace/mc-420/docs/witness/pitch-ceiling/pitchtracker_ac_ceiling_dedup.dsp";
const SR = 48000;
const topOld = 1581.12, r = 1.0545;
const above = [];
for (let k = 1; k <= 19; k++) above.push(+(topOld * Math.pow(r, k)).toFixed(2));
const oldGrid = [1581.12,1500.0,1423.02,1350.0,1272.79,1200.0,1095.45,1000.0,938.08,880.0,784.86,700.0,641.01,587.0,508.21,440.0,391.87,349.0,320.32,294.0,277.33,261.6,239.9,220.0,201.74,185.0,169.66,155.6,142.66,130.8,119.95,110.0,100.87,92.5,84.83,77.8,71.33,65.4,62.64,60.0];
const G0 = [above[18], ...above.slice(0, 18).reverse(), ...oldGrid];
const G = G0.filter((f, i) => i === 0 || i === G0.length - 1 || Math.trunc(SR / f) !== Math.trunc(SR / G0[i - 1]));
const lit = (f) => (Number.isInteger(f) ? f.toFixed(1) : (+f.toFixed(2)).toString());
const val = (f) => (f >= topOld ? "cH(" + lit(f) + ")" : "c(" + lit(f) + ")");
const parts = [];
for (let i = 0; i + 2 < G.length - 1; i++) {
  parts.push("ba.if(isPeak(" + val(G[i]) + ", " + val(G[i + 1]) + ", " + val(G[i + 2]) + "), " + lit(G[i + 1]) + ",");
}
const chain = parts.join("\n        ") + "\n        ba.if(c(60.0) >= corrThresh, 60.0,\n        60.0" + ")".repeat(parts.length + 1) + ";";
const block = [
"corrAtLagVarTau(x, w, lagSig, energyTau) = num / den",
"with {",
"    lagClamped = lagSig : max(1) : min(delayMaxLag);",
"    d = rwtable(delayTableSize, 0.0, w, x, (w + delayTableSize - lagClamped) % delayTableSize);",
"    pole = ba.tau2pole(energyTau);",
"    smoo(sig) = sig : *(1.0-pole) : + ~ *(pole);",
"    num = smoo(x * d);",
"    den = max(1e-9, smoo(x*x));",
"};",
"",
"pickFundamental(x, w) = result",
"with {",
"    c(f) = corrAtLagTau(x, lagFor(f), tauFor(f));",
"    cH(f) = corrAtLagVarTau(x, w, lagFor(f), 0.02);",
"    isPeak(cLo, cMid, cHi) = (cMid >= corrThresh) & (cMid >= cLo) & (cMid >= cHi);",
"",
"    result =",
"        " + chain,
"};"
].join("\n");
let s = fs.readFileSync(SRC, "utf8");
const start = s.indexOf("pickFundamental(x) = result");
if (start < 0) throw new Error("anchor");
const end = s.indexOf("\n};", start) + 3;
s = s.slice(0, start) + block + s.slice(end);
const once = (str, a, b) => { const i = str.indexOf(a); if (i < 0 || str.indexOf(a, i + 1) >= 0) throw new Error("anchor2 " + a); return str.split(a).join(b); };
s = once(s, "maxTrackHz = 1500.0;", "maxTrackHz = 1500.0;\nmaxRawHz = 4200.0;");
s = once(s, "coarseFreq = pickFundamental(xh);", "coarseFreq = pickFundamental(xh, w);");
s = once(s, "rawFreq = rawFreqUnclamped : max(minTrackHz) : min(maxTrackHz);", "rawFreq = rawFreqUnclamped : max(minTrackHz) : min(maxRawHz);");
fs.writeFileSync(DST, s);
console.log("candidates", G.length - 2, "dropped", G0.length - G.length, "bytes", s.length);
