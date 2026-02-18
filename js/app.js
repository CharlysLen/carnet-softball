/* ============================================
   SOFTBALL +40 — Player Card App
   Reads player ID from URL, loads data, renders card
   With stats section and photo support
   Uses Storage module for persistent data
   ============================================ */

(function () {
  'use strict';

  const ICONS = {
    check: '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>',
    warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
    flip: '<svg viewBox="0 0 24 24"><path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/></svg>' // Flip icon
  };

  function generateAvatar(name, dorsal) {
    const initials = name.split(' ').filter(w => w.length > 0).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash % 360);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 230" style="background: hsl(${hue}, 35%, 22%)">
        <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:hsl(${hue}, 40%, 30%);stop-opacity:1" />
          <stop offset="100%" style="stop-color:hsl(${hue}, 35%, 18%);stop-opacity:1" />
        </linearGradient></defs>
        <rect width="200" height="230" fill="url(#grad)"/>
        <circle cx="100" cy="85" r="45" fill="hsl(${hue}, 30%, 35%)" opacity="0.5"/>
        <text x="100" y="98" font-family="Oswald, Impact, sans-serif" font-size="38" font-weight="700" fill="rgba(255,255,255,0.85)" text-anchor="middle">${initials}</text>
        <text x="100" y="175" font-family="Oswald, Impact, sans-serif" font-size="48" font-weight="700" fill="rgba(255,255,255,0.15)" text-anchor="middle">#${dorsal}</text>
      </svg>`;
  }

  function showError(title, message) {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
    document.getElementById('app').innerHTML = `
      <div class="error-screen">
        <div class="error-icon">${ICONS.warning}</div>
        <h1 class="error-title">${title}</h1>
        <p class="error-message">${message}</p>
      </div>`;
  }

  // ── Build stats section HTML ──
  function buildStatsSection(stats) {
    if (!stats) return '<div style="text-align:center;color:#666;font-size:0.8rem;padding:20px;">Sin estadísticas disponibles</div>';
    const entries = [
      { label: 'AVG', value: stats.avg },
      { label: 'HR', value: stats.hr },
      { label: 'RBI', value: stats.rbi },
      { label: 'H', value: stats.h },
      { label: 'AB', value: stats.ab },
      { label: 'R', value: stats.r }
    ].filter(e => e.value && e.value !== '');

    if (entries.length === 0) return '<div style="text-align:center;color:#666;font-size:0.8rem;padding:20px;">Sin estadísticas registradas</div>';

    return `
      <div class="stats-section">
        <div class="stats-title">ESTADÍSTICAS OFICIALES</div>
        <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr); gap: 8px;">
          ${entries.map(e => `
            <div class="stat-item" style="padding: 10px;">
              <span class="stat-value" style="font-size: 1.2rem;">${e.value}</span>
              <span class="stat-label">${e.label}</span>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderCard(player, teamInfo) {
    const isHab = player.estado === 'habilitado';

    // Safe fallback using encoded SVG data URI
    const avatarSvg = generateAvatar(player.nombre, player.dorsal);
    const avatarUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(avatarSvg)}`;

    const photoContent = player.foto
      ? `<img src="${player.foto}" alt="Foto de ${player.nombre}"
             onerror="this.onerror=null; this.src='${avatarUrl}';">`
      : avatarSvg;

    const statusIcon = isHab ? ICONS.check : ICONS.close;
    const statusText = isHab ? 'Jugador Habilitado · Edad Verificada' : 'No Elegible · Suspendido';
    const statusClass = isHab ? 'habilitado' : 'suspendido';

    const verifiedBadge = player.verificado
      ? `<div class="verified-badge" title="Identidad y edad verificadas">${ICONS.shield}</div>`
      : `<div class="verified-badge hidden"></div>`;

    const teamColor = teamInfo ? teamInfo.color : '#f5a623';
    const teamEmoji = teamInfo ? (teamInfo.escudo || '🥎') : '🥎';
    const teamImageHTML = teamInfo && teamInfo.imagen
      ? `<img src="${teamInfo.imagen}" style="width:1.2em;height:1.2em;object-fit:contain;border-radius:4px;vertical-align:middle;margin-right:4px;">`
      : teamEmoji + ' ';

    const statsHTML = buildStatsSection(player.stats);
    const pendienteAprobacion = player.aprobado === false;
    const fechaAltaStr = player.fechaAlta ? new Date(player.fechaAlta + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

    // Bio data
    const height = player.altura ? `${player.altura} m` : '—';
    const weight = player.peso ? `${player.peso} kg` : '—';
    const age = player.edad ? `${player.edad} años` : '—';

    const card = `
      <div class="scene">
        <div class="player-card" style="--team-color: ${teamColor}" onclick="this.classList.toggle('is-flipped')">
          
          <!-- FRONT FACE -->
          <div class="card-face card-front">
            <div class="card-header">
              <div class="league-badge">
                <div class="league-logo">+40</div>
                <div class="league-name">Liga de Softball<strong>Masters +40</strong></div>
              </div>
              <div class="season-badge">${player.temporada}</div>
            </div>

            <div class="photo-section">
              <div class="photo-frame">
                ${photoContent}
                <div class="flip-hint-overlay">${ICONS.flip}</div>
                <div class="dorsal-overlay">${player.dorsal}</div>
                ${verifiedBadge}
              </div>
            </div>

            <div class="player-info">
              <h1 class="player-name">${player.nombre}</h1>
              <div class="player-details">
                <div class="detail-chip">
                  <span class="chip-label">Equipo</span>
                  <span class="chip-value">${teamImageHTML}${player.equipo}</span>
                </div>
                <div class="detail-chip">
                  <span class="chip-label">Pos.</span>
                  <span class="chip-value">${player.posicion}</span>
                </div>
              </div>
            </div>

            ${pendienteAprobacion
              ? `<div class="status-banner suspendido" style="background:rgba(255,160,0,0.15);border-color:rgba(255,160,0,0.3);">
                  <div class="status-icon" style="color:#ffa000;">${ICONS.warning}</div>
                  <span style="color:#ffa000;">Pendiente de aprobación</span>
                </div>`
              : `<div class="status-banner ${statusClass}">
                  <div class="status-icon">${statusIcon}</div>
                  <span>${statusText}</span>
                </div>`}

            <div class="card-footer">
              <div class="verification-note">
                ${player.verificado
        ? '<span class="blue-text">✓ Verificado</span> — Identidad y edad comprobadas'
        : 'Pendiente de verificación'}
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <div class="player-id">ID: ${player.id}</div>
                ${fechaAltaStr ? `<div style="font-size:0.6rem;color:rgba(255,255,255,0.4);">Alta: ${fechaAltaStr}</div>` : ''}
              </div>
            </div>
            
            <div class="click-hint">Toca la carta para ver detalles</div>
          </div>

          <!-- BACK FACE -->
          <div class="card-face card-back">
             <div class="card-header back-header" style="justify-content:center; border-bottom:1px solid rgba(255,255,255,0.1);">
              <div class="league-name" style="text-align:center;">Ficha Técnica</div>
            </div>
            
            <div class="back-content">
              <div class="bio-grid">
                <div class="bio-item">
                  <div class="bio-label">ALTURA</div>
                  <div class="bio-value">${height}</div>
                </div>
                <div class="bio-item">
                  <div class="bio-label">PESO</div>
                  <div class="bio-value">${weight}</div>
                </div>
                <div class="bio-item">
                  <div class="bio-label">EDAD</div>
                  <div class="bio-value">${age}</div>
                </div>
              </div>

               <div style="margin: 20px 0; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
                ${statsHTML}
              </div>
              
              <div style="margin-top:auto; text-align:center; opacity:0.6; font-size:0.8rem;">
                 <div style="margin-bottom:8px;">${teamImageHTML} ${player.equipo}</div>
                 <div>#${player.dorsal} ${player.nombre}</div>
              </div>
            </div>
             <div class="click-hint">Toca para volver</div>
          </div>

        </div>
      </div>`;

    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
    document.getElementById('app').innerHTML = card;
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const playerId = params.get('id');

    if (!playerId) {
      showError('ID no proporcionado', 'La URL debe incluir ?id=001');
      return;
    }

    try {
      const data = await AppStore.load();
      const players = data.jugadores;
      const equipos = data.equipos;

      const player = players.find(p => p.id === playerId);
      if (!player) {
        showError('Jugador no encontrado', `No existe un jugador con ID "${playerId}".`);
        return;
      }

      const teamInfo = equipos.find(e => e.nombre === player.equipo) || null;
      setTimeout(() => renderCard(player, teamInfo), 400);
    } catch (err) {
      console.error('Error loading:', err);
      showError('Error de carga', 'No se pudieron cargar los datos.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
