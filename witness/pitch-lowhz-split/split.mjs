import fs from "node:fs";import crypto from "node:crypto";
const P="/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lowhz/";
const sha=s=>crypto.createHash("sha256").update(s).digest("hex");
const base=fs.readFileSync("/config/workspace/mc-420/effects/pitchtracker-src/pitchtracker_ac.dsp","utf8");
const rep=(s,a,b,n)=>{const c=s.split(a).length-1;if(c!==n)throw new Error("count "+c+" for "+a);return s.split(a).join(b)};
const A=s=>{
s=rep(s,"minTrackHz = 60.0;","minTrackHz = 50.0;",1);
s=rep(s,"        ba.if(c(60.0) >= corrThresh, 60.0,\n        60.0)))))))))))))))))))))))))))))))))))))));","        ba.if(isPeak(c(62.64), c(60.0), c(57.47)), 60.0,\n        ba.if(isPeak(c(60.0), c(57.47), c(55.05)), 57.47,\n        ba.if(isPeak(c(57.47), c(55.05), c(52.73)), 55.05,\n        ba.if(isPeak(c(55.05), c(52.73), c(50.5)), 52.73,\n        ba.if(c(50.5) >= corrThresh, 50.5,\n        50.5)))))))))))))))))))))))))))))))))))))))))));",1);
s=rep(s,"demoteNow = (freqH >= minTrackHz)","demoteNow = (freqH >= 60.0)",1);return s};
const Sm=s=>rep(s,"smoo(sig) = sig : *(1.0-pole) : + ~ *(pole);","smoo(sig) = sig : *(1.0-pole) : + ~ *(pole) : *(1.0-pole) : + ~ *(pole);",2);
const va=A(base),vs=Sm(base),both=Sm(A(base));
fs.writeFileSync(P+"var/va.dsp",va);fs.writeFileSync(P+"var/vs.dsp",vs);
console.log("base",sha(base));console.log("va",sha(va));console.log("vs",sha(vs));console.log("va+vs",sha(both),sha(both)==="535a08bd2fed27021aed38c10dcb7aa0f2b6e4fe585dc13e231ff1f0028ef910"?"MATCH":"NOMATCH");
