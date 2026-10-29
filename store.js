/* global supabase */
// Where the data lives: the shared Supabase database when configured, otherwise this browser (IndexedDB).
const Store = (() => {
  const cfg = window.CRM_CONFIG || {};
  const url = cfg.supabaseUrl || localStorage.getItem('crm.supabaseUrl') || '';
  const anonKey = cfg.supabaseAnonKey || localStorage.getItem('crm.supabaseAnonKey') || '';
  const domain = (cfg.allowedEmailDomain || '33equity.eu').toLowerCase();
  let sb = null, user = null;
  const mode = url && anonKey && window.supabase ? 'cloud' : 'local';

  // ---------- Browser storage ----------
  const idb = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('mna-crm', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res((this._db = r.result));
        r.onerror = () => rej(r.error);
      });
    },
    async get(k, fallback) {
      const db = await this.open();
      return new Promise(res => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result ?? fallback);
        q.onerror = () => res(fallback);
      });
    },
    async set(k, v) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    },
  };

  // Runtime-only fields are rebuilt on load.
  const strip = c => { const { _norm, _domain, ...rest } = c; return rest; };
  const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const check = ({ error }) => { if (error) throw new Error(error.message); };

  async function init() {
    if (mode !== 'cloud') return { mode, user: null };
    sb = supabase.createClient(url, anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
    const { data } = await sb.auth.getSession();
    user = data.session?.user || null;
    sb.auth.onAuthStateChange((_e, s) => { user = s?.user || null; });
    return { mode, user };
  }

  async function sendLoginLink(email) {
    email = email.trim().toLowerCase();
    if (!email.endsWith('@' + domain)) throw new Error(`Use your @${domain} email address.`);
    check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
  }
  async function signOut() { if (sb) await sb.auth.signOut(); user = null; }

  async function loadCompanies() {
    if (mode === 'local') return idb.get('companies', []);
    const out = [];
    for (let from = 0; ; from += 1000) {
      const res = await sb.from('companies').select('id,data').order('id').range(from, from + 999);
      check(res);
      out.push(...res.data.map(r => ({ ...r.data, id: r.id })));
      if (res.data.length < 1000) break;
    }
    return out;
  }

  // `changed` is what to write to the cloud; `all` is the full list for browser storage.
  async function saveCompanies(changed, all) {
    if (mode === 'local') return idb.set('companies', all.map(strip));
    const now = new Date().toISOString();
    for (const part of chunks(changed, 300)) {
      check(await sb.from('companies').upsert(part.map(c => ({ id: c.id, data: strip(c), updated_at: now, updated_by: user?.email || null }))));
    }
  }

  async function deleteCompanies(ids, all) {
    if (mode === 'local') return idb.set('companies', all.map(strip));
    for (const part of chunks(ids, 200)) check(await sb.from('companies').delete().in('id', part));
  }

  async function loadActivity() {
    if (mode === 'local') return idb.get('activity', []);
    const res = await sb.from('activity').select('data').order('created_at', { ascending: false }).limit(5000);
    check(res);
    return res.data.map(r => r.data);
  }
  async function addActivity(entries, all) {
    if (mode === 'local') return idb.set('activity', all);
    check(await sb.from('activity').insert(entries.map(e => ({ id: e.id, data: e }))));
  }

  async function getState(key, fallback) {
    if (mode === 'local') return idb.get(key, fallback);
    const res = await sb.from('app_state').select('data').eq('key', key).maybeSingle();
    check(res);
    return res.data ? res.data.data : fallback;
  }
  async function setState(key, value) {
    if (mode === 'local') return idb.set(key, value);
    check(await sb.from('app_state').upsert({ key, data: value, updated_at: new Date().toISOString() }));
  }

  // Data that was kept in this browser before the team database was connected.
  const localCompanies = () => idb.get('companies', []);

  return {
    mode, domain, init, sendLoginLink, signOut, loadCompanies, saveCompanies, deleteCompanies, loadActivity, addActivity, getState, setState, localCompanies,
    get user() { return user; },
    get configured() { return !!(url && anonKey); },
  };
})();
