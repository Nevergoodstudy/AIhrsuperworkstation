import { createInterface } from 'node:readline/promises';
import { getConfig } from './config.mjs';
import { openDatabase, transaction } from './db.mjs';
import { id, now, hashPassword, audit } from './security.mjs';
const mode = process.argv[2];
if (!['create', 'reset'].includes(mode) || !process.stdin.isTTY) { console.error('请在交互式终端执行 npm run admin:create 或 npm run admin:reset。密码输入不会回显。'); process.exit(1); }
const input = createInterface({ input: process.stdin, output: process.stdout });
async function secret(prompt) {
  process.stdout.write(prompt);
  const stdin = process.stdin; stdin.setRawMode(true); stdin.resume();
  try { return await new Promise((resolve, reject) => { let value = ''; const listener = chunk => { for (const char of chunk.toString()) { if (char === '\u0003') { stdin.off('data', listener); reject(new Error('已取消')); return; } if (char === '\r' || char === '\n') { stdin.off('data', listener); resolve(value); return; } if (char === '\u007f') value = value.slice(0, -1); else if (char >= ' ') value += char; } }; stdin.on('data', listener); }); }
  finally { stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); }
}
let db;
try {
  const email = (await input.question('管理员邮箱：')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('邮箱格式不正确');
  const name = mode === 'create' ? (await input.question('姓名：')).trim() : '';
  if (mode === 'create' && (!name || name.length > 100)) throw new Error('姓名不能为空，最长 100 字');
  input.close();
  const password = await secret('临时密码（12–128 位）：');
  const confirm = await secret('再次输入：');
  if (password.length < 12 || password.length > 128 || password !== confirm) throw new Error('密码长度不符或两次输入不一致');
  const config = getConfig(); db = openDatabase(config.dataDir);
  const hash = await hashPassword(password);
  transaction(db, () => {
    const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (mode === 'create') {
      if (existing) throw new Error('邮箱已存在，可使用 admin:reset');
      const key = id(); db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,created_at) VALUES(?,?,?,?,?,?,?)').run(key,name,email,hash,'admin','',now()); audit(db,'cli','admin.create',key);
    } else {
      if (!existing || existing.role !== 'admin') throw new Error('管理员不存在');
      db.prepare('UPDATE users SET password_hash=?,must_change=1,active=1 WHERE id=?').run(hash,existing.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id); audit(db,'cli','admin.reset',existing.id);
    }
  });
  console.log('管理员已' + (mode === 'create' ? '创建' : '重置') + '。首次登录必须修改临时密码。');
} catch (error) { console.error(error.message); process.exitCode=1; } finally { input.close(); db?.close(); }
