/* ============================================
   SOFTBALL +40 — Admin Panel Logic
   Shield cards, roster, photos, team email/phone,
   CSV import, auto-save to localStorage
   ============================================ */

(function () {
  'use strict';

  let players = [];
  let equipos = [];
  let partidos = [];
  let usuarios = [];
  let currentView = 'teams';
  let selectedTeam = null;
  let selectedMatchId = null;
  let lineupSubView = 'resumen'; // resumen | local | visitante | bitacora
  let selectedLineupPlayerId = null; // For per-player editor dropdown
  let csvParsedData = [];
  let pendingPlayerPhoto = '';
  let pendingTeamImage = '';

  // Current logged-in user info
  function getCurrentUser() {
    return {
      id: sessionStorage.getItem('admin_auth_id') || '',
      rol: sessionStorage.getItem('admin_auth_rol') || 'delegado',
      equipo: sessionStorage.getItem('admin_auth_equipo') || '',
      nombre: sessionStorage.getItem('admin_auth_nombre') || ''
    };
  }
  function isAdmin() { return getCurrentUser().rol === 'admin'; }
  function isSuperuser() { return getCurrentUser().rol === 'superusuario'; }
  function isDelegado() { return getCurrentUser().rol === 'delegado'; }
  function isUsuario() { return getCurrentUser().rol === 'usuario'; }
  // Admin & Superusuario can edit any team; Delegado only their own; Usuario can't edit
  function getDelegadoTeam() {
    const u = getCurrentUser();
    if (!u.equipo) return null;
    // Match by nombre or id (case-insensitive) for robustness
    const found = equipos.find(e => e.nombre === u.equipo || e.id === u.equipo ||
      e.nombre.toLowerCase() === u.equipo.toLowerCase() || e.id.toLowerCase() === u.equipo.toLowerCase());
    // Fallback: if team not in equipos array yet (race condition / not loaded), return synthetic object
    return found || { nombre: u.equipo, id: u.equipo };
  }
  // Returns true if current user can make edits to a live/scheduled match.
  // Delegados: only while match is live. Admin/super: always.
  function canEditMatch(match) {
    if (!match) return false;
    if (isAdmin() || isSuperuser()) return true;
    if (isDelegado()) return match.status === 'live';
    return false;
  }

  // Returns true if the match bitácora/log window is open for the current user.
  // Admin: always. Superusuario/delegado: 1h before scheduled time → 1h after endedAt.
  function isMatchWindowOpen(match) {
    if (!match) return false;
    if (isAdmin()) return true;
    if (match.status === 'live') return true; // live game is always writable

    const now = Date.now();
    const [h, mn] = (match.hora || '00:00').split(':').map(Number);
    const matchDate = new Date(match.fecha);
    matchDate.setHours(h, mn, 0, 0);
    const windowStart = matchDate.getTime() - 60 * 60 * 1000;

    if (now < windowStart) return false; // too early

    if (match.status === 'finished') {
      if (!match.endedAt) return false;
      const windowEnd = new Date(match.endedAt).getTime() + 60 * 60 * 1000;
      return now <= windowEnd;
    }

    // scheduled but already within the pre-match window
    return true;
  }

  // Returns true if the current user can edit the lineup for a given team/match.
  function canEditLineup(match, teamName) {
    if (!match) return false;
    if (isAdmin()) return true;
    if (match.status === 'finished') return false;
    if (isSuperuser()) return true;
    if (isDelegado()) return canEditTeam(teamName); // scheduled or live
    return false;
  }

  function canEditTeam(teamName) {
    if (isUsuario()) return false;
    if (isAdmin() || isSuperuser()) return true;
    if (!isDelegado()) return false;
    const u = getCurrentUser();
    if (!u.equipo) return false;
    const tn = (teamName || '').toLowerCase();
    // Direct match: stored equipo name vs teamName (most robust — no dependency on equipos array)
    if (u.equipo.toLowerCase() === tn) return true;
    // Also check via getDelegadoTeam to support team-id-based stored equipo values
    const dt = getDelegadoTeam();
    if (!dt) return false;
    return dt.nombre.toLowerCase() === tn || dt.id.toLowerCase() === tn;
  }
  // Only Admin & Superusuario can toggle estado/verificado
  function canToggleStatus() { return isAdmin() || isSuperuser(); }
  // Admin & Superusuario can manage teams (create/edit/delete)
  function canManageTeams() { return isAdmin() || isSuperuser(); }

  let _suppressSync = false; // prevents echo when current user just saved

  function autoSave() {
    _suppressSync = true;
    AppStore.save({ equipos, jugadores: players, partidos, usuarios });
    setTimeout(() => { _suppressSync = false; }, 3000);
  }

  async function loadData() {
    const data = await AppStore.load();
    players = data.jugadores;
    equipos = data.equipos;
    partidos = data.partidos || [];
    usuarios = data.usuarios || [];
    applyPermissions();
    renderView();
    // Migrate photos with black areas from EXIF bug (runs once, auto-detects)
    migratePhotos().then(() => renderView());
    // Start real-time sync after initial load
    setupRealtimeSync();
  }

  function setupRealtimeSync() {
    if (typeof firebaseDB === 'undefined') return;
    firebaseDB.ref('softball40').on('value', (snap) => {
      if (_suppressSync) return; // ignore echo from own save
      const val = snap.val();
      if (!val || !val.jugadores) return;

      // Update local state from Firebase
      if (val.equipos)   equipos  = val.equipos;
      if (val.jugadores) players  = val.jugadores;
      if (val.partidos)  partidos = val.partidos;
      if (val.usuarios)  usuarios = val.usuarios;

      // Update localStorage cache
      try { localStorage.setItem('softball40_data', JSON.stringify({ equipos, jugadores: players, partidos, usuarios })); } catch(e) {}

      // Re-render — but skip if user is actively typing in an input/textarea
      const ae = document.activeElement;
      const isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (!isTyping) {
        renderView();
        _showSyncToast();
      } else {
        _showUpdateBanner();
      }
    });
  }

  function _showSyncToast() {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(0,200,100,0.9);color:#000;padding:7px 18px;border-radius:20px;font-size:0.78rem;font-weight:700;z-index:9999;pointer-events:none;box-shadow:0 3px 10px rgba(0,0,0,0.3);';
    t.textContent = '🔄 Datos actualizados';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function _showUpdateBanner() {
    if (document.getElementById('rt-update-banner')) return;
    const b = document.createElement('div');
    b.id = 'rt-update-banner';
    b.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--gold);color:#000;padding:9px 20px;border-radius:20px;font-size:0.8rem;font-weight:700;cursor:pointer;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,0.35);';
    b.innerHTML = '🔄 Hay cambios pendientes — <u>pulsa para actualizar</u>';
    b.onclick = () => { b.remove(); renderView(); };
    document.body.appendChild(b);
  }

  function getTeamPlayers(n) {
    const tp = players.filter(p => p.equipo === n);
    // Usuarios only see approved players; delegados see their own team's pending too
    if (isUsuario()) return tp.filter(p => p.aprobado !== false);
    return tp;
  }

  function renderView() {
    renderStats();
    updateTeamDropdown();
    updateUserTeamDropdown();
    if (currentView === 'teams') renderTeamShields();
    else if (currentView === 'roster') renderRoster();
    else if (currentView === 'calendar') renderCalendar();
    else if (currentView === 'standings') renderStandings();
    else if (currentView === 'match') renderMatchDetail();
    else if (currentView === 'lineup') renderLineupList();
    else if (currentView === 'users') renderUsers();
  }



  function switchTab(view) {
    if (view === 'users' && !isAdmin()) return;
    currentView = view;
    selectedTeam = null;
    selectedLineupPlayerId = null;
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.remove('active');
      l.style.color = 'var(--white-muted)';
    });
    const links = document.querySelectorAll('.nav-link');
    const idx = { teams: 0, calendar: 1, standings: 2, lineup: 3, users: 4 }[view];
    if (links[idx]) { links[idx].classList.add('active'); links[idx].style.color = 'var(--white)'; }
    renderView();
  }

  function renderStats() {
    const t = players.length, h = players.filter(p => p.estado === 'habilitado').length, s = t - h;
    const pending = players.filter(p => p.aprobado === false).length;
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-number">${t}</div><div class="stat-label">Jugadores</div></div>
      <div class="stat-card green"><div class="stat-number">${h}</div><div class="stat-label">Habilitados</div></div>
      <div class="stat-card red"><div class="stat-number">${s}</div><div class="stat-label">Suspendidos</div></div>
      <div class="stat-card"><div class="stat-number">${equipos.length}</div><div class="stat-label">Equipos</div></div>
      ${pending > 0 && (isAdmin() || isSuperuser()) ? `<div class="stat-card" style="background:rgba(255,160,0,0.15);border-color:rgba(255,160,0,0.3);cursor:pointer;" onclick="document.getElementById('pending-section').scrollIntoView({behavior:'smooth'})"><div class="stat-number" style="color:#ffa000;">${pending}</div><div class="stat-label">Pendientes</div></div>` : ''}`;

    // Render pending approvals section for admin/superusuario
    renderPendingApprovals();
  }

  function renderPendingApprovals() {
    let container = document.getElementById('pending-section');
    if (!container) {
      container = document.createElement('div');
      container.id = 'pending-section';
      const statsRow = document.getElementById('stats-row');
      statsRow.parentNode.insertBefore(container, statsRow.nextSibling);
    }

    const pendingPlayers = players.filter(p => p.aprobado === false);
    if (pendingPlayers.length === 0 || (!isAdmin() && !isSuperuser())) {
      container.innerHTML = '';
      return;
    }

    let html = `<div style="background:rgba(255,160,0,0.08);border:1px solid rgba(255,160,0,0.25);border-radius:16px;padding:20px;margin:20px 0;">
      <h3 style="color:#ffa000;font-family:var(--font-display);margin-bottom:15px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:1.2rem;">🔔</span> Solicitudes Pendientes de Aprobación (${pendingPlayers.length})
      </h3>`;

    for (const p of pendingPlayers) {
      const team = equipos.find(e => e.nombre === p.equipo);
      const teamEmoji = team ? (team.escudo || '🥎') : '🥎';
      const fechaStr = p.fechaAlta ? new Date(p.fechaAlta + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

      html += `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-card);border-radius:12px;padding:12px 16px;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,160,0,0.2);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#ffa000;">${p.nombre.charAt(0)}</div>
          <div>
            <div style="font-weight:600;color:var(--white);">${p.nombre}</div>
            <div style="font-size:0.75rem;color:var(--white-muted);">${teamEmoji} ${p.equipo} · #${p.dorsal} · ${p.posicion}${fechaStr ? ' · Alta: ' + fechaStr : ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-success" onclick="Admin.aprobarJugador('${p.id}')" style="padding:6px 16px;">✔ Aprobar</button>
          <button class="btn btn-sm btn-danger" onclick="Admin.rechazarJugador('${p.id}')" style="padding:6px 16px;">✖ Rechazar</button>
          <button class="btn btn-sm btn-secondary" onclick="Admin.viewCard('${p.id}')" style="padding:6px 12px;">👁</button>
        </div>
      </div>`;
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function updateTeamDropdown() {
    const s = document.getElementById('inp-equipo');
    if (!s) return;
    const container = s.closest('.form-group') || s.parentElement;
    if (isDelegado()) {
      // Delegado: auto-assign their team, hide the dropdown
      const dt = getDelegadoTeam();
      const teamName = dt ? dt.nombre : getCurrentUser().equipo;
      s.innerHTML = `<option value="${teamName}">${dt ? (dt.escudo || '🥎') + ' ' : ''}${teamName}</option>`;
      s.value = teamName;
      container.style.display = 'none';
    } else {
      container.style.display = '';
      const list = (isAdmin() || isSuperuser()) ? equipos : equipos;
      s.innerHTML = list.length === 0
        ? '<option value="">— Crea un equipo —</option>'
        : list.map(e => `<option value="${e.nombre}">${e.escudo || '🥎'} ${e.nombre}</option>`).join('');
    }
  }

  function renderEmblem(team, size) {
    if (team.imagen) return `<img src="${team.imagen}" style="width:${size};height:${size};object-fit:contain;border-radius:12px;">`;
    return `<span style="font-size:${size};line-height:1">${team.escudo || '🥎'}</span>`;
  }

  // ── SHIELD CARDS ──
  function renderTeamShields() {
    const c = document.getElementById('main-content');
    if (equipos.length === 0) {
      c.innerHTML = `<div style="text-align:center;color:rgba(255,255,255,0.4);padding:60px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;">🛡</div><p>Usa <strong style="color:var(--gold)">🛡 Nuevo Equipo</strong> para empezar.</p></div>`;
      return;
    }
    let html = '<div class="shields-grid">';
    for (const team of equipos) {
      const tp = getTeamPlayers(team.nombre);
      const hab = tp.filter(p => p.estado === 'habilitado').length;
      const susp = tp.filter(p => p.estado === 'suspendido').length;
      const ver = tp.filter(p => p.verificado).length;
      const contactInfo = [];
      if (team.entrenador) contactInfo.push(`🧑‍🏫 ${team.entrenador}`);
      if (team.email) contactInfo.push(`✉ ${team.email}`);
      if (team.telefono) contactInfo.push(`📞 ${team.telefono}`);

      const canEdit = canEditTeam(team.nombre);
      html += `
        <div class="shield-card" onclick="if(!event.target.closest('.shield-edit-btn')) Admin.selectTeam('${team.nombre.replace(/'/g, "\\'")}')"
             style="--shield-color:${team.color};--shield-bg:${team.colorSecundario || '#1a1a2e'}">
          ${canManageTeams() ? `<div style="position:absolute;top:10px;right:10px;z-index:10;display:flex;gap:4px;">
            <button class="btn btn-sm btn-secondary shield-edit-btn" onclick="Admin.editTeam('${team.id}')" title="Editar Equipo">✏️</button>
            ${isAdmin() ? `<button class="btn btn-sm btn-danger shield-edit-btn" onclick="Admin.deleteTeam('${team.id}')" title="Borrar Equipo">🗑</button>` : ''}
          </div>` : ''}
          <div class="shield-glow" style="background:radial-gradient(circle,${team.color}15 0%,transparent 70%)"></div>
          <div class="shield-emblem">${renderEmblem(team, '4rem')}</div>
          <h2 class="shield-name">${team.nombre}</h2>
          ${contactInfo.length ? `<div class="shield-contact">${contactInfo.join(' · ')}</div>` : ''}
          <div class="shield-stats">
            <div class="shield-stat"><span class="shield-stat-number">${tp.length}</span><span class="shield-stat-label">Jugadores</span></div>
            <div class="shield-stat"><span class="shield-stat-number" style="color:var(--green)">${hab}</span><span class="shield-stat-label">Habilitados</span></div>
            ${susp > 0 ? `<div class="shield-stat"><span class="shield-stat-number" style="color:var(--red)">${susp}</span><span class="shield-stat-label">Suspendidos</span></div>` : ''}
          </div>
          <div class="shield-footer">
            <span class="shield-verified">${tp.length === 0 ? 'Sin jugadores' : ver === tp.length ? '✓ Todos verificados' : `${ver}/${tp.length} verificados`}</span>
          </div>
          <div class="shield-arrow">Ver plantilla →</div>
        </div>`;
    }
    html += '</div>';
    c.innerHTML = html;
  }

  // ── ROSTER VIEW ──
  function renderRoster() {
    const c = document.getElementById('main-content');
    const team = equipos.find(e => e.nombre === selectedTeam);
    if (!team) { backToTeams(); return; }
    const tp = getTeamPlayers(team.nombre);
    const canEdit = canEditTeam(team.nombre);

    let html = `<div class="roster-view">
      <div class="roster-header" style="--shield-color:${team.color}">
        <button class="btn btn-secondary roster-back" onclick="Admin.backToTeams()">← Equipos</button>
        <div class="roster-team-info">
          <span class="roster-emblem">${renderEmblem(team, '2.5rem')}</span>
          <div>
            <h2 class="roster-team-name">${team.nombre}
              ${canManageTeams() ? `<button class="btn btn-sm btn-secondary" onclick="Admin.editTeam('${team.id}')" style="margin-left:8px;font-size:0.8rem;" title="Editar Equipo">✏️</button>` : ''}
              <button class="btn btn-sm btn-secondary" onclick="Admin.exportTeamCSV('${team.nombre}')" style="margin-left:8px;font-size:0.8rem;" title="Exportar Jugadores">⬇️ CSV</button>
            </h2>
            <span class="roster-team-count">${tp.length} jugador${tp.length !== 1 ? 'es' : ''}</span>
            ${team.entrenador ? `<div class="roster-team-contact">🧑‍🏫 Entrenador: <strong>${team.entrenador}</strong></div>` : ''}
            ${team.email ? `<div class="roster-team-contact">✉ <a href="mailto:${team.email}" style="color:var(--gold)">${team.email}</a></div>` : ''}
            ${team.telefono ? `<div class="roster-team-contact">📞 <a href="tel:${team.telefono}" style="color:var(--white-soft)">${team.telefono}</a></div>` : ''}
          </div>
        </div>
      </div>`;

    if (tp.length === 0) {
      html += `<div style="text-align:center;color:rgba(255,255,255,0.4);padding:40px 20px;">
        <p>Sin jugadores. Usa <strong style="color:var(--gold)">+ Nuevo Jugador</strong> o <strong style="color:var(--gold)">📄 CSV</strong>.</p></div>`;
    } else {
      html += '<div class="roster-grid">';
      for (const p of tp) {
        const isHab = p.estado === 'habilitado';
        const initials = p.nombre.split(' ').filter(w => w.length).slice(0, 2).map(w => w[0]).join('');
        let hash = 0;
        for (let i = 0; i < p.nombre.length; i++) hash = p.nombre.charCodeAt(i) + ((hash << 5) - hash);
        const hue = Math.abs(hash % 360);

        const avatarContent = p.foto
          ? `<img src="${p.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`
          : `<span class="roster-initials">${initials}</span>`;
        const avatarBg = p.foto ? '' : `background:linear-gradient(135deg,hsl(${hue},35%,28%),hsl(${hue},30%,18%))`;

        const pendienteAprobacion = p.aprobado === false;
        const fechaAltaStr = p.fechaAlta ? new Date(p.fechaAlta + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

        html += `
          <div class="roster-card ${p.estado}${pendienteAprobacion ? ' pendiente' : ''}" style="--shield-color:${team.color}">
            <div class="roster-avatar" style="${avatarBg}">
              ${avatarContent}
              <span class="roster-dorsal-badge">${p.dorsal}</span>
              ${p.verificado ? '<span class="roster-verified-badge" title="Verificado">✓</span>' : ''}
            </div>
            <div class="roster-card-info">
              <h3 class="roster-player-name">${p.nombre}</h3>
              <span class="roster-position">${p.posicion}</span>
              <div style="font-size:0.6rem;color:var(--white-muted);margin-top:2px;">AVG: ${p.stats && p.stats.avg ? p.stats.avg : '-'}</div>
              ${fechaAltaStr ? `<div style="font-size:0.55rem;color:var(--white-muted);margin-top:2px;">Alta: ${fechaAltaStr}</div>` : ''}
              ${canEdit && (p.email || p.telefono) ? `<div style="font-size:0.55rem;color:var(--white-muted);margin-top:2px;">${p.email ? '✉ ' + p.email : ''}${p.email && p.telefono ? ' · ' : ''}${p.telefono ? '📞 ' + p.telefono : ''}</div>` : ''}
            </div>
            ${pendienteAprobacion
              ? `<div class="roster-status pendiente"><span class="roster-status-dot"></span>Pendiente de aprobación</div>`
              : `<div class="roster-status ${p.estado}"><span class="roster-status-dot"></span>${isHab ? 'Habilitado' : 'Suspendido'}</div>`}
            <div class="roster-actions">
              ${canEdit ? `<button class="btn btn-sm btn-secondary" onclick="Admin.editPlayer('${p.id}')" title="Editar">✏️</button>` : ''}
              ${pendienteAprobacion && (isAdmin() || isSuperuser()) ? `<button class="btn btn-sm btn-success" onclick="Admin.aprobarJugador('${p.id}')" title="Aprobar jugador">✔ Aprobar</button>` : ''}
              ${!pendienteAprobacion && canToggleStatus() ? `<button class="btn btn-sm ${isHab ? 'btn-danger' : 'btn-success'}" onclick="Admin.toggleEstado('${p.id}')">${isHab ? '⛔' : '✅'}</button>` : ''}
              ${(isAdmin() || isSuperuser()) ? `<button class="btn btn-sm btn-danger" onclick="Admin.deletePlayer('${p.id}')" title="Eliminar jugador">🗑</button>` : ''}
              <button class="btn btn-sm btn-secondary" onclick="Admin.viewCard('${p.id}')">👁</button>
            </div>
          </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    c.innerHTML = html;
  }

  // ── ACTIONS ──
  function selectTeam(n) { selectedTeam = n; currentView = 'roster'; renderView(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function backToTeams() { selectedTeam = null; currentView = 'teams'; renderView(); }

  function toggleEstado(id) {
    const p = players.find(x => x.id === id); if (!p) return;
    p.estado = p.estado === 'habilitado' ? 'suspendido' : 'habilitado';
    autoSave(); renderView();
  }
  function toggleVerificado(id) {
    const p = players.find(x => x.id === id); if (!p) return;
    p.verificado = !p.verificado; autoSave(); renderView();
  }
  function aprobarJugador(id) {
    if (!isAdmin() && !isSuperuser()) return;
    const p = players.find(x => x.id === id); if (!p) return;
    p.aprobado = true;
    p.estado = 'habilitado';
    autoSave(); renderView();
  }
  function rechazarJugador(id) {
    if (!isAdmin() && !isSuperuser()) return;
    const p = players.find(x => x.id === id); if (!p) return;
    if (!confirm(`¿Rechazar y eliminar a ${p.nombre} del equipo ${p.equipo}?`)) return;
    players = players.filter(x => x.id !== id);
    autoSave(); renderView();
  }
  function deletePlayer(id) {
    if (!isAdmin() && !isSuperuser()) return;
    const p = players.find(x => x.id === id); if (!p) return;
    if (!confirm(`¿Eliminar a ${p.nombre} (#${p.dorsal}) del equipo ${p.equipo}?`)) return;
    players = players.filter(x => x.id !== id);
    autoSave(); renderView();
  }
  function generateId() {
    if (players.length === 0) return '001';
    return String(Math.max(...players.map(p => parseInt(p.id, 10) || 0)) + 1).padStart(3, '0');
  }

  // ── PHOTO UPLOAD ──
  function readFileAsDataURL(file, maxW) {
    return new Promise(resolve => {
      // Use createImageBitmap for proper EXIF orientation handling
      createImageBitmap(file).then(bitmap => {
        const canvas = document.createElement('canvas');
        const s = Math.min(1, maxW / bitmap.width);
        canvas.width = bitmap.width * s;
        canvas.height = bitmap.height * s;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/webp', 0.75));
      });
    });
  }

  // Auto-crop black areas from photos saved with EXIF orientation bug
  function cropBlackAreas(dataURL) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        // Find rightmost non-black column
        let rightEdge = canvas.width;
        for (let x = canvas.width - 1; x >= 0; x--) {
          let hasContent = false;
          for (let y = 0; y < canvas.height; y += 4) {
            const i = (y * canvas.width + x) * 4;
            if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) {
              hasContent = true; break;
            }
          }
          if (hasContent) { rightEdge = x + 1; break; }
        }

        // Find bottom non-black row
        let bottomEdge = canvas.height;
        for (let y = canvas.height - 1; y >= 0; y--) {
          let hasContent = false;
          for (let x = 0; x < canvas.width; x += 4) {
            const i = (y * canvas.width + x) * 4;
            if (data[i] > 10 || data[i + 1] > 10 || data[i + 2] > 10) {
              hasContent = true; break;
            }
          }
          if (hasContent) { bottomEdge = y + 1; break; }
        }

        // Only crop if we detected significant black area (>15% of dimension)
        if (rightEdge < canvas.width * 0.85 || bottomEdge < canvas.height * 0.85) {
          const cropped = document.createElement('canvas');
          cropped.width = rightEdge;
          cropped.height = bottomEdge;
          cropped.getContext('2d').drawImage(canvas, 0, 0, rightEdge, bottomEdge, 0, 0, rightEdge, bottomEdge);
          resolve(cropped.toDataURL('image/webp', 0.75));
        } else {
          resolve(null); // No significant black area, keep original
        }
      };
      img.src = dataURL;
    });
  }

  // Migrate existing photos to remove black areas (runs once)
  async function migratePhotos() {
    let changed = false;
    for (const p of players) {
      if (p.foto && p.foto.startsWith('data:')) {
        const cropped = await cropBlackAreas(p.foto);
        if (cropped) { p.foto = cropped; changed = true; }
      }
    }
    if (changed) { autoSave(); console.log('Photos migrated: black areas removed'); }
  }
  function handlePlayerPhotoChange() {
    const f = document.getElementById('inp-foto').files[0];
    if (!f) return; // Keep existing if cancelled? logic handled in save
    readFileAsDataURL(f, 300).then(u => { pendingPlayerPhoto = u; document.getElementById('foto-preview-img').src = u; document.getElementById('foto-preview').style.display = 'block'; });
  }
  function handleTeamImageChange() {
    const f = document.getElementById('team-imagen').files[0];
    if (!f) return;
    readFileAsDataURL(f, 200).then(u => { pendingTeamImage = u; document.getElementById('team-imagen-preview-img').src = u; document.getElementById('team-imagen-preview').style.display = 'block'; });
  }

  // ── EDIT TEAM ──
  function editTeam(id) {
    const team = equipos.find(e => e.id === id);
    if (!team) return;

    document.getElementById('modal-add-team').querySelector('.modal-title').textContent = 'Editar Equipo';
    document.getElementById('modal-add-team').querySelector('button[type="submit"]').textContent = 'Guardar Cambios';

    document.getElementById('team-original-name').value = team.nombre;
    document.getElementById('team-nombre').value = team.nombre;
    document.getElementById('team-escudo').value = team.escudo || '🥎';
    document.getElementById('team-color').value = team.color || '#f5a623';
    document.getElementById('team-entrenador').value = team.entrenador || '';
    document.getElementById('team-email').value = team.email || '';
    document.getElementById('team-telefono').value = team.telefono || '';

    // Handle image preview
    if (team.imagen) {
      document.getElementById('team-imagen-preview-img').src = team.imagen;
      document.getElementById('team-imagen-preview').style.display = 'block';
      pendingTeamImage = team.imagen; // Pre-fill pending with existing
    } else {
      document.getElementById('team-imagen-preview').style.display = 'none';
      pendingTeamImage = '';
    }
    document.getElementById('team-imagen').value = ''; // Reset file input

    openModal('modal-add-team');
  }

  // ── DELETE TEAM ──
  function deleteTeam(id) {
    const team = equipos.find(e => e.id === id);
    if (!team) return;
    const tp = getTeamPlayers(team.nombre);

    if (tp.length > 0) {
      const choice = confirm(`El equipo "${team.nombre}" tiene ${tp.length} jugador(es).\n\n¿Quieres borrar también los jugadores?\n\n- Aceptar = Borrar equipo Y jugadores\n- Cancelar = No borrar nada`);
      if (!choice) {
        const keepTeam = confirm(`¿Quieres borrar SOLO el equipo y dejar los jugadores sin equipo?`);
        if (!keepTeam) return;
        // Remove team only, players stay with orphaned team name
      } else {
        // Delete players too
        players = players.filter(p => p.equipo !== team.nombre);
      }
    } else {
      if (!confirm(`¿Borrar el equipo "${team.nombre}"?`)) return;
    }

    equipos = equipos.filter(e => e.id !== id);
    autoSave();
    renderView();
  }

  // ── EDIT PLAYER ──
  function editPlayer(id) {
    const p = players.find(x => x.id === id);
    if (!p) return;

    document.getElementById('modal-add-player').querySelector('.modal-title').textContent = 'Editar Jugador';
    document.getElementById('modal-add-player').querySelector('button[type="submit"]').textContent = 'Guardar Cambios';

    document.getElementById('inp-id').value = p.id;
    document.getElementById('inp-nombre').value = p.nombre;
    document.getElementById('inp-dorsal').value = p.dorsal;
    document.getElementById('inp-posicion').value = p.posicion;
    document.getElementById('inp-equipo').value = p.equipo;
    document.getElementById('inp-email').value = p.email || '';
    document.getElementById('inp-telefono').value = p.telefono || '';
    document.getElementById('inp-estado').value = p.estado;
    document.getElementById('inp-verificado').value = p.verificado.toString();
    document.getElementById('inp-altura').value = p.altura || '';
    document.getElementById('inp-peso').value = p.peso || '';
    document.getElementById('inp-edad').value = p.edad || '';

    // Stats
    const s = p.stats || {};
    document.getElementById('inp-avg').value = s.avg || '';
    document.getElementById('inp-hr').value = s.hr || '';
    document.getElementById('inp-rbi').value = s.rbi || '';
    document.getElementById('inp-h').value = s.h || '';
    document.getElementById('inp-ab').value = s.ab || '';
    document.getElementById('inp-r').value = s.r || '';

    if (p.foto) {
      document.getElementById('foto-preview-img').src = p.foto;
      document.getElementById('foto-preview').style.display = 'block';
      pendingPlayerPhoto = p.foto;
    } else {
      document.getElementById('foto-preview').style.display = 'none';
      pendingPlayerPhoto = '';
    }
    document.getElementById('inp-foto').value = '';

    // Show fecha de alta
    const fechaInfo = document.getElementById('fecha-alta-info');
    const fechaDisplay = document.getElementById('fecha-alta-display');
    if (p.fechaAlta) {
      const fechaStr = new Date(p.fechaAlta + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      const aprobadoStr = p.aprobado === false ? ' · Pendiente de aprobación' : ' · Aprobado';
      fechaDisplay.innerHTML = fechaStr + `<span style="color:${p.aprobado === false ? '#ffa000' : 'var(--green)'};margin-left:4px;">${aprobadoStr}</span>`;
      fechaInfo.style.display = '';
    } else {
      fechaInfo.style.display = 'none';
    }

    // Restrict fields for delegado
    const restricted = isDelegado();
    ['inp-estado', 'inp-verificado'].forEach(id => {
      document.getElementById(id).disabled = restricted;
    });
    ['inp-avg', 'inp-hr', 'inp-rbi', 'inp-h', 'inp-ab', 'inp-r'].forEach(id => {
      document.getElementById(id).disabled = restricted;
    });

    openModal('modal-add-player');
  }

  // ── SAVE TEAM (CREATE/UPDATE) ──
  function saveTeam(e) {
    e.preventDefault();
    const originalName = document.getElementById('team-original-name').value;
    const nombre = document.getElementById('team-nombre').value.trim();
    if (!nombre) return;

    // Check duplicate if name changed or new team
    if ((!originalName || originalName !== nombre) && equipos.find(x => x.nombre.toLowerCase() === nombre.toLowerCase())) {
      alert('Ya existe un equipo con ese nombre.');
      return;
    }

    if (originalName) {
      // EDIT MODE
      const team = equipos.find(e => e.nombre === originalName);
      if (team) {
        team.nombre = nombre;
        // Update ID if name changes? Better keep ID stable if possible, but our ID is name-based.
        // Let's update ID too to keep consistency, but strictly speaking ID should be immutable.
        // For this simple app, updating ID is fine if we update refs.
        const newId = nombre.toLowerCase().replace(/\s+/g, '-');
        team.id = newId;

        team.escudo = document.getElementById('team-escudo').value.trim() || '🥎';
        team.color = document.getElementById('team-color').value;
        team.entrenador = document.getElementById('team-entrenador').value.trim() || '';
        team.email = document.getElementById('team-email').value.trim() || '';
        team.telefono = document.getElementById('team-telefono').value.trim() || '';
        if (pendingTeamImage) team.imagen = pendingTeamImage;

        // Cascade update players and matches if name changed
        if (originalName !== nombre) {
          players.forEach(p => { if (p.equipo === originalName) p.equipo = nombre; });
          partidos.forEach(m => {
            if (m.local === originalName) m.local = nombre;
            if (m.visitante === originalName) m.visitante = nombre;
          });
          if (selectedTeam === originalName) selectedTeam = nombre;
        }
      }
    } else {
      // CREATE MODE
      equipos.push({
        id: nombre.toLowerCase().replace(/\s+/g, '-'),
        nombre, nombreCorto: nombre.split(' ')[0],
        color: document.getElementById('team-color').value,
        colorSecundario: '#1a1a2e',
        escudo: document.getElementById('team-escudo').value.trim() || '🥎',
        imagen: pendingTeamImage || '',
        email: document.getElementById('team-email').value.trim() || '',
        telefono: document.getElementById('team-telefono').value.trim() || '',
        entrenador: document.getElementById('team-entrenador').value.trim() || ''
      });
    }

    pendingTeamImage = ''; autoSave(); closeModal('modal-add-team'); renderView();
    document.getElementById('add-team-form').reset();
    document.getElementById('team-imagen-preview').style.display = 'none';
  }

  // ── SAVE PLAYER (CREATE/UPDATE) ──
  function savePlayer(e) {
    e.preventDefault();
    const id = document.getElementById('inp-id').value;
    const eq = document.getElementById('inp-equipo').value;

    if (!eq) { alert('Selecciona un equipo.'); return; }

    const stats = {
      avg: document.getElementById('inp-avg').value,
      hr: document.getElementById('inp-hr').value,
      rbi: document.getElementById('inp-rbi').value,
      h: document.getElementById('inp-h').value,
      ab: document.getElementById('inp-ab').value,
      r: document.getElementById('inp-r').value
    };

    if (id) {
      // EDIT
      const p = players.find(x => x.id === id);
      if (p) {
        p.nombre = document.getElementById('inp-nombre').value.trim();
        p.dorsal = parseInt(document.getElementById('inp-dorsal').value, 10);
        p.equipo = eq;
        p.posicion = document.getElementById('inp-posicion').value;
        p.estado = document.getElementById('inp-estado').value;
        p.verificado = document.getElementById('inp-verificado').value === 'true';
        p.altura = document.getElementById('inp-altura').value.trim();
        p.peso = document.getElementById('inp-peso').value.trim();
        p.edad = document.getElementById('inp-edad').value.trim();
        p.email = document.getElementById('inp-email').value.trim();
        p.telefono = document.getElementById('inp-telefono').value.trim();
        p.stats = stats;
        if (pendingPlayerPhoto) p.foto = pendingPlayerPhoto;
      }
    } else {
      // CREATE
      const creadoPorDelegado = isDelegado();
      players.push({
        id: generateId(),
        nombre: document.getElementById('inp-nombre').value.trim(),
        dorsal: parseInt(document.getElementById('inp-dorsal').value, 10),
        equipo: eq,
        posicion: document.getElementById('inp-posicion').value,
        foto: pendingPlayerPhoto || '',
        estado: creadoPorDelegado ? 'suspendido' : document.getElementById('inp-estado').value,
        verificado: creadoPorDelegado ? false : document.getElementById('inp-verificado').value === 'true',
        altura: document.getElementById('inp-altura').value.trim(),
        peso: document.getElementById('inp-peso').value.trim(),
        edad: document.getElementById('inp-edad').value.trim(),
        email: document.getElementById('inp-email').value.trim(),
        telefono: document.getElementById('inp-telefono').value.trim(),
        temporada: new Date().getFullYear().toString(),
        fechaAlta: new Date().toISOString().split('T')[0],
        aprobado: creadoPorDelegado ? false : true,
        stats: stats
      });
      if (creadoPorDelegado) {
        alert('Jugador creado como pendiente de aprobación. Un superusuario o admin debe aprobar su inclusión en el equipo.');
      }
    }

    pendingPlayerPhoto = ''; autoSave(); closeModal('modal-add-player'); renderView();
    document.getElementById('add-player-form').reset();
    document.getElementById('foto-preview').style.display = 'none';
  }

  function resetModalTitles() {
    // Reset to "Create" mode when opening via "New" buttons
    // This is handled in the click listeners for the "New" buttons
    const teamTitle = document.getElementById('modal-add-team').querySelector('.modal-title');
    const teamBtn = document.getElementById('modal-add-team').querySelector('button[type="submit"]');
    teamTitle.textContent = '🛡 Nuevo Equipo';
    teamBtn.textContent = 'Crear Equipo';
    document.getElementById('team-original-name').value = '';
    document.getElementById('add-team-form').reset();
    document.getElementById('team-imagen-preview').style.display = 'none';
    pendingTeamImage = '';

    const playerTitle = document.getElementById('modal-add-player').querySelector('.modal-title');
    const playerBtn = document.getElementById('modal-add-player').querySelector('button[type="submit"]');
    playerTitle.textContent = 'Nuevo Jugador';
    playerBtn.textContent = 'Guardar Jugador';
    document.getElementById('inp-id').value = '';
    document.getElementById('add-player-form').reset();
    document.getElementById('foto-preview').style.display = 'none';
    document.getElementById('fecha-alta-info').style.display = 'none';
    pendingPlayerPhoto = '';
    // Re-enable fields that may have been disabled for delegado
    ['inp-estado', 'inp-verificado', 'inp-avg', 'inp-hr', 'inp-rbi', 'inp-h', 'inp-ab', 'inp-r'].forEach(id => {
      document.getElementById(id).disabled = isDelegado();
    });
  }

  // ── CSV ──
  function handleCSVFile() {
    const file = document.getElementById('csv-file').files[0];
    const preview = document.getElementById('csv-preview');
    if (!file) { preview.style.display = 'none'; csvParsedData = []; return; }
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
      csvParsedData = [];
      const start = (lines[0] && lines[0].toLowerCase().includes('nombre')) ? 1 : 0;
      for (let i = start; i < lines.length; i++) {
        const p = lines[i].split(';').map(s => s.trim());
        if (p.length >= 3) {
          csvParsedData.push({
            nombre: p[0], dorsal: parseInt(p[1], 10) || 0, equipo: p[2],
            posicion: p[3] || 'Utility', estado: (p[4] || 'habilitado').toLowerCase(),
            altura: p[5] || '', peso: p[6] || '', edad: p[7] || '',
            avg: p[8] || '', hr: p[9] || '', rbi: p[10] || '', h: p[11] || '', ab: p[12] || '', r: p[13] || ''
          });
        }
      }
      if (csvParsedData.length > 0) {
        let h = `<div style="font-family:var(--font-display);font-size:0.7rem;letter-spacing:1px;color:var(--green);margin-bottom:8px;">✓ ${csvParsedData.length} JUGADORES</div>`;
        h += '<div style="max-height:150px;overflow-y:auto;background:var(--bg-card-inner);border-radius:8px;padding:8px 12px;">';
        csvParsedData.slice(0, 10).forEach(p => { h += `<div style="font-size:0.75rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03);color:var(--white-soft);">#${p.dorsal} ${p.nombre} — <span style="color:var(--white-muted)">${p.equipo}</span></div>`; });
        if (csvParsedData.length > 10) h += `<div style="font-size:0.7rem;padding:6px 0;color:var(--white-muted)">...y ${csvParsedData.length - 10} más</div>`;
        h += '</div>';
        preview.innerHTML = h;
      } else {
        preview.innerHTML = '<div style="color:var(--red);font-size:0.8rem">⚠ Sin datos válidos.</div>';
      }
      preview.style.display = 'block';
    };
    reader.readAsText(file, 'UTF-8');
  }

  function confirmImport() {
    if (!csvParsedData.length) { alert('Sube un CSV primero.'); return; }
    let n = 0;
    for (const row of csvParsedData) {
      if (row.equipo && !equipos.find(e => e.nombre === row.equipo)) {
        equipos.push({ id: row.equipo.toLowerCase().replace(/\s+/g, '-'), nombre: row.equipo, nombreCorto: row.equipo.split(' ')[0], color: '#f5a623', colorSecundario: '#1a1a2e', escudo: '🥎', imagen: '', email: '', telefono: '' });
      }
      players.push({
        id: generateId(), nombre: row.nombre, dorsal: row.dorsal, equipo: row.equipo,
        posicion: row.posicion, foto: '', estado: row.estado === 'suspendido' ? 'suspendido' : 'habilitado',
        verificado: false, temporada: new Date().getFullYear().toString(),
        fechaAlta: new Date().toISOString().split('T')[0],
        aprobado: true,
        altura: row.altura, peso: row.peso, edad: row.edad,
        stats: { avg: row.avg, hr: row.hr, rbi: row.rbi, h: row.h, ab: row.ab, r: row.r }
      });
      n++;
    }
    autoSave(); csvParsedData = []; closeModal('modal-import-csv');
    document.getElementById('csv-file').value = '';
    document.getElementById('csv-preview').style.display = 'none';
    renderView(); alert(`✅ ${n} jugadores importados.`);
  }

  function downloadCSVTemplate() {
    const t = 'Nombre;Dorsal;Equipo;Posicion;Estado;Altura;Peso;Edad;AVG;HR;RBI;H;AB;R\nCarlos Mendoza;7;Tigres de Vallecas;Pitcher;habilitado;1.80;85;42;.320;5;12;24;75;10\n';
    const b = new Blob(['\ufeff' + t], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'plantilla_jugadores.csv'; a.click();
  }

  // ── EXPORT / RESET ──
  function exportJSON() {
    const j = JSON.stringify({ equipos, jugadores: players, partidos }, null, 2);
    const b = new Blob([j], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'players.json'; a.click();
  }
  function resetData() {
    if (!confirm('⚠️ Borrar TODOS los cambios y volver a los datos originales?')) return;
    AppStore.reset(); location.reload();
  }

  function generateDemoData() {
    if (!confirm('⚠️ Esto GENERARÁ una liga completa de demostración con 12 equipos y ~180 jugadores, y 40 partidos. Si ya existen datos, se añadirán. ¿Continuar?')) return;

    // 1. Generate Teams (At least 12 total)
    const demoTeams = [
      { n: 'Tigres de Vallecas', c: '#ff6b6b', s: '🐯' },
      { n: 'Leones de Alcorcón', c: '#feca57', s: '🦁' },
      { n: 'Águilas Imperiales', c: '#54a0ff', s: '🦅' },
      { n: 'Piratas del Caribe', c: '#00d2d3', s: '🏴‍☠️' },
      { n: 'Gigantes de Madrid', c: '#ff9f43', s: '🗽' },
      { n: 'Bravos del Norte', c: '#5f27cd', s: '🏹' },
      { n: 'Cardenales Rojos', c: '#ee5253', s: '🐦' },
      { n: 'Mets de Getafe', c: '#2e86de', s: '⚾' },
      { n: 'Yankees de Leganés', c: '#222f3e', s: '🎩' },
      { n: 'Red Sox Móstoles', c: '#c0392b', s: '🧦' },
      { n: 'Astros de Pozuelo', c: '#e67e22', s: '🚀' },
      { n: 'Dodgers de Rivas', c: '#2980b9', s: '🧢' }
    ];

    demoTeams.forEach(t => {
      if (!equipos.find(e => e.nombre === t.n)) {
        equipos.push({
          id: t.n.toLowerCase().replace(/\s+/g, '-'),
          nombre: t.n,
          nombreCorto: t.n.split(' ')[0],
          color: t.c,
          colorSecundario: '#1a1a2e',
          escudo: t.s,
          imagen: '',
          email: `${t.n.toLowerCase().replace(/\s/g, '.')}@ligapanama.com`,
          telefono: '600' + Math.floor(Math.random() * 1000000)
        });
      }
    });

    // 2. Generate Players (At least 15 per team)
    const positions = ['Pitcher', 'Catcher', 'Primera Base', 'Segunda Base', 'Tercera Base', 'Shortstop', 'Left Field', 'Center Field', 'Right Field', 'Shortfield', 'Utility'];
    const names = ['Carlos', 'Juan', 'Pedro', 'Luis', 'José', 'Miguel', 'Angel', 'David', 'Jorge', 'Fernando', 'Ramón', 'Antonio', 'Manuel', 'Francisco', 'Javier', 'Roberto', 'Ricardo', 'Daniel', 'Eduardo', 'Hector'];
    const surnames = ['García', 'Rodríguez', 'López', 'Martínez', 'González', 'Pérez', 'Sánchez', 'Romero', 'Díaz', 'Muñoz', 'Álvarez', 'Ruiz', 'Alonso', 'Gómez', 'Fernández', 'Jiménez', 'Moreno', 'Vargas', 'Mendoza', 'Silva'];

    equipos.forEach(team => {
      const currentPlayers = players.filter(p => p.equipo === team.nombre);
      const needed = 15 - currentPlayers.length;

      for (let i = 0; i < needed; i++) {
        const nm = names[Math.floor(Math.random() * names.length)];
        const sn = surnames[Math.floor(Math.random() * surnames.length)];
        const sn2 = surnames[Math.floor(Math.random() * surnames.length)];
        const fullName = `${nm} ${sn} ${sn2}`;

        players.push({
          id: generateId(), // ensure generateId uses updated players array length if it relies on it? It relies on players array content.
          nombre: fullName,
          dorsal: Math.floor(Math.random() * 99).toString(),
          equipo: team.nombre,
          posicion: positions[Math.floor(Math.random() * positions.length)],
          foto: '',
          estado: Math.random() > 0.9 ? 'suspendido' : 'habilitado',
          verificado: Math.random() > 0.5,
          temporada: new Date().getFullYear().toString(),
          fechaAlta: new Date(new Date().getFullYear(), Math.floor(Math.random() * 3), Math.floor(1 + Math.random() * 28)).toISOString().split('T')[0],
          aprobado: true,
          altura: (1.70 + Math.random() * 0.3).toFixed(2),
          peso: Math.floor(70 + Math.random() * 40),
          edad: Math.floor(40 + Math.random() * 15),
          stats: { avg: '.000', hr: 0, rbi: 0, h: 0, ab: 0, r: 0 }
        });
      }
    });

    // 3. Generate Matches (40 matches) for Calendar
    // Dates from May to Aug
    const startObj = new Date(new Date().getFullYear() + '-05-01');
    const newMatches = [];

    // Create random pairings
    for (let i = 0; i < 40; i++) {
      const home = equipos[Math.floor(Math.random() * equipos.length)];
      let away = equipos[Math.floor(Math.random() * equipos.length)];
      while (away.id === home.id) away = equipos[Math.floor(Math.random() * equipos.length)]; // retry

      // Date increments
      const d = new Date(startObj);
      d.setDate(d.getDate() + Math.floor(i * 2.5)); // spaced out
      const dateStr = d.toISOString().split('T')[0];

      const m = {
        id: 'demo-' + Date.now() + '-' + i,
        fecha: dateStr,
        hora: `${Math.floor(9 + Math.random() * 8)}:00`,
        campo: ['Campo 1', 'Campo 2', 'Estadio Municipal'][Math.floor(Math.random() * 3)],
        jornada: `Jornada ${Math.floor(i / 4) + 1}`,
        local: home.nombre,
        visitante: away.nombre,
        arbitro: 'Árbitro Demo',
        playerStats: {}
      };

      // 4. Generate Stats for this match
      const homePlayers = players.filter(p => p.equipo === home.nombre);
      const awayPlayers = players.filter(p => p.equipo === away.nombre);

      [...homePlayers, ...awayPlayers].forEach(p => {
        if (Math.random() > 0.3) { // 70% chance to play
          const ab = Math.floor(Math.random() * 5) + 1;
          const h = Math.floor(Math.random() * (ab + 1)); // Hits <= AB
          // boost hits slightly for fun
          const hr = (h > 0 && Math.random() > 0.9) ? 1 : 0;
          const rbi = (h > 0) ? Math.floor(Math.random() * 3) : 0;
          const r = (h > 0) ? Math.floor(Math.random() * 2) : 0;

          m.playerStats[p.id] = { ab, h, hr, rbi, r };

          // Accumulate to total stats
          if (!p.stats) p.stats = { ab: 0, h: 0, hr: 0, rbi: 0, r: 0 };
          p.stats.ab = (parseInt(p.stats.ab) || 0) + ab;
          p.stats.h = (parseInt(p.stats.h) || 0) + h;
          p.stats.hr = (parseInt(p.stats.hr) || 0) + hr;
          p.stats.rbi = (parseInt(p.stats.rbi) || 0) + rbi;
          p.stats.r = (parseInt(p.stats.r) || 0) + r;
          p.stats.avg = p.stats.ab > 0 ? (p.stats.h / p.stats.ab).toFixed(3).replace(/^0+/, '') : '.000';
        }
      });

      newMatches.push(m);
    }

    partidos = [...partidos, ...newMatches];

    // Sort matches by date
    partidos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    autoSave();
    alert(`✅ LIGA DEMO GENERADA:\n- ${equipos.length} Equipos\n- ${players.length} Jugadores\n- ${newMatches.length} Partidos nuevos\n\nRecargando...`);
    location.reload();
  }

  // ── STANDINGS VIEW ──
  function renderStandings() {
    const c = document.getElementById('main-content');
    if (equipos.length === 0) {
      c.innerHTML = '<div style="text-align:center;padding:40px;">No hay equipos.</div>';
      return;
    }

    // Calculate standings from matches first
    const calculatedStats = {};
    equipos.forEach(e => {
      calculatedStats[e.nombre] = { w: 0, l: 0, c: 0 }; // Added 'c' (carreras)
    });

    partidos.forEach(m => {
      let ls = 0, vs = 0;
      if (m.playerStats) {
        Object.entries(m.playerStats).forEach(([pid, s]) => {
          const p = players.find(x => x.id === pid);
          if (p) {
            if (p.equipo === m.local) ls += (s.r || 0);
            if (p.equipo === m.visitante) vs += (s.r || 0);
          }
        });
      }

      // Update Total Runs
      if (calculatedStats[m.local]) calculatedStats[m.local].c += ls;
      if (calculatedStats[m.visitante]) calculatedStats[m.visitante].c += vs;

      if (calculatedStats[m.local] && calculatedStats[m.visitante]) {
        if (ls > vs) { calculatedStats[m.local].w++; calculatedStats[m.visitante].l++; }
        else if (vs > ls) { calculatedStats[m.visitante].w++; calculatedStats[m.local].l++; }
      }
    });

    // Merge with manual overrides if present
    const finalStats = equipos.map(e => {
      const manual = e.manualStats || {};
      // Use manual if valid number, else calculated
      const w = (manual.w !== undefined && manual.w !== '') ? parseInt(manual.w, 10) : calculatedStats[e.nombre].w;
      const l = (manual.l !== undefined && manual.l !== '') ? parseInt(manual.l, 10) : calculatedStats[e.nombre].l;
      const c = calculatedStats[e.nombre].c; // Runs are always calculated from matches for now

      return {
        name: e.nombre,
        id: e.id,
        logo: e.escudo,
        img: e.imagen,
        w: w || 0,
        l: l || 0,
        c: c || 0,
        isManual: (manual.w !== undefined || manual.l !== undefined)
      };
    });

    finalStats.sort((a, b) => b.w - a.w || a.l - b.l); // Sort by Wins desc

    // Calculate DIF (Games Back)
    const leaderFn = finalStats.length > 0 ? { w: finalStats[0].w, l: finalStats[0].l } : { w: 0, l: 0 };

    let html = `
      <div class="standings-container" style="max-width:900px;margin:0 auto;animation:fadeIn 0.5s ease;">
        <h2 style="font-family:var(--font-display);color:var(--gold);text-align:center;margin-bottom:20px;letter-spacing:2px;">TABLA CLASIFICATORIA</h2>
        
        <div style="background:var(--bg-card);border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);margin-bottom:20px;">
          <table style="width:100%;border-collapse:collapse;color:var(--white);">
            <thead>
              <tr style="background:rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.1);">
                <th style="padding:15px;text-align:left;font-family:var(--font-display);font-size:0.8rem;letter-spacing:1px;color:var(--white-muted);">EQUIPO</th>
                <th style="padding:15px;text-align:center;width:60px;" title="Victorias">W</th>
                <th style="padding:15px;text-align:center;width:60px;" title="Derrotas">L</th>
                <th style="padding:15px;text-align:center;width:70px;">AVG</th>
                <th style="padding:15px;text-align:center;width:60px;" title="Diferencia">DIF</th>
                <th style="padding:15px;text-align:center;width:60px;" title="Carreras Totales">C</th>
              </tr>
            </thead>
            <tbody>`;

    finalStats.forEach((t, i) => {
      const avg = (t.w + t.l) > 0 ? (t.w / (t.w + t.l)).toFixed(3).replace(/^0+/, '') : '.000';

      // GB Calculation: ((LeaderW - TeamW) + (TeamL - LeaderL)) / 2
      // Standard Formula: GB = ((FirstPlaceWins - TeamWins) + (TeamLosses - FirstPlaceLosses)) / 2
      const gb = i === 0 ? '-' : (((leaderFn.w - t.w) + (t.l - leaderFn.l)) / 2).toFixed(1).replace('.0', '');

      const bg = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent';
      const emblem = t.img
        ? `<img src="${t.img}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;margin-right:8px;">`
        : `<span style="margin-right:8px;">${t.logo || '🥎'}</span>`;

      const manualIndicator = t.isManual ? '<span style="color:var(--gold);font-size:0.6rem;margin-left:4px;" title="Editado manualmente">•</span>' : '';

      html += `
        <tr style="background:${bg};border-bottom:1px solid rgba(255,255,255,0.02);">
          <td style="padding:12px 15px;font-weight:600;">
            <span style="color:var(--gold);margin-right:10px;font-size:0.8rem;">${i + 1}</span>
            ${emblem} ${t.name}
          </td>
          <td style="padding:8px;text-align:center;">
             <input type="number" class="form-input" style="width:40px;text-align:center;padding:2px;font-size:0.9rem;background:rgba(0,0,0,0.3);border:none;"
                    value="${t.w}" min="0" onchange="Admin.updateStanding('${t.id}', 'w', this.value)">
          </td>
          <td style="padding:8px;text-align:center;">
             <input type="number" class="form-input" style="width:40px;text-align:center;padding:2px;font-size:0.9rem;background:rgba(0,0,0,0.3);border:none;"
                    value="${t.l}" min="0" onchange="Admin.updateStanding('${t.id}', 'l', this.value)">
          </td>
          <td style="padding:12px 15px;text-align:center;font-family:monospace;color:var(--blue-check);">
             ${avg} ${manualIndicator}
          </td>
          <td style="padding:12px 15px;text-align:center;font-weight:700;">${gb}</td>
          <td style="padding:12px 15px;text-align:center;">${t.c}</td>
        </tr>`;
    });

    html += `</tbody></table></div>
       <div style="text-align:center;margin-bottom:30px;">
         <button class="btn btn-sm btn-secondary" onclick="Admin.resetStandings()">🔄 Recalcular desde Partidos</button>
       </div>

       ${renderLeaders()}
    </div>`;
    c.innerHTML = html;
  }

  function renderLeaders() {
    // Recalc to ensure stats are up to date
    recalcAllPlayerStats();

    // Categories to show
    const categories = [
      { key: 'avg', label: 'AVG (Promedio)', format: v => v, icon: '🎯', minAB: 5 },
      { key: 'hr', label: 'HR (Home Runs)', format: v => v, icon: '💣' },
      { key: 'h', label: 'H (Hits)', format: v => v, icon: '🏏' },
      { key: 'rbi', label: 'RBI (Carreras Impulsadas)', format: v => v, icon: '💪' },
      { key: 'r', label: 'R (Carreras Anotadas)', format: v => v, icon: '🏃' },
      { key: 'ab', label: 'AB (Turnos al Bate)', format: v => v, icon: '⚾' },
      { key: 'doubles', label: '2B (Dobles)', format: v => v, icon: '✌' },
      { key: 'triples', label: '3B (Triples)', format: v => v, icon: '🔥' },
      { key: 'bb', label: 'BB (Bases por Bolas)', format: v => v, icon: '👁' },
      { key: 'sb', label: 'SB (Bases Robadas)', format: v => v, icon: '⚡' },
    ];

    let html = `<h2 style="font-family:var(--font-display);color:var(--gold);text-align:center;margin:30px 0 20px;letter-spacing:2px;">🏆 LÍDERES DE LA LIGA</h2>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(340px, 1fr));gap:16px;">`;

    for (const cat of categories) {
      // Get players with stats, filter and sort
      let ranked = players
        .filter(p => p.stats && p.aprobado !== false)
        .map(p => ({ ...p, val: cat.key === 'avg' ? parseFloat(p.stats.avg) || 0 : (p.stats[cat.key] || 0) }));

      // For AVG, require minimum at-bats
      if (cat.minAB) {
        ranked = ranked.filter(p => (p.stats.ab || 0) >= cat.minAB);
      }

      // Filter out zeros (except AVG where 0 is meaningful if they have ABs)
      if (cat.key !== 'avg') {
        ranked = ranked.filter(p => p.val > 0);
      }

      ranked.sort((a, b) => b.val - a.val);
      const top10 = ranked.slice(0, 10);

      if (top10.length === 0) continue;

      html += `<div style="background:var(--bg-card);border-radius:14px;padding:16px;border:1px solid rgba(255,255,255,0.05);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:1.2rem;">${cat.icon}</span>
          <span style="font-family:var(--font-display);font-size:0.85rem;letter-spacing:1px;color:var(--gold);text-transform:uppercase;">${cat.label}</span>
        </div>`;

      top10.forEach((p, i) => {
        const team = equipos.find(e => e.nombre === p.equipo);
        const teamEmoji = team ? (team.escudo || '🥎') : '🥎';
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:var(--white-muted);font-size:0.75rem;width:20px;display:inline-block;text-align:center;">${i + 1}</span>`;
        const displayVal = cat.key === 'avg' ? (p.val === 0 ? '.000' : p.val.toFixed(3).replace(/^0+/, '')) : p.val;
        const highlight = i === 0 ? 'color:var(--gold);font-weight:800;font-size:1rem;' : 'color:var(--white);font-weight:600;';

        html += `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;${i < top10.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.02);' : ''}"
          onclick="Admin.viewCard('${p.id}')" title="Ver ficha" style="cursor:pointer;">
          <span style="width:24px;text-align:center;">${medal}</span>
          <span style="font-size:0.8rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${p.nombre} <span style="font-size:0.65rem;color:var(--white-muted);">${teamEmoji}</span>
          </span>
          <span style="${highlight}font-family:monospace;">${displayVal}</span>
        </div>`;
      });

      html += `</div>`;
    }

    html += `</div>`;
    return html;
  }

  function updateStanding(teamId, field, value) {
    const t = equipos.find(e => e.id === teamId);
    if (!t) return;
    if (!t.manualStats) t.manualStats = {};
    t.manualStats[field] = parseInt(value, 10);
    autoSave();
    renderStandings(); // Re-render to sort
  }

  function resetStandings() {
    if (!confirm('¿Restablecer clasificatoria a cálculo automático basado en partidos?')) return;
    equipos.forEach(e => delete e.manualStats);
    autoSave();
    renderStandings();
  }

  // ── CALENDAR VIEW ──
  function renderCalendar() {
    const c = document.getElementById('main-content');
    if (partidos.length === 0) {
      c.innerHTML = `<div style="text-align:center;padding:40px;color:rgba(255,255,255,0.4);">
        <p>No hay partidos programados.</p>
        ${(isAdmin() || isSuperuser()) ? `<button class="btn btn-primary" onclick="Admin.openCreateMatch()" style="margin-top:10px;">+ Crear Primer Partido</button>` : ''}
        <button class="btn btn-secondary" onclick="Admin.generateDemoData()" style="margin-top:10px;margin-left:8px;">🎲 Generar Demo</button>
      </div>`;
      return;
    }

    // Sort by date desc
    const sorted = [...partidos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    // Calculate scores 
    sorted.forEach(m => {
      let ls = 0, vs = 0;
      if (m.playerStats) {
        Object.entries(m.playerStats).forEach(([pid, s]) => {
          const p = players.find(x => x.id === pid);
          if (p) {
            if (p.equipo === m.local) ls += (s.r || 0);
            if (p.equipo === m.visitante) vs += (s.r || 0);
          }
        });
      }
      m.localScore = ls; m.visitScore = vs;
    });

    let html = '<div class="calendar-list" style="max-width:800px;margin:0 auto;">';

    // Create match button (admin, superusuario only)
    if (isAdmin() || isSuperuser()) {
      html += `<div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
        <button class="btn btn-primary" onclick="Admin.openCreateMatch()" style="font-size:0.85rem;">+ Nuevo Partido</button>
      </div>`;
    }

    let currentMonth = '';

    sorted.forEach(m => {
      const d = new Date(m.fecha);
      const monthName = d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase();

      if (monthName !== currentMonth) {
        currentMonth = monthName;
        html += `<div class="month-header" style="font-family:var(--font-display);color:var(--gold);margin:30px 0 15px;font-size:1.2rem;letter-spacing:2px;border-bottom:1px solid var(--gold);padding-bottom:5px;">📅 ${monthName}</div>`;
      }

      const localTeam = equipos.find(e => e.nombre === m.local);
      const visitTeam = equipos.find(e => e.nombre === m.visitante);
      const lImg = localTeam ? (localTeam.imagen ? `<img src="${localTeam.imagen}" style="width:20px;height:20px;object-fit:contain;">` : (localTeam.escudo || '🥎')) : '🥎';
      const vImg = visitTeam ? (visitTeam.imagen ? `<img src="${visitTeam.imagen}" style="width:20px;height:20px;object-fit:contain;">` : (visitTeam.escudo || '🥎')) : '🥎';

      const statusBadge = m.status === 'live'
        ? `<span class="live-badge">● EN VIVO</span>`
        : m.status === 'finished'
        ? `<span style="font-size:0.6rem;color:var(--white-muted);background:rgba(255,255,255,0.06);border-radius:10px;padding:2px 7px;">✓ FINALIZADO</span>`
        : '';
      const cardBorder = m.status === 'live' ? 'rgba(0,200,100,0.3)' : 'rgba(255,255,255,0.05)';
      html += `
         <div class="match-card" onclick="Admin.viewMatch('${m.id}')" style="background:var(--bg-card);border-radius:12px;padding:15px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;border:1px solid ${cardBorder};cursor:pointer;transition:transform 0.2s, background 0.2s;">
           <div style="text-align:center;min-width:60px;margin-right:15px;">
             <div style="font-size:1.5rem;font-weight:700;line-height:1;">${d.getDate()}</div>
             <div style="font-size:0.6rem;text-transform:uppercase;color:var(--white-muted);">${d.toLocaleDateString('es-ES', { weekday: 'short' })}</div>
           </div>

           <div style="flex:1;">
             <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
               <div style="display:flex;align-items:center;gap:8px;font-weight:600;">${lImg} ${m.local}</div>
               <div style="font-size:1.2rem;font-weight:700;color:${m.localScore > m.visitScore ? 'var(--gold)' : 'white'};">${m.localScore}</div>
             </div>
             <div style="display:flex;align-items:center;justify-content:space-between;">
               <div style="display:flex;align-items:center;gap:8px;font-weight:600;">${vImg} ${m.visitante}</div>
               <div style="font-size:1.2rem;font-weight:700;color:${m.visitScore > m.localScore ? 'var(--gold)' : 'white'};">${m.visitScore}</div>
             </div>
           </div>

           <div style="margin-left:20px;text-align:right;font-size:0.7rem;color:var(--white-muted);">
             <div>${m.hora}</div>
             <div>${m.campo}</div>
             ${statusBadge ? `<div style="margin-top:5px;">${statusBadge}</div>` : `<div style="margin-top:4px;color:var(--gold);font-size:0.6rem;">VER DETALLES →</div>`}
           </div>
         </div>
       `;
    });

    html += '</div>';
    c.innerHTML = html;
  }

  // ── CREATE / EDIT MATCH ──
  function openCreateMatch(editId) {
    if (!editId && isDelegado()) return; // delegados cannot create matches
    const c = document.getElementById('main-content');
    const m = editId ? partidos.find(x => x.id === editId) : null;
    const today = new Date().toISOString().split('T')[0];

    // Team options — delegado only sees their team as local
    const teamOptions = equipos.map(e => `<option value="${e.nombre}">${e.nombre}</option>`).join('');
    const delegadoTeam = getDelegadoTeam();
    const localOptions = isDelegado() && delegadoTeam
      ? `<option value="${delegadoTeam.nombre}">${delegadoTeam.nombre}</option>`
      : teamOptions;

    c.innerHTML = `
      <div style="max-width:600px;margin:0 auto;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <button class="btn btn-secondary" onclick="Admin.switchTab('calendar')" style="font-size:0.8rem;">← Volver</button>
          <h2 style="font-family:var(--font-display);color:var(--gold);margin:0;">${m ? 'Editar Partido' : 'Nuevo Partido'}</h2>
        </div>
        <div style="background:var(--bg-card);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <div>
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Equipo Local</label>
              <select id="match-local" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
                ${localOptions}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Equipo Visitante</label>
              <select id="match-visitante" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
                ${teamOptions}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Fecha</label>
              <input type="date" id="match-fecha" value="${m ? m.fecha : today}" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Hora</label>
              <input type="time" id="match-hora" value="${m ? m.hora : '10:00'}" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Campo / Ubicación</label>
              <input type="text" id="match-campo" value="${m ? m.campo : ''}" placeholder="Ej: Campo Municipal" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Jornada</label>
              <input type="text" id="match-jornada" value="${m ? m.jornada : ''}" placeholder="Ej: Jornada 5" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
            </div>
            <div style="grid-column:1/-1;">
              <label style="font-size:0.75rem;color:var(--white-muted);font-weight:600;">Árbitro</label>
              <input type="text" id="match-arbitro" value="${m ? (m.arbitro || '') : ''}" placeholder="Nombre del árbitro" style="width:100%;padding:10px;border-radius:8px;background:var(--bg-card-inner);color:white;border:1px solid rgba(255,255,255,0.1);font-size:0.9rem;margin-top:4px;">
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
            <button class="btn btn-secondary" onclick="Admin.switchTab('calendar')">Cancelar</button>
            <button class="btn btn-primary" onclick="Admin.saveNewMatch('${editId || ''}')">${m ? 'Guardar Cambios' : 'Crear Partido'}</button>
          </div>
        </div>
      </div>`;

    // Set selected values if editing
    if (m) {
      document.getElementById('match-local').value = m.local;
      document.getElementById('match-visitante').value = m.visitante;
    }
  }

  function saveNewMatch(editId) {
    const local = document.getElementById('match-local').value;
    const visitante = document.getElementById('match-visitante').value;
    const fecha = document.getElementById('match-fecha').value;
    const hora = document.getElementById('match-hora').value;
    const campo = document.getElementById('match-campo').value.trim();
    const jornada = document.getElementById('match-jornada').value.trim();
    const arbitro = document.getElementById('match-arbitro').value.trim();

    if (!local || !visitante) { alert('Selecciona ambos equipos.'); return; }
    if (local === visitante) { alert('Los equipos deben ser diferentes.'); return; }
    if (!fecha) { alert('Selecciona una fecha.'); return; }

    if (editId) {
      // Edit existing
      const m = partidos.find(x => x.id === editId);
      if (!m) return;
      m.local = local;
      m.visitante = visitante;
      m.fecha = fecha;
      m.hora = hora;
      m.campo = campo;
      m.jornada = jornada;
      m.arbitro = arbitro;
    } else {
      // Create new
      partidos.push({
        id: 'match-' + Date.now(),
        fecha,
        hora,
        campo,
        jornada,
        local,
        visitante,
        arbitro,
        playerStats: {},
        status: 'scheduled',
        log: [],
        mensajes: []
      });
    }

    autoSave();
    switchTab('calendar');
  }

  function deleteMatch(matchId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    if (!confirm(`¿Eliminar el partido "${m.local} vs ${m.visitante}" del ${m.fecha}? Esta acción no se puede deshacer.`)) return;
    partidos = partidos.filter(x => x.id !== matchId);
    autoSave();
    switchTab('calendar');
  }

  // ── MATCH DETAIL VIEW (MVP & STATS) ──
  function renderMatchDetail() {
    const c = document.getElementById('main-content');
    const m = partidos.find(x => x.id === selectedMatchId);
    if (!m) { backToCalendar(); return; }

    const localTeam = equipos.find(e => e.nombre === m.local);
    const visitTeam = equipos.find(e => e.nombre === m.visitante);
    const lImg = localTeam ? (localTeam.imagen || null) : null;
    const vImg = visitTeam ? (visitTeam.imagen || null) : null;
    const lShield = localTeam ? (localTeam.escudo || '🥎') : '🥎';
    const vShield = visitTeam ? (visitTeam.escudo || '🥎') : '🥎';

    // Calculate MVP
    let bestPlayer = null;
    let maxScore = -1;

    // Helper to get match stats for a player
    const getStats = (pid) => m.playerStats && m.playerStats[pid] ? m.playerStats[pid] : { ab: 0, h: 0, r: 0, rbi: 0, hr: 0 };

    // Determine MVP from all players in match
    if (m.playerStats) {
      Object.entries(m.playerStats).forEach(([pid, s]) => {
        // Simple MVP score: H*1 + R*1 + RBI*2 + HR*3
        const score = (s.h || 0) + (s.r || 0) + ((s.rbi || 0) * 2) + ((s.hr || 0) * 3);
        if (score > maxScore) {
          maxScore = score;
          const p = players.find(x => x.id === pid);
          if (p) bestPlayer = { ...p, score, matchStats: s };
        }
      });
    }

    // Render MVP card
    let mvpHtml = '';
    if (bestPlayer && maxScore > 0) {
      const pImg = bestPlayer.foto ? `<img src="${bestPlayer.foto}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);">` : `<div style="width:60px;height:60px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid var(--gold);">${bestPlayer.nombre[0]}</div>`;
      const ms = bestPlayer.matchStats;
      mvpHtml = `
         <div onclick="Admin.viewCard('${bestPlayer.id}')" style="background:linear-gradient(135deg, rgba(245, 166, 35, 0.1), rgba(0,0,0,0));border:1px solid var(--gold);border-radius:12px;padding:15px;margin:20px 0;display:flex;align-items:center;cursor:pointer;transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
           <div style="margin-right:15px;">${pImg}</div>
           <div>
             <div style="color:var(--gold);font-size:0.7rem;letter-spacing:2px;font-weight:700;">MVP DEL PARTIDO</div>
             <div style="font-size:1.1rem;font-weight:700;">${bestPlayer.nombre}</div>
             <div style="font-size:0.8rem;color:var(--white-muted);">${bestPlayer.equipo}</div>
             <div style="margin-top:5px;font-size:0.85rem;font-family:monospace;">
               ${ms.h}-${ms.ab}, ${ms.hr > 0 ? ms.hr + ' HR, ' : ''}${ms.rbi} RBI, ${ms.r} R
             </div>
           </div>
           <div style="margin-left:auto;font-size:2rem;">🏆</div>
         </div>`;
    }

    // Render Rosters
    const renderTeamList = (teamName) => {
      const teamPlayers = players.filter(p => p.equipo === teamName);
      if (teamPlayers.length === 0) return '<div style="color:var(--white-muted);font-size:0.8rem;">Sin plantilla</div>';

      let h = '<div class="match-roster-list">';
      teamPlayers.forEach(p => {
        const s = getStats(p.id);
        const didPlay = s.ab > 0 || s.h > 0;
        h += `
           <div onclick="Admin.viewCard('${p.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.03);opacity:${didPlay ? 1 : 0.5};cursor:pointer;transition:background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
             <div style="display:flex;align-items:center;gap:8px;">
               <div style="font-weight:600;font-size:0.9rem;">${p.nombre}</div>
               <div style="font-size:0.7rem;width:20px;text-align:center;background:rgba(255,255,255,0.1);border-radius:4px;">${p.dorsal}</div>
             </div>
             <div style="font-family:monospace;font-size:0.85rem;color:var(--gold);">
               ${s.h}-${s.ab} <span style="color:var(--white-muted);font-size:0.75rem;">(R:${s.r} RBI:${s.rbi})</span>
             </div>
           </div>`;
      });
      h += '</div>';
      return h;
    };


    let html = `
      <div class="match-detail-view" style="max-width:900px;margin:0 auto;animation:fadeIn 0.4s ease;">
        <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center;">
          <button class="btn btn-secondary" onclick="Admin.backToCalendar()">← Volver al Calendario</button>
          ${(isAdmin() || isSuperuser()) ? `
            ${m.status === 'live'
              ? `<button class="btn btn-danger" onclick="Admin.endGame('${m.id}')" style="font-weight:700;">🏁 Finalizar Partido</button>`
              : m.status === 'finished'
              ? `<span style="font-size:0.8rem;color:var(--white-muted);padding:6px 10px;">✓ Partido finalizado</span>`
              : `<button class="btn btn-primary" onclick="Admin.startGame('${m.id}')" style="font-weight:700;">▶️ Iniciar Partido</button>`
            }
          ` : ''}
          ${canEditTeam(m.local) || canEditTeam(m.visitante) ? `
            <button class="btn btn-secondary" onclick="Admin.openCreateMatch('${m.id}')" title="Editar partido">✏️ Editar</button>
            <button class="btn btn-danger" onclick="Admin.deleteMatch('${m.id}')" title="Eliminar partido" style="font-size:0.75rem;">🗑️</button>
            <button class="btn btn-secondary" onclick="Admin.downloadMatchTemplate('${m.id}')" style="margin-left:auto;">📥 Descargar Plantilla CSV</button>
            <button class="btn btn-primary" onclick="Admin.openMatchCSV('${m.id}')">📤 Subir Stats CSV</button>
          ` : ''}
        </div>
        
        <div class="match-scoreboard" style="background:var(--bg-card);border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);padding:20px;">
          <div style="text-align:center;color:var(--white-muted);font-size:0.8rem;text-transform:uppercase;margin-bottom:15px;letter-spacing:1px;">
            ${new Date(m.fecha).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} • ${m.hora} • ${m.campo}
          </div>
          
          <div style="display:flex;align-items:center;justify-content:space-around;">
             <div style="text-align:center;flex:1;">
               <div style="font-size:3rem;margin-bottom:10px;">
                  ${lImg ? `<img src="${lImg}" style="width:60px;height:60px;object-fit:contain;">` : lShield}
               </div>
               <div style="font-weight:700;font-size:1.1rem;margin-bottom:5px;">${m.local}</div>
               <div style="font-size:2.5rem;font-weight:800;color:${m.localScore > m.visitScore ? 'var(--gold)' : 'white'};line-height:1;">${m.localScore}</div>
             </div>
             
             <div style="font-size:1.5rem;font-weight:700;color:var(--red);opacity:0.5;">VS</div>
             
             <div style="text-align:center;flex:1;">
               <div style="font-size:3rem;margin-bottom:10px;">
                  ${vImg ? `<img src="${vImg}" style="width:60px;height:60px;object-fit:contain;">` : vShield}
               </div>
               <div style="font-weight:700;font-size:1.1rem;margin-bottom:5px;">${m.visitante}</div>
               <div style="font-size:2.5rem;font-weight:800;color:${m.visitScore > m.localScore ? 'var(--gold)' : 'white'};line-height:1;">${m.visitScore}</div>
             </div>
          </div>
        </div>

        ${mvpHtml}

        <!-- Sub-tabs -->
        <div style="display:flex;gap:4px;margin-top:20px;border-bottom:2px solid rgba(255,255,255,0.1);padding-bottom:0;">
          ${['resumen', 'local', 'visitante', 'bitacora'].map(tab => {
            const pendingLogs = (isAdmin() || isSuperuser()) ? (m.log || []).filter(e => !e.acknowledged && e.actorRol === 'delegado').length : 0;
            const unreadMsgs = getUnreadMsgCount(m);
            const totalBadge = pendingLogs + unreadMsgs;
            const bitacoraLabel = totalBadge > 0
              ? `📝 Bitácora <span style="background:${unreadMsgs > 0 ? '#e53935' : 'var(--gold)'};color:#fff;border-radius:10px;padding:1px 6px;font-size:0.65rem;font-weight:700;">${totalBadge}</span>`
              : '📝 Bitácora';
            const labels = { resumen: '📊 Resumen', local: '⚾ ' + m.local, visitante: '⚾ ' + m.visitante, bitacora: bitacoraLabel };
            const active = lineupSubView === tab;
            return `<button onclick="Admin.setLineupSubView('${tab}')"
              style="padding:10px 16px;font-size:0.8rem;font-weight:${active ? '700' : '400'};border:none;border-bottom:2px solid ${active ? 'var(--gold)' : 'transparent'};
              background:transparent;color:${active ? 'var(--gold)' : 'var(--white-muted)'};cursor:pointer;margin-bottom:-2px;transition:all 0.2s;">
              ${labels[tab]}</button>`;
          }).join('')}
        </div>

        <div style="margin-top:20px;">
        ${lineupSubView === 'resumen' ? `
          <div style="display:grid;grid-template-columns: 1fr 1fr; gap:20px;">
            <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
              <h3 style="color:var(--white-muted);font-size:0.9rem;text-align:center;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">${m.local}</h3>
              ${renderTeamList(m.local)}
            </div>
            <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
              <h3 style="color:var(--white-muted);font-size:0.9rem;text-align:center;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">${m.visitante}</h3>
              ${renderTeamList(m.visitante)}
            </div>
          </div>
        ` : lineupSubView === 'local' ? `
          <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
            <h3 style="color:var(--gold);font-family:var(--font-display);margin-bottom:15px;text-transform:uppercase;letter-spacing:1px;font-size:0.9rem;">Alineación — ${m.local}</h3>
            ${renderLineupEditor(m, m.local)}
          </div>
        ` : lineupSubView === 'visitante' ? `
          <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
            <h3 style="color:var(--gold);font-family:var(--font-display);margin-bottom:15px;text-transform:uppercase;letter-spacing:1px;font-size:0.9rem;">Alineación — ${m.visitante}</h3>
            ${renderLineupEditor(m, m.visitante)}
          </div>
        ` : `
          <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">

            <!-- Registro de Cambios -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <h3 style="color:var(--gold);font-family:var(--font-display);margin:0;text-transform:uppercase;letter-spacing:1px;font-size:0.85rem;">📋 Registro de Cambios</h3>
              ${m.status !== 'live' ? `<span style="font-size:0.65rem;padding:2px 8px;border-radius:10px;background:${m.status === 'finished' ? 'rgba(244,67,54,0.15)' : 'rgba(255,255,255,0.07)'};color:${m.status === 'finished' ? 'var(--red)' : 'var(--white-muted)'};">${m.status === 'finished' ? '🔒 Finalizado' : '⏳ No iniciado'}</span>` : '<span class="live-badge">● EN VIVO</span>'}
            </div>
            <div id="match-log-structured">
              ${renderMatchLog(m)}
            </div>

            ${(isAdmin() || isSuperuser() || isDelegado()) ? (() => {
              const windowOpen = isMatchWindowOpen(m);
              const canWrite = isAdmin() || windowOpen;
              let windowLabel = '';
              if (!isAdmin()) {
                if (windowOpen) {
                  windowLabel = '<span class="window-open">✓ Ventana abierta</span>';
                } else if (m.status === 'finished') {
                  windowLabel = '<span class="window-closed">🔒 Ventana cerrada</span>';
                } else {
                  const [wh, wm] = (m.hora || '00:00').split(':').map(Number);
                  const wd = new Date(m.fecha);
                  wd.setHours(wh - 1, wm, 0, 0);
                  const openTime = wd.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                  windowLabel = `<span class="window-closed">🔒 Disponible desde las ${openTime}</span>`;
                }
              }
              return `<div style="margin-top:14px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:4px;">
                <div style="font-size:0.7rem;color:var(--white-muted);">Nota libre ${windowLabel}</div>
                ${canWrite ? `<button class="btn btn-sm btn-secondary" onclick="Admin.saveMatchLog('${m.id}',document.getElementById('match-log-${m.id}').value)" style="font-size:0.7rem;padding:4px 10px;">📤 Añadir al registro</button>` : ''}
              </div>
              <textarea id="match-log-${m.id}"
                ${canWrite ? '' : 'readonly'}
                style="width:100%;height:70px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px;color:var(--white);font-family:inherit;resize:vertical;opacity:${canWrite ? 1 : 0.5};"
                placeholder="Incidencias, árbitro, condiciones del campo...">${m.bitacora || ''}</textarea>
            </div>`;
            })() : ''}

            <!-- Mensajes -->
            <div style="margin-top:20px;border-top:2px solid rgba(255,255,255,0.07);padding-top:16px;">
              <h3 style="color:var(--gold);font-family:var(--font-display);margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;font-size:0.85rem;">✉️ Mensajes</h3>
              <div id="match-mensajes-box">
                ${renderMatchMessages(m)}
              </div>
            </div>

          </div>
        `}
        </div>
        
      </div>`;
    c.innerHTML = html;
  }

  function viewMatch(id, subView) {
    selectedMatchId = id;
    selectedLineupPlayerId = null;
    currentView = 'match';
    lineupSubView = subView || 'resumen';
    renderView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setLineupSubView(view) {
    lineupSubView = view;
    selectedLineupPlayerId = null;
    if (view === 'bitacora' && selectedMatchId) markMessagesRead(selectedMatchId);
    renderView();
  }

  function backToCalendar() {
    selectedMatchId = null;
    currentView = 'calendar';
    renderView();
  }

  // ── PERMISSIONS ──
  function applyPermissions() {
    const admin = isAdmin();
    const superuser = isSuperuser();
    const delegado = isDelegado();
    const usuario = isUsuario();
    const user = getCurrentUser();

    // Show/hide admin-only elements
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = admin ? '' : 'none');
    const navUsers = document.getElementById('nav-users');
    if (navUsers) navUsers.style.display = admin ? '' : 'none';

    // Usuario (jugador): read-only — hide ALL action buttons, can browse everything
    if (usuario) {
      ['btn-add-team', 'btn-add-player', 'btn-import-csv', 'btn-export', 'btn-demo', 'btn-reset', 'btn-qr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    } else {
      // Team management buttons: admin & superusuario
      ['btn-add-team', 'btn-import-csv', 'btn-demo', 'btn-reset'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (admin || (superuser && id !== 'btn-reset' && id !== 'btn-demo')) ? '' : 'none';
      });

      // Add player: admin, superusuario, delegado (always - their team auto-assigned)
      const btnAddPlayer = document.getElementById('btn-add-player');
      if (btnAddPlayer) btnAddPlayer.style.display = (admin || superuser || delegado) ? '' : 'none';

      // Export JSON: admin & superusuario
      const btnExport = document.getElementById('btn-export');
      if (btnExport) btnExport.style.display = (admin || superuser) ? '' : 'none';

      // QR codes: admin, superusuario, delegado
      const btnQR = document.getElementById('btn-qr');
      if (btnQR) btnQR.style.display = (admin || superuser || delegado) ? '' : 'none';
    }

    // User badge with role label
    const roleLabels = { admin: 'Admin', superusuario: 'Super', delegado: 'Delegado', usuario: 'Jugador' };
    const roleColors = { admin: '#f5a623', superusuario: '#3498db', delegado: '#1abc9c', usuario: '#95a5a6' };
    const badge = document.getElementById('current-user-badge');
    if (badge) {
      const initial = (user.nombre || '?')[0].toUpperCase();
      const color = roleColors[user.rol] || '#95a5a6';
      const rolLabel = roleLabels[user.rol] || user.rol;
      const teamStr = (delegado || usuario) && user.equipo ? `<span class="user-badge-team">${user.equipo}</span>` : '';
      badge.innerHTML = `<span class="user-badge-avatar" style="background:${color}22;color:${color};border:1px solid ${color}66;">${initial}</span><span class="user-badge-info"><span class="user-badge-name">${user.nombre}</span><span class="user-badge-role" style="color:${color};">${rolLabel}${teamStr ? ' · ' : ''}${teamStr ? user.equipo : ''}</span></span>`;
    }

    // Change panel title for non-admin roles
    const titleEl = document.querySelector('.admin-title');
    if (titleEl) {
      if (usuario) titleEl.textContent = '🥎 Liga Softball Masters +40';
      else if (delegado) titleEl.textContent = '🥎 Panel de Delegado';
      else if (superuser) titleEl.textContent = '🥎 Panel de Gestión';
    }
  }

  function logout() {
    sessionStorage.clear();
    if (typeof firebaseAuth !== 'undefined') {
      firebaseAuth.signOut().catch(() => {});
    }
    location.reload();
  }

  // ── USERS CRUD ──
  function updateUserTeamDropdown() {
    const s = document.getElementById('usr-equipo');
    if (!s) return;
    s.innerHTML = '<option value="">— Sin equipo —</option>' + equipos.map(e => `<option value="${e.nombre}">${e.escudo || '🥎'} ${e.nombre}</option>`).join('');
  }

  function renderUsers() {
    if (!isAdmin()) { switchTab('teams'); return; }
    const c = document.getElementById('main-content');
    let html = `
      <div style="max-width:800px;margin:0 auto;animation:fadeIn 0.5s ease;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h2 style="font-family:var(--font-display);color:var(--gold);letter-spacing:2px;">GESTIÓN DE USUARIOS</h2>
          <button class="btn btn-primary" onclick="Admin.openAddUser()">+ Nuevo Usuario</button>
        </div>
        <div style="background:var(--bg-card);border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
          <table style="width:100%;border-collapse:collapse;color:var(--white);">
            <thead>
              <tr style="background:rgba(255,255,255,0.05);border-bottom:1px solid rgba(255,255,255,0.1);">
                <th style="padding:12px 15px;text-align:left;font-size:0.8rem;color:var(--white-muted);">NOMBRE</th>
                <th style="padding:12px 15px;text-align:left;font-size:0.8rem;color:var(--white-muted);">USUARIO</th>
                <th style="padding:12px 15px;text-align:center;font-size:0.8rem;color:var(--white-muted);">ROL</th>
                <th style="padding:12px 15px;text-align:left;font-size:0.8rem;color:var(--white-muted);">EQUIPO</th>
                <th style="padding:12px 15px;text-align:center;font-size:0.8rem;color:var(--white-muted);">ACCIONES</th>
              </tr>
            </thead>
            <tbody>`;
    for (const u of usuarios) {
      const rolStyles = {
        admin: 'background:var(--gold);color:#000;',
        superusuario: 'background:#9c27b0;color:#fff;',
        delegado: 'background:var(--blue-check);color:#fff;',
        usuario: 'background:var(--green);color:#000;'
      };
      const rolNames = { admin: 'ADMIN', superusuario: 'SUPER', delegado: 'DELEGADO', usuario: 'JUGADOR' };
      const rolBadge = `<span style="${rolStyles[u.rol] || rolStyles.delegado}padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;">${rolNames[u.rol] || u.rol.toUpperCase()}</span>`;
      const isMainAdmin = u.id === 'admin';
      html += `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
          <td style="padding:12px 15px;font-weight:600;">${u.nombre}</td>
          <td style="padding:12px 15px;color:var(--white-muted);">${u.user}</td>
          <td style="padding:12px 15px;text-align:center;">${rolBadge}</td>
          <td style="padding:12px 15px;">${u.equipo || '—'}</td>
          <td style="padding:12px 15px;text-align:center;">
            <button class="btn btn-sm btn-secondary" onclick="Admin.editUser('${u.id}')" title="Editar">✏️</button>
            ${isMainAdmin ? '' : `<button class="btn btn-sm btn-secondary" onclick="Admin.deleteUser('${u.id}')" title="Eliminar" style="color:var(--red);">🗑</button>`}
          </td>
        </tr>`;
    }
    html += '</tbody></table></div></div>';
    c.innerHTML = html;
  }

  function openAddUser() {
    document.getElementById('usr-id').value = '';
    document.getElementById('add-user-form').reset();
    document.getElementById('modal-add-user').querySelector('.modal-title').textContent = '👥 Nuevo Usuario';
    document.getElementById('modal-add-user').querySelector('button[type="submit"]').textContent = 'Guardar Usuario';
    updateUserTeamDropdown();
    openModal('modal-add-user');
  }

  function editUser(id) {
    const u = usuarios.find(x => x.id === id);
    if (!u) return;
    document.getElementById('usr-id').value = u.id;
    document.getElementById('usr-nombre').value = u.nombre;
    document.getElementById('usr-user').value = u.user;
    document.getElementById('usr-pass').value = u.pass;
    document.getElementById('usr-rol').value = u.rol;
    updateUserTeamDropdown();
    document.getElementById('usr-equipo').value = u.equipo || '';
    document.getElementById('modal-add-user').querySelector('.modal-title').textContent = 'Editar Usuario';
    document.getElementById('modal-add-user').querySelector('button[type="submit"]').textContent = 'Guardar Cambios';
    openModal('modal-add-user');
  }

  function saveUser(e) {
    e.preventDefault();
    const id = document.getElementById('usr-id').value;
    const nombre = document.getElementById('usr-nombre').value.trim();
    const user = document.getElementById('usr-user').value.trim();
    const pass = document.getElementById('usr-pass').value;
    const rol = document.getElementById('usr-rol').value;
    const equipo = document.getElementById('usr-equipo').value || null;
    if (!nombre || !user || !pass) return;

    // Check duplicate username
    const dup = usuarios.find(u => u.user === user && u.id !== id);
    if (dup) { alert('Ya existe un usuario con ese nombre de usuario.'); return; }

    if (id) {
      const u = usuarios.find(x => x.id === id);
      if (u) { u.nombre = nombre; u.user = user; u.pass = pass; u.rol = rol; u.equipo = equipo; }
    } else {
      usuarios.push({ id: 'u-' + Date.now(), nombre, user, pass, rol, equipo });
    }
    autoSave(); closeModal('modal-add-user'); renderView();
  }

  function deleteUser(id) {
    if (id === 'admin') return;
    if (!confirm('¿Eliminar este usuario?')) return;
    usuarios = usuarios.filter(u => u.id !== id);
    autoSave(); renderView();
  }

  // ── MATCH STATS CSV ──
  let matchCsvData = [];
  let matchCsvTargetId = null;

  function downloadMatchTemplate(matchId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    const homePlayers = players.filter(p => p.equipo === m.local);
    const awayPlayers = players.filter(p => p.equipo === m.visitante);
    const allPlayers = [...homePlayers, ...awayPlayers];

    const headers = 'JugadorID;Nombre;Equipo;AB;H;HR;RBI;R';
    const rows = allPlayers.map(p => {
      const s = (m.playerStats && m.playerStats[p.id]) || {};
      return `${p.id};${p.nombre};${p.equipo};${s.ab || 0};${s.h || 0};${s.hr || 0};${s.rbi || 0};${s.r || 0}`;
    });

    const csv = '\ufeff' + headers + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const dateStr = m.fecha || 'partido';
    a.download = `stats_${m.local.replace(/\s+/g, '_')}_vs_${m.visitante.replace(/\s+/g, '_')}_${dateStr}.csv`;
    a.click();
  }

  function openMatchCSV(matchId) {
    matchCsvTargetId = matchId;
    matchCsvData = [];
    const fileInput = document.getElementById('match-csv-file');
    if (fileInput) fileInput.value = '';
    document.getElementById('match-csv-preview').style.display = 'none';
    openModal('modal-match-csv');
  }

  function handleMatchCSVFile() {
    const file = document.getElementById('match-csv-file').files[0];
    const preview = document.getElementById('match-csv-preview');
    if (!file) { preview.style.display = 'none'; matchCsvData = []; return; }
    const reader = new FileReader();
    reader.onload = e => {
      const lines = e.target.result.split(/\r?\n/).filter(l => l.trim());
      matchCsvData = [];
      const start = (lines[0] && lines[0].toLowerCase().includes('jugadorid')) ? 1 : 0;
      for (let i = start; i < lines.length; i++) {
        const p = lines[i].split(';').map(s => s.trim());
        if (p.length >= 5) {
          matchCsvData.push({
            id: p[0], nombre: p[1] || '', equipo: p[2] || '',
            ab: parseInt(p[3], 10) || 0, h: parseInt(p[4], 10) || 0,
            hr: parseInt(p[5], 10) || 0, rbi: parseInt(p[6], 10) || 0, r: parseInt(p[7], 10) || 0
          });
        }
      }
      if (matchCsvData.length > 0) {
        let h = `<div style="font-size:0.7rem;color:var(--green);margin-bottom:8px;">✓ ${matchCsvData.length} JUGADORES</div>`;
        h += '<div style="max-height:200px;overflow-y:auto;background:var(--bg-card-inner);border-radius:8px;padding:8px 12px;">';
        matchCsvData.forEach(p => {
          h += `<div style="font-size:0.75rem;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03);color:var(--white-soft);display:flex;justify-content:space-between;">
            <span>${p.nombre} <span style="color:var(--white-muted)">(${p.equipo})</span></span>
            <span style="font-family:monospace;color:var(--gold);">${p.h}-${p.ab} | HR:${p.hr} RBI:${p.rbi} R:${p.r}</span>
          </div>`;
        });
        h += '</div>';
        preview.innerHTML = h;
      } else {
        preview.innerHTML = '<div style="color:var(--red);font-size:0.8rem">⚠ Sin datos válidos.</div>';
      }
      preview.style.display = 'block';
    };
    reader.readAsText(file, 'UTF-8');
  }

  function confirmMatchCSV() {
    if (!matchCsvData.length || !matchCsvTargetId) { alert('Sube un CSV primero.'); return; }
    const m = partidos.find(x => x.id === matchCsvTargetId);
    if (!m) return;

    if (!m.playerStats) m.playerStats = {};
    for (const row of matchCsvData) {
      // Match by ID first, fallback to name
      let pid = row.id;
      if (!players.find(p => p.id === pid)) {
        const byName = players.find(p => p.nombre.toLowerCase() === row.nombre.toLowerCase());
        if (byName) pid = byName.id;
        else continue; // Skip unknown players
      }
      m.playerStats[pid] = { ab: row.ab, h: row.h, hr: row.hr, rbi: row.rbi, r: row.r };
    }

    recalcAllPlayerStats();
    autoSave();
    matchCsvData = [];
    matchCsvTargetId = null;
    closeModal('modal-match-csv');
    renderView();
    alert(`✅ Estadísticas del partido actualizadas.`);
  }

  function recalcAllPlayerStats() {
    // Reset all player stats (including extended fields)
    for (const p of players) {
      p.stats = { ab: 0, h: 0, hr: 0, rbi: 0, r: 0, avg: '.000', pa: 0, doubles: 0, triples: 0, bb: 0, k: 0, sb: 0 };
    }
    // Accumulate from all matches
    for (const m of partidos) {
      // Sync lineup data to playerStats first
      if (m.lineup) syncLineupToPlayerStats(m);
      if (!m.playerStats) continue;
      for (const [pid, s] of Object.entries(m.playerStats)) {
        const p = players.find(x => x.id === pid);
        if (!p) continue;
        p.stats.ab += (parseInt(s.ab, 10) || 0);
        p.stats.h += (parseInt(s.h, 10) || 0);
        p.stats.hr += (parseInt(s.hr, 10) || 0);
        p.stats.rbi += (parseInt(s.rbi, 10) || 0);
        p.stats.r += (parseInt(s.r, 10) || 0);
      }
      // Aggregate extended stats from lineup data
      if (m.lineup) {
        for (const entries of Object.values(m.lineup)) {
          for (const entry of entries) {
            const p = players.find(x => x.id === entry.playerId);
            if (!p) continue;
            const s = calcLineupSummary(entry);
            p.stats.pa += s.pa;
            p.stats.doubles += s.doubles;
            p.stats.triples += s.triples;
            p.stats.bb += s.bb;
            p.stats.k += s.k;
            p.stats.sb += s.sb;
          }
        }
      }
    }
    // Calculate AVG
    for (const p of players) {
      p.stats.avg = p.stats.ab > 0 ? (p.stats.h / p.stats.ab).toFixed(3).replace(/^0+/, '') : '.000';
    }
  }

  // ── LINEUP / SCORECARD ──
  const TURN_RESULTS = ['H', '2', '3', '4', 'B', 'E', 'K', 'O'];
  const TURN_RESULT_LABELS = { H: 'H', '2': '2B', '3': '3B', '4': 'HR', B: 'BB', E: 'E', K: 'K', O: 'OUT' };
  const TURN_RESULT_COLORS = { H: '#4caf50', '2': '#8bc34a', '3': '#ff9800', '4': '#f44336', B: '#2196f3', E: '#9c27b0', K: '#795548', O: '#607d8b' };

  function calcLineupSummary(entry) {
    const turns = (entry.turns || []).filter(t => t.result);
    const pa = turns.length;
    const bb = turns.filter(t => t.result === 'B').length;
    const ab = pa - bb;
    const h = turns.filter(t => ['H', '2', '3', '4'].includes(t.result)).length;
    const doubles = turns.filter(t => t.result === '2').length;
    const triples = turns.filter(t => t.result === '3').length;
    const hr = turns.filter(t => t.result === '4').length;
    const k = turns.filter(t => t.result === 'K').length;
    const o = turns.filter(t => t.result === 'O').length;
    const sb = turns.filter(t => t.sb).length;
    const r = turns.filter(t => t.run).length;
    const rbi = turns.reduce((s, t) => s + (t.rbi || 0), 0);
    const avg = ab > 0 ? (h / ab).toFixed(3).replace(/^0+/, '') : '.000';
    return { pa, ab, h, doubles, triples, hr, bb, k, o, sb, r, rbi, avg };
  }

  function syncLineupToPlayerStats(match) {
    if (!match.lineup) return;
    if (!match.playerStats) match.playerStats = {};
    for (const entries of Object.values(match.lineup)) {
      for (const entry of entries) {
        const s = calcLineupSummary(entry);
        match.playerStats[entry.playerId] = { ab: s.ab, h: s.h, hr: s.hr, rbi: s.rbi, r: s.r };
      }
    }
    // Recalculate scores
    let ls = 0, vs = 0;
    const localPlayers = players.filter(p => p.equipo === match.local).map(p => p.id);
    for (const [pid, ps] of Object.entries(match.playerStats)) {
      if (localPlayers.includes(pid)) ls += (ps.r || 0);
      else vs += (ps.r || 0);
    }
    match.localScore = ls;
    match.visitScore = vs;
  }

  function initLineupForMatch(matchId, teamName) {
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    if (!m.lineup) m.lineup = {};
    if (m.lineup[teamName] && m.lineup[teamName].length > 0) return; // already exists
    const tp = players.filter(p => p.equipo === teamName && p.aprobado !== false);
    if (tp.length === 0) { alert('No hay jugadores aprobados en ' + teamName); return; }
    m.lineup[teamName] = tp.map((p, i) => ({
      playerId: p.id, order: i + 1, position: p.posicion, status: 'suplente',
      turns: [], defense: { outs: 0, errors: 0, assists: 0 }
    }));
    autoSave();
  }

  function selectLineupPlayer(playerId) {
    selectedLineupPlayerId = playerId;
    // Re-render the whole view — renderLineupEditor already handles selectedLineupPlayerId
    renderView();
    // After render, scroll to the editor box
    requestAnimationFrame(function () {
      var box = document.getElementById('lineup-editor-box');
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function setTurnResult(matchId, teamName, playerId, turnIdx, field, value) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (!canEditMatch(m)) return;
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    while (entry.turns.length <= turnIdx) {
      entry.turns.push({ result: '', sb: false, run: false, rbi: 0, direction: '' });
    }
    const turn = entry.turns[turnIdx];
    if (field === 'result') {
      turn.result = turn.result === value ? '' : value;
    } else if (field === 'sb' || field === 'run') {
      turn[field] = !turn[field];
    } else if (field === 'rbi') {
      turn.rbi = parseInt(value, 10) || 0;
    } else if (field === 'direction') {
      turn.direction = value;
    }
    const _lp = players.find(x => x.id === playerId);
    const _ln = _lp ? `${_lp.nombre.split(' ')[0]} #${_lp.dorsal || '?'}` : playerId;
    if (field === 'result' && turn.result) {
      logChange(matchId, 'turn_result', `${_ln} (${teamName.split(' ')[0]}): turno ${turnIdx + 1} → ${turn.result}`);
    } else if (field === 'sb' || field === 'run') {
      logChange(matchId, 'turn_result', `${_ln}: turno ${turnIdx + 1} ${field === 'sb' ? 'SB' : 'anotó'} → ${turn[field] ? 'sí' : 'no'}`);
    }
    syncLineupToPlayerStats(m);
    autoSave();
    // Update only the editor, not the full page
    const box = document.getElementById('lineup-editor-box');
    if (box) box.innerHTML = buildPlayerEditor(m, teamName, playerId);
    // Update summary table inline
    updateLineupSummaryRow(m, teamName, playerId);
  }

  function setDefenseStat(matchId, teamName, playerId, field, value) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (!canEditMatch(m)) return;
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    entry.defense[field] = parseInt(value, 10) || 0;
    const _dp = players.find(x => x.id === playerId);
    const _dn = _dp ? `${_dp.nombre.split(' ')[0]} #${_dp.dorsal || '?'}` : playerId;
    logChange(matchId, 'defense_change', `${_dn}: defensa ${field} → ${value}`);
    autoSave();
  }

  function updateLineupSummaryRow(match, teamName, playerId) {
    const lineup = match.lineup[teamName];
    const entry = lineup.find(e => e.playerId === playerId);
    if (!entry) return;
    const row = document.querySelector(`#lineup-summary-table tr[data-pid="${playerId}"]`);
    if (!row) return;
    const s = calcLineupSummary(entry);
    const cells = row.querySelectorAll('td');
    if (cells.length >= 14) {
      cells[2].textContent = s.pa;
      cells[3].textContent = s.ab;
      cells[4].textContent = s.h;
      cells[5].textContent = s.doubles;
      cells[6].textContent = s.triples;
      cells[7].textContent = s.hr;
      cells[8].textContent = s.bb;
      cells[9].textContent = s.k;
      cells[10].textContent = s.sb;
      cells[11].textContent = s.r;
      cells[12].textContent = s.rbi;
      cells[13].textContent = s.avg;
    }
  }

  // Build HTML for a single player's turn editor (used by selectLineupPlayer and setTurnResult)
  function buildPlayerEditor(match, teamName, playerId) {
    if (!match || !match.lineup || !match.lineup[teamName]) return '';
    const lineup = match.lineup[teamName];
    const entry = lineup.find(e => e.playerId === playerId);
    if (!entry) return '';
    const p = players.find(x => x.id === playerId);
    if (!p) return '';
    const mid = match.id;
    const tn = teamName.replace(/'/g, "\\'");
    const pid = playerId;

    const st = entry.status || (entry.starter === false ? 'suplente' : entry.starter === 'ausente' ? 'ausente' : 'titular');
    const STATUS_STYLES = {
      titular:   { bg: 'rgba(0,230,118,0.15)',  color: 'var(--green)',      label: 'Titular',   icon: '⚾',  next: 'lesionado', nextLabel: 'Lesionado' },
      lesionado: { bg: 'rgba(255,152,0,0.15)',   color: '#ff9800',           label: 'Lesionado', icon: '🚑',  next: 'suplente',  nextLabel: 'Suplente' },
      suplente:  { bg: 'rgba(255,255,255,0.08)', color: 'var(--white-muted)',label: 'Suplente',  icon: '📋', next: 'ausente',   nextLabel: 'Ausente' },
      ausente:   { bg: 'rgba(244,67,54,0.15)',   color: 'var(--red)',        label: 'Ausente',   icon: '❌',  next: 'titular',   nextLabel: 'Titular' }
    };
    const stStyle = STATUS_STYLES[st] || STATUS_STYLES.suplente;
    const ALL_POSITIONS = ['Pitcher','Catcher','Primera Base','Segunda Base','Tercera Base','Shortstop','Left Field','Center Field','Right Field','Shortfield','Infielder','Outfielder','BA','BD'];
    let h = `<div style="background:rgba(245,166,35,0.06);border-radius:12px;padding:14px;border:1px solid rgba(245,166,35,0.2);animation:slideUp 0.2s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label style="display:flex;align-items:center;gap:3px;color:var(--gold);font-weight:700;font-size:0.8rem;">
            BAT<input type="number" min="1" max="30" value="${entry.order}"
              onchange="Admin.setPlayerOrder('${mid}','${tn}','${pid}',this.value)"
              style="width:38px;padding:2px 4px;font-size:0.85rem;font-weight:700;color:var(--gold);background:rgba(245,166,35,0.1);border:1px solid rgba(245,166,35,0.4);border-radius:4px;text-align:center;">
          </label>
          <span style="font-weight:700;font-size:1rem;">${p.nombre}</span>
          <select onchange="Admin.setLineupPosition('${mid}','${tn}','${pid}',this.value)"
            style="padding:3px 6px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--gold);border:1px solid rgba(245,166,35,0.3);border-radius:6px;font-weight:600;">
            ${ALL_POSITIONS.map(pos => `<option value="${pos}" ${entry.position === pos ? 'selected' : ''}>${shortenPosition(pos)}</option>`).join('')}
          </select>
          <span style="font-size:0.6rem;padding:2px 8px;border-radius:10px;font-weight:600;background:${stStyle.bg};color:${stStyle.color};">${stStyle.label}</span>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-sm btn-secondary" onclick="Admin.cycleStatus('${mid}','${tn}','${pid}')" title="Cambiar a ${stStyle.nextLabel}">${stStyle.icon}</button>
          <button class="btn btn-sm btn-secondary" onclick="Admin.movePlayerInLineup('${mid}','${tn}','${pid}','up')" title="Subir">▲</button>
          <button class="btn btn-sm btn-secondary" onclick="Admin.movePlayerInLineup('${mid}','${tn}','${pid}','down')" title="Bajar">▼</button>
          <button class="btn btn-sm btn-danger" onclick="Admin.removePlayerFromLineup('${mid}','${tn}','${pid}')" title="Quitar">✕</button>
        </div>
      </div>`;

    if (!entry.turns) entry.turns = [];
    for (let t = 0; t < 5; t++) {
      const turn = entry.turns[t] || { result: '', sb: false, run: false, rbi: 0, direction: '' };
      h += `<div style="margin-bottom:6px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;">
        <div style="font-size:0.7rem;color:var(--white-muted);margin-bottom:5px;font-weight:600;">Turno ${t + 1}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">`;
      for (const code of TURN_RESULTS) {
        const active = turn.result === code;
        const color = active ? TURN_RESULT_COLORS[code] : 'transparent';
        const border = active ? TURN_RESULT_COLORS[code] : 'rgba(255,255,255,0.15)';
        h += `<button onclick="Admin.setTurnResult('${mid}','${tn}','${pid}',${t},'result','${code}')"
          style="padding:4px 10px;font-size:0.75rem;font-weight:700;border-radius:6px;border:1px solid ${border};
          background:${color};color:${active ? '#fff' : 'var(--white-muted)'};cursor:pointer;min-width:32px;">
          ${TURN_RESULT_LABELS[code]}</button>`;
      }
      h += `</div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">`;
      const sbA = turn.sb ? 'background:var(--blue-check);color:#fff;' : '';
      const runA = turn.run ? 'background:var(--green);color:#fff;' : '';
      h += `<button onclick="Admin.setTurnResult('${mid}','${tn}','${pid}',${t},'sb','')"
        style="padding:3px 8px;font-size:0.7rem;border-radius:4px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;${sbA}">S</button>`;
      h += `<button onclick="Admin.setTurnResult('${mid}','${tn}','${pid}',${t},'run','')"
        style="padding:3px 8px;font-size:0.7rem;border-radius:4px;border:1px solid rgba(255,255,255,0.15);cursor:pointer;${runA}">A</button>`;
      h += `<select onchange="Admin.setTurnResult('${mid}','${tn}','${pid}',${t},'rbi',this.value)"
        style="padding:3px 6px;font-size:0.7rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;">
        ${[0,1,2,3,4].map(v => `<option value="${v}" ${turn.rbi === v ? 'selected' : ''}>I:${v}</option>`).join('')}</select>`;
      h += `<select onchange="Admin.setTurnResult('${mid}','${tn}','${pid}',${t},'direction',this.value)"
        style="padding:3px 6px;font-size:0.7rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;">
        <option value="" ${!turn.direction ? 'selected' : ''}>D:-</option>
        <option value="LF" ${turn.direction === 'LF' ? 'selected' : ''}>LF</option>
        <option value="CF" ${turn.direction === 'CF' ? 'selected' : ''}>CF</option>
        <option value="RF" ${turn.direction === 'RF' ? 'selected' : ''}>RF</option></select>`;
      h += `</div></div>`;
    }

    // Defense (guard against missing field in old data)
    const def = entry.defense || { outs: 0, errors: 0, assists: 0 };
    h += `<div style="margin-top:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;">
      <div style="font-size:0.7rem;color:var(--white-muted);margin-bottom:5px;font-weight:600;">Defensa</div>
      <div style="display:flex;gap:12px;">
        <label style="font-size:0.75rem;display:flex;align-items:center;gap:4px;">O: <input type="number" min="0" max="99" value="${def.outs || 0}"
          onchange="Admin.setDefenseStat('${mid}','${tn}','${pid}','outs',this.value)"
          style="width:44px;padding:3px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;text-align:center;"></label>
        <label style="font-size:0.75rem;display:flex;align-items:center;gap:4px;">E: <input type="number" min="0" max="99" value="${def.errors || 0}"
          onchange="Admin.setDefenseStat('${mid}','${tn}','${pid}','errors',this.value)"
          style="width:44px;padding:3px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;text-align:center;"></label>
        <label style="font-size:0.75rem;display:flex;align-items:center;gap:4px;">A: <input type="number" min="0" max="99" value="${def.assists || 0}"
          onchange="Admin.setDefenseStat('${mid}','${tn}','${pid}','assists',this.value)"
          style="width:44px;padding:3px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;text-align:center;"></label>
      </div>
    </div>`;

    // Extra panels depending on status
    const lineup2 = match.lineup[teamName];
    const getStatus2 = e => e.status || (e.starter === false ? 'suplente' : 'titular');

    // Titular (or unsubstituted lesionado): show "Reemplazar por" dropdown with available suplentes
    if ((st === 'titular' || (st === 'lesionado' && !entry.replacedBy))) {
      const availableSubs = lineup2.filter(e =>
        e.playerId !== playerId &&
        getStatus2(e) === 'suplente' &&
        !e.replacesPlayer
      );
      if (availableSubs.length > 0) {
        const selId = 'sub-in-' + playerId;
        h += `<div style="margin-top:10px;padding:10px 12px;background:rgba(255,152,0,0.06);border-radius:10px;border:1px solid rgba(255,152,0,0.2);">
          <div style="font-size:0.7rem;color:#ff9800;font-weight:700;margin-bottom:8px;">🔄 CAMBIO — Reemplazar por:</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <select id="${selId}" style="flex:1;padding:5px 8px;font-size:0.8rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,152,0,0.3);border-radius:6px;">
              ${availableSubs.map(e => { const cp = players.find(x => x.id === e.playerId); return cp ? `<option value="${e.playerId}">${cp.nombre} (${shortenPosition(e.position)})</option>` : ''; }).join('')}
            </select>
            <button class="btn btn-sm" onclick="Admin.makeSubstitution('${mid}','${tn}',document.getElementById('${selId}').value,'${pid}')"
              style="background:#ff9800;color:#000;font-weight:700;white-space:nowrap;">Confirmar</button>
          </div>
        </div>`;
      }
    }
    if (st === 'lesionado' && entry.replacedBy) {
      const subP = players.find(x => x.id === entry.replacedBy);
      if (subP) {
        h += `<div style="margin-top:8px;padding:6px 10px;background:rgba(255,152,0,0.06);border-radius:8px;border:1px solid rgba(255,152,0,0.15);font-size:0.75rem;color:#ff9800;">
          🔄 Reemplazado por: <strong>${subP.nombre}</strong>
        </div>`;
      }
    }
    if (st === 'titular' && entry.replacesPlayer) {
      const outP = players.find(x => x.id === entry.replacesPlayer);
      if (outP) {
        h += `<div style="margin-top:8px;padding:6px 10px;background:rgba(0,230,118,0.06);border-radius:8px;border:1px solid rgba(0,230,118,0.15);font-size:0.75rem;color:var(--green);">
          ↑ Entró por: <strong>${outP.nombre}</strong>
        </div>`;
      }
    }

    h += '</div>';
    return h;
  }

  function addPlayerToLineup(matchId, teamName, playerId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (m.lineup[teamName].find(e => e.playerId === playerId)) return; // already in
    const p = players.find(x => x.id === playerId);
    if (!p) return;
    const maxOrder = m.lineup[teamName].reduce((mx, e) => Math.max(mx, e.order), 0);
    m.lineup[teamName].push({
      playerId: p.id, order: maxOrder + 1, position: p.posicion, status: 'suplente',
      turns: [], defense: { outs: 0, errors: 0, assists: 0 }
    });
    autoSave(); renderView();
  }

  function removePlayerFromLineup(matchId, teamName, playerId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    m.lineup[teamName] = m.lineup[teamName].filter(e => e.playerId !== playerId);
    // Re-order
    m.lineup[teamName].forEach((e, i) => e.order = i + 1);
    syncLineupToPlayerStats(m);
    autoSave(); renderView();
  }

  function movePlayerInLineup(matchId, teamName, playerId, direction) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    const arr = m.lineup[teamName];
    const idx = arr.findIndex(e => e.playerId === playerId);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= arr.length) return;
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    arr.forEach((e, i) => e.order = i + 1);
    autoSave(); renderView();
  }

  // Softball field position coordinates (% based, for a 400x320 container)
  const FIELD_POSITIONS = {
    'Pitcher':      { x: 50, y: 58 },
    'Catcher':      { x: 50, y: 88 },
    'Primera Base': { x: 72, y: 56 },
    'Segunda Base': { x: 60, y: 40 },
    'Tercera Base': { x: 28, y: 56 },
    'Shortstop':    { x: 40, y: 40 },
    'Left Field':   { x: 15, y: 22 },
    'Center Field': { x: 50, y: 10 },
    'Right Field':  { x: 85, y: 22 },
    'Shortfield':   { x: 50, y: 30 },
    'BA':           { x: 92, y: 60 },
    'BD':           { x: 92, y: 75 }
    // Infielder, Outfielder are not fielded — shown in bench area
  };

  // Position number mapping (softball standard)
  const POSITION_NUMBERS = {
    'Pitcher': '1', 'Catcher': '2', 'Primera Base': '3', 'Segunda Base': '4',
    'Tercera Base': '5', 'Shortstop': '6', 'Left Field': '7', 'Center Field': '8',
    'Right Field': '9', 'Shortfield': '10', 'Infielder': 'IF', 'Outfielder': 'OF',
    'BA': 'BA', 'BD': 'BD'
  };
  function posNum(pos) { return POSITION_NUMBERS[pos] || (pos ? pos : '-'); }

  function shortenPosition(pos) {
    return (pos || '').replace('Primera Base','1B').replace('Segunda Base','2B').replace('Tercera Base','3B')
      .replace('Left Field','LF').replace('Center Field','CF').replace('Right Field','RF')
      .replace('Shortfield','SF').replace('Shortstop','SS').replace('Infielder','IF').replace('Outfielder','OF');
  }

  function setLineupPosition(matchId, teamName, playerId, position) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    entry.position = position;
    autoSave();
    renderView();
  }

  function cycleStatus(matchId, teamName, playerId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (!canEditLineup(m, teamName)) return;
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    const cur = entry.status || (entry.starter === false ? 'suplente' : 'titular');
    const order = { titular: 'lesionado', lesionado: 'suplente', suplente: 'ausente', ausente: 'titular' };
    entry.status = order[cur] || 'suplente';
    delete entry.starter; // migrate away from old field
    const _sp = players.find(x => x.id === playerId);
    const _sn = _sp ? `${_sp.nombre.split(' ')[0]} #${_sp.dorsal || '?'}` : playerId;
    logChange(matchId, 'status_change', `${_sn}: ${cur} → ${entry.status}`);
    autoSave();
    renderView();
  }

  function setPlayerOrder(matchId, teamName, playerId, newOrder) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (!canEditLineup(m, teamName)) return;
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    const n = parseInt(newOrder, 10);
    if (isNaN(n) || n < 1) return;
    entry.order = n;
    const _op = players.find(x => x.id === playerId);
    const _on = _op ? `${_op.nombre.split(' ')[0]} #${_op.dorsal || '?'}` : playerId;
    logChange(matchId, 'order_change', `${_on}: turno de bateo → ${n}`);
    autoSave();
    renderView();
  }

  function makeSubstitution(matchId, teamName, subPlayerId, outPlayerId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (!canEditLineup(m, teamName)) return;
    const outEntry = m.lineup[teamName].find(e => e.playerId === outPlayerId);
    const subEntry = m.lineup[teamName].find(e => e.playerId === subPlayerId);
    if (!outEntry || !subEntry) return;
    const inheritedOrder = outEntry.order;
    outEntry.status = 'lesionado';
    outEntry.replacedBy = subPlayerId;
    subEntry.status = 'titular';
    subEntry.order = inheritedOrder;
    subEntry.replacesPlayer = outPlayerId;
    const _outP = players.find(x => x.id === outPlayerId);
    const _subP = players.find(x => x.id === subPlayerId);
    const _outN = _outP ? `${_outP.nombre.split(' ')[0]} #${_outP.dorsal || '?'}` : outPlayerId;
    const _subN = _subP ? `${_subP.nombre.split(' ')[0]} #${_subP.dorsal || '?'}` : subPlayerId;
    logChange(matchId, 'substitution', `Sustitución (${teamName.split(' ')[0]}): sale ${_outN}, entra ${_subN}`);
    autoSave();
    renderView();
  }

  function renderFieldMap(match, teamName) {
    const lineup = match.lineup && match.lineup[teamName] ? match.lineup[teamName] : [];
    if (lineup.length === 0) return '';

    // Helper to resolve status (backward compat with old starter boolean)
    const getStatus = e => e.status || (e.starter === false ? 'suplente' : 'titular');
    const starters = lineup.filter(e => ['titular','lesionado'].includes(getStatus(e)));
    const subs = lineup.filter(e => getStatus(e) === 'suplente');
    const lesionados = lineup.filter(e => getStatus(e) === 'lesionado');
    const ausentes = lineup.filter(e => getStatus(e) === 'ausente');
    const canEdit = canEditTeam(teamName);
    const mid = match.id;
    const tn = teamName.replace(/'/g, "\\'");

    // Positions not shown on field (no defense) — go to bench section
    const NO_FIELD_POSITIONS = new Set(['Infielder', 'Outfielder']);
    // Separate field starters from bench-only starters
    const fieldStarters = starters.filter(e => !NO_FIELD_POSITIONS.has(e.position));
    const benchStarters = starters.filter(e => NO_FIELD_POSITIONS.has(e.position));

    // Drop zones for every defined field position (z-index 1, behind players)
    let dropZones = '';
    if (canEdit) {
      for (const [posName, pos] of Object.entries(FIELD_POSITIONS)) {
        dropZones += `<div class="field-drop-zone" data-pos="${posName}"
          style="left:${pos.x}%;top:${pos.y}%;"
          ondragover="Admin.onFieldDragOver(event)"
          ondragenter="this.classList.add('drop-hover')"
          ondragleave="this.classList.remove('drop-hover')"
          ondrop="Admin.onFieldDrop(event,'${posName}')"></div>`;
      }
    }

    // Track used positions to offset duplicates
    const usedPositions = {};
    let spots = '';
    for (const entry of fieldStarters) {
      const p = players.find(x => x.id === entry.playerId);
      if (!p) continue;
      let pos = FIELD_POSITIONS[entry.position];
      if (!pos) continue; // skip unknown field positions
      // Offset duplicates slightly
      const posKey = entry.position || 'unknown';
      if (usedPositions[posKey]) {
        usedPositions[posKey]++;
        pos = { x: pos.x + (usedPositions[posKey] % 2 === 0 ? 6 : -6), y: pos.y + (usedPositions[posKey] > 2 ? 8 : -2) };
      } else {
        usedPositions[posKey] = 1;
      }
      const photo = p.foto
        ? `<img src="${p.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span style="font-size:0.7rem;font-weight:700;color:rgba(255,255,255,0.8);">${p.nombre.charAt(0)}</span>`;
      const s = calcLineupSummary(entry);
      const statLine = s.pa > 0 ? `${s.h}-${s.ab}` : '';
      const lesIcon = getStatus(entry) === 'lesionado' ? '<div style="position:absolute;top:-4px;right:-4px;font-size:0.6rem;">🚑</div>' : '';

      const dragAttrs = canEdit
        ? `draggable="true"
           ondragstart="Admin.startFieldDrag('${mid}','${tn}','${entry.playerId}',event)"
           ondragend="Admin.clearFieldDrag()"
           ondragover="Admin.onFieldDragOver(event)"
           ondragenter="this.querySelector('.field-avatar').style.outlineColor='var(--gold)'"
           ondragleave="this.querySelector('.field-avatar').style.outlineColor=''"
           ondrop="Admin.onFieldDrop(event,'${entry.position}')"
           ontouchstart="Admin.touchDragStart(event,'${mid}','${tn}','${entry.playerId}')"` : '';

      spots += `<div class="field-spot" style="left:${pos.x}%;top:${pos.y}%;" ${dragAttrs}
        onclick="Admin.selectLineupPlayer('${entry.playerId}')">
        <div style="position:relative;display:inline-block;">
          <div class="field-avatar" style="border-color:${selectedLineupPlayerId === entry.playerId ? 'var(--gold)' : 'rgba(255,255,255,0.4)'};">
            ${photo}
          </div>
          ${lesIcon}
        </div>
        <div class="field-name">${p.nombre.split(' ')[0]}</div>
        <div class="field-pos">${shortenPosition(entry.position)}</div>
        ${statLine ? `<div class="field-stat">${statLine}</div>` : ''}
      </div>`;
    }

    let html = `<div class="softball-field" style="position:relative;width:100%;max-width:500px;margin:0 auto 12px;aspect-ratio:5/4;background:radial-gradient(ellipse at 50% 95%, rgba(139,90,43,0.3) 0%, rgba(34,85,34,0.25) 30%, rgba(34,85,34,0.15) 60%, transparent 80%);border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
      <svg viewBox="0 0 400 320" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" preserveAspectRatio="xMidYMid meet">
        <path d="M 20,90 Q 200,-30 380,90" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
        <polygon points="200,175 280,230 200,285 120,230" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>
        <path d="M 120,175 Q 200,130 280,175" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        <line x1="200" y1="285" x2="30" y2="50" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <line x1="200" y1="285" x2="370" y2="50" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
        <rect x="196" y="172" width="8" height="8" transform="rotate(45,200,176)" fill="var(--white)" opacity="0.4"/>
        <rect x="276" y="226" width="8" height="8" transform="rotate(45,280,230)" fill="var(--white)" opacity="0.4"/>
        <rect x="116" y="226" width="8" height="8" transform="rotate(45,120,230)" fill="var(--white)" opacity="0.4"/>
        <polygon points="196,285 200,280 204,285 204,290 196,290" fill="var(--white)" opacity="0.5"/>
        <circle cx="200" cy="230" r="5" fill="rgba(139,90,43,0.4)" stroke="rgba(255,255,255,0.1)"/>
      </svg>
      ${dropZones}
      ${spots}
    </div>`;

    // Infielder / Outfielder titulares (posiciones sin spot fijo en el campo)
    if (benchStarters.length > 0) {
      html += `<div style="margin:0 auto 8px;max-width:500px;background:rgba(245,166,35,0.04);border-radius:10px;padding:8px 12px;border:1px solid rgba(245,166,35,0.12);">
        <div style="font-size:0.7rem;color:var(--gold);margin-bottom:6px;font-weight:600;letter-spacing:1px;">CAMPO (${benchStarters.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      for (const entry of benchStarters) {
        const p = players.find(x => x.id === entry.playerId);
        if (!p) continue;
        const photo = p.foto
          ? `<img src="${p.foto}" style="width:24px;height:24px;object-fit:cover;border-radius:50%;">`
          : `<span style="font-size:0.55rem;font-weight:700;">${p.nombre.charAt(0)}</span>`;
        const isSelected = selectedLineupPlayerId === entry.playerId;
        html += `<div onclick="Admin.selectLineupPlayer('${entry.playerId}')" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;cursor:pointer;background:${isSelected ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isSelected ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.05)'};">
          <div style="width:24px;height:24px;border-radius:50%;overflow:hidden;background:var(--bg-card);display:flex;align-items:center;justify-content:center;">${photo}</div>
          <div>
            <div style="font-size:0.7rem;font-weight:600;${isSelected ? 'color:var(--gold);' : ''}">${p.nombre.split(' ')[0]}</div>
            <div style="font-size:0.55rem;color:var(--gold);font-weight:700;">${entry.position}</div>
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }

    // Bench / Suplentes section
    const allSubs = [...subs];
    if (allSubs.length > 0) {
      html += `<div style="margin:0 auto 16px;max-width:500px;background:rgba(255,255,255,0.02);border-radius:10px;padding:8px 12px;border:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.7rem;color:var(--white-muted);margin-bottom:6px;font-weight:600;letter-spacing:1px;">SUPLENTES (${allSubs.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      for (const entry of allSubs) {
        const p = players.find(x => x.id === entry.playerId);
        if (!p) continue;
        const photo = p.foto
          ? `<img src="${p.foto}" style="width:24px;height:24px;object-fit:cover;border-radius:50%;">`
          : `<span style="font-size:0.55rem;font-weight:700;">${p.nombre.charAt(0)}</span>`;
        const isSelected = selectedLineupPlayerId === entry.playerId;
        const dragA = canEdit ? `draggable="true" data-mid="${mid}" data-tn="${tn}" data-pid="${entry.playerId}" ondragstart="Admin.startFieldDrag(this.dataset.mid,this.dataset.tn,this.dataset.pid,event)" ondragend="Admin.clearFieldDrag()" ontouchstart="Admin.touchDragStart(event,this.dataset.mid,this.dataset.tn,this.dataset.pid)"` : "";
        html += `<div ${dragA} onclick="Admin.selectLineupPlayer('${entry.playerId}')" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;cursor:${canEdit ? 'grab' : 'pointer'};background:${isSelected ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isSelected ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.05)'};transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='${isSelected ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.03)'}'"}>
          <div style="width:24px;height:24px;border-radius:50%;overflow:hidden;background:var(--bg-card);display:flex;align-items:center;justify-content:center;">${photo}</div>
          <div>
            <div style="font-size:0.7rem;font-weight:600;${isSelected ? 'color:var(--gold);' : ''}">${p.nombre.split(' ')[0]}</div>
            <div style="font-size:0.55rem;color:var(--gold);">${shortenPosition(entry.position)}</div>
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }

    // Ausentes section
    if (ausentes.length > 0) {
      html += `<div style="margin:0 auto 16px;max-width:500px;background:rgba(244,67,54,0.04);border-radius:10px;padding:8px 12px;border:1px solid rgba(244,67,54,0.1);">
        <div style="font-size:0.7rem;color:var(--red);margin-bottom:6px;font-weight:600;letter-spacing:1px;">AUSENTES (${ausentes.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      for (const entry of ausentes) {
        const p = players.find(x => x.id === entry.playerId);
        if (!p) continue;
        const photo = p.foto
          ? `<img src="${p.foto}" style="width:24px;height:24px;object-fit:cover;border-radius:50%;filter:grayscale(100%);opacity:0.5;">`
          : `<span style="font-size:0.55rem;font-weight:700;opacity:0.4;">${p.nombre.charAt(0)}</span>`;
        const isSelected = selectedLineupPlayerId === entry.playerId;
        html += `<div onclick="Admin.selectLineupPlayer('${entry.playerId}')" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;cursor:pointer;background:${isSelected ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.02)'};border:1px solid ${isSelected ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.03)'};opacity:0.6;">
          <div style="width:24px;height:24px;border-radius:50%;overflow:hidden;background:var(--bg-card);display:flex;align-items:center;justify-content:center;">${photo}</div>
          <div>
            <div style="font-size:0.7rem;font-weight:600;${isSelected ? 'color:var(--gold);' : 'color:var(--white-muted);'}">${p.nombre.split(' ')[0]}</div>
          </div>
        </div>`;
      }
      html += `</div></div>`;
    }

    return html;
  }

  function renderBattingOrderCard(match, teamName) {
    const lineup = match.lineup && match.lineup[teamName] ? match.lineup[teamName] : [];
    if (lineup.length === 0) return '';
    const getStatus = e => e.status || (e.starter === false ? 'suplente' : 'titular');
    // Build slots: keyed by the "base" order (lesionado's order = canonical slot)
    // Collect all titulares and lesionados, skip pure suplentes/ausentes
    const active = lineup.filter(e => ['titular','lesionado'].includes(getStatus(e)));
    if (active.length === 0) return '';

    // Group by slot: for a sub (replacesPlayer set), slot = their order (which was inherited)
    // For a lesionado, slot = their order
    // Sort by order
    const sorted = [...active].sort((a, b) => a.order - b.order);

    let rows = '';
    const seenOrders = new Set();
    for (const entry of sorted) {
      const st = getStatus(entry);
      const p = players.find(x => x.id === entry.playerId);
      if (!p) continue;
      const isSelected = selectedLineupPlayerId === entry.playerId;
      if (st === 'lesionado') {
        const subEntry = entry.replacedBy ? lineup.find(e => e.playerId === entry.replacedBy) : null;
        const subP = subEntry ? players.find(x => x.id === subEntry.playerId) : null;
        rows += `<tr onclick="Admin.selectLineupPlayer('${entry.playerId}')" style="cursor:pointer;opacity:0.5;${isSelected ? 'background:rgba(245,166,35,0.1);' : ''}">
          <td style="padding:4px 8px;color:#ff9800;font-weight:700;text-decoration:line-through;">${entry.order}</td>
          <td style="padding:4px;text-align:center;font-size:0.7rem;color:var(--white-muted);">${p.dorsal || '-'}</td>
          <td style="padding:4px;text-align:center;font-weight:700;font-size:0.7rem;">${posNum(entry.position)}</td>
          <td style="padding:4px 8px;font-size:0.8rem;text-decoration:line-through;">${p.nombre} <span style="font-size:0.6rem;color:#ff9800;font-weight:700;">LES</span></td>
          <td style="padding:4px 8px;font-size:0.7rem;color:#ff9800;">${subP ? '→ ' + subP.nombre : ''}</td>
        </tr>`;
        if (subP && subEntry) {
          const isSubSel = selectedLineupPlayerId === subEntry.playerId;
          rows += `<tr onclick="Admin.selectLineupPlayer('${subEntry.playerId}')" style="cursor:pointer;${isSubSel ? 'background:rgba(245,166,35,0.1);' : ''}">
            <td style="padding:4px 8px;color:var(--green);font-weight:700;">↑ ${subEntry.order}</td>
            <td style="padding:4px;text-align:center;font-size:0.7rem;color:var(--white-muted);">${subP.dorsal || '-'}</td>
            <td style="padding:4px;text-align:center;font-weight:700;font-size:0.7rem;">${posNum(subEntry.position)}</td>
            <td style="padding:4px 8px;font-weight:600;font-size:0.8rem;${isSubSel ? 'color:var(--gold);' : ''}">${subP.nombre}</td>
            <td></td>
          </tr>`;
          seenOrders.add(subEntry.playerId);
        }
        seenOrders.add(entry.playerId);
      } else if (!seenOrders.has(entry.playerId)) {
        rows += `<tr onclick="Admin.selectLineupPlayer('${entry.playerId}')" style="cursor:pointer;${isSelected ? 'background:rgba(245,166,35,0.1);' : ''}">
          <td style="padding:4px 8px;color:var(--gold);font-weight:700;">${entry.order}</td>
          <td style="padding:4px;text-align:center;font-size:0.7rem;color:var(--white-muted);">${p.dorsal || '-'}</td>
          <td style="padding:4px;text-align:center;font-weight:700;font-size:0.7rem;">${posNum(entry.position)}</td>
          <td style="padding:4px 8px;font-weight:600;font-size:0.8rem;${isSelected ? 'color:var(--gold);' : ''}">${p.nombre}${entry.replacesPlayer ? ' <span style="font-size:0.6rem;color:var(--green);">↑</span>' : ''}</td>
          <td></td>
        </tr>`;
        seenOrders.add(entry.playerId);
      }
    }

    return `<div style="margin:0 auto 12px;max-width:500px;">
      <div style="font-size:0.7rem;color:var(--gold);font-weight:700;letter-spacing:1px;margin-bottom:6px;">ORDEN DE BATEO</div>
      <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
        <thead><tr style="background:rgba(255,255,255,0.04);font-size:0.65rem;color:var(--white-muted);">
          <th style="padding:4px 8px;text-align:left;">BAT</th>
          <th style="padding:4px;text-align:center;">No</th>
          <th style="padding:4px;text-align:center;">Pos</th>
          <th style="padding:4px 8px;text-align:left;">Jugador</th>
          <th style="padding:4px;"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function renderLineupEditor(match, teamName) {
    const canEdit = canEditTeam(teamName);
    const lineup = match.lineup && match.lineup[teamName] ? match.lineup[teamName] : [];
    const mid = match.id;
    const tn = teamName.replace(/'/g, "\\'");

    if (lineup.length === 0 && canEdit) {
      return `<div style="text-align:center;padding:40px 20px;">
        <p style="color:var(--white-muted);margin-bottom:16px;">No hay alineación para este equipo.</p>
        <button class="btn btn-primary" onclick="Admin.initLineupForMatch('${mid}','${tn}'); Admin.renderView();">
          📋 Crear Alineación desde Roster
        </button>
      </div>`;
    }
    if (lineup.length === 0) {
      return '<div style="text-align:center;padding:40px;color:var(--white-muted);">Sin alineación registrada.</div>';
    }

    // Field map
    let html = renderFieldMap(match, teamName);

    // Batting order card
    html += renderBattingOrderCard(match, teamName);

    // Summary table — clickable rows
    html += `<div style="overflow-x:auto;margin-bottom:16px;">
      <table id="lineup-summary-table" style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <thead><tr style="background:rgba(255,255,255,0.05);">
          <th style="padding:6px 8px;text-align:left;">#</th>
          <th style="padding:6px 4px;text-align:center;">No</th>
          <th style="padding:6px 4px;text-align:center;">Pos</th>
          <th style="padding:6px 8px;text-align:left;">Jugador</th>
          <th style="padding:6px 4px;">PA</th><th style="padding:6px 4px;">AB</th>
          <th style="padding:6px 4px;">H</th><th style="padding:6px 4px;">2B</th>
          <th style="padding:6px 4px;">3B</th><th style="padding:6px 4px;">HR</th>
          <th style="padding:6px 4px;">BB</th><th style="padding:6px 4px;">K</th>
          <th style="padding:6px 4px;">SB</th><th style="padding:6px 4px;">R</th>
          <th style="padding:6px 4px;">RBI</th><th style="padding:6px 4px;">AVG</th>
        </tr></thead><tbody>`;

    const totals = { pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, k: 0, sb: 0, r: 0, rbi: 0 };

    for (const entry of lineup) {
      const p = players.find(x => x.id === entry.playerId);
      if (!p) continue;
      const s = calcLineupSummary(entry);
      Object.keys(totals).forEach(k => totals[k] += s[k]);
      const isSelected = selectedLineupPlayerId === entry.playerId;
      const pStatus = entry.status || (entry.starter === false ? 'suplente' : 'titular');
      const statusTag = pStatus === 'suplente'   ? ' <span style="font-size:0.6rem;color:var(--white-muted);font-weight:400;">(SUP)</span>'
        : pStatus === 'ausente'   ? ' <span style="font-size:0.6rem;color:var(--red);font-weight:400;">(AUS)</span>'
        : pStatus === 'lesionado' ? ' <span style="font-size:0.6rem;color:#ff9800;font-weight:700;">🚑</span>' : '';
      const rowOpacity = pStatus === 'ausente' ? 'opacity:0.35;' : pStatus === 'suplente' ? 'opacity:0.5;' : pStatus === 'lesionado' ? 'opacity:0.6;' : '';
      html += `<tr data-pid="${entry.playerId}" style="border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;${isSelected ? 'background:rgba(245,166,35,0.15);' : ''}${rowOpacity}"
        onclick="Admin.selectLineupPlayer('${entry.playerId}')">
        <td style="padding:4px 8px;color:var(--gold);font-weight:700;">${entry.order}</td>
        <td style="padding:4px;text-align:center;color:var(--white-muted);font-size:0.7rem;">${p.dorsal || '-'}</td>
        <td style="padding:4px;text-align:center;font-weight:700;font-size:0.7rem;">${posNum(entry.position)}</td>
        <td style="padding:4px 8px;font-weight:600;${isSelected ? 'color:var(--gold);' : ''}">${p.nombre}${statusTag}</td>
        <td style="padding:4px;text-align:center;">${s.pa}</td>
        <td style="padding:4px;text-align:center;">${s.ab}</td>
        <td style="padding:4px;text-align:center;color:var(--green);font-weight:700;">${s.h}</td>
        <td style="padding:4px;text-align:center;">${s.doubles}</td>
        <td style="padding:4px;text-align:center;">${s.triples}</td>
        <td style="padding:4px;text-align:center;${s.hr > 0 ? 'color:var(--red);font-weight:700;' : ''}">${s.hr}</td>
        <td style="padding:4px;text-align:center;">${s.bb}</td>
        <td style="padding:4px;text-align:center;">${s.k}</td>
        <td style="padding:4px;text-align:center;">${s.sb}</td>
        <td style="padding:4px;text-align:center;">${s.r}</td>
        <td style="padding:4px;text-align:center;">${s.rbi}</td>
        <td style="padding:4px;text-align:center;font-weight:700;">${s.avg}</td>
      </tr>`;
    }
    const tAvg = totals.ab > 0 ? (totals.h / totals.ab).toFixed(3).replace(/^0+/, '') : '.000';
    html += `<tr style="border-top:2px solid var(--gold);font-weight:700;">
      <td colspan="4" style="padding:6px 8px;">TOTALES</td>
      <td style="padding:4px;text-align:center;">${totals.pa}</td>
      <td style="padding:4px;text-align:center;">${totals.ab}</td>
      <td style="padding:4px;text-align:center;">${totals.h}</td>
      <td style="padding:4px;text-align:center;">${totals.doubles}</td>
      <td style="padding:4px;text-align:center;">${totals.triples}</td>
      <td style="padding:4px;text-align:center;">${totals.hr}</td>
      <td style="padding:4px;text-align:center;">${totals.bb}</td>
      <td style="padding:4px;text-align:center;">${totals.k}</td>
      <td style="padding:4px;text-align:center;">${totals.sb}</td>
      <td style="padding:4px;text-align:center;">${totals.r}</td>
      <td style="padding:4px;text-align:center;">${totals.rbi}</td>
      <td style="padding:4px;text-align:center;">${tAvg}</td>
    </tr></tbody></table></div>`;

    if (!canEdit) return html;

    // Editor container — updated via direct DOM in selectLineupPlayer
    html += `<div id="lineup-editor-box">`;
    if (selectedLineupPlayerId) {
      html += buildPlayerEditor(match, teamName, selectedLineupPlayerId);
    } else {
      html += `<div style="text-align:center;padding:16px;color:var(--white-muted);font-size:0.85rem;border:1px dashed rgba(255,255,255,0.1);border-radius:12px;">
        Haz clic en un jugador de la tabla o del campo para editar sus turnos al bate.
      </div>`;
    }
    html += `</div>`;

    // Add player button
    const teamPlayers = players.filter(p => p.equipo === teamName && p.aprobado !== false);
    const inLineup = lineup.map(e => e.playerId);
    const available = teamPlayers.filter(p => !inLineup.includes(p.id));
    if (available.length > 0) {
      const selId = 'lineup-add-' + mid + '-' + teamName.replace(/\s/g, '_');
      html += `<div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
        <select id="${selId}" style="flex:1;padding:8px;background:var(--bg-card);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:8px;">
          ${available.map(p => `<option value="${p.id}">#${p.dorsal} ${p.nombre}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary" onclick="Admin.addPlayerToLineup('${mid}','${tn}',document.getElementById('${selId}').value)">+ Añadir</button>
      </div>`;
    }

    // ── Enviar Alineación section ──
    if (canEditLineup(match, teamName)) {
      const sentInfo = match.lineupSent && match.lineupSent[teamName];
      const sentBadge = sentInfo
        ? `<span class="lineup-sent-badge">✓ Enviada a las ${new Date(sentInfo.sentAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} por ${sentInfo.sentByName}</span>`
        : `<span class="lineup-draft-badge">Borrador — pendiente de envío</span>`;
      html += `<div style="margin-top:16px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        ${sentBadge}
        <button class="btn btn-primary" style="font-size:0.82rem;" onclick="Admin.enviarAlineacion('${mid}','${tn}')">📤 Enviar Alineación al partido</button>
      </div>`;
    }

    return html;
  }

  function renderLineupList() {
    const c = document.getElementById('main-content');
    const dt = getDelegadoTeam();

    // Helper: returns badge HTML for a team's lineup status in a match
    function lineupStatusBadge(match, teamName) {
      const hasPlayers = match.lineup && match.lineup[teamName] && match.lineup[teamName].length > 0;
      const sent = match.lineupSent && match.lineupSent[teamName];
      if (sent) return `<span class="lineup-sent-badge">✓ Enviada</span>`;
      if (hasPlayers) return `<span class="lineup-draft-badge">Borrador</span>`;
      return `<span style="font-size:0.75rem;color:var(--white-muted);background:rgba(255,255,255,0.06);border-radius:4px;padding:2px 8px;">Sin alineación</span>`;
    }

    let html = '<div style="max-width:900px;margin:0 auto;">';
    html += '<h2 style="font-family:var(--font-display);margin-bottom:20px;">📋 Alineaciones</h2>';

    if (partidos.length === 0) {
      html += '<div style="text-align:center;color:var(--white-muted);padding:40px;">No hay partidos en el calendario.</div>';
      html += '</div>';
      c.innerHTML = html;
      return;
    }

    // For delegado: show only matches involving their team, most relevant first
    const matchList = isDelegado() && dt
      ? partidos.filter(m => m.local === dt.nombre || m.visitante === dt.nombre)
      : partidos;

    if (isDelegado() && dt && matchList.length === 0) {
      html += `<div style="text-align:center;color:var(--white-muted);padding:40px;">No hay partidos asignados al equipo <strong>${dt.nombre}</strong>.</div>`;
      html += '</div>';
      c.innerHTML = html;
      return;
    }

    for (const m of matchList) {
      const statusLabel = m.status === 'live'
        ? '<span class="live-badge" style="font-size:0.65rem;">● EN VIVO</span>'
        : m.status === 'finished'
          ? '<span style="font-size:0.65rem;padding:2px 7px;border-radius:8px;background:rgba(244,67,54,0.15);color:var(--red);">Finalizado</span>'
          : '<span style="font-size:0.65rem;padding:2px 7px;border-radius:8px;background:rgba(255,255,255,0.07);color:var(--white-muted);">Programado</span>';

      // Determine which team(s) to show badges for
      const teamsToShow = isDelegado() && dt
        ? [dt.nombre]
        : [m.local, m.visitante];

      const badgesHtml = teamsToShow.map(tn =>
        `<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;color:var(--white-muted);">
          <span style="font-weight:600;">${tn}:</span> ${lineupStatusBadge(m, tn)}
        </div>`
      ).join('');

      // Navigate delegado directly to their team's sub-view tab
      const subView = (isDelegado() && dt && m.visitante === dt.nombre) ? 'visitante' : 'local';
      html += `<div onclick="Admin.viewMatch('${m.id}','${subView}')"
        style="background:var(--bg-card);border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.05);transition:background 0.2s;"
        onmouseover="this.style.background='var(--bg-card-inner)'" onmouseout="this.style.background='var(--bg-card)'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;margin-bottom:4px;">${m.local} vs ${m.visitante}</div>
            <div style="font-size:0.75rem;color:var(--white-muted);">${m.fecha}${m.hora ? ' · ' + m.hora : ''}${m.jornada ? ' · ' + m.jornada : ''}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            ${statusLabel}
            ${badgesHtml}
          </div>
        </div>
      </div>`;
    }

    html += '</div>';
    c.innerHTML = html;
  }

  // ── MODALS ──
  function openModal(id) { document.getElementById(id).classList.add('active'); }
  function closeModal(id) { document.getElementById(id).classList.remove('active'); }

  // ── EVENTS ──
  function bindEvents() {
    document.getElementById('btn-add-player').addEventListener('click', () => { resetModalTitles(); openModal('modal-add-player'); });
    document.getElementById('btn-add-team').addEventListener('click', () => { resetModalTitles(); openModal('modal-add-team'); });
    document.getElementById('btn-import-csv').addEventListener('click', () => openModal('modal-import-csv'));
    document.getElementById('btn-export').addEventListener('click', exportJSON);
    document.getElementById('btn-reset').addEventListener('click', resetData);
    document.getElementById('btn-demo').addEventListener('click', generateDemoData); // New button
    document.getElementById('add-player-form').addEventListener('submit', savePlayer); // Renamed handler
    document.getElementById('add-team-form').addEventListener('submit', saveTeam); // Renamed handler
    document.getElementById('csv-file').addEventListener('change', handleCSVFile);
    document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);
    document.getElementById('btn-download-template').addEventListener('click', downloadCSVTemplate);
    document.getElementById('inp-foto').addEventListener('change', handlePlayerPhotoChange);
    document.getElementById('team-imagen').addEventListener('change', handleTeamImageChange);
    document.getElementById('add-user-form').addEventListener('submit', saveUser);
    document.getElementById('match-csv-file').addEventListener('change', handleMatchCSVFile);
    document.getElementById('btn-confirm-match-csv').addEventListener('click', confirmMatchCSV);
    document.querySelectorAll('.modal-overlay').forEach(o => {
      o.addEventListener('click', function (e) { if (e.target === this) closeModal(this.id); });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
    });
  }

  function exportTeamCSV(teamName) {
    const tp = players.filter(p => p.equipo === teamName);
    if (tp.length === 0) { alert('Este equipo no tiene jugadores para exportar.'); return; }

    const headers = ['Nombre', 'Dorsal', 'Equipo', 'Posicion', 'Estado', 'Altura', 'Peso', 'Edad', 'AVG', 'HR', 'RBI', 'H', 'AB', 'R'];
    const rows = [headers.join(';')];

    tp.forEach(p => {
      const s = p.stats || {};
      const row = [
        p.nombre, p.dorsal, p.equipo, p.posicion, p.estado,
        p.altura || '', p.peso || '', p.edad || '',
        s.avg || '', s.hr || '', s.rbi || '', s.h || '', s.ab || '', s.r || ''
      ];
      rows.push(row.join(';'));
    });

    const csvContent = '\ufeff' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `jugadores_${teamName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function viewCard(id) {
    if (id) window.open(`index.html?id=${id}`, '_blank');
  }

  // ── EXPOSE TO WINDOW ──
  function saveMatchLog(id, text) {
    const match = partidos.find(p => p.id === id);
    if (!match) return;
    if (!isMatchWindowOpen(match)) {
      alert('Solo puedes escribir en la bitácora durante la ventana del partido (1 hora antes hasta 1 hora después de finalizar).');
      return;
    }
    const prev = (match.bitacora || '').trim();
    const next = text.trim();
    match.bitacora = text;
    // Only log if text actually changed and is non-empty
    if (next && next !== prev) {
      logChange(id, 'note', next);
    }
    autoSave();
    // Refresh the structured log panel if it's visible
    const box = document.getElementById('match-log-structured');
    if (box) box.innerHTML = renderMatchLog(match);
  }

  // ── FIELD DRAG & DROP (mouse + touch) ──
  let _fieldDrag = null;
  const _td = { pending: false, active: false, clone: null, matchId: null, teamName: null, playerId: null, startX: 0, startY: 0 };

  function startFieldDrag(matchId, teamName, playerId, event) {
    _fieldDrag = { matchId, teamName, playerId };
    if (event && event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', playerId);
    }
    document.querySelectorAll('.field-drop-zone').forEach(z => z.classList.add('drag-active'));
    const spot = event && event.currentTarget;
    if (spot) spot.classList.add('dragging');
  }

  function clearFieldDrag() {
    _fieldDrag = null;
    document.querySelectorAll('.field-drop-zone').forEach(z => z.classList.remove('drag-active', 'drop-hover'));
    document.querySelectorAll('.field-spot.dragging').forEach(s => s.classList.remove('dragging'));
  }

  function dropPlayerToPosition(positionName) {
    if (!_fieldDrag) return;
    const { matchId, teamName, playerId } = _fieldDrag;
    clearFieldDrag();
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
    if (!canEditLineup(m, teamName)) return;
    const getStatus = e => e.status || (e.starter === false ? 'suplente' : 'titular');
    const draggedEntry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!draggedEntry) return;
    // Swap positions with existing titular at that spot
    const occupant = m.lineup[teamName].find(e =>
      e.playerId !== playerId && e.position === positionName && getStatus(e) === 'titular'
    );
    const _oldPos = draggedEntry.position;
    if (occupant) occupant.position = draggedEntry.position;
    draggedEntry.position = positionName;
    const st = getStatus(draggedEntry);
    if (st === 'suplente' || st === 'ausente') draggedEntry.status = 'titular';
    const _pp = players.find(x => x.id === playerId);
    const _pn = _pp ? `${_pp.nombre.split(' ')[0]} #${_pp.dorsal || '?'}` : playerId;
    logChange(matchId, 'position_change', `${_pn}: ${_oldPos || '?'} → ${positionName}`);
    autoSave();
    renderView();
  }

  function onFieldDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function onFieldDrop(event, positionName) {
    event.preventDefault();
    event.currentTarget.classList.remove('drop-hover');
    dropPlayerToPosition(positionName);
  }

  // Touch drag (works on mobile)
  function touchDragStart(event, matchId, teamName, playerId) {
    event.preventDefault(); // prevents click from firing on touch
    const touch = event.touches[0];
    _td.pending = true; _td.active = false;
    _td.matchId = matchId; _td.teamName = teamName; _td.playerId = playerId;
    _td.startX = touch.clientX; _td.startY = touch.clientY; _td.clone = null;
    document.addEventListener('touchmove', _tdMove, { passive: false });
    document.addEventListener('touchend', _tdEnd, { once: true });
    document.addEventListener('touchcancel', _tdCancel, { once: true });
  }

  function _tdMove(event) {
    if (!_td.pending && !_td.active) return;
    const touch = event.touches[0];
    const dx = touch.clientX - _td.startX, dy = touch.clientY - _td.startY;
    if (_td.pending && Math.sqrt(dx * dx + dy * dy) > 10) {
      _td.pending = false; _td.active = true;
      event.preventDefault();
      _fieldDrag = { matchId: _td.matchId, teamName: _td.teamName, playerId: _td.playerId };
      const p = players.find(x => x.id === _td.playerId);
      const clone = document.createElement('div');
      clone.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;width:40px;height:40px;border-radius:50%;background:var(--bg-card);border:2px solid var(--gold);display:flex;align-items:center;justify-content:center;opacity:0.9;box-shadow:0 4px 16px rgba(0,0,0,0.6);';
      if (p && p.foto) clone.innerHTML = `<img src="${p.foto}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      else if (p) clone.innerHTML = `<span style="font-size:0.75rem;font-weight:700;color:var(--gold);">${p.nombre.charAt(0)}</span>`;
      clone.style.left = (touch.clientX - 20) + 'px';
      clone.style.top = (touch.clientY - 48) + 'px';
      document.body.appendChild(clone);
      _td.clone = clone;
      document.querySelectorAll('.field-drop-zone').forEach(z => z.classList.add('drag-active'));
      return;
    }
    if (_td.active) {
      event.preventDefault();
      if (_td.clone) {
        _td.clone.style.left = (touch.clientX - 20) + 'px';
        _td.clone.style.top = (touch.clientY - 48) + 'px';
      }
      const underEl = document.elementFromPoint(touch.clientX, touch.clientY);
      const zone = underEl && underEl.closest('.field-drop-zone[data-pos]');
      document.querySelectorAll('.field-drop-zone.drop-hover').forEach(z => { if (z !== zone) z.classList.remove('drop-hover'); });
      if (zone) zone.classList.add('drop-hover');
    }
  }

  function _tdEnd(event) {
    document.removeEventListener('touchmove', _tdMove);
    if (_td.clone) { document.body.removeChild(_td.clone); _td.clone = null; }
    if (_td.pending) {
      _td.pending = false; _td.active = false;
      selectLineupPlayer(_td.playerId); // treat as tap
      return;
    }
    if (_td.active) {
      const touch = event.changedTouches[0];
      const underEl = document.elementFromPoint(touch.clientX, touch.clientY);
      const zone = underEl && underEl.closest('.field-drop-zone[data-pos]');
      const positionName = zone && zone.getAttribute('data-pos');
      _td.active = false;
      if (positionName) {
        _fieldDrag = { matchId: _td.matchId, teamName: _td.teamName, playerId: _td.playerId };
        dropPlayerToPosition(positionName);
      } else {
        clearFieldDrag();
      }
    }
  }

  function _tdCancel() {
    document.removeEventListener('touchmove', _tdMove);
    if (_td.clone) { document.body.removeChild(_td.clone); _td.clone = null; }
    _td.pending = false; _td.active = false;
    clearFieldDrag();
  }

  // ── MATCH MESSAGING ──

  // Visibility: who can see a message
  function canSeeMsg(msg) {
    const cu = getCurrentUser();
    if (cu.rol === 'superusuario' || cu.rol === 'admin') return true;
    if (msg.from === cu.id) return true; // own messages always visible
    if (msg.to === 'all') return true;
    if (msg.to === 'all_delegados' && cu.rol === 'delegado') return true;
    if (msg.to === cu.id) return true;
    if (Array.isArray(msg.to) && msg.to.includes(cu.id)) return true;
    return false;
  }

  // Resolve display name for 'to' field
  function toLabel(to) {
    if (to === 'all') return 'Todos';
    if (to === 'all_delegados') return 'Todos los delegados';
    if (Array.isArray(to)) {
      return to.map(id => { const u = usuarios.find(x => x.id === id); return u ? u.nombre : id; }).join(', ');
    }
    const u = usuarios.find(x => x.id === to);
    return u ? u.nombre : to;
  }

  function sendMatchMessage(matchId, to, text) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !text.trim()) return;
    if (!m.mensajes) m.mensajes = [];
    const cu = getCurrentUser();
    m.mensajes.push({
      id: 'msg-' + Date.now(),
      timestamp: Date.now(),
      from: cu.id,
      fromNombre: cu.nombre || cu.id,
      fromRol: cu.rol,
      to,
      text: text.trim(),
      type: 'super_message',
      replies: []
    });
    autoSave();
    const box = document.getElementById('match-mensajes-box');
    if (box) box.innerHTML = renderMatchMessages(m);
    // Clear compose textarea
    const ta = document.getElementById('compose-msg-text');
    if (ta) ta.value = '';
  }

  function replyToMessage(matchId, msgId, text) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.mensajes || !text.trim()) return;
    const msg = m.mensajes.find(x => x.id === msgId);
    if (!msg) return;
    const cu = getCurrentUser();
    if (!msg.replies) msg.replies = [];
    msg.replies.push({
      id: 'reply-' + Date.now(),
      timestamp: Date.now(),
      from: cu.id,
      fromNombre: cu.nombre || cu.id,
      fromRol: cu.rol,
      text: text.trim()
    });
    autoSave();
    const box = document.getElementById('match-mensajes-box');
    if (box) box.innerHTML = renderMatchMessages(m);
  }

  function requestContactSuper(matchId, text) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !text.trim()) return;
    if (!m.mensajes) m.mensajes = [];
    const cu = getCurrentUser();
    // Find all super/admin IDs so only they can see this
    const superIds = usuarios.filter(u => u.rol === 'superusuario' || u.rol === 'admin').map(u => u.id);
    m.mensajes.push({
      id: 'msg-' + Date.now(),
      timestamp: Date.now(),
      from: cu.id,
      fromNombre: cu.nombre || cu.id,
      fromRol: cu.rol,
      to: superIds.length > 0 ? superIds : ['admin'],
      text: text.trim(),
      type: 'contact_request',
      replies: []
    });
    autoSave();
    const box = document.getElementById('match-mensajes-box');
    if (box) box.innerHTML = renderMatchMessages(m);
    const reqPanel = document.getElementById('contact-super-panel');
    if (reqPanel) reqPanel.innerHTML = '<div style="font-size:0.8rem;color:var(--green);padding:8px 0;">✓ Mensaje enviado al supervisor.</div>';
  }

  // Track last time current user viewed the messages of a match (sessionStorage, per-browser)
  function getLastSeenMessages(matchId) {
    try { return JSON.parse(sessionStorage.getItem('msg_seen') || '{}')[matchId] || 0; }
    catch(e) { return 0; }
  }

  function markMessagesRead(matchId) {
    try {
      const s = JSON.parse(sessionStorage.getItem('msg_seen') || '{}');
      s[matchId] = Date.now();
      sessionStorage.setItem('msg_seen', JSON.stringify(s));
    } catch(e) {}
  }

  function getUnreadMsgCount(m) {
    if (!m || !m.mensajes) return 0;
    const lastSeen = getLastSeenMessages(m.id);
    const cu = getCurrentUser();
    let count = 0;
    for (const msg of m.mensajes) {
      if (!canSeeMsg(msg) || msg.from === cu.id) continue;
      if (msg.timestamp > lastSeen) count++;
      // New replies from others on messages I can see
      for (const r of (msg.replies || [])) {
        if (r.from !== cu.id && r.timestamp > lastSeen) count++;
      }
    }
    return count;
  }

  function renderMatchMessages(m) {
    if (typeof m === 'string') m = partidos.find(x => x.id === m);
    if (!m) return '';
    const cu = getCurrentUser();
    const canSuper = isSuperuser() || isAdmin();
    const isDeleg = isDelegado();
    const msgs = (m.mensajes || []).filter(msg => canSeeMsg(msg)).slice().reverse();

    let html = '';

    // ── Unread notification banner ──
    const unread = getUnreadMsgCount(m);
    if (unread > 0) {
      html += `<div style="display:flex;align-items:center;gap:10px;background:rgba(229,57,53,0.12);border:1px solid rgba(229,57,53,0.35);border-radius:10px;padding:10px 14px;margin-bottom:12px;animation:livePulse 2s ease-in-out infinite;">
        <span style="font-size:1.2rem;">🔔</span>
        <div>
          <div style="font-size:0.82rem;font-weight:700;color:#ef5350;">Tienes ${unread} mensaje${unread !== 1 ? 's' : ''} nuevo${unread !== 1 ? 's' : ''}</div>
          <div style="font-size:0.68rem;color:var(--white-muted);">Desplázate para ver los mensajes sin leer</div>
        </div>
      </div>`;
    }

    // ── Super compose panel ──
    if (canSuper) {
      // Only delegados from the two teams playing this match
      const matchTeams = [m.local, m.visitante].map(t => (t || '').toLowerCase());
      const delegList = usuarios.filter(u =>
        u.rol === 'delegado' &&
        matchTeams.some(t => t && (u.equipo || '').toLowerCase() === t)
      );
      const recipientOptions = [
        '<option value="all_delegados">Todos los delegados del partido</option>',
        ...delegList.map(u => `<option value="${u.id}">${u.equipo || u.nombre} — Delegado</option>`)
      ].join('');
      html += `<div style="background:rgba(245,166,35,0.05);border:1px solid rgba(245,166,35,0.2);border-radius:10px;padding:12px;margin-bottom:14px;">
        <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:8px;">✉️ Nuevo mensaje</div>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:160px;">
            <span style="font-size:0.7rem;color:var(--white-muted);white-space:nowrap;">Para:</span>
            <select id="compose-msg-to" style="flex:1;padding:5px 8px;font-size:0.78rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(245,166,35,0.3);border-radius:6px;">
              ${recipientOptions}
            </select>
          </div>
        </div>
        <textarea id="compose-msg-text" rows="2"
          style="width:100%;padding:8px;font-size:0.8rem;background:rgba(0,0,0,0.3);color:var(--white);border:1px solid rgba(255,255,255,0.12);border-radius:8px;resize:vertical;"
          placeholder="Escribe un mensaje para los delegados..."></textarea>
        <div style="text-align:right;margin-top:6px;">
          <button class="btn btn-primary" onclick="Admin.sendMatchMessage('${m.id}',document.getElementById('compose-msg-to').value,document.getElementById('compose-msg-text').value)" style="font-size:0.78rem;padding:6px 14px;">Enviar →</button>
        </div>
      </div>`;
    }

    // ── Messages list ──
    if (msgs.length === 0) {
      html += '<div style="font-size:0.8rem;color:var(--white-muted);text-align:center;padding:12px 0;">Sin mensajes aún.</div>';
    }
    const lastSeen = getLastSeenMessages(m.id);
    for (const msg of msgs) {
      const dt = new Date(msg.timestamp);
      const timeStr = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const dateStr = dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      const isOwnMsg = msg.from === cu.id;
      const isContactReq = msg.type === 'contact_request';
      const isNewMsg = !isOwnMsg && msg.timestamp > lastSeen;
      const hasNewReply = (msg.replies || []).some(r => r.from !== cu.id && r.timestamp > lastSeen);
      const isUnread = isNewMsg || hasNewReply;
      const headerColor = isContactReq ? '#aaa' : (isOwnMsg ? 'var(--gold)' : 'var(--white)');
      const bgColor = isUnread ? 'rgba(229,57,53,0.08)' : isContactReq ? 'rgba(255,255,255,0.03)' : (isOwnMsg ? 'rgba(245,166,35,0.06)' : 'rgba(255,255,255,0.04)');
      const borderColor = isUnread ? 'rgba(229,57,53,0.4)' : isContactReq ? 'rgba(255,255,255,0.07)' : (isOwnMsg ? 'rgba(245,166,35,0.2)' : 'rgba(255,255,255,0.08)');
      const newBadge = isUnread ? '<span style="font-size:0.6rem;font-weight:700;background:#e53935;color:#fff;border-radius:8px;padding:1px 6px;margin-left:6px;">NUEVO</span>' : '';
      const dirLabel = !isContactReq && canSuper ? ` <span style="font-size:0.65rem;color:var(--white-muted);">→ ${toLabel(msg.to)}</span>` : '';
      const typeIcon = isContactReq ? '📩' : (msg.fromRol === 'superusuario' || msg.fromRol === 'admin' ? '📢' : '💬');

      // Can this user reply to this message?
      const canReply = !isContactReq && !isOwnMsg && (
        msg.to === cu.id ||
        msg.to === 'all' ||
        (msg.to === 'all_delegados' && isDeleg) ||
        (Array.isArray(msg.to) && msg.to.includes(cu.id))
      );
      // Supers can always reply
      const canReplyFinal = canReply || (canSuper && !isOwnMsg);

      html += `<div style="background:${bgColor};border:1px solid ${borderColor};border-radius:10px;padding:10px 12px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
          <span style="font-size:0.78rem;font-weight:700;color:${headerColor};">${typeIcon} ${msg.fromNombre}${dirLabel}${newBadge}</span>
          <span style="font-size:0.65rem;color:var(--white-muted);">${dateStr} ${timeStr}</span>
        </div>
        <div style="font-size:0.82rem;color:var(--white);line-height:1.4;">${msg.text}</div>`;

      // Replies
      if (msg.replies && msg.replies.length > 0) {
        html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">';
        for (const r of msg.replies) {
          const rdt = new Date(r.timestamp);
          const rTime = rdt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          html += `<div style="display:flex;gap:6px;margin-bottom:4px;">
            <span style="font-size:0.7rem;color:var(--white-muted);flex-shrink:0;">${r.fromNombre} · ${rTime}</span>
            <span style="font-size:0.75rem;color:var(--white);">${r.text}</span>
          </div>`;
        }
        html += '</div>';
      }

      // Reply input
      if (canReplyFinal) {
        const replyId = 'reply-' + msg.id;
        html += `<div style="display:flex;gap:6px;margin-top:8px;">
          <input id="${replyId}" type="text" placeholder="Responder..."
            style="flex:1;padding:5px 8px;font-size:0.75rem;background:rgba(0,0,0,0.3);color:var(--white);border:1px solid rgba(255,255,255,0.12);border-radius:6px;"
            onkeydown="if(event.key==='Enter'){Admin.replyToMessage('${m.id}','${msg.id}',this.value);this.value='';}">
          <button class="btn btn-sm btn-secondary" onclick="Admin.replyToMessage('${m.id}','${msg.id}',document.getElementById('${replyId}').value);document.getElementById('${replyId}').value='';" style="font-size:0.7rem;padding:4px 8px;">↩</button>
        </div>`;
      }

      html += '</div>';
    }

    // ── Delegado: initiate contact with super ──
    if (isDeleg) {
      const hasPendingReq = (m.mensajes || []).some(msg =>
        msg.type === 'contact_request' && msg.from === cu.id &&
        (!msg.replies || msg.replies.length === 0)
      );
      html += `<div id="contact-super-panel" style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;">`;
      if (hasPendingReq) {
        html += '<div style="font-size:0.75rem;color:var(--white-muted);text-align:center;">Ya tienes una solicitud pendiente con el supervisor.</div>';
      } else {
        html += `<div style="font-size:0.75rem;color:var(--white-muted);margin-bottom:6px;">¿Necesitas contactar al supervisor?</div>
          <div style="display:flex;gap:6px;">
            <input id="contact-super-text" type="text" placeholder="Escribe tu mensaje..."
              style="flex:1;padding:5px 8px;font-size:0.75rem;background:rgba(0,0,0,0.3);color:var(--white);border:1px solid rgba(255,255,255,0.12);border-radius:6px;"
              onkeydown="if(event.key==='Enter'){Admin.requestContactSuper('${m.id}',this.value);}">
            <button class="btn btn-sm btn-secondary" onclick="Admin.requestContactSuper('${m.id}',document.getElementById('contact-super-text').value);" style="font-size:0.7rem;white-space:nowrap;">Enviar al Super</button>
          </div>`;
      }
      html += '</div>';
    }

    return html;
  }

  // ── GAME LOG ──
  function logChange(matchId, type, description) {
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    if (!isMatchWindowOpen(m)) return; // only register changes within the match window
    if (!m.log) m.log = [];
    const cu = getCurrentUser();
    m.log.push({
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      type,
      actorId: cu.id,
      actorNombre: cu.nombre || cu.id,
      actorRol: cu.rol,
      description,
      acknowledged: (cu.rol === 'admin' || cu.rol === 'superusuario') // auto-ack if admin/super made the change
    });
  }

  function startGame(matchId) {
    if (!isAdmin() && !isSuperuser()) return;
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    m.status = 'live';
    m.startedAt = Date.now();
    logChange(matchId, 'game_start', 'Partido iniciado');
    autoSave();
    renderView();
  }

  function endGame(matchId) {
    if (!isAdmin() && !isSuperuser()) return;
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    if (!confirm('¿Finalizar el partido? Esta acción declarará el partido como terminado.')) return;

    // Build final summary before changing status (logChange guard passes while live)
    const totalChanges = (m.log || []).length;
    let localScore = 0, visitScore = 0;
    if (m.playerStats) {
      Object.entries(m.playerStats).forEach(([pid, s]) => {
        const p = players.find(x => x.id === pid);
        if (p) {
          if (p.equipo === m.local) localScore += (s.r || 0);
          if (p.equipo === m.visitante) visitScore += (s.r || 0);
        }
      });
    }
    const duration = m.startedAt ? Math.round((Date.now() - m.startedAt) / 60000) : null;
    const durationStr = duration ? ` · Duración: ${duration} min` : '';
    const summary = `Partido finalizado — ${m.local} ${localScore} : ${visitScore} ${m.visitante}${durationStr} · ${totalChanges} cambios registrados`;

    // Log while still 'live' so the guard passes
    logChange(matchId, 'game_end', summary);

    // Append summary to free-text bitácora as permanent record
    const ts = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const prev = (m.bitacora || '').trim();
    m.bitacora = (prev ? prev + '\n' : '') + `[${ts}] ${summary}`;

    m.status = 'finished';
    m.endedAt = Date.now();
    autoSave();
    renderView();
  }

  function acknowledgeLog(matchId, logId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.log) return;
    const entry = m.log.find(x => x.id === logId);
    if (entry) {
      entry.acknowledged = true;
      entry.acknowledgedBy = getCurrentUser().id;
      entry.acknowledgedAt = Date.now();
    }
    autoSave();
    const box = document.getElementById('match-log-structured');
    if (box) box.innerHTML = renderMatchLog(m);
    // Refresh tab badge without full re-render
    const tabContainer = document.querySelector('[onclick*="setLineupSubView(\'bitacora\')"]');
    if (tabContainer) {
      const pending = (m.log || []).filter(e => !e.acknowledged && e.actorRol === 'delegado').length;
      tabContainer.innerHTML = pending > 0
        ? `📝 Bitácora <span style="background:var(--gold);color:#000;border-radius:10px;padding:1px 6px;font-size:0.65rem;font-weight:700;">${pending}</span>`
        : '📝 Bitácora';
    }
  }

  function acknowledgeAllLogs(matchId) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.log) return;
    const cu = getCurrentUser();
    m.log.forEach(e => {
      if (!e.acknowledged) {
        e.acknowledged = true;
        e.acknowledgedBy = cu.id;
        e.acknowledgedAt = Date.now();
      }
    });
    autoSave();
    const box = document.getElementById('match-log-structured');
    if (box) box.innerHTML = renderMatchLog(m);
    const tabContainer = document.querySelector('[onclick*="setLineupSubView(\'bitacora\')"]');
    if (tabContainer) tabContainer.innerHTML = '📝 Bitácora';
  }

  function renderMatchLog(m) {
    if (!m.log || m.log.length === 0) {
      return '<div style="color:var(--white-muted);font-size:0.8rem;padding:20px 0;text-align:center;">No hay cambios registrados aún.</div>';
    }
    const canAck = isAdmin() || isSuperuser();
    const sorted = [...m.log].reverse();
    const pending = sorted.filter(e => !e.acknowledged && e.actorRol === 'delegado').length;
    const LOG_ICONS = {
      game_start: '▶️', game_end: '🏁',
      turn_result: '⚾', defense_change: '🧤',
      status_change: '🔄', order_change: '🔢',
      substitution: '↕️', position_change: '📍',
      note: '📝'
    };
    let html = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div style="font-size:0.75rem;color:var(--white-muted);">${m.log.length} cambio${m.log.length !== 1 ? 's' : ''}${pending > 0 ? ` · <span style="color:var(--gold);font-weight:700;">${pending} pendiente${pending !== 1 ? 's' : ''}</span>` : ''}</div>
      ${canAck && pending > 0 ? `<button class="btn btn-sm btn-secondary" onclick="Admin.acknowledgeAllLogs('${m.id}')" style="font-size:0.7rem;padding:4px 10px;">✓ Reconocer todo</button>` : ''}
    </div><div style="display:flex;flex-direction:column;gap:5px;max-height:320px;overflow-y:auto;">`;
    for (const e of sorted) {
      const dt = new Date(e.timestamp);
      const timeStr = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = dt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
      const icon = LOG_ICONS[e.type] || '📝';
      const isDelegate = e.actorRol === 'delegado';
      const needsAck = !e.acknowledged && isDelegate;
      html += `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border-radius:8px;background:${needsAck ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.03)'};border:1px solid ${needsAck ? 'rgba(245,166,35,0.25)' : 'transparent'};">
        <span style="font-size:0.9rem;flex-shrink:0;margin-top:1px;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.82rem;color:var(--white);">${e.description}</div>
          <div style="font-size:0.68rem;color:var(--white-muted);margin-top:2px;">${e.actorNombre} · ${dateStr} ${timeStr}</div>
        </div>
        ${needsAck && canAck ? `<button onclick="Admin.acknowledgeLog('${m.id}','${e.id}')" style="flex-shrink:0;background:rgba(245,166,35,0.15);border:1px solid var(--gold);color:var(--gold);border-radius:6px;padding:3px 8px;font-size:0.7rem;cursor:pointer;white-space:nowrap;">✓ OK</button>` : ''}
        ${e.acknowledged ? `<span style="flex-shrink:0;color:var(--green);font-size:0.75rem;opacity:0.7;margin-top:2px;">✓</span>` : ''}
      </div>`;
    }
    html += '</div>';
    return html;
  }

  // ── ENVIAR ALINEACIÓN ──
  function enviarAlineacion(matchId, teamName) {
    const m = partidos.find(x => x.id === matchId);
    if (!m) return;
    if (!canEditLineup(m, teamName)) { alert('No tienes permisos para enviar esta alineación.'); return; }
    const lineup = m.lineup && m.lineup[teamName];
    if (!lineup || lineup.length === 0) { alert('Añade al menos un jugador antes de enviar la alineación.'); return; }
    if (!m.lineupSent) m.lineupSent = {};
    const cu = getCurrentUser();
    m.lineupSent[teamName] = { sentAt: new Date().toISOString(), sentBy: cu.id, sentByName: cu.nombre || cu.id };
    autoSave();
    renderView();
    alert(`Alineación de ${teamName} enviada al partido${m.jornada ? ' — Jornada ' + m.jornada : ''} (${m.fecha})`);
  }

  window.Admin = {
    init,
    renderView,
    renderTeams: renderTeamShields,
    renderRoster,
    renderCalendar,
    renderStandings,
    switchTab,
    renderMatchDetail,
    viewMatch,
    backToCalendar,
    updateStanding,
    resetStandings,
    selectTeam,
    backToTeams,
    saveMatchLog,

    // Actions called from HTML
    toggleEstado,
    toggleVerificado,
    aprobarJugador,
    rechazarJugador,
    deletePlayer,
    viewCard,

    // Edit functions
    editTeam,
    deleteTeam,
    editPlayer,
    savePlayer,
    saveTeam,

    // Handlers
    handlePhotoUpload: handlePlayerPhotoChange,
    handleTeamImageUpload: handleTeamImageChange,
    handleCSVFile,
    closeModal,
    saveMatchLog,

    // Exports & Utilities
    downloadCSVTemplate,
    exportJSON,
    exportTeamCSV,
    resetData,
    generateDemoData,

    // Match stats CSV
    downloadMatchTemplate,
    openMatchCSV,
    handleMatchCSVFile,
    confirmMatchCSV,
    recalcAllPlayerStats,

    // User management
    applyPermissions,
    logout,
    renderUsers,
    openAddUser,
    editUser,
    saveUser,
    deleteUser,

    // Match CRUD
    openCreateMatch,
    saveNewMatch,
    deleteMatch,
    startGame,
    endGame,

    // Game log
    acknowledgeLog,
    acknowledgeAllLogs,

    // Messaging
    sendMatchMessage,
    replyToMessage,
    requestContactSuper,

    // Lineup / Scorecard
    enviarAlineacion,
    setLineupSubView,
    initLineupForMatch,
    setTurnResult,
    setDefenseStat,
    addPlayerToLineup,
    removePlayerFromLineup,
    movePlayerInLineup,
    selectLineupPlayer,
    cycleStatus,
    setPlayerOrder,
    makeSubstitution,
    setLineupPosition,
    startFieldDrag,
    clearFieldDrag,
    dropPlayerToPosition,
    onFieldDragOver,
    onFieldDrop,
    touchDragStart,
    renderLineupList,

    // Legacy aliases
    toggleStats: renderStats
  };

  // ── COLLAPSIBLE HEADER ON SCROLL ──
  function initScrollHeader() {
    const header = document.querySelector('.admin-header');
    if (!header) return;
    let lastScrollY = window.scrollY;
    let ticking = false;
    // Only use transform (header-hidden) — no size changes that affect layout
    window.addEventListener('scroll', function () {
      if (!ticking) {
        window.requestAnimationFrame(function () {
          const currentY = window.scrollY;
          if (currentY <= 10) {
            header.classList.remove('header-hidden');
          } else if (currentY > lastScrollY + 8) {
            // Scrolling down: hide header
            header.classList.add('header-hidden');
          } else if (currentY < lastScrollY - 8) {
            // Scrolling up: show header
            header.classList.remove('header-hidden');
          }
          lastScrollY = currentY;
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  function init() { bindEvents(); loadData(); initScrollHeader(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
