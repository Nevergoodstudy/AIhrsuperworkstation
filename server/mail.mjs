import nodemailer from 'nodemailer';
import { parseConnectionUrl } from 'nodemailer/lib/shared';

export function createMailTransport(config) {
  const url = new URL(config.smtpUrl);
  if (!['smtp:', 'smtps:'].includes(url.protocol)) throw new Error('SMTP_URL 必须使用 smtp:// 或 smtps://');
  const options = parseConnectionUrl(config.smtpUrl);
  // URL query parameters cannot disable production TLS or certificate verification.
  return nodemailer.createTransport({
    host: options.host,
    port: options.port ?? (options.secure ? 465 : 587),
    secure: Boolean(options.secure),
    auth: options.auth,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    dnsTimeout: 10000,
    requireTLS: config.env === 'production',
    ignoreTLS: false,
    tls: { rejectUnauthorized: true },
    logger: false,
    debug: false
  });
}
