import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage();
await page.goto(pathToFileURL(join(root,'index.html')).href);await page.waitForSelector('html[data-ready=true]');
async function sheet(items,name){
 const data=await page.evaluate(async items=>{
  const c=document.createElement('canvas');c.width=1568;c.height=Math.ceil(items.length/2)*482;const ctx=c.getContext('2d');ctx.fillStyle='#06120f';ctx.fillRect(0,0,c.width,c.height);
  for(let i=0;i<items.length;i++){const img=await new Promise(resolve=>{const v=new Image();v.onload=()=>resolve(v);v.src=items[i].src});const x=12+(i%2)*784,y=12+Math.floor(i/2)*482;ctx.drawImage(img,x,y,760,427.5);ctx.font='16px sans-serif';ctx.fillStyle='#8fa99d';ctx.fillText(items[i].label,x,y+452)}return c.toDataURL();
 },items);
 await writeFile(join(root,name),Buffer.from(data.split(',')[1],'base64'));
}
const items=await Promise.all(Array.from({length:8},async(_,i)=>({src:'data:image/png;base64,'+(await readFile(join(root,'qa','scene-'+(i+1)+'.png'))).toString('base64'),label:'SCENE '+String(i+1).padStart(2,'0')+' / '+(i*12+9.5)+'s'})));
await sheet(items,'contact-sheet.png');
const transitions=[];
for(const t of [12.06,12.18,12.32,84.06,84.18,84.32]){await page.evaluate(t=>window.TalentFilm.seek(t),t);transitions.push({src:await page.locator('canvas').evaluate(c=>c.toDataURL()),label:t+'s'})}
await sheet(transitions,'qa/transitions.png');
await page.evaluate(()=>window.TalentFilm.seek(94.5));
const poster=await page.locator('canvas').evaluate(c=>c.toDataURL());
await writeFile(join(root,'poster.png'),Buffer.from(poster.split(',')[1],'base64'));
await browser.close();console.log('Poster, contact sheet and transition previews saved.');
