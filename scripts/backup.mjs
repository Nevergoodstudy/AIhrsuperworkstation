import 'dotenv/config';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, copyFile, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../server/db.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validKey=key=>/^[0-9a-f-]{36}$/.test(key);
async function integrity(db){const rows=db.prepare('PRAGMA integrity_check').all();if(rows.some(row=>Object.values(row)[0]!=='ok'))throw new Error('数据库完整性检查失败');if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('数据库外键检查失败');}
export async function createBackup(dataDir, outputRoot) {
 const dest=path.resolve(outputRoot,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));
 await mkdir(outputRoot,{recursive:true,mode:0o700});await mkdir(dest,{mode:0o700});await mkdir(path.join(dest,'resumes'),{mode:0o700});
 let source,snapshot;
 try {
  source=new DatabaseSync(path.join(dataDir,'talent.sqlite'),{readOnly:true});await backup(source,path.join(dest,'talent.sqlite'));source.close();source=null;
  snapshot=new DatabaseSync(path.join(dest,'talent.sqlite'),{readOnly:true});await integrity(snapshot);
  const keys=snapshot.prepare('SELECT DISTINCT file_key FROM candidates WHERE file_key IS NOT NULL').all().map(row=>row.file_key);snapshot.close();snapshot=null;
  const manifest={format:1,createdAt:new Date().toISOString(),files:[]};
  for(const file of ['talent.sqlite',...keys.map(key=>{if(!validKey(key))throw new Error('简历文件标识无效');return 'resumes/'+key;})]){if(file!=='talent.sqlite')await copyFile(path.join(dataDir,file),path.join(dest,file));const bytes=await readFile(path.join(dest,file));manifest.files.push({path:file,bytes:bytes.length,sha256:sha(bytes)});}
  await writeFile(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});await verifyBackup(dest);return dest;
 } catch(error) {source?.close();snapshot?.close();await rm(dest,{recursive:true,force:true});throw error;}
}
export async function verifyBackup(root){
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.format!==1||!Array.isArray(manifest.files)||manifest.files.length>100000)throw new Error('备份清单格式无效');
 const seen=new Set();
 for(const file of manifest.files){if(typeof file.path!=='string'||!(file.path==='talent.sqlite'||(file.path.startsWith('resumes/')&&validKey(file.path.slice(8))))||seen.has(file.path))throw new Error('备份包含无效路径');seen.add(file.path);const info=await stat(path.join(root,file.path));if(!info.isFile()||info.size!==file.bytes)throw new Error('备份文件大小不符：'+file.path);const bytes=await readFile(path.join(root,file.path));if(sha(bytes)!==file.sha256)throw new Error('备份校验不符：'+file.path);}
 if(!seen.has('talent.sqlite'))throw new Error('备份缺少数据库');
 const db=new DatabaseSync(path.join(root,'talent.sqlite'),{readOnly:true});try{await integrity(db);const files=db.prepare('SELECT file_key FROM candidates WHERE file_key IS NOT NULL').all();if(files.some(row=>!seen.has('resumes/'+row.file_key)))throw new Error('备份缺少简历原件');}finally{db.close();}return manifest;
}
export async function restoreBackup(root,target){
 const manifest=await verifyBackup(root);await mkdir(target,{mode:0o700});
 try {
  await mkdir(path.join(target,'resumes'), { mode:0o700 });
  for (const file of manifest.files) await copyFile(path.join(root,file.path), path.join(target,file.path));
  const db = new DatabaseSync(path.join(target,'talent.sqlite'));
  try {
   transaction(db, () => {
    db.exec('DELETE FROM sessions; DELETE FROM portal_sessions;');
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='feedback_links'").get()) {
     db.exec('DELETE FROM feedback_links');
    }
   });
   await integrity(db);
  } finally { db.close(); }
 } catch (error) {
  await rm(target, { recursive:true, force:true });
  throw error;
 }
 return target;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 process.umask(0o077);const [mode,arg,target]=process.argv.slice(2);
 try{if(mode==='verify'){if(!arg)throw new Error('用法：npm run backup:verify -- /备份目录');const manifest=await verifyBackup(path.resolve(arg));console.log('备份校验通过：'+manifest.files.length+' 个文件');}else if(mode==='restore'){if(!arg||!target)throw new Error('用法：node scripts/backup.mjs restore /备份目录 /全新数据目录（先停止服务）');console.log('已恢复至 '+await restoreBackup(path.resolve(arg),path.resolve(target)));}else{const data=path.resolve(process.env.DATA_DIR||'./data');const dest=await createBackup(data,path.resolve(mode||'./backups'));console.log('备份已完成并校验：'+dest);}}catch(error){console.error('备份操作失败：'+error.message);process.exitCode=1;}
}
