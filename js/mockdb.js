// テスト専用：localhost のモックサーバー（tests/mock-server.mjs）につなぐバックエンド。
// 本番（GitHub Pages）では読み込まれない。
import { ADMIN_UID } from './firebase-config.js?v=4';

const TS = { '.sv': 'timestamp' };
let snapshot = {};
let ready = null;
const listeners = new Set();

function getAt(obj, path) {
  let cur = obj;
  for (const k of String(path || '').split('/').filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}

function fire() {
  for (const l of listeners) {
    const v = getAt(snapshot, l.path);
    const s = JSON.stringify(v);
    if (s !== l.last) {
      l.last = s;
      try { l.cb(v == null ? null : JSON.parse(s)); } catch (e) { console.error(e); }
    }
  }
}

function start() {
  ready ??= new Promise(resolve => {
    const es = new EventSource('/__mock/events');
    es.onmessage = ev => { snapshot = JSON.parse(ev.data) || {}; fire(); resolve(); };
  });
  return ready;
}

export async function createMockBackend(appName) {
  await start();
  const key = 'mock-user-' + appName;
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { /* noop */ }
  const authCbs = new Set();
  const setUser = u => {
    user = u;
    try { u ? sessionStorage.setItem(key, JSON.stringify(u)) : sessionStorage.removeItem(key); } catch { /* noop */ }
    authCbs.forEach(cb => cb(u));
  };
  const post = async body => {
    const r = await fetch('/__mock/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, uid: user?.uid || null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { const e = new Error(j.error || 'mock error'); e.code = j.code || 'PERMISSION_DENIED'; throw e; }
    await new Promise(res => setTimeout(res, 15)); // SSE で新しい状態が届くのを少し待つ
  };
  return {
    mock: true,
    ADMIN_UID,
    TS,
    serverNow: () => Date.now(),
    uid: () => user?.uid || null,
    user: () => user,
    isAnonymous: () => !!user?.isAnonymous,
    onAuth(cb) { authCbs.add(cb); setTimeout(() => cb(user), 0); return () => authCbs.delete(cb); },
    async signInAnon() { setUser({ uid: 'anon_' + Math.random().toString(36).slice(2, 12), isAnonymous: true }); return { user }; },
    async signInEmail(email, pw) {
      if (pw !== 'mock') { const e = new Error('invalid'); e.code = 'auth/invalid-credential'; throw e; }
      setUser({ uid: ADMIN_UID, isAnonymous: false, email });
      return { user };
    },
    async signOut() { setUser(null); },
    watch(path, cb) {
      const l = { path, cb, last: undefined };
      listeners.add(l);
      setTimeout(() => { const v = getAt(snapshot, path); l.last = JSON.stringify(v); cb(v); }, 0);
      return () => listeners.delete(l);
    },
    async get(path) { const r = await fetch('/__mock/get?path=' + encodeURIComponent(path || '')); return (await r.json()).value ?? null; },
    set: (path, v) => post({ op: 'set', path, value: v }),
    update: obj => post({ op: 'update', value: obj }),
    remove: path => post({ op: 'set', path, value: null }),
    onDisconnectRemove() { return Promise.resolve(); },
    onConnected(cb) { cb(true); return () => {}; },
  };
}
