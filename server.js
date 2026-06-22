/* =========================================================
   Tiny Planet Messenger — multiplayer + static file server
   Zero dependencies. Pure Node.js built-ins only.
   Run:   node server.js
   Open:  http://localhost:8080
   ========================================================= */
'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon'
};

/* ---------------- Static file server ---------------- */
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------------- Minimal WebSocket (RFC 6455) ---------------- */
const clients = new Map();   // id -> { socket, state }
let nextId = 1;
const builds = [];           // store placed objects

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  onConnect(socket);
});

function onConnect(socket) {
  const id = nextId++;
  const client = { id, socket, state: null, buf: Buffer.alloc(0), alive: true };
  clients.set(id, client);

  // tell the new client its id + current roster
  send(socket, { t: 'welcome', id });
  const others = [];
  for (const [oid, c] of clients) if (oid !== id && c.state) others.push({ id: oid, ...c.state });
  send(socket, { t: 'roster', players: others });
  if (builds.length > 0) send(socket, { t: 'syncBuilds', builds });
  broadcastCount();

  socket.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk]);
    let frame;
    while ((frame = decodeFrame(client.buf))) {
      client.buf = frame.rest;
      if (frame.opcode === 0x8) { close(client); return; }        // close
      if (frame.opcode === 0x9) { socket.write(encodeFrame(frame.payload, 0xA)); continue; } // ping->pong
      if (frame.opcode === 0x1) handleMessage(client, frame.payload.toString('utf8'));
    }
  });
  socket.on('close', () => close(client));
  socket.on('error', () => close(client));
}

function handleMessage(client, raw) {
  let msg; try { msg = JSON.parse(raw); } catch { return; }
  if (msg.t === 'state') {
    client.state = {
      name: String(msg.name || 'Friend').slice(0, 12),
      body: msg.body, hat: msg.hat,
      dx: msg.dx, dy: msg.dy, dz: msg.dz,     // position direction (unit)
      fx: msg.fx, fy: msg.fy, fz: msg.fz,     // forward
      moving: !!msg.moving, carry: !!msg.carry
    };
    relay({ t: 'move', id: client.id, ...client.state });
  } else if (msg.t === 'emote') {
    relay({ t: 'emote', id: client.id, e: String(msg.e || '👋').slice(0, 4) });
  } else if (msg.t === 'delivery') {
    // celebrate a kindness for everyone
    broadcast({ t: 'delivery', id: client.id, name: client.state ? client.state.name : 'Someone' });
  } else if (msg.t === 'build') {
    const buildMsg = { t: 'build', id: client.id, type: msg.type, dx: msg.dx, dy: msg.dy, dz: msg.dz, ry: msg.ry };
    builds.push(buildMsg);
    broadcast(buildMsg);
  } else if (msg.t === 'chat') {
    relay({ t: 'chat', id: client.id, msg: String(msg.msg).slice(0, 50) });
  }
}

function close(client) {
  if (!clients.has(client.id)) return;
  clients.delete(client.id);
  try { client.socket.destroy(); } catch {}
  broadcast({ t: 'leave', id: client.id });
  broadcastCount();
}

/* broadcast helpers */
function relay(obj) { const s = JSON.stringify(obj); for (const [id, c] of clients) if (id !== obj.id) raw(c.socket, s); }
function broadcast(obj) { const s = JSON.stringify(obj); for (const [, c] of clients) raw(c.socket, s); }
function broadcastCount() { broadcast({ t: 'count', n: clients.size }); }
function send(socket, obj) { raw(socket, JSON.stringify(obj)); }
function raw(socket, str) { try { socket.write(encodeFrame(Buffer.from(str, 'utf8'), 0x1)); } catch {} }

/* ---------------- Frame codec ---------------- */
function encodeFrame(payload, opcode) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  let mask;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.slice(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  let payload = buf.slice(off, off + len);
  if (masked) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
  return { opcode, payload, rest: buf.slice(off + len) };
}

server.listen(PORT, () => {
  console.log('🌍 Tiny Planet Messenger running:');
  console.log('   Local:   http://localhost:' + PORT);
  console.log('   Open it in two browser tabs to see real multiplayer!');
});
