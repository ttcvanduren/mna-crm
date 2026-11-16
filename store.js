/* global supabase */
// Where the data lives: the shared Supabase database when configured, otherwise this browser (IndexedDB).
const Store = (() => {
  const cfg = window.CRM_CONFIG || {};
  const url = cfg.supabaseUrl || localStorage.getItem('crm.supabaseUrl') || '';
  const anonKey = cfg.supabaseAnonKey || localStorage.getItem('crm.supabaseAnonKey') || '';
  const domain = (cfg.allowedEmailDomain || '33equity.eu').toLowerCase();
  let sb = null, user = null;
  // Testing: localStorage 'crm.forceLocal' = '1' keeps a browser on its own IndexedDB even when config.js has the team keys.
  const forceLocal = (() => { try { return localStorage.getItem('crm.forceLocal') === '1'; } catch { return false; } })();
  const mode = url && anonKey && window.supabase && !forceLocal ? 'cloud' : 'local';

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
  async function signOut() { if (sb) await sb.auth.signOut(); user = null; await cache.clear().catch(() => {}); }

  // Browser storage: one record per company. Data saved by the old version (one big array) is moved over once.
  async function localLoad() {
    const list = await idb.all('companies');
    if (list.length) return list;
    const old = await idb.get('companies', []);
    if (old.length) { await idb.write('companies', old); await idb.del('companies'); }
    return old;
  }

  // ---------- Team database: local copy + sync of changes ----------
  // Loading every company from Supabase on each visit (28k+ companies, ~150 MB) is slow. The browser keeps a copy
  // (IndexedDB 'mna-crm-cache': store 'companies' + kv 'stamps' = { id: updated_at }). On load it fetches only
  // id + updated_at for all rows (~1.5 MB), then the full rows that are new or changed, and drops deleted ones.
  // Comparing stamps per row (not "changed since") is robust to clock differences between team members' PCs.
  const cache = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('mna-crm-cache', 1);
        r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('companies', { keyPath: 'id' }); db.createObjectStore('kv'); };
        r.onsuccess = () => res((this._db = r.result));
        r.onerror = () => rej(r.error);
      });
    },
    async all() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction('companies').objectStore('companies').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
    async write(puts = [], dels = []) {
      const db = await this.open();
      return new Promise((res, rej) => { const tx = db.transaction('companies', 'readwrite'), os = tx.objectStore('companies'); puts.forEach(v => os.put(v)); dels.forEach(k => os.delete(k)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },
    async get(k, fallback) { const db = await this.open(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? fallback); q.onerror = () => res(fallback); }); },
    async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
    async clear() { const db = await this.open(); return new Promise(res => { const tx = db.transaction(['companies', 'kv'], 'readwrite'); tx.objectStore('companies').clear(); tx.objectStore('kv').clear(); tx.oncomplete = res; tx.onerror = res; }); },
  };
  const sameStamp = (a, b) => !!a && !!b && Date.parse(a) === Date.parse(b);
  // Runs async jobs with at most n in flight.
  async function pool(jobs, n = 6) { const out = new Array(jobs.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); } })); return out; }
  const PAGE = 1000;
  // Source of rows: the Supabase table (kept separate so the sync logic can be tested with a fake source).
  const cloudSource = () => ({
    async count() { const res = await sb.from('companies').select('id', { count: 'exact', head: true }); check(res); return res.count || 0; },
    async stamps(n) { const pages = await pool(Array.from({ length: Math.ceil(n / PAGE) + 1 }, (_, p) => async () => { const res = await sb.from('companies').select('id,updated_at').order('id').range(p * PAGE, p * PAGE + PAGE - 1); check(res); return res.data; })); return pages.flat(); },
    async rows(ids) { const parts = await pool(chunks(ids, 200).map(part => async () => { const res = await sb.from('companies').select('id,data,updated_at').in('id', part); check(res); return res.data; }), 4); return parts.flat(); },
  });
  async function syncCompanies(src, onProgress) {
    const [cached, stamps0] = await Promise.all([cache.all().catch(() => []), cache.get('stamps', {}).catch(() => ({}))]);
    const stamps = stamps0 || {};
    const n = await src.count();
    const server = await src.stamps(n);
    const byId = new Map(cached.map(c => [c.id, c]));
    const need = server.filter(r => !byId.has(r.id) || !sameStamp(stamps[r.id], r.updated_at)).map(r => r.id);
    onProgress?.(need.length, server.length);
    const fresh = need.length ? await src.rows(need) : [];
    const puts = fresh.map(r => ({ ...r.data, id: r.id }));
    for (const r of fresh) stamps[r.id] = r.updated_at;
    puts.forEach(c => byId.set(c.id, c));
    const live = new Set(server.map(r => r.id));
    const dels = [...byId.keys()].filter(id => !live.has(id));
    dels.forEach(id => { byId.delete(id); delete stamps[id]; });
    if (puts.length || dels.length) { await cache.write(puts, dels).catch(() => {}); await cache.set('stamps', stamps).catch(() => {}); }
    return { companies: [...byId.values()], fetched: puts.length, removed: dels.length, total: server.length };
  }

  async function loadCompanies(onProgress) {
    if (mode === 'local') return localLoad();
    try {
      const r = await syncCompanies(cloudSource(), onProgress);
      lastSync = r;
      return r.companies;
    } catch (err) {
      // Cache unavailable (private window, blocked storage): fall back to loading everything, in parallel pages.
      console.warn('Sync failed, loading everything', err);
      const src = cloudSource(), n = await src.count();
      const pages = await pool(Array.from({ length: Math.ceil(n / PAGE) + 1 }, (_, p) => async () => { const res = await sb.from('companies').select('id,data').order('id').range(p * PAGE, p * PAGE + PAGE - 1); check(res); return res.data; }), 4);
      return pages.flat().map(r => ({ ...r.data, id: r.id }));
    }
  }
  let lastSync = null;
  // Keeps the local copy in step with this browser's own saves, so they are not downloaded again.
  async function cacheSaved(rows) {
    if (mode !== 'cloud' || !rows.length) return;
    try { const stamps = await cache.get('stamps', {}); rows.forEach(r => { stamps[r.id] = r.updated_at; }); await cache.write(rows.map(r => ({ ...r.data, id: r.id }))); await cache.set('stamps', stamps); } catch { /* the next load fetches them */ }
  }
  async function cacheDeleted(ids) {
    if (mode !== 'cloud' || !ids.length) return;
    try { const stamps = await cache.get('stamps', {}); ids.forEach(id => delete stamps[id]); await cache.write([], ids); await cache.set('stamps', stamps); } catch { /* next load prunes them */ }
  }
  // Shared state blobs that are large and rarely change (transactions): kept in the local copy, keyed by a version.
  const cacheGet = (k, fallback) => mode === 'cloud' ? cache.get(k, fallback).catch(() => fallback) : Promise.resolve(fallback);
  const cacheSet = (k, v) => mode === 'cloud' ? cache.set(k, v).catch(() => {}) : Promise.resolve();

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
      if (!error) { done += b.length; onProgress?.(done, rows.length); await cacheSaved(b); return; }
      if (b.length > 1) { const h = Math.ceil(b.length / 2); await send(b.slice(0, h)); await send(b.slice(h)); return; }
      failed.push(b[0].id); lastError = error.message;
    };
    for (const b of batches) await send(b);
    if (failed.length) { const err = new Error(`${failed.length} of ${rows.length} companies could not be saved (${lastError})`); err.failed = failed; throw err; }
  }

  async function deleteCompanies(ids, all) {
    if (mode === 'local') return idb.write('companies', [], ids);
    for (const part of chunks(ids, 200)) check(await sb.from('companies').delete().in('id', part));
    await cacheDeleted(ids);
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

  // Leads from the public valuation website (table `leads`, written by the website server). Team database only.
  async function loadLeads() {
    if (mode !== 'cloud') return [];
    const res = await sb.from('leads').select('id,created_at,name,email,website,input,summary,status').order('created_at', { ascending: false }).limit(500);
    check(res);
    return res.data || [];
  }
  async function updateLead(id, patch) {
    if (mode !== 'cloud') return;
    check(await sb.from('leads').update(patch).eq('id', id));
  }

  // Data that was kept in this browser before the team database was connected.
  const localCompanies = () => localLoad();

  return {
    mode, domain, init, sendLoginLink, signOut, accessToken, loadCompanies, cacheGet, cacheSet, _sync: { syncCompanies, cache }, saveCompanies, deleteCompanies, loadActivity, addActivity, getState, setState, localCompanies, loadLeads, updateLead,
    get user() { return user; },
    get configured() { return !!(url && anonKey); },
    get lastSync() { return lastSync; },
  };
})();
