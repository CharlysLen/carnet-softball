/* ============================================
   SOFTBALL +40 — QR Code Generator
   Uses Storage module, includes email/WhatsApp sharing
   ============================================ */

(function () {
    'use strict';

    let players = [];
    let equipos = [];

    async function loadData() {
        const data = await AppStore.load();
        players = data.jugadores;
        equipos = data.equipos;
    }

    function findTeam(name) {
        return equipos.find(e => e.nombre === name) || { escudo: '🥎', color: '#f5a623', imagen: '' };
    }

    function renderEmblem(team) {
        if (team.imagen) return `<img src="${team.imagen}" style="width:1.1rem;height:1.1rem;object-fit:contain;border-radius:4px;vertical-align:middle;">`;
        return team.escudo || '🥎';
    }

    function groupByTeam(list) {
        const teams = {};
        for (const p of list) {
            if (!teams[p.equipo]) teams[p.equipo] = [];
            teams[p.equipo].push(p);
        }
        return teams;
    }

    // --- Share functions ---
    function shareEmail(playerName, cardUrl, email) {
        const subject = encodeURIComponent(`Carnet Digital — ${playerName} — Liga Softball Masters +40`);
        const body = encodeURIComponent(`Hola,\n\nAquí tienes el carnet digital de ${playerName}:\n${cardUrl}\n\nEscanea el QR o haz clic en el enlace para ver la ficha del jugador.\n\nLiga Softball Masters +40`);
        const to = email ? encodeURIComponent(email) : '';
        window.open(`mailto:${to}?subject=${subject}&body=${body}`);
    }

    function shareWhatsApp(playerName, cardUrl, phone) {
        const text = encodeURIComponent(`⚾ Carnet Digital — ${playerName}\n\n${cardUrl}\n\nLiga Softball Masters +40`);
        const dest = phone ? phone.replace(/[^0-9+]/g, '') : '';
        window.open(`https://wa.me/${dest}?text=${text}`, '_blank');
    }

    function generateQRCodes() {
        const baseUrl = document.getElementById('base-url').value.trim().replace(/\/$/, '');
        const grid = document.getElementById('qr-grid');

        if (!baseUrl) { alert('Introduce una URL base válida.'); return; }
        grid.innerHTML = '';

        if (players.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.4);">No hay jugadores. <a href="admin.html" style="color:#f5a623;">Añade desde admin</a>.</div>';
            return;
        }

        const teams = groupByTeam(players);
        for (const [teamName, teamPlayers] of Object.entries(teams)) {
            const team = findTeam(teamName);

            const header = document.createElement('div');
            header.className = 'qr-team-header';
            header.innerHTML = `<span class="qr-team-icon">${renderEmblem(team)}</span> ${teamName}`;
            grid.appendChild(header);

            for (const player of teamPlayers) {
                const url = `${baseUrl}/?id=${player.id}`;
                const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&format=png&margin=8&data=${encodeURIComponent(url)}`;
                const statusDot = player.estado === 'habilitado'
                    ? '<span class="qr-status-dot habilitado"></span>'
                    : '<span class="qr-status-dot suspendido"></span>';

                const card = document.createElement('div');
                card.className = 'qr-card';
                card.innerHTML = `
          <img src="${qrApiUrl}" alt="QR ${player.nombre}" width="180" height="180"
               style="border-radius:8px;background:#fff;display:block;margin:0 auto 12px;"
               onerror="this.style.display='none';">
          <div class="qr-player-name">${statusDot} ${player.nombre}</div>
          <div class="qr-player-meta">#${player.dorsal} · ${player.posicion}</div>
          <div class="qr-player-url">${url}</div>
          <div class="qr-share-row">
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); QR.shareEmail('${player.nombre.replace(/'/g, "\\'")}', '${url}', '${(player.email || '').replace(/'/g, "\\'")}')" title="${player.email ? 'Enviar a ' + player.email : 'Enviar por email'}">
              ✉️ ${player.email ? 'Enviar' : 'Email'}
            </button>
            <button class="btn btn-sm btn-success" onclick="event.stopPropagation(); QR.shareWhatsApp('${player.nombre.replace(/'/g, "\\'")}', '${url}', '${(player.telefono || '').replace(/'/g, "\\'")}')" title="${player.telefono ? 'Enviar a ' + player.telefono : 'Enviar por WhatsApp'}">
              💬 ${player.telefono ? 'Enviar' : 'WhatsApp'}
            </button>
          </div>
        `;
                grid.appendChild(card);
            }
        }
    }

    window.QR = { shareEmail, shareWhatsApp };

    async function init() {
        await loadData();
        document.getElementById('btn-generate-qr').addEventListener('click', generateQRCodes);
        if (players.length > 0) generateQRCodes();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
