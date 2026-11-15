import { createApp } from './app.mjs';
process.umask(0o077);
const service = createApp();
const timer = setInterval(service.sweep, 10000); timer.unref();
const server = service.app.listen(service.config.port, service.config.host, () => console.log('Talent Desk listening on ' + service.config.host + ':' + server.address().port));
server.requestTimeout = 60000; server.headersTimeout = 20000;
function stop() { clearInterval(timer); server.close(() => { service.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
process.once('SIGTERM', stop); process.once('SIGINT', stop);
