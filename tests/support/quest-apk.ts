import { zipSync } from 'fflate';
export function manifestFixture(name = 'com.example.game', utf8 = true) {
  const values = ['manifest','package',name], chunks: Buffer[] = [], offsets: number[] = []; let bytes = 0;
  for (const s of values) { const b = Buffer.from(s,utf8?'utf8':'utf16le'), length = utf8 ? Buffer.from([s.length,b.length]) : Buffer.from([s.length,0]); const entry=Buffer.concat([length,b,Buffer.alloc(utf8?1:2)]);offsets.push(bytes);bytes+=entry.length;chunks.push(entry); }
  const start=28+values.length*4, pool=Buffer.alloc((start+bytes+3)&~3);pool.writeUInt16LE(1,0);pool.writeUInt16LE(28,2);pool.writeUInt32LE(pool.length,4);pool.writeUInt32LE(values.length,8);pool.writeUInt32LE(utf8?256:0,16);pool.writeUInt32LE(start,20);offsets.forEach((v,i)=>pool.writeUInt32LE(v,28+i*4));Buffer.concat(chunks).copy(pool,start);
  const tag=Buffer.alloc(56);tag.writeUInt16LE(0x0102,0);tag.writeUInt16LE(16,2);tag.writeUInt32LE(56,4);tag.writeUInt32LE(0xffffffff,16);tag.writeUInt32LE(0,20);tag.writeUInt16LE(20,24);tag.writeUInt16LE(20,26);tag.writeUInt16LE(1,28);tag.writeUInt32LE(0xffffffff,36);tag.writeUInt32LE(1,40);tag.writeUInt32LE(2,44);tag.writeUInt16LE(8,48);tag[51]=3;tag.writeUInt32LE(2,52);
  const head=Buffer.alloc(8);head.writeUInt16LE(3,0);head.writeUInt16LE(8,2);head.writeUInt32LE(8+pool.length+tag.length,4);return new Uint8Array(Buffer.concat([head,pool,tag]));
}
export const apkFixture = (name='com.example.game', utf8=true, level:0|6=6) => zipSync({'AndroidManifest.xml':manifestFixture(name,utf8),'classes.dex':new Uint8Array(100000)}, {level});
