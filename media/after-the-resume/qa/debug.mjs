import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.cwd()+'/media/after-the-resume/';
const browser=await chromium.launch({headless:true,channel:'msedge'});const page=await browser.newPage();
await page.goto(pathToFileURL(root+'index.html').href);await page.waitForSelector('html[data-ready=true]');
console.log(JSON.stringify(await page.evaluate(()=>{
  const c=document.querySelector('canvas'),ctx=c.getContext('2d');
  const state=()=>Object.fromEntries(['globalAlpha','globalCompositeOperation','textAlign','textBaseline','font','fillStyle','strokeStyle','shadowColor','shadowBlur','shadowOffsetX','shadowOffsetY','filter','lineWidth','lineCap','lineJoin','lineDashOffset','imageSmoothingEnabled'].map(k=>[k,String(ctx[k])]));
  window.TalentFilm.render(.5);const a=ctx.getImageData(0,0,1920,1080).data,sa=state();window.TalentFilm.render(94.5);const sb=state();window.TalentFilm.render(.5);const b=ctx.getImageData(0,0,1920,1080).data,sc=state();let n=0,max=0,minX=1920,maxX=0,minY=1080,maxY=0;
  for(let i=0;i<a.length;i++){let d=Math.abs(a[i]-b[i]);if(d){n++;max=Math.max(max,d);const p=Math.floor(i/4);minX=Math.min(minX,p%1920);maxX=Math.max(maxX,p%1920);minY=Math.min(minY,Math.floor(p/1920));maxY=Math.max(maxY,Math.floor(p/1920))}}
  return {n,max,minX,maxX,minY,maxY,sa,sb,sc};
}),null,2));
const sources=await Promise.all(Array.from({length:8},(_,i)=>readFile(root+'qa/scene-'+(i+1)+'.png').then(b=>'data:image/png;base64,'+b.toString('base64'))));
const sheet=await page.evaluate(async sources=>{
  const out=document.createElement('canvas');out.width=1568;out.height=1928;const ctx=out.getContext('2d');ctx.fillStyle='#06120f';ctx.fillRect(0,0,out.width,out.height);
  const imgs=await Promise.all(sources.map(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.src=src})));
  imgs.forEach((img,i)=>{const x=12+(i%2)*784,y=12+Math.floor(i/2)*482;ctx.drawImage(img,x,y,760,427.5);ctx.font='14px sans-serif';ctx.fillStyle='#8fa99d';ctx.fillText(String(i+1).padStart(2,'0')+' / '+String(i*12).padStart(2,'0')+'s',x,y+451)});return out.toDataURL();
},sources);
await writeFile(root+'contact-sheet.png',Buffer.from(sheet.split(',')[1],'base64'));await browser.close();
