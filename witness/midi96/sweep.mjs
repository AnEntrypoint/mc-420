import {execFileSync} from "node:child_process";
import fs from "node:fs";
const S=process.argv[2];const nsd="/config/workspace/mc-420/docs/witness/midi96/nsd.mjs";
const rows=["kind\tparam\tclamped\tpick_hz\tpick_nsd\ttop3"];
const nsdOf=w=>{const t=execFileSync("node",[nsd,w],{encoding:"utf8"});const m=/pick (\{.*?\}|null) top3 NSD minima\s*(\[.*\])/s.exec(t.replace(/\n/g," "));return m?[m[1],m[2]]:[t,""]};
for(let s=12;s<=24;s+=1){const w=S+"/sw_"+s+".wav";const o=execFileSync(S+"/dsp_cli",["--solad","in="+S+"/sine2093.wav","out="+w,"semis="+s,"freq=2093","normrms=0.21"],{encoding:"utf8"});const c=/clamped=(\d+)/.exec(o)[1];const [p,t]=nsdOf(w);const pj=p==="null"?{}:JSON.parse(p);rows.push(["solad",s,c,pj.hz??"none",pj.nsd??"",t].join("\t"));fs.unlinkSync(w);}
for(const e of [400,500,600,650,700,719.3,740,800,900,1000,1200,1500,2000]){const w=S+"/lk_"+e+".wav";execFileSync(S+"/lock",["--gen0","sine:2093:6","--gen4","const:"+e+":6","--gen5","const:96:6","--gen6","const:1:6",w],{stdio:"pipe"});const [p,t]=nsdOf(w);const pj=p==="null"?{}:JSON.parse(p);rows.push(["lock96_ext",e,"",pj.hz??"none",pj.nsd??"",t].join("\t"));fs.unlinkSync(w);try{fs.unlinkSync(w.replace(".wav",".1.wav"))}catch{}}
fs.writeFileSync(S+"/sweep.tsv",rows.join("\n")+"\n");console.log(rows.join("\n"));
