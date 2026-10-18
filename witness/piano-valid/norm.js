const fs=require('fs');
const b=fs.readFileSync(process.argv[2]);let o=12,d,off;while(o+8<=b.length){const id=b.toString('ascii',o,o+4),sz=b.readUInt32LE(o+4);if(id==='data'){off=o+8;d=sz;}o+=8+sz+(sz&1);}
const n=d/2;const x=new Float32Array(n);for(let i=0;i<n;i++)x[i]=b.readInt16LE(off+i*2)/32768;
let on=0;for(let i=0;i<n;i++){if(Math.abs(x[i])>0.01){on=i;break}}
let pk=0;for(let i=on;i<n;i++)pk=Math.max(pk,Math.abs(x[i]));
const g=Math.pow(10,-3/20)/pk;const ramp=240;
const out=Buffer.from(b);
for(let i=0;i<n;i++){let gi=1;if(i>=on)gi=g;else if(i>=on-ramp)gi=1+(g-1)*(i-(on-ramp))/ramp;
let v=Math.round(x[i]*gi*32768);v=Math.max(-32768,Math.min(32767,v));out.writeInt16LE(v,off+i*2);}
fs.writeFileSync(process.argv[3],out);
console.log('onset sample',on,(on/48000).toFixed(3)+'s','pk',pk.toFixed(5),'gain',g.toFixed(3),(20*Math.log10(g)).toFixed(1)+'dB');
