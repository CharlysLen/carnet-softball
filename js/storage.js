/* ============================================
   SOFTBALL +40 — Persistence Layer
   Firebase Realtime Database + localStorage cache
   Stores: equipos, jugadores, partidos, usuarios
   ============================================ */

const AppStore = (function () {
    'use strict';

    const STORAGE_KEY = 'softball40_data';
    const SEED_URL = 'data/players.json';
    const FB_PATH = 'softball40';

    function fbAvailable() {
        return typeof firebaseDB !== 'undefined';
    }

    // --- Firebase helpers ---
    function fbSave(data) {
        if (!fbAvailable()) return Promise.resolve();
        return firebaseDB.ref(FB_PATH).set(data)
            .then(() => console.log('[Firebase] Saved'))
            .catch(e => console.error('[Firebase] Save failed:', e));
    }

    function fbLoad() {
        if (!fbAvailable()) return Promise.resolve(null);
        return firebaseDB.ref(FB_PATH).once('value')
            .then(snap => {
                const val = snap.val();
                if (val && val.jugadores) {
                    console.log('[Firebase] Loaded from cloud');
                    return val;
                }
                return null;
            })
            .catch(e => { console.error('[Firebase] Load failed:', e); return null; });
    }

    // --- Main load ---
    async function load() {
        // 1. Try Firebase first (cloud = source of truth)
        const fbData = await fbLoad();
        if (fbData) {
            const normalized = normalize(fbData);
            localSave(normalized); // cache locally
            return normalized;
        }

        // 2. Fallback to localStorage
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const data = JSON.parse(saved);
                if (data && data.jugadores) {
                    console.log('[Storage] Loaded from localStorage');
                    const normalized = normalize(data);
                    // Push local data to Firebase if available
                    fbSave(normalized);
                    return normalized;
                }
            } catch (e) { /* corrupt */ }
        }

        // 3. Seed from JSON file
        try {
            const resp = await fetch(SEED_URL);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const normalized = normalize(Array.isArray(data) ? { equipos: [], jugadores: data, partidos: [] } : data);
            save(normalized);
            console.log(`[Storage] Seeded from ${SEED_URL}`);
            return normalized;
        } catch (err) {
            console.error('[Storage] Seed failed:', err);
            return { equipos: [], jugadores: [], partidos: [], usuarios: defaultUsers() };
        }
    }

    function defaultUsers() {
        return [{ id: 'admin', nombre: 'Administrador', user: 'admin', pass: '1234', rol: 'admin', equipo: null }];
    }

    function localSave(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
        catch (e) { console.error('[Storage] LocalSave failed:', e); }
    }

    function save(data) {
        localSave(data);
        fbSave(data);
    }

    function reset() {
        localStorage.removeItem(STORAGE_KEY);
        if (fbAvailable()) {
            firebaseDB.ref(FB_PATH).remove()
                .then(() => console.log('[Firebase] Data removed'))
                .catch(e => console.error('[Firebase] Remove failed:', e));
        }
    }

    function normalize(data) {
        const equipos = data.equipos || [];
        const jugadores = data.jugadores || [];
        const partidos = data.partidos || [];
        let usuarios = data.usuarios || [];
        if (!usuarios.find(u => u.rol === 'admin')) {
            usuarios = [...defaultUsers(), ...usuarios];
        }

        const teamNames = [...new Set(jugadores.map(p => p.equipo))];
        for (const name of teamNames) {
            if (!equipos.find(e => e.nombre === name)) {
                equipos.push({
                    id: name.toLowerCase().replace(/\s+/g, '-'),
                    nombre: name, nombreCorto: name.split(' ')[0],
                    color: '#f5a623', colorSecundario: '#1a1a2e', escudo: '🥎', imagen: ''
                });
            }
        }

        for (const p of jugadores) {
            if (!p.stats) {
                p.stats = { avg: '', hr: '', rbi: '', h: '', ab: '', r: '' };
            }
        }

        return { equipos, jugadores, partidos, usuarios };
    }

    function getUsers() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                const usuarios = data.usuarios || [];
                if (!usuarios.find(u => u.rol === 'admin')) return [...defaultUsers(), ...usuarios];
                return usuarios;
            }
        } catch (e) { /* ignore */ }
        return defaultUsers();
    }

    return { load, save, reset, getUsers };
})();
