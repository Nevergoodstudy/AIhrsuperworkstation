import 'dotenv/config';
import path from 'node:path';
export function getConfig(overrides = {}) {
  const env = overrides.env ?? process.env.NODE_ENV ?? 'development';
  const appUrl = overrides.appUrl ?? process.env.APP_URL ?? 'http://localhost:5173';
  const url = new URL(appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('APP_URL 必须是应用公开访问的根地址');
  if (env === 'production' && url.protocol !== 'https:') throw new Error('生产环境 APP_URL 必须使用 HTTPS');
  return { env, port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1', dataDir: path.resolve(process.env.DATA_DIR ?? './data'), appUrl: url.origin, secureCookies: url.protocol === 'https:', trustProxy: process.env.TRUST_PROXY === '1', company: process.env.COMPANY_NAME ?? '企业招聘工作区', aiBaseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1', aiKey: process.env.AI_API_KEY ?? '', aiModel: process.env.AI_MODEL ?? '', smtpUrl: process.env.SMTP_URL ?? '', mailFrom: process.env.MAIL_FROM ?? '', ...overrides };
}
