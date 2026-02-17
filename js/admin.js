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
  let currentView = 'teams';
  let selectedTeam = null;
  let selectedMatchId = null;
  let csvParsedData = [];
  let pendingPlayerPhoto = '';
  let pendingTeamImage = '';

  function autoSave() {
    AppStore.save({ equipos, jugadores: players, partidos });
  }

  async function loadData() {
    const data = await AppStore.load();
    players = data.jugadores;
    equipos = data.equipos;
    partidos = data.partidos || [];
    renderView();
  }

  function getTeamPlayers(n) { return players.filter(p => p.equipo === n); }

  function renderView() {
    renderStats();
    updateTeamDropdown();
    if (currentView === 'teams') renderTeamShields();
    else if (currentView === 'roster') renderRoster();
    else if (currentView === 'calendar') renderCalendar();
    else if (currentView === 'standings') renderStandings();
    else if (currentView === 'match') renderMatchDetail();
  }



  function switchTab(view) {
    currentView = view;
    selectedTeam = null;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    // Update active tab visual
    const links = document.querySelectorAll('.nav-link');
    if (view === 'teams' && links[0]) links[0].classList.add('active');
    if (view === 'calendar' && links[1]) links[1].classList.add('active');
    // If standings tab exists (user might need to add it to HTML), highlight it.
    // Assuming 3rd link is QR or Standings. We will handle HTML update separately.
    renderView();
  }

  function renderStats() {
    const t = players.length, h = players.filter(p => p.estado === 'habilitado').length, s = t - h;
    document.getElementById('stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-number">${t}</div><div class="stat-label">Jugadores</div></div>
      <div class="stat-card green"><div class="stat-number">${h}</div><div class="stat-label">Habilitados</div></div>
      <div class="stat-card red"><div class="stat-number">${s}</div><div class="stat-label">Suspendidos</div></div>
      <div class="stat-card"><div class="stat-number">${equipos.length}</div><div class="stat-label">Equipos</div></div>`;
  }

  function updateTeamDropdown() {
    const s = document.getElementById('inp-equipo');
    if (!s) return;
    s.innerHTML = equipos.length === 0
      ? '<option value="">— Crea un equipo —</option>'
      : equipos.map(e => `<option value="${e.nombre}">${e.escudo || '🥎'} ${e.nombre}</option>`).join('');
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

      html += `
        <div class="shield-card" onclick="if(!event.target.closest('.shield-edit-btn')) Admin.selectTeam('${team.nombre.replace(/'/g, "\\'")}')"
             style="--shield-color:${team.color};--shield-bg:${team.colorSecundario || '#1a1a2e'}">
          <button class="btn btn-sm btn-secondary shield-edit-btn" style="position:absolute;top:10px;right:10px;z-index:10;" onclick="Admin.editTeam('${team.id}')" title="Editar Equipo">✏️</button>
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

    let html = `<div class="roster-view">
      <div class="roster-header" style="--shield-color:${team.color}">
        <button class="btn btn-secondary roster-back" onclick="Admin.backToTeams()">← Equipos</button>
        <div class="roster-team-info">
          <span class="roster-emblem">${renderEmblem(team, '2.5rem')}</span>
          <div>
            <h2 class="roster-team-name">${team.nombre}
              <button class="btn btn-sm btn-secondary" onclick="Admin.editTeam('${team.id}')" style="margin-left:8px;font-size:0.8rem;" title="Editar Equipo">✏️</button>
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

        html += `
          <div class="roster-card ${p.estado}" style="--shield-color:${team.color}">
            <div class="roster-avatar" style="${avatarBg}">
              ${avatarContent}
              <span class="roster-dorsal-badge">${p.dorsal}</span>
              ${p.verificado ? '<span class="roster-verified-badge" title="Verificado">✓</span>' : ''}
            </div>
            <div class="roster-card-info">
              <h3 class="roster-player-name">${p.nombre}</h3>
              <span class="roster-position">${p.posicion}</span>
              <div style="font-size:0.6rem;color:var(--white-muted);margin-top:2px;">AVG: ${p.stats && p.stats.avg ? p.stats.avg : '-'}</div>
            </div>
            <div class="roster-status ${p.estado}"><span class="roster-status-dot"></span>${isHab ? 'Habilitado' : 'Suspendido'}</div>
            <div class="roster-actions">
              <button class="btn btn-sm btn-secondary" onclick="Admin.editPlayer('${p.id}')" title="Editar">✏️</button>
              <button class="btn btn-sm ${isHab ? 'btn-danger' : 'btn-success'}" onclick="Admin.toggleEstado('${p.id}')">${isHab ? '⛔' : '✅'}</button>
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
  function generateId() {
    if (players.length === 0) return '001';
    return String(Math.max(...players.map(p => parseInt(p.id, 10) || 0)) + 1).padStart(3, '0');
  }

  // ── PHOTO UPLOAD ──
  function readFileAsDataURL(file, maxW) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const s = Math.min(1, maxW / img.width);
          canvas.width = img.width * s; canvas.height = img.height * s;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/webp', 0.75));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
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
        p.stats = stats;
        if (pendingPlayerPhoto) p.foto = pendingPlayerPhoto;
      }
    } else {
      // CREATE
      players.push({
        id: generateId(),
        nombre: document.getElementById('inp-nombre').value.trim(),
        dorsal: parseInt(document.getElementById('inp-dorsal').value, 10),
        equipo: eq,
        posicion: document.getElementById('inp-posicion').value,
        foto: pendingPlayerPhoto || '',
        estado: document.getElementById('inp-estado').value,
        verificado: document.getElementById('inp-verificado').value === 'true',
        altura: document.getElementById('inp-altura').value.trim(),
        peso: document.getElementById('inp-peso').value.trim(),
        edad: document.getElementById('inp-edad').value.trim(),
        temporada: new Date().getFullYear().toString(),
        stats: stats
      });
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
    pendingPlayerPhoto = '';
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
       <div style="text-align:center;">
         <button class="btn btn-sm btn-secondary" onclick="Admin.resetStandings()">🔄 Recalcular desde Partidos</button>
       </div>
    </div>`;
    c.innerHTML = html;
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
        <button class="btn btn-primary" onclick="Admin.generateDemoData()" style="margin-top:10px;">🎲 Generar Partidos Demo</button>
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
        <button class="btn btn-secondary" onclick="Admin.backToCalendar()" style="margin-bottom:20px;">← Volver al Calendario</button>
        
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
        
        <div style="display:grid;grid-template-columns: 1fr 1fr; gap:20px; margin-top:20px;">
          <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
            <h3 style="color:var(--white-muted);font-size:0.9rem;text-align:center;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">${m.local}</h3>
            ${renderTeamList(m.local)}
          </div>
          <div style="background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
            <h3 style="color:var(--white-muted);font-size:0.9rem;text-align:center;text-transform:uppercase;letter-spacing:1px;margin-bottom:15px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:10px;">${m.visitante}</h3>
            ${renderTeamList(m.visitante)}
          </div>
          <div style="margin-top:20px;background:var(--bg-card);border-radius:16px;padding:20px;border:1px solid rgba(255,255,255,0.05);">
            <h3 style="color:var(--gold);font-family:var(--font-display);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;font-size:0.9rem;">📝 Cuaderno de Bitácora</h3>
            <textarea id="match-log-${m.id}" 
                      style="width:100%;height:120px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;color:var(--white);font-family:inherit;resize:vertical;"
                      placeholder="Escribe aquí las incidencias, notas del partido o comentarios..."
                      onblur="Admin.saveMatchLog('${m.id}', this.value)">${m.bitacora || ''}</textarea>
            <div style="text-align:right;font-size:0.7rem;color:var(--white-muted);margin-top:5px;">Se guarda automáticamente al hacer clic fuera.</div>
          </div>
        </div>
        
      </div>`;
    c.innerHTML = html;
  }

  function viewMatch(id) {
    selectedMatchId = id;
    currentView = 'match';
    renderView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function backToCalendar() {
    selectedMatchId = null;
    currentView = 'calendar';
    renderView();
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
    viewCard,

    // Edit functions
    editTeam,
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

    // Legacy aliases
    toggleStats: renderStats
  };

  function init() { bindEvents(); loadData(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
