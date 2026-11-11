// ローカル試験用モックサーバー
//  - リポジトリ直下の静的ファイルを配信（node tests/mock-server.mjs . 8080）
//  - /__mock/events (SSE) で DB 全体を配信、/__mock/write で書き込み
//  - 書き込みは database.rules.json を簡易評価して、本番と同じ考え方で許可/拒否する
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateWrite } from './rules-engine.mjs';

const ROOT = path.resolve(process.argv[2] || '.');
const PORT = Number(process.argv[3] || 8080);
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')).rules;
const ADMIN_UID = 'uBDBPDOsN9OphJoSg1KHAIXonSA2';

let db = {};
const clients = new Set();
export const log = [];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function getAt(obj, p) {
  let cur = obj;
  for (const k of String(p || '').split('/').filter(Boolean)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}

function broadcast() {
  const msg = `data: ${JSON.stringify(db)}\n\n`;
  for (const c of clients) c.write(msg);
}

function body(req) {
  return new Promise(res => { let s = ''; req.on('data', d => (s += d)); req.on('end', () => res(s)); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__mock/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(db)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/__mock/get') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ value: getAt(db, url.searchParams.get('path')) }));
    return;
  }
  if (url.pathname === '/__mock/log') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(log));
    return;
  }
  if (url.pathname === '/__mock/reset' && req.method === 'POST') {
    db = {}; log.length = 0; broadcast();
    res.writeHead(200); res.end('{}');
    return;
  }
  if (url.pathname === '/__mock/write' && req.method === 'POST') {
    const b = JSON.parse(await body(req));
    const auth = b.uid ? { uid: b.uid, token: { firebase: { sign_in_provider: b.uid === ADMIN_UID ? 'password' : 'anonymous' } } } : null;
    const updates = b.op === 'update' ? b.value : { [b.path || '']: b.value };
    const r = evaluateWrite(RULES, db, updates, auth, Date.now());
    log.push({ t: Date.now(), uid: b.uid, op: b.op, paths: Object.keys(updates), ok: r.ok, reason: r.reason });
    if (!r.ok) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'PERMISSION_DENIED: ' + r.reason, code: 'PERMISSION_DENIED' }));
      return;
    }
    db = r.newRoot;
    broadcast();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  // static
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`mock server http://localhost:${PORT} root=${ROOT}`));
