import {readFile,writeFile,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Add duration to Chromium MediaRecorder streams without re-encoding media.
// Only accepts the unindexed, unknown-length Segment / Cluster layout we record.
export async function finalizeWebm(path,seconds){
  assert(Number.isFinite(seconds)&&seconds>0);
  const source=await readFile(path);
  function element(offset){
    let idLength=1,marker=128;
    while(idLength<=4&&!(source[offset]&marker)){idLength++;marker>>=1}
    assert(idLength<=4,'Invalid EBML ID');
    const id=source.subarray(offset,offset+idLength).toString('hex');
    const sizeOffset=offset+idLength;let width=1;marker=128;
    while(width<=8&&!(source[sizeOffset]&marker)){width++;marker>>=1}
    assert(width<=8,'Invalid EBML size');
    let size=BigInt(source[sizeOffset]&(marker-1));
    for(let i=1;i<width;i++)size=(size<<8n)|BigInt(source[sizeOffset+i]);
    const unknown=size===((1n<<BigInt(7*width))-1n),data=sizeOffset+width;
    return {id,size:Number(size),unknown,data,end:unknown?source.length:data+Number(size),sizeOffset,width};
  }
  const ebml=element(0),segment=element(ebml.end);
  assert.equal(ebml.id,'1a45dfa3');assert.equal(segment.id,'18538067');assert(segment.unknown);
  const info=element(segment.data),tracks=element(info.end),cluster=element(tracks.end);
  assert.equal(info.id,'1549a966');assert(!info.unknown);assert.equal(tracks.id,'1654ae6b');
  assert.equal(cluster.id,'1f43b675');assert(cluster.unknown,'Refusing indexed or finite Cluster layout');
  let scale=1000000,duration;
  for(let at=info.data;at<info.end;){
    const e=element(at);assert(!e.unknown&&e.end<=info.end);
    if(e.id==='2ad7b1')scale=source.readUIntBE(e.data,e.size);
    if(e.id==='4489')duration=e;
    at=e.end;
  }
  const units=seconds*1e9/scale;let output;
  if(duration){
    assert.equal(duration.size,8,'Unexpected duration encoding');source.writeDoubleBE(units,duration.data);output=source;
  }else{
    assert.equal(info.width,1);assert(info.size+11<127);
    const entry=Buffer.alloc(11);entry[0]=0x44;entry[1]=0x89;entry[2]=0x88;entry.writeDoubleBE(units,3);
    output=Buffer.concat([source.subarray(0,info.sizeOffset),Buffer.from([128|(info.size+11)]),source.subarray(info.data,info.end),entry,source.subarray(info.end)]);
  }
  await writeFile(path+'.tmp',output);await rename(path+'.tmp',path);
  return {bytes:output.length,durationMetadataSeconds:seconds};
}
