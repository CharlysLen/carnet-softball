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
    return equipos.find(e => e.nombre === u.equipo || e.id === u.equipo ||
      e.nombre.toLowerCase() === u.equipo.toLowerCase() || e.id.toLowerCase() === u.equipo.toLowerCase());
  }
  function canEditTeam(teamName) {
    if (isUsuario()) return false;
    if (isAdmin() || isSuperuser()) return true;
    if (!isDelegado()) return false;
    const dt = getDelegadoTeam();
    return dt && (dt.nombre === teamName || dt.id === teamName);
  }
  // Only Admin & Superusuario can toggle estado/verificado
  function canToggleStatus() { return isAdmin() || isSuperuser(); }
  // Admin & Superusuario can manage teams (create/edit/delete)
  function canManageTeams() { return isAdmin() || isSuperuser(); }

  function autoSave() {
    AppStore.save({ equipos, jugadores: players, partidos, usuarios });
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
        ${!isUsuario() ? `<button class="btn btn-primary" onclick="Admin.openCreateMatch()" style="margin-top:10px;">+ Crear Primer Partido</button>` : ''}
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

    // Create match button (admin, superusuario, delegado)
    if (!isUsuario()) {
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

      html += `
         <div class="match-card" onclick="Admin.viewMatch('${m.id}')" style="background:var(--bg-card);border-radius:12px;padding:15px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;border:1px solid rgba(255,255,255,0.05);cursor:pointer;transition:transform 0.2s, background 0.2s;">
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
             <div style="margin-top:4px;color:var(--gold);font-size:0.6rem;">VER DETALLES →</div>
           </div>
         </div>
       `;
    });

    html += '</div>';
    c.innerHTML = html;
  }

  // ── CREATE / EDIT MATCH ──
  function openCreateMatch(editId) {
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
        playerStats: {}
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
            const labels = { resumen: '📊 Resumen', local: '⚾ ' + m.local, visitante: '⚾ ' + m.visitante, bitacora: '📝 Bitácora' };
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
            <h3 style="color:var(--gold);font-family:var(--font-display);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;font-size:0.9rem;">📝 Cuaderno de Bitácora</h3>
            <textarea id="match-log-${m.id}"
                      style="width:100%;height:120px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;color:var(--white);font-family:inherit;resize:vertical;"
                      placeholder="Escribe aquí las incidencias, notas del partido o comentarios..."
                      onblur="Admin.saveMatchLog('${m.id}', this.value)">${m.bitacora || ''}</textarea>
            <div style="text-align:right;font-size:0.7rem;color:var(--white-muted);margin-top:5px;">Se guarda automáticamente al hacer clic fuera.</div>
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
    const roleLabels = { admin: 'Admin', superusuario: 'Superusuario', delegado: 'Delegado', usuario: 'Jugador' };
    const badge = document.getElementById('current-user-badge');
    if (badge) badge.textContent = `${user.nombre} (${roleLabels[user.rol] || user.rol}${(delegado || usuario) ? ' · ' + (user.equipo || 'Sin equipo') : ''})`;

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
    const m = partidos.find(x => x.id === selectedMatchId);
    if (!m) return;

    // Find the team whose lineup contains this player (don't rely on lineupSubView alone)
    let teamName = null;
    const candidates = lineupSubView === 'visitante'
      ? [m.visitante, m.local]
      : [m.local, m.visitante];
    for (const tn of candidates) {
      if (m.lineup && m.lineup[tn] && m.lineup[tn].find(e => e.playerId === playerId)) {
        teamName = tn;
        break;
      }
    }
    if (!teamName) return;

    const box = document.getElementById('lineup-editor-box');
    if (!box) {
      // Fallback: full re-render (box not in DOM means canEdit was false)
      renderView();
      return;
    }

    const html = buildPlayerEditor(m, teamName, playerId);
    if (!html) return; // player or entry not found

    box.innerHTML = html;
    // Highlight selected row in table
    document.querySelectorAll('#lineup-summary-table tr[data-pid]').forEach(tr => {
      tr.style.background = tr.dataset.pid === playerId ? 'rgba(245,166,35,0.15)' : '';
    });
    // Scroll editor into view
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setTurnResult(matchId, teamName, playerId, turnIdx, field, value) {
    const m = partidos.find(x => x.id === matchId);
    if (!m || !m.lineup || !m.lineup[teamName]) return;
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
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    entry.defense[field] = parseInt(value, 10) || 0;
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
      titular: { bg: 'rgba(0,230,118,0.15)', color: 'var(--green)', label: 'Titular', icon: '⚾', next: 'suplente', nextLabel: 'Suplente' },
      suplente: { bg: 'rgba(255,255,255,0.08)', color: 'var(--white-muted)', label: 'Suplente', icon: '📋', next: 'ausente', nextLabel: 'Ausente' },
      ausente: { bg: 'rgba(244,67,54,0.15)', color: 'var(--red)', label: 'Ausente', icon: '❌', next: 'titular', nextLabel: 'Titular' }
    };
    const stStyle = STATUS_STYLES[st] || STATUS_STYLES.suplente;
    const ALL_POSITIONS = ['Pitcher','Catcher','Primera Base','Segunda Base','Tercera Base','Shortstop','Left Field','Center Field','Right Field','Shortfield','Utility'];
    let h = `<div style="background:rgba(245,166,35,0.06);border-radius:12px;padding:14px;border:1px solid rgba(245,166,35,0.2);animation:slideUp 0.2s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="color:var(--gold);font-weight:700;font-size:1.1rem;">#${entry.order}</span>
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

    // Defense
    h += `<div style="margin-top:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;">
      <div style="font-size:0.7rem;color:var(--white-muted);margin-bottom:5px;font-weight:600;">Defensa</div>
      <div style="display:flex;gap:12px;">
        <label style="font-size:0.75rem;display:flex;align-items:center;gap:4px;">O: <input type="number" min="0" max="99" value="${entry.defense.outs}"
          onchange="Admin.setDefenseStat('${mid}','${tn}','${pid}','outs',this.value)"
          style="width:44px;padding:3px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;text-align:center;"></label>
        <label style="font-size:0.75rem;display:flex;align-items:center;gap:4px;">E: <input type="number" min="0" max="99" value="${entry.defense.errors}"
          onchange="Admin.setDefenseStat('${mid}','${tn}','${pid}','errors',this.value)"
          style="width:44px;padding:3px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;text-align:center;"></label>
        <label style="font-size:0.75rem;display:flex;align-items:center;gap:4px;">A: <input type="number" min="0" max="99" value="${entry.defense.assists}"
          onchange="Admin.setDefenseStat('${mid}','${tn}','${pid}','assists',this.value)"
          style="width:44px;padding:3px;font-size:0.75rem;background:var(--bg-card-inner);color:var(--white);border:1px solid rgba(255,255,255,0.15);border-radius:4px;text-align:center;"></label>
      </div>
    </div>`;

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
    'Utility':      { x: 50, y: 75 }
  };

  function shortenPosition(pos) {
    return (pos || '').replace('Primera Base','1B').replace('Segunda Base','2B').replace('Tercera Base','3B')
      .replace('Left Field','LF').replace('Center Field','CF').replace('Right Field','RF')
      .replace('Shortfield','SF').replace('Shortstop','SS');
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
    const entry = m.lineup[teamName].find(e => e.playerId === playerId);
    if (!entry) return;
    const cur = entry.status || (entry.starter === false ? 'suplente' : 'titular');
    const order = { titular: 'suplente', suplente: 'ausente', ausente: 'titular' };
    entry.status = order[cur] || 'suplente';
    delete entry.starter; // migrate away from old field
    autoSave();
    renderView();
  }

  function renderFieldMap(match, teamName) {
    const lineup = match.lineup && match.lineup[teamName] ? match.lineup[teamName] : [];
    if (lineup.length === 0) return '';

    // Helper to resolve status (backward compat with old starter boolean)
    const getStatus = e => e.status || (e.starter === false ? 'suplente' : 'titular');
    const starters = lineup.filter(e => getStatus(e) === 'titular');
    const subs = lineup.filter(e => getStatus(e) === 'suplente');
    const ausentes = lineup.filter(e => getStatus(e) === 'ausente');
    const canEdit = canEditTeam(teamName);
    const mid = match.id;
    const tn = teamName.replace(/'/g, "\\'");

    // Track used positions to offset duplicates
    const usedPositions = {};
    let spots = '';
    for (const entry of starters) {
      const p = players.find(x => x.id === entry.playerId);
      if (!p) continue;
      let pos = FIELD_POSITIONS[entry.position] || FIELD_POSITIONS['Utility'];
      // Offset duplicates slightly
      const posKey = entry.position || 'Utility';
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

      spots += `<div class="field-spot" style="left:${pos.x}%;top:${pos.y}%;"
        onclick="Admin.selectLineupPlayer('${entry.playerId}')">
        <div class="field-avatar" style="border-color:${selectedLineupPlayerId === entry.playerId ? 'var(--gold)' : 'rgba(255,255,255,0.4)'};">
          ${photo}
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
      ${spots}
    </div>`;

    // Bench / Suplentes section
    if (subs.length > 0) {
      html += `<div style="margin:0 auto 16px;max-width:500px;background:rgba(255,255,255,0.02);border-radius:10px;padding:8px 12px;border:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.7rem;color:var(--white-muted);margin-bottom:6px;font-weight:600;letter-spacing:1px;">SUPLENTES (${subs.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      for (const entry of subs) {
        const p = players.find(x => x.id === entry.playerId);
        if (!p) continue;
        const photo = p.foto
          ? `<img src="${p.foto}" style="width:24px;height:24px;object-fit:cover;border-radius:50%;">`
          : `<span style="font-size:0.55rem;font-weight:700;">${p.nombre.charAt(0)}</span>`;
        const isSelected = selectedLineupPlayerId === entry.playerId;
        html += `<div onclick="Admin.selectLineupPlayer('${entry.playerId}')" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:8px;cursor:pointer;background:${isSelected ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isSelected ? 'rgba(245,166,35,0.3)' : 'rgba(255,255,255,0.05)'};transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='${isSelected ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.03)'}'"}>
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

    // Summary table — clickable rows
    html += `<div style="overflow-x:auto;margin-bottom:16px;">
      <table id="lineup-summary-table" style="width:100%;border-collapse:collapse;font-size:0.75rem;">
        <thead><tr style="background:rgba(255,255,255,0.05);">
          <th style="padding:6px 8px;text-align:left;">#</th>
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
      const statusTag = pStatus === 'suplente' ? ' <span style="font-size:0.6rem;color:var(--white-muted);font-weight:400;">(SUP)</span>'
        : pStatus === 'ausente' ? ' <span style="font-size:0.6rem;color:var(--red);font-weight:400;">(AUS)</span>' : '';
      const rowOpacity = pStatus === 'ausente' ? 'opacity:0.35;' : pStatus === 'suplente' ? 'opacity:0.5;' : '';
      html += `<tr data-pid="${entry.playerId}" style="border-bottom:1px solid rgba(255,255,255,0.03);cursor:pointer;${isSelected ? 'background:rgba(245,166,35,0.15);' : ''}${rowOpacity}"
        onclick="Admin.selectLineupPlayer('${entry.playerId}')">
        <td style="padding:4px 8px;color:var(--gold);">${entry.order}</td>
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
      <td colspan="2" style="padding:6px 8px;">TOTALES</td>
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

    return html;
  }

  function renderLineupList() {
    const c = document.getElementById('main-content');
    const matchesWithLineup = partidos.filter(m => m.lineup && Object.keys(m.lineup).length > 0);
    const matchesWithout = partidos.filter(m => !m.lineup || Object.keys(m.lineup).length === 0);

    let html = '<div style="max-width:900px;margin:0 auto;">';
    html += '<h2 style="font-family:var(--font-display);margin-bottom:20px;">📋 Alineaciones</h2>';

    if (matchesWithLineup.length > 0) {
      html += '<h3 style="color:var(--gold);font-size:0.85rem;margin-bottom:10px;">Con alineación registrada</h3>';
      for (const m of matchesWithLineup) {
        const teams = Object.keys(m.lineup).join(' vs ');
        html += `<div onclick="Admin.viewMatch('${m.id}','local')" style="background:var(--bg-card);border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;transition:background 0.2s;" onmouseover="this.style.background='var(--bg-card-inner)'" onmouseout="this.style.background='var(--bg-card)'">
          <div>
            <div style="font-weight:700;">${m.local} vs ${m.visitante}</div>
            <div style="font-size:0.75rem;color:var(--white-muted);">${m.fecha} • ${m.jornada || ''}</div>
          </div>
          <div style="font-size:0.75rem;color:var(--gold);">${teams}</div>
        </div>`;
      }
    }

    if (matchesWithout.length > 0 && (isAdmin() || isSuperuser() || isDelegado())) {
      html += '<h3 style="color:var(--white-muted);font-size:0.85rem;margin:20px 0 10px;">Sin alineación</h3>';
      for (const m of matchesWithout) {
        html += `<div onclick="Admin.viewMatch('${m.id}')" style="background:var(--bg-card);border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;border:1px solid rgba(255,255,255,0.05);opacity:0.6;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
          <div style="font-weight:700;">${m.local} vs ${m.visitante}</div>
          <div style="font-size:0.75rem;color:var(--white-muted);">${m.fecha} • ${m.jornada || ''}</div>
        </div>`;
      }
    }

    if (partidos.length === 0) {
      html += '<div style="text-align:center;color:var(--white-muted);padding:40px;">No hay partidos en el calendario.</div>';
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
    if (match) {
      match.bitacora = text;
      autoSave();
    }
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

    // Lineup / Scorecard
    setLineupSubView,
    initLineupForMatch,
    setTurnResult,
    setDefenseStat,
    addPlayerToLineup,
    removePlayerFromLineup,
    movePlayerInLineup,
    selectLineupPlayer,
    cycleStatus,
    setLineupPosition,
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
