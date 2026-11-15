import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.mjs';
import { id,now,hashPassword } from '../server/security.mjs';
const dataDir=mkdtempSync(path.join(os.tmpdir(),'talent-e2e-'));
const service=createApp({env:'test',dataDir,appUrl:'http://127.0.0.1:4173'});
for(const [role,department] of [['admin',''],['hr',''],['department','技术部']])service.db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)').run(id(),role+'测试账号',role+'@example.test',await hashPassword('E2e-only-password!2026'),role,department,now());
const server=service.app.listen(4173,'127.0.0.1');
function close(){server.close(()=>{service.close();rmSync(dataDir,{recursive:true,force:true});process.exit(0);});}
process.on('SIGTERM',close);process.on('SIGINT',close);
