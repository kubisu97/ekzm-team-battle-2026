// Firebase Web アプリの公開設定（秘密鍵ではありません。アクセス制御は database.rules.json で行います）
export const firebaseConfig = {
  apiKey: 'AIzaSyDBDUXL_28_ONiCitFOcYKJ5DocDVLdaFA',
  authDomain: 'ekzam-team-battle-2026.firebaseapp.com',
  databaseURL: 'https://ekzam-team-battle-2026-default-rtdb.firebaseio.com',
  projectId: 'ekzam-team-battle-2026',
  storageBucket: 'ekzam-team-battle-2026.firebasestorage.app',
  messagingSenderId: '1076057894320',
  appId: '1:1076057894320:web:6b40a2f6884b1b5dc0ba75',
};

// 管理者（司会者）の Firebase Authentication UID。database.rules.json と必ず同じ値にする。
export const ADMIN_UID = 'uBDBPDOsN9OphJoSg1KHAIXonSA2';

export const SDK_VERSION = '12.19.0';
