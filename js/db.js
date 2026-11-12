// Firebase との接続をまとめたアダプター。
// ?mock を付けて localhost で開いたときだけ、テスト用のモックサーバーにつなぐ（本番には影響しない）。
import { firebaseConfig, ADMIN_UID, SDK_VERSION } from './firebase-config.js?v=4';

export function isMockMode() {
  const p = new URLSearchParams(location.search);
  return p.has('mock') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
}

let sdkPromise = null;
function loadSdk() {
  const base = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
  sdkPromise ??= Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-database.js'),
  ]);
  return sdkPromise;
}

/**
 * appName ごとに独立したログイン状態を持つ（管理者と参加者を同じブラウザで開いても混ざらない）。
 */
export async function createBackend(appName) {
  if (isMockMode()) {
    const m = await import( './mockdb.js?v=4');
    return m.createMockBackend(appName);
  }
  const [appM, authM, dbM] = await loadSdk();
  const app = appM.getApps().find(a => a.name === appName) || appM.initializeApp(firebaseConfig, appName);
  const auth = authM.getAuth(app);
  const db = dbM.getDatabase(app);
  let offset = 0;
  let connected = false;
  const connCbs = new Set();
  dbM.onValue(dbM.ref(db, '.info/serverTimeOffset'), s => { offset = Number(s.val()) || 0; });
  dbM.onValue(dbM.ref(db, '.info/connected'), s => {
    connected = !!s.val();
    connCbs.forEach(cb => cb(connected));
  });
  const r = path => (path ? dbM.ref(db, path) : dbM.ref(db));
  return {
    mock: false,
    ADMIN_UID,
    TS: dbM.serverTimestamp(),
    serverNow: () => Date.now() + offset,
    uid: () => auth.currentUser?.uid || null,
    user: () => auth.currentUser,
    isAnonymous: () => !!auth.currentUser?.isAnonymous,
    onAuth: cb => authM.onAuthStateChanged(auth, cb),
    signInAnon: () => authM.signInAnonymously(auth),
    signInEmail: (email, pw) => authM.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => authM.signOut(auth),
    watch(path, cb, onErr) {
      return dbM.onValue(r(path), s => cb(s.val()), e => { console.warn('[watch]', path, e?.code || e); onErr?.(e); });
    },
    get: async path => (await dbM.get(r(path))).val(),
    set: (path, v) => dbM.set(r(path), v),
    update: obj => dbM.update(r(''), obj),
    remove: path => dbM.remove(r(path)),
    onDisconnectRemove: path => dbM.onDisconnect(r(path)).remove(),
    onConnected(cb) { connCbs.add(cb); cb(connected); return () => connCbs.delete(cb); },
  };
}

export function errMsg(e) {
  const code = e?.code || '';
  if (/PERMISSION_DENIED|permission/i.test(code + (e?.message || ''))) return '権限がないか、受付時間外のため保存できませんでした';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') return 'メールアドレスまたはパスワードが違います';
  if (code === 'auth/too-many-requests') return '試行回数が多すぎます。少し待ってから再度お試しください';
  if (code === 'auth/operation-not-allowed') return 'Firebase でこのログイン方式が有効になっていません';
  if (code === 'auth/network-request-failed') return '通信できませんでした。電波の良い場所で再度お試しください';
  return e?.message || String(e);
}
