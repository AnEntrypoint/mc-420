import fs from "node:fs";import {execFileSync} from "node:child_process";
const X=process.argv[2];
const SP="/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lowhz";
const W=SP+"/g_"+X;const OLD="/tmp/claude-1000/-config-workspace-mc-420/552e4f18-f9c8-4f76-973c-a987b5ca102c/scratchpad/lowhz";
const SRC="/config/workspace/mc-420/docs/witness/pitch-lowhz-168b38c2/";
fs.mkdirSync(W+"/tr",{recursive:true});fs.mkdirSync(W+"/lk",{recursive:true});
for(const f of fs.readdirSync(SP+"/out")){
 if(f.startsWith("trace_base_"))fs.copyFileSync(SP+"/out/"+f,W+"/tr/"+f);
 else if(f.startsWith("trace_"+X+"_"))fs.copyFileSync(SP+"/out/"+f,W+"/tr/trace_cand_"+f.slice(7+X.length));
}
fs.copyFileSync(SP+"/lk/lock",W+"/lk/lock");
const fix=s=>s.split(OLD+"/out").join(W+"/tr").split(OLD+"/lk").join(W+"/lk");
for(const f of ["prep.mjs","run.mjs","gate.mjs"])fs.writeFileSync(W+"/"+f,fix(fs.readFileSync(SRC+f,"utf8")));
for(const f of ["prep.mjs","run.mjs","gate.mjs"]){console.log(execFileSync("node",[W+"/"+f],{encoding:"utf8",maxBuffer:1<<26}));}
