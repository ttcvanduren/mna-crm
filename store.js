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
  // Version 2: companies are stored one record per company (store "companies"), so saving one change writes
  // one record instead of the whole database. Version 1 kept them as one big array under kv "companies".
  const idb = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('mna-crm', 2);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('companies')) db.createObjectStore('companies', { keyPath: 'id' });
        };
        r.onsuccess = () => res((this._db = r.result));
        r.onerror = () => rej(r.error);
      });
    },
    async all(store) {
      const db = await this.open();
      return new Promise((res, rej) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
    },
    // Writes and deletes in one transaction.
    async write(store, puts = [], dels = []) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
        puts.forEach(v => os.put(v));
        dels.forEach(k => os.delete(k));
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    },
    async del(k) {
      const db = await this.open();
      return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
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
  // Token for calling the team's Supabase Edge Functions (e.g. the Apollo proxy).
  async function accessToken() {
    if (!sb) return anonKey || '';
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || anonKey;
  }
  async function signOut() { if (sb) await sb.auth.signOut(); user = null; }

  // Browser storage: one record per company. Data saved by the old version (one big array) is moved over once.
  async function localLoad() {
    const list = await idb.all('companies');
    if (list.length) return list;
    const old = await idb.get('companies', []);
    if (old.length) { await idb.write('companies', old); await idb.del('companies'); }
    return old;
  }

  async function loadCompanies() {
    if (mode === 'local') return localLoad();
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
  // Cloud: batches of at most 100 companies and ~1.5 MB, because large records (long deal lists, research texts) can hit
  // Supabase's request-size or time limit. A failing batch is split in halves and retried; companies that still fail are
  // reported in err.failed so only those are retried later. onProgress(done, total) reports progress for big uploads.
  async function saveCompanies(changed, all, onProgress) {
    if (mode === 'local') return idb.write('companies', changed.map(strip));
    const now = new Date().toISOString();
    const rows = changed.map(c => ({ id: c.id, data: strip(c), updated_at: now, updated_by: user?.email || null }));
    const batches = [];
    let cur = [], size = 0;
    for (const r of rows) {
      const n = JSON.stringify(r.data).length;
      if (cur.length && (cur.length >= 100 || size + n > 1_500_000)) { batches.push(cur); cur = []; size = 0; }
      cur.push(r); size += n;
    }
    if (cur.length) batches.push(cur);
    let done = 0, lastError = '';
    const failed = [];
    const send = async b => {
      const { error } = await sb.from('companies').upsert(b);
      if (!error) { done += b.length; onProgress?.(done, rows.length); return; }
      if (b.length > 1) { const h = Math.ceil(b.length / 2); await send(b.slice(0, h)); await send(b.slice(h)); return; }
      failed.push(b[0].id); lastError = error.message;
    };
    for (const b of batches) await send(b);
    if (failed.length) { const err = new Error(`${failed.length} of ${rows.length} companies could not be saved (${lastError})`); err.failed = failed; throw err; }
  }

  async function deleteCompanies(ids, all) {
    if (mode === 'local') return idb.write('companies', [], ids);
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
  const localCompanies = () => localLoad();

  return {
    mode, domain, init, sendLoginLink, signOut, accessToken, loadCompanies, saveCompanies, deleteCompanies, loadActivity, addActivity, getState, setState, localCompanies,
    get user() { return user; },
    get configured() { return !!(url && anonKey); },
  };
})();
