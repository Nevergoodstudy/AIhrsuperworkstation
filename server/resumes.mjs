import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fail, now } from './security.mjs';
let running = 0;
export async function extractResume(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!['.pdf', '.docx', '.txt'].includes(ext)) throw fail(400, '仅支持 PDF、DOCX、UTF-8 TXT');
  if (buffer.length > 10 * 1024 * 1024 || !buffer.length) throw fail(400, '文件必须为 1 字节至 10 MB');
  if (running >= 2) throw fail(429, '正在解析其他简历，请稍后重试');
  running++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./resume-worker.mjs', import.meta.url), { workerData: { buffer, ext }, resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 } });
      let settled = false;
      const timeout = setTimeout(() => finish(fail(422, '简历解析超时，请转换为文本后重试')), 25000);
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); worker.terminate(); error ? reject(error) : resolve(value); };
      worker.once('message', result => result.error ? finish(fail(422, result.error)) : finish(null, result.text));
      worker.once('error', () => finish(fail(422, '简历解析失败，请检查文件或转换为文本')));
      worker.once('exit', () => { if (!settled) finish(fail(422, '解析进程提前结束，请转换为文本')); });
    });
  } finally { running--; }
}
export function ruleAnalysis(text, requirements) {
  const lines = text.split(/\n/).map(s => s.trim()).filter(Boolean);
  const evidence = requirements.map(requirement => {
    const quote = lines.find(line => line.toLocaleLowerCase().includes(requirement.toLocaleLowerCase()));
    const at = quote?.toLocaleLowerCase().indexOf(requirement.toLocaleLowerCase()) ?? 0; return { requirement, quote: quote ? quote.slice(Math.max(0, at - 250), at + requirement.length + 250) : '', matched: Boolean(quote) };
  });
  const matched = evidence.filter(item => item.matched).length;
  return { method: 'keyword', label: '岗位关键词覆盖（仅辅助筛选）', score: requirements.length ? Math.round(matched / requirements.length * 100) : null, evidence, summary: requirements.length ? '按岗位填写的完整关键词逐项查找；未命中不代表不具备能力，请人工核实。' : '该岗位尚未填写匹配关键词，无法计算覆盖率。', analyzedAt: now() };
}
export function contactHints(text) {
  return { email: text.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? '', phone: text.match(/(?:\+?86[- ]?)?1[3-9]\d{9}/)?.[0] ?? '' };
}
