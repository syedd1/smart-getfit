// Entry point: starts the server. Point hosting platforms (and `npm start`) at THIS
// file. It starts unconditionally, however the platform launches it (directly, or
// through its own wrapper that imports the file), which a "run only when this is the
// main module" check cannot guarantee.
//
// It also starts LISTENING immediately (using only Node's built-in http module), then
// loads the rest of the app and swaps it in. Some hosts give an app only a few seconds
// to open its port; loading Express, Sharp and the page templates can take longer on a
// slow shared server. Until the site is ready, requests get a short "starting" 503.
import http from 'node:http';

const host = process.env.HOST?.trim() || '127.0.0.1';
const port = Number(process.env.PORT?.trim() || 3000);

let handler = (req, res) => {
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3', 'Cache-Control': 'no-store' });
  res.end('The site is starting. Please try again in a few seconds.\n');
};
const server = http.createServer((req, res) => handler(req, res));

server.on('error', (err) => {
  console.error(JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'server error', code: err.code, message: err.message }));
  process.exit(1);
});

server.listen(port, host, async () => {
  try {
    const { start } = await import('./index.js');
    await start({ early: { server, mount: (app) => { handler = app; } } });
  } catch (err) {
    console.error(JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'failed to start', message: err.message }));
    process.exit(1);
  }
});
