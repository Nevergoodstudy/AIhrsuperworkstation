import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createMailTransport } from '../server/mail.mjs';

async function plaintextSMTP(t) {
  const commands = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); socket.setEncoding('utf8');
    socket.write('220 localhost SMTP regression fixture\r\n');
    let pending = '', inData = false;
    socket.on('data', chunk => {
      pending += chunk;
      while (pending.includes('\r\n')) {
        const end = pending.indexOf('\r\n'), line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 accepted locally\r\n'); }
          continue;
        }
        commands.push(line);
        if (/^EHLO|^HELO/.test(line)) socket.write('250-localhost\r\n250 SIZE 1048576\r\n');
        else if (/^STARTTLS/.test(line)) socket.write('502 TLS is unavailable on this fixture\r\n');
        else if (/^DATA/.test(line)) { inData = true; socket.write('354 End with a dot\r\n'); }
        else if (/^QUIT/.test(line)) socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { commands, url: 'smtp://127.0.0.1:' + server.address().port };
}
const message = { from: 'hr@example.test', to: 'candidate@example.test', subject: 'Local SMTP regression', text: 'Local fixture only' };

test('生产邮件在不支持 TLS 时停止，不向明文服务传输邀请或收件人', { timeout: 5000 }, async t => {
  const smtp = await plaintextSMTP(t);
  const transport = createMailTransport({ env: 'production', smtpUrl: smtp.url + '?requireTLS=false&ignoreTLS=true&tls.rejectUnauthorized=false' });
  t.after(() => transport.close());
  await assert.rejects(transport.sendMail(message));
  assert.ok(smtp.commands.some(line => line === 'STARTTLS'));
  assert.equal(smtp.commands.some(line => /^(MAIL FROM|RCPT TO|DATA|AUTH)/.test(line)), false);
});

test('本地测试邮件使用真实 SMTP 会话确认服务接受状态', { timeout: 5000 }, async t => {
  const smtp = await plaintextSMTP(t);
  const transport = createMailTransport({ env: 'test', smtpUrl: smtp.url });
  t.after(() => transport.close());
  const info = await transport.sendMail(message);
  assert.deepEqual(info.accepted, ['candidate@example.test']);
  assert.deepEqual(info.rejected, []);
  assert.ok(smtp.commands.some(line => line.startsWith('MAIL FROM:')));
  assert.ok(smtp.commands.some(line => line === 'DATA'));
});
