import fs from "node:fs";
const kRate=48000,kMinHz=50,kMaxHz=8000;
function readWav(f){const b=fs.readFileSync(f);let p=12,fmt,data;while(p<b.length){const id=b.toString("ascii",p,p+4),sz=b.readUInt32LE(p+4);if(id==="fmt ")fmt={ch:b.readUInt16LE(p+10),bits:b.readUInt16LE(p+22),tag:b.readUInt16LE(p+8)};if(id==="data")data=b.subarray(p+8,p+8+sz);p+=8+sz+(sz&1);}
const bps=fmt.bits/8,n=Math.floor(data.length/bps/fmt.ch),x=new Float64Array(n);for(let i=0;i<n;i++){const o=i*fmt.ch*bps;x[i]=fmt.tag===3?data.readFloatLE(o):bps===2?data.readInt16LE(o)/32768:data.readInt32LE(o)/2147483648;}return x;}
function nsdScores(s,start,win,minLag,limit){const sc=new Float64Array(limit-minLag+1).fill(Infinity);for(let lag=minLag;lag<=limit;lag++){let num=0,dA=0,dB=0;for(let j=0;j<win;j++){const a=s[start+j],b=s[start+j+lag],d=a-b;num+=d*d;dA+=a*a;dB+=b*b;}const den=dA+dB;if(den>0)sc[lag-minLag]=num/den;}return sc;}
for(const f of process.argv.slice(2)){const x=readWav(f);const seg=x.subarray(Math.round((+process.env.START||0.95)*kRate),x.length-Math.round(0.3*kRate));
let bestAt=0,best=0;const win=8192;for(let i=0;i+win<seg.length;i+=1024){let e=0;for(let j=i;j<i+win;j++)e+=seg[j]*seg[j];if(e>best){best=e;bestAt=i;}}
const w=Math.min(win,seg.length-bestAt-2048);const minLag=Math.floor(kRate/kMaxHz),maxLag=Math.floor(kRate/kMinHz);const limit=Math.min(maxLag,seg.length-bestAt-w-1);
const sc=nsdScores(seg,bestAt,w,minLag,limit);const mins=[];for(let i=1;i<sc.length-1;i++)if(sc[i]<sc[i-1]&&sc[i]<=sc[i+1])mins.push([sc[i],i+minLag]);mins.sort((a,b)=>a[0]-b[0]);
const top=mins.slice(0,3).map(([s,l])=>({lag:l,hz:+(kRate/l).toFixed(2),nsd:+s.toFixed(4)}));
let bestScore=Infinity,bestLag=0;for(let i=0;i<sc.length;i++)if(sc[i]<bestScore){bestScore=sc[i];bestLag=i+minLag;}
let pick=null;if(bestLag&&bestScore<=0.75){pick={lag:bestLag,hz:+(kRate/bestLag).toFixed(2),nsd:+bestScore.toFixed(4)};for(let lag=minLag+1;lag<bestLag;lag++){const s=sc[lag-minLag];if(s>bestScore+0.02)continue;if(s>sc[lag-minLag-1]||s>sc[lag-minLag+1])continue;pick={lag,hz:+(kRate/lag).toFixed(2),nsd:+s.toFixed(4),via:"submultiple-walk"};break;}}
console.log(f.split("/").pop(),"witness-estimator pick",JSON.stringify(pick),"top3 NSD minima",JSON.stringify(top));}
