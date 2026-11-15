import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
await mkdir(join(root,'qa'),{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const checks=[],errors=[],requests=[];
const page=await browser.newPage({viewport:{width:1440,height:1150},deviceScaleFactor:1});
page.on('pageerror',error=>errors.push(error.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});
page.on('request',req=>requests.push(req.url()));
await page.addInitScript(()=>{
  const C=window.AudioContext||window.webkitAudioContext;
  if(C){const create=C.prototype.createBuffer;C.prototype.createBuffer=function(...args){const b=create.apply(this,args);window.__score=b;return b}}
});
const url=pathToFileURL(join(root,'index.html')).href;
await page.goto(url);
await page.waitForSelector('html[data-ready=true]');
assert.equal(await page.evaluate(()=>window.TalentFilm.duration),96);
assert.equal(await page.locator('.chapter').count(),8);
assert.equal(await page.locator('#transcript section').count(),8);
checks.push('Self-contained local file loads; 8 chapters and complete transcript exist.');
for(let i=0;i<8;i++){
  const t=i*12+9.5;
  await page.evaluate(t=>window.TalentFilm.seek(t),t);
  const image=await page.locator('#film').evaluate(c=>c.toDataURL('image/png'));
  await writeFile(join(root,'qa','scene-'+(i+1)+'.png'),Buffer.from(image.split(',')[1],'base64'));
}
await page.evaluate(()=>window.TalentFilm.seek(0));
await page.screenshot({path:join(root,'qa','desktop.png'),fullPage:true});
const frames=[0,.5,2,5,11.99,12,12.15,12.36,23.99,24.15,36.15,48.15,60.15,72.15,84.15,95.99,96];
for(const t of frames){
  const result=await page.evaluate(t=>{
    const ctx=document.querySelector('canvas').getContext('2d');
    window.TalentFilm.render(t);const a=ctx.getImageData(0,0,1920,1080).data;
    window.TalentFilm.render(95-t);window.TalentFilm.render(t);const b=ctx.getImageData(0,0,1920,1080).data;
    let total=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);total+=d;max=Math.max(max,d)}
    return {total,max};
  },t);
  assert(result.max<=2&&result.total<=5000,'determinism within GPU raster tolerance at '+t+': '+JSON.stringify(result));
}
checks.push('Forward/reverse seeks match within GPU raster tolerance (max 2/255 per channel, total 5000); all seven transitions and final frame sampled.');
await page.evaluate(()=>window.TalentFilm.seek(0));
const started=Date.now();
await page.locator('#play').click();
await page.waitForFunction(()=>window.TalentFilm.getState().audioReady,null,{timeout:15000});
const audioInitMs=Date.now()-started;
await page.waitForTimeout(1000);
assert.equal(await page.evaluate(()=>window.TalentFilm.getState().playing),true);
assert((await page.evaluate(()=>window.TalentFilm.getState().time))>.5);
await page.locator('#play').click();
const stopped=await page.evaluate(()=>window.TalentFilm.getState().time);
await page.waitForTimeout(300);
assert.equal(await page.evaluate(()=>window.TalentFilm.getState().time),stopped);
const audio=await page.evaluate(()=>{
  const b=window.__score;let peak=0,sum=0,finite=true;
  for(let c=0;c<b.numberOfChannels;c++){const data=b.getChannelData(c);for(let i=0;i<data.length;i++){const v=data[i];peak=Math.max(peak,Math.abs(v));sum+=v*v;if(!Number.isFinite(v))finite=false}}
  return {channels:b.numberOfChannels,duration:b.duration,sampleRate:b.sampleRate,peak,rms:Math.sqrt(sum/(b.length*b.numberOfChannels)),finite,context:window.TalentFilm.getState().audioState};
});
assert.equal(audio.duration,96);assert.equal(audio.channels,2);assert(audio.peak>.05&&audio.peak<1);assert(audio.rms>.005);assert(audio.finite);assert.equal(audio.context,'running');
checks.push('Playback advances; pause holds time; 96-second stereo WebAudio score has finite nonzero samples below clipping.');
await page.locator('#sound').click();assert.equal(await page.evaluate(()=>window.TalentFilm.getState().muted),true);
await page.locator('#sound').click();assert.equal(await page.evaluate(()=>window.TalentFilm.getState().muted),false);
await page.locator('#captions').click();assert.equal(await page.evaluate(()=>window.TalentFilm.getState().subtitles),false);
await page.locator('#captions').click();assert.equal(await page.evaluate(()=>window.TalentFilm.getState().subtitles),true);
await page.locator('.chapter').nth(4).click();assert.equal(await page.evaluate(()=>window.TalentFilm.getState().time),48);
await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>window.TalentFilm.getState().time),53);
await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>window.TalentFilm.getState().time),48);
await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>window.TalentFilm.getState().time),0);
await page.locator('#seek').evaluate(el=>{el.value=30;el.dispatchEvent(new Event('input',{bubbles:true}))});
assert.equal(await page.evaluate(()=>window.TalentFilm.getState().time),30);
await page.locator('#fullscreen').click();
assert(await page.evaluate(()=>Boolean(document.fullscreenElement)));
await page.evaluate(()=>document.exitFullscreen());
await page.locator('#screen').focus();await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.TalentFilm.getState().playing),true);
await page.keyboard.press('Space');assert.equal(await page.evaluate(()=>window.TalentFilm.getState().playing),false);
await page.evaluate(()=>{window.TalentFilm.seek(95.8);window.TalentFilm.play()});
await page.waitForFunction(()=>window.TalentFilm.getState().time===96&&!window.TalentFilm.getState().playing);
assert.equal(await page.locator('#playLabel').textContent(),'重播');
await page.locator('#restart').click();await page.waitForTimeout(200);
assert((await page.evaluate(()=>window.TalentFilm.getState().time))<2);
await page.evaluate(()=>window.TalentFilm.pause());
checks.push('Buttons, keyboard, slider, chapters, fullscreen, ending and restart work.');
const performanceMs=await page.evaluate(()=>{const start=performance.now();for(let i=0;i<120;i++)window.TalentFilm.render(i*.8);return(performance.now()-start)/120});
assert(performanceMs<50,'mean render below 50ms');
const mobile=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
mobile.on('pageerror',e=>errors.push(e.message));
await mobile.goto(url);await mobile.waitForSelector('html[data-ready=true]');
assert.equal(await mobile.evaluate(()=>window.TalentFilm.getState().playing),false);
assert(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
assert((await mobile.locator('#status').textContent()).includes('减少动态'));
await mobile.screenshot({path:join(root,'qa','mobile.png'),fullPage:true});
checks.push('390px mobile layout has no horizontal overflow; reduced-motion preference starts paused.');
assert.equal(requests.filter(u=>/^https?:/.test(u)).length,0);assert.deepEqual(errors,[]);
checks.push('No external HTTP requests and no browser script/console errors.');
await page.evaluate(()=>window.TalentFilm.seek(91.5));
const poster=await page.locator('#film').evaluate(c=>c.toDataURL('image/png'));
await writeFile(join(root,'poster.png'),Buffer.from(poster.split(',')[1],'base64'));
const scripts=await page.evaluate(()=>Array.from(document.scripts,s=>s.textContent));
for(const source of scripts)new Function(source);
const subtitles=await page.evaluate(()=>Array.from(document.querySelectorAll('#transcript section'),s=>({title:s.querySelector('h2').textContent,text:s.querySelector('p').textContent})));
await writeFile(join(root,'qa','result.json'),JSON.stringify({date:new Date().toISOString(),checks,audio,audioInitMs,meanRenderMs:performanceMs,errors,externalRequests:requests.filter(u=>/^https?:/.test(u)),subtitles},null,2));
console.log(JSON.stringify({checks:checks.length,audio,audioInitMs,meanRenderMs:performanceMs,errors},null,2));
await browser.close();
