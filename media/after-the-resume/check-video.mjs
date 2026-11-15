import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createServer} from 'node:http';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const videoPath=join(root,'简历之后.webm');
const size=(await stat(videoPath)).size;
const header=(await readFile(videoPath)).subarray(0,4).toString('hex');
assert.equal(header,'1a45dfa3');
assert(size>1000000);
const server=createServer((req,res)=>{
  if(req.url!=='/film.webm'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset=utf-8><title>Video validation</title><video controls preload=auto src=/film.webm></video>');return}
  const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),size-1):size-1;
  if(start>=size||end<start){res.writeHead(416,{'Content-Range':'bytes */'+size});res.end();return}
  const headers={'Content-Type':'video/webm','Accept-Ranges':'bytes','Content-Length':end-start+1};
  if(range)headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
  res.writeHead(range?206:200,headers);
  const stream=createReadStream(videoPath,{start,end});req.on('close',()=>stream.destroy());stream.pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,null,{timeout:30000});
  const initial=await page.evaluate(()=>{const v=document.querySelector('video');v.pause();return {width:v.videoWidth,height:v.videoHeight,duration:Number.isFinite(v.duration)?v.duration:String(v.duration),readyState:v.readyState,seekable:Array.from({length:v.seekable.length},(_,i)=>[v.seekable.start(i),v.seekable.end(i)])}});
  assert.equal(initial.width,1920);assert.equal(initial.height,1080);
  assert.equal(initial.duration,96,'Duration available immediately from finalized metadata');
  if(initial.duration==='Infinity'){
    await page.evaluate(()=>{document.querySelector('video').currentTime=1e10});
    await page.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&Number.isFinite(v.duration)},null,{timeout:20000});
  }
  const samples=[];
  for (const t of [6,48,90,95]) {
    await page.evaluate(t=>{document.querySelector('video').currentTime=t},t);
    await page.waitForFunction(t=>{const v=document.querySelector('video');return !v.seeking&&v.readyState>=2&&Math.abs(v.currentTime-t)<.1},t,{timeout:20000});
    const frame=await page.evaluate(()=>{
      const v=document.querySelector('video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
      const x=c.getContext('2d');x.drawImage(v,0,0);
      const pixels=x.getImageData(0,0,c.width,c.height).data;let nonBlack=0,sum=0,hash=2166136261;
      for(let i=0;i<pixels.length;i+=16){const n=pixels[i]+pixels[i+1]+pixels[i+2];sum+=n;if(n>20)nonBlack++;hash=Math.imul(hash^pixels[i],16777619)}
      return {time:v.currentTime,nonBlackRatio:nonBlack/(pixels.length/16),meanRGB:sum/(pixels.length/16*3),hash:hash>>>0,png:c.toDataURL('image/png')};
    });
    assert(frame.nonBlackRatio>.5);assert(frame.meanRGB>5);
    if(t===48||t===95)await writeFile(join(root,'qa','video-'+t+'.png'),Buffer.from(frame.png.slice(frame.png.indexOf(',')+1),'base64'));
    const {png,...measure}=frame;samples.push(measure);
  }
  assert.equal(new Set(samples.map(s=>s.hash)).size,samples.length);
  await page.evaluate(()=>{const v=document.querySelector('video');v.currentTime=0;v.muted=false;v.volume=1});
  await page.waitForFunction(()=>!document.querySelector('video').seeking);
  await page.evaluate(()=>document.querySelector('video').play());
  await page.waitForTimeout(1500);
  const decoded=await page.evaluate(()=>{const v=document.querySelector('video');v.pause();return {time:v.currentTime,duration:v.duration,readyState:v.readyState,videoFrames:v.getVideoPlaybackQuality().totalVideoFrames,droppedFrames:v.getVideoPlaybackQuality().droppedVideoFrames,audioDecodedBytes:v.webkitAudioDecodedByteCount,videoDecodedBytes:v.webkitVideoDecodedByteCount,error:v.error?{code:v.error.code,message:v.error.message}:null}});
  assert(decoded.time>.5);assert(decoded.duration>95&&decoded.duration<99);assert(decoded.audioDecodedBytes>0);assert(decoded.videoFrames>0);assert.equal(decoded.error,null);assert.deepEqual(errors,[]);
  const result={date:new Date().toISOString(),browser:'Microsoft Edge headless',bytes:size,header,initial,samples,decoded,checks:['EBML WebM signature and nonempty file','1920 × 1080 video decoder output','Distinct nonblack decoded frames at 6, 48, 90 and 95 seconds','Playback time advances with decoded video frames and decoded audio bytes','Duration near 96 seconds; no media or script errors'],errors};
  await writeFile(join(root,'qa','video.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
