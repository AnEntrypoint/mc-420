const fs=require('fs');
function rd(f){const b=fs.readFileSync(f);let o=12,fmt,d;while(o+8<=b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='fmt ')fmt={ch:b.readUInt16LE(o+10),rate:b.readUInt32LE(o+12),bits:b.readUInt16LE(o+22)};else if(id==='data')d=b.subarray(o+8,o+8+sz);o+=8+sz+(sz&1);}
const n=Math.floor(d.length/(fmt.bits/8)/fmt.ch),s=new Float32Array(n);for(let i=0;i<n;i++)s[i]=d.readInt16LE(i*fmt.ch*2)/32768;return{rate:fmt.rate,s};}
const [f,win]=process.argv.slice(2);const w=rd(f);const h=Math.round(w.rate*(Number(win)||0.25));
let out=[];let pk=0,ss=0;for(const v of w.s){pk=Math.max(pk,Math.abs(v));ss+=v*v}
console.log(f,'rate',w.rate,'len_s',(w.s.length/w.rate).toFixed(2),'peak',pk.toFixed(5),'peak_dBFS',(20*Math.log10(pk||1e-9)).toFixed(1),'rms',Math.sqrt(ss/w.s.length).toFixed(5));
for(let i=0;i+h<=w.s.length;i+=h){let e=0,p=0;for(let j=i;j<i+h;j++){e+=w.s[j]*w.s[j];p=Math.max(p,Math.abs(w.s[j]))}out.push((20*Math.log10(Math.sqrt(e/h)||1e-9)).toFixed(0))}
console.log('rms dBFS per',win||0.25,'s:',out.join(' '));
