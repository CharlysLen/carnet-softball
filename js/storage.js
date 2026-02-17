/* ============================================
   SOFTBALL +40 — Persistence Layer
   localStorage auto-save / load
   Stores: equipos, jugadores, partidos
   ============================================ */

const AppStore = (function () {
    'use strict';

    const STORAGE_KEY = 'softball40_data';
    const SEED_URL = 'data/players.json';

    async function load() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const data = JSON.parse(saved);
                if (data && data.jugadores) {
                    console.log(`[Storage] Loaded from localStorage`);
                    return normalize(data);
                }
            } catch (e) { /* corrupt */ }
        }

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
            return { equipos: [], jugadores: [], partidos: [] };
        }
    }

    function save(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
        catch (e) { console.error('[Storage] Save failed:', e); }
    }

    function reset() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function normalize(data) {
        const equipos = data.equipos || [];
        const jugadores = data.jugadores || [];
        const partidos = data.partidos || [];

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

        // Ensure stats object on every player
        for (const p of jugadores) {
            if (!p.stats) {
                p.stats = { avg: '', hr: '', rbi: '', h: '', ab: '', r: '' };
            }
        }

        return { equipos, jugadores, partidos };
    }

    return { load, save, reset };
})();
