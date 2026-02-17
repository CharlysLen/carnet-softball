/* ============================================
   SOFTBALL +40 — Calendario de Partidos
   Persistent matches, create new, team roster popup
   ============================================ */

(function () {
  'use strict';

  let players = [];
  let equipos = [];
  let partidos = [];

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  function autoSave() {
    AppStore.save({ equipos, jugadores: players, partidos });
  }

  async function loadData() {
    const data = await AppStore.load();
    players = data.jugadores;
    equipos = data.equipos;
    partidos = data.partidos || [];
    updateTeamDropdowns();
    renderCalendar();
  }

  function findTeam(name) {
    return equipos.find(e => e.nombre === name) || { escudo: '🥎', color: '#f5a623', nombre: name, imagen: '' };
  }

  function renderEmblem(team, size) {
    if (team.imagen) return `<img src="${team.imagen}" style="width:${size};height:${size};object-fit:contain;border-radius:6px;vertical-align:middle;">`;
    return team.escudo || '🥎';
  }

  function updateTeamDropdowns() {
    const localSel = document.getElementById('match-local');
    const visSel = document.getElementById('match-visitante');
    if (!localSel || !visSel) return;
    const opts = equipos.map(e => `<option value="${e.nombre}">${e.escudo || '🥎'} ${e.nombre}</option>`).join('');
    localSel.innerHTML = opts || '<option value="">Sin equipos</option>';
    visSel.innerHTML = opts || '<option value="">Sin equipos</option>';
    // Default visitante to second team if possible
    if (equipos.length >= 2) visSel.selectedIndex = 1;
  }

  // ──────────────────────────────────────────────
  // RENDER CALENDAR
  // ──────────────────────────────────────────────

  function renderCalendar() {
    const grid = document.getElementById('calendar-grid');

    // Sort by date
    const sorted = [...partidos].sort((a, b) => a.fecha.localeCompare(b.fecha));

    if (sorted.length === 0) {
      grid.innerHTML = `<div style="text-align:center;padding:60px 20px;color:rgba(255,255,255,0.4);">
        <div style="font-size:3rem;margin-bottom:12px;">📅</div>
        <p>No hay partidos programados.</p>
        <p style="margin-top:8px;">Usa <strong style="color:var(--gold)">+ Nuevo Partido</strong> para crear el primero.</p>
      </div>`;
      return;
    }

    // Group by month
    const byMonth = {};
    for (const m of sorted) {
      const d = new Date(m.fecha);
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { label: `${MESES[d.getMonth()]} ${d.getFullYear()}`, matches: [] };
      byMonth[key].matches.push(m);
    }

    let html = '';
    for (const [, group] of Object.entries(byMonth)) {
      html += `<div class="calendar-month-header">📆 ${group.label}</div>`;
      for (const match of group.matches) {
        const d = new Date(match.fecha);
        const local = findTeam(match.local);
        const vis = findTeam(match.visitante);
        html += `
          <div class="calendar-match-card">
            <div class="match-date-box">
              <div class="match-day">${d.getDate()}</div>
              <div class="match-month">${MESES[d.getMonth()].substring(0, 3).toUpperCase()}</div>
              <div class="match-weekday">${DIAS[d.getDay()]}</div>
            </div>
            <div class="match-info">
              <div class="match-teams">
                <div class="match-team-pill" onclick="Cal.showRoster('${match.local.replace(/'/g, "\\'")}')" title="Ver plantilla">
                  <span class="match-team-emoji">${renderEmblem(local, '1.2rem')}</span>
                  <span class="match-team-name">${local.nombre}</span>
                </div>
                <span class="match-vs">VS</span>
                <div class="match-team-pill" onclick="Cal.showRoster('${match.visitante.replace(/'/g, "\\'")}')" title="Ver plantilla">
                  <span class="match-team-emoji">${renderEmblem(vis, '1.2rem')}</span>
                  <span class="match-team-name">${vis.nombre}</span>
                </div>
              </div>
              <div class="match-details">
                <span class="match-detail-item">📍 ${match.campo}</span>
                ${match.jornada ? `<span class="match-detail-item">⚾ Jornada ${match.jornada}</span>` : ''}
                ${match.arbitro ? `<span class="match-detail-item">🧑‍⚖️ ${match.arbitro}</span>` : ''}
              </div>
            </div>
            <div style="text-align:right">
              <div class="match-time-badge">${match.hora}</div>
              <button class="btn btn-sm btn-secondary" style="margin-top:6px;opacity:0.5;" onclick="Cal.deleteMatch('${match.id}')" title="Eliminar">🗑</button>
            </div>
          </div>`;
      }
    }
    grid.innerHTML = html;
  }

  // ──────────────────────────────────────────────
  // ROSTER POPUP
  // ──────────────────────────────────────────────

  function showRoster(teamName) {
    const team = findTeam(teamName);
    const tp = players.filter(p => p.equipo === teamName);
    const overlay = document.getElementById('roster-overlay');
    const panel = document.getElementById('roster-panel');

    let html = `<div class="roster-popup-header">
      <span class="roster-popup-emblem">${renderEmblem(team, '2.2rem')}</span>
      <div><div class="roster-popup-name">${team.nombre}</div>
      <div class="roster-popup-count">${tp.length} jugador${tp.length !== 1 ? 'es' : ''}</div></div>
    </div>`;

    if (tp.length === 0) {
      html += '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4);">Sin jugadores.</div>';
    } else {
      for (const p of tp) {
        const initials = p.nombre.split(' ').filter(w => w.length).slice(0, 2).map(w => w[0]).join('');
        let hash = 0;
        for (let i = 0; i < p.nombre.length; i++) hash = p.nombre.charCodeAt(i) + ((hash << 5) - hash);
        const hue = Math.abs(hash % 360);
        const avatarStyle = p.foto
          ? `background-image:url('${p.foto}');background-size:cover;background-position:center;`
          : `background:linear-gradient(135deg,hsl(${hue},35%,28%),hsl(${hue},30%,18%));`;

        html += `
          <div class="roster-popup-player" style="cursor:pointer" onclick="window.open('index.html?id=${p.id}','_blank')">
            <div class="roster-popup-avatar" style="${avatarStyle}">
              ${p.foto ? '' : `<span class="roster-popup-avatar-initials">${initials}</span>`}
            </div>
            <div class="roster-popup-info">
              <div class="roster-popup-pname">#${p.dorsal} ${p.nombre}</div>
              <div class="roster-popup-position">${p.posicion}</div>
            </div>
            <span class="roster-popup-status ${p.estado}">${p.estado === 'habilitado' ? '●Hab.' : '●Susp.'}</span>
          </div>`;
      }
    }
    html += '<button class="btn btn-secondary roster-popup-close" onclick="Cal.closeRoster()">Cerrar</button>';
    panel.innerHTML = html;
    overlay.classList.add('active');
  }

  function closeRoster() { document.getElementById('roster-overlay').classList.remove('active'); }

  // ──────────────────────────────────────────────
  // ADD / DELETE MATCH
  // ──────────────────────────────────────────────

  function addMatch(e) {
    e.preventDefault();
    const local = document.getElementById('match-local').value;
    const visitante = document.getElementById('match-visitante').value;
    if (local === visitante) { alert('Elige dos equipos diferentes.'); return; }

    partidos.push({
      id: 'p' + Date.now(),
      fecha: document.getElementById('match-fecha').value,
      hora: document.getElementById('match-hora').value,
      local,
      visitante,
      campo: document.getElementById('match-campo').value.trim(),
      jornada: parseInt(document.getElementById('match-jornada').value, 10) || null,
      arbitro: document.getElementById('match-arbitro').value.trim() || ''
    });

    autoSave();
    closeModal();
    renderCalendar();
    document.getElementById('add-match-form').reset();
  }

  function deleteMatch(id) {
    if (!confirm('¿Eliminar este partido?')) return;
    partidos = partidos.filter(m => m.id !== id);
    autoSave();
    renderCalendar();
  }

  // ──────────────────────────────────────────────
  // MODAL
  // ──────────────────────────────────────────────

  function openModal() { document.getElementById('modal-add-match').classList.add('active'); }
  function closeModal() { document.getElementById('modal-add-match').classList.remove('active'); }

  window.Cal = { showRoster, closeRoster, deleteMatch, closeModal };

  async function init() {
    await loadData();
    document.getElementById('btn-add-match').addEventListener('click', openModal);
    document.getElementById('add-match-form').addEventListener('submit', addMatch);
    document.getElementById('roster-overlay').addEventListener('click', function (e) { if (e.target === this) closeRoster(); });
    document.getElementById('modal-add-match').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeRoster(); closeModal(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
