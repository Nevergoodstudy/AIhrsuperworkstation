import { randomBytes, createHash, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const token = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) { const salt = randomBytes(16).toString('hex'); const key = await derive(password, salt, 64); return salt + ':' + key.toString('hex'); }
export async function verifyPassword(password, stored) { const [salt, hash] = stored.split(':'); const key = await derive(password, salt, 64); const expected = Buffer.from(hash, 'hex'); return key.length === expected.length && timingSafeEqual(key, expected); }
export function cookieValue(req, name) { const item = (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '=')); return item?.slice(name.length + 1) ?? ''; }
export function setCookie(res, config, name, value, maxAge, path = '/') { res.cookie(name, value, { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path, maxAge }); }
export function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, active: Boolean(user.active), mustChange: Boolean(user.must_change) }; }
export function audit(db, actor, action, resource) { db.prepare('INSERT INTO audit(actor_id,action,resource_id,created_at) VALUES(?,?,?,?)').run(actor, action, resource, now()); }
export function fail(status, message) { return Object.assign(new Error(message), { status }); }
export function limit(db, key, maximum, windowMs) {
  const time = Date.now(); db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(time);
  const row = db.prepare('SELECT * FROM rate_limits WHERE key=?').get(key);
  if (row && row.hits >= maximum) throw fail(429, '请求过于频繁，请稍后重试');
  db.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1').run(key, time + windowMs);
}
export function redact(text) { return text.replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[邮箱已隐藏]').replace(/(?:\+?86[- ]?)?1[3-9]\d{9}|(?:\+?\d[\d\s()-]{7,}\d)/g, '[电话已隐藏]'); }
