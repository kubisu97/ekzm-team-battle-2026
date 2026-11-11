// Firebase Realtime Database セキュリティルールの簡易評価器（試験用）
// 対応：.write の継承、.validate（対象・祖先・子孫）、$ワイルドカード、auth/root/data/newData/now、
//       RuleDataSnapshot の child/parent/val/exists/hasChild/hasChildren/isString/isNumber/isBoolean、String.matches
/* eslint-disable no-extend-native */
if (!String.prototype.matches) {
  Object.defineProperty(String.prototype, 'matches', { value(re) { return re.test(String(this)); } });
}

const split = p => String(p || '').split('/').filter(Boolean);
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

function getAt(obj, parts) {
  let cur = obj;
  for (const k of parts) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}

function resolveTS(v, now) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    const out = Array.isArray(v) ? {} : {};
    for (const [k, x] of Object.entries(v)) { const r = resolveTS(x, now); if (r !== null && r !== undefined) out[k] = r; }
    return Object.keys(out).length ? out : null;
  }
  return v === undefined ? null : v;
}

function setAt(root, parts, value) {
  if (!parts.length) return value ?? {};
  let cur = root;
  const stack = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    stack.push([cur, k]);
    cur = cur[k];
  }
  const last = parts[parts.length - 1];
  if (value === null) delete cur[last]; else cur[last] = value;
  // 空になった親を刈り込む
  for (let i = stack.length - 1; i >= 0; i--) {
    const [o, k] = stack[i];
    if (o[k] && typeof o[k] === 'object' && !Object.keys(o[k]).length) delete o[k]; else break;
  }
  return root;
}

class Snap {
  constructor(rootObj, parts) { this.r = rootObj; this.p = parts; }
  val() { const v = getAt(this.r, this.p); return v && typeof v === 'object' ? { __object: true } : v; }
  child(x) {
    if (typeof x !== 'string' && typeof x !== 'number') throw new Error('child() requires a string');
    return new Snap(this.r, [...this.p, ...split(String(x))]);
  }
  parent() { if (!this.p.length) throw new Error('no parent'); return new Snap(this.r, this.p.slice(0, -1)); }
  exists() { return getAt(this.r, this.p) !== null; }
  hasChild(x) { return this.child(x).exists(); }
  hasChildren(list) {
    const v = getAt(this.r, this.p);
    if (!v || typeof v !== 'object') return false;
    if (!list) return Object.keys(v).length > 0;
    return list.every(k => this.child(k).exists());
  }
  isString() { return typeof getAt(this.r, this.p) === 'string'; }
  isNumber() { return typeof getAt(this.r, this.p) === 'number'; }
  isBoolean() { return typeof getAt(this.r, this.p) === 'boolean'; }
}

const cache = new Map();
function evalRule(expr, ctx, vars) {
  if (typeof expr === 'boolean') return expr;
  const names = Object.keys(vars);
  const key = expr + '|' + names.join(',');
  let fn = cache.get(key);
  if (!fn) { fn = new Function('auth', 'root', 'data', 'newData', 'now', ...names, `return (${expr});`); cache.set(key, fn); }
  try { return fn(ctx.auth, ctx.root, ctx.data, ctx.newData, ctx.now, ...names.map(n => vars[n])) === true; }
  catch { return false; }
}

function walk(rules, parts) {
  const out = [];
  let node = rules;
  const vars = {};
  for (let d = 0; d <= parts.length; d++) {
    out.push({ node, d, vars: { ...vars } });
    if (d === parts.length) break;
    const k = parts[d];
    if (!node) continue;
    if (node[k] && typeof node[k] === 'object') node = node[k];
    else {
      const wk = Object.keys(node).find(x => x.startsWith('$'));
      if (wk) { vars[wk] = k; node = node[wk]; } else node = null;
    }
  }
  return out;
}

function childRule(node, k, vars) {
  if (!node) return [null, vars];
  if (node[k] && typeof node[k] === 'object') return [node[k], vars];
  const wk = Object.keys(node).find(x => x.startsWith('$'));
  if (wk) return [node[wk], { ...vars, [wk]: k }];
  return [null, vars];
}

export function evaluateWrite(rules, oldRoot, updates, auth, now = Date.now()) {
  const newRoot = clone(oldRoot) || {};
  let nr = newRoot;
  const entries = Object.entries(updates).map(([p, v]) => [split(p), resolveTS(clone(v), now)]);
  for (const [parts, v] of entries) nr = setAt(nr, parts, v);
  const ctxFor = parts => ({ auth, now, root: new Snap(oldRoot, []), data: new Snap(oldRoot, parts), newData: new Snap(nr, parts) });

  for (const [parts] of entries) {
    const chain = walk(rules, parts);
    let granted = false;
    for (const c of chain) {
      if (c.node && c.node['.write'] !== undefined && evalRule(c.node['.write'], ctxFor(parts.slice(0, c.d)), c.vars)) { granted = true; break; }
    }
    if (!granted) return { ok: false, reason: 'write denied: /' + parts.join('/') };
    for (const c of chain) {
      const p = parts.slice(0, c.d);
      if (c.node && c.node['.validate'] !== undefined && getAt(nr, p) !== null) {
        if (!evalRule(c.node['.validate'], ctxFor(p), c.vars)) return { ok: false, reason: 'validate failed: /' + p.join('/') };
      }
    }
    const last = chain[chain.length - 1];
    const bad = validateTree(last.node, parts, last.vars);
    if (bad) return { ok: false, reason: 'validate failed: /' + bad.join('/') };
  }
  return { ok: true, newRoot: nr };

  function validateTree(node, p, vars) {
    const v = getAt(nr, p);
    if (!node || !v || typeof v !== 'object') return null;
    for (const k of Object.keys(v)) {
      const [cn, cv] = childRule(node, k, vars);
      const cp = [...p, k];
      if (cn && cn['.validate'] !== undefined && v[k] !== null) {
        if (!evalRule(cn['.validate'], ctxFor(cp), cv)) return cp;
      }
      const deep = validateTree(cn, cp, cv);
      if (deep) return deep;
    }
    return null;
  }
}

export function evaluateRead(rules, root, path, auth, now = Date.now()) {
  const parts = split(path);
  for (const c of walk(rules, parts)) {
    if (c.node && c.node['.read'] !== undefined) {
      const p = parts.slice(0, c.d);
      if (evalRule(c.node['.read'], { auth, now, root: new Snap(root, []), data: new Snap(root, p), newData: new Snap(root, p) }, c.vars)) return true;
    }
  }
  return false;
}
