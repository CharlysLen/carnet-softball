# 🥎 Softball +40 — Sistema de Fichas Digitales

Sistema de fichas digitales de jugador accesibles mediante código QR para la Liga de Softball Masters +40. Permite a los árbitros verificar la identidad y elegibilidad de los jugadores escaneando un QR con el móvil.

---

## 🚀 Despliegue Rápido (GitHub Pages — Gratis)

### 1. Crear repositorio en GitHub
1. Ve a [github.com/new](https://github.com/new)
2. Nombre del repo: `carnet-softball`
3. Público ✓ → Crear repositorio

### 2. Subir archivos
```bash
cd "Carnet Softball"
git init
git add .
git commit -m "Primera versión del sistema de fichas"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/carnet-softball.git
git push -u origin main
```

### 3. Activar GitHub Pages
1. Ve a **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Guardar

Tu app estará en: `https://TU-USUARIO.github.io/carnet-softball/`

---

## 📱 Flujo de Uso

```
Organizador genera QR → Jugador lleva QR impreso/en móvil → 
Árbitro escanea con cámara → Se abre ficha en el navegador → 
Árbitro ve estado: ✅ HABILITADO o ❌ SUSPENDIDO
```

### URLs de ejemplo
| Acción | URL |
|--------|-----|
| Ver ficha jugador 001 | `https://TU-USUARIO.github.io/carnet-softball/?id=001` |
| Panel admin | `https://TU-USUARIO.github.io/carnet-softball/admin.html` |
| Generar QR | `https://TU-USUARIO.github.io/carnet-softball/qr-generator.html` |

---

## 📊 Estructura del Excel / Google Sheet

Si prefieres gestionar los datos desde un Excel o Google Sheet, usa estas **5 columnas**:

| Columna | Campo | Tipo | Ejemplo |
|---------|-------|------|---------|
| A | `ID` | Texto | `001` |
| B | `Nombre` | Texto | `Carlos Mendoza García` |
| C | `Dorsal` | Número | `7` |
| D | `Equipo` | Texto | `Tigres de Vallecas` |
| E | `Estado` | Texto | `habilitado` o `suspendido` |

> **Tip**: Exporta el Sheet como JSON (menú Extensions → Apps Script → script de export) y reemplaza `data/players.json`.

---

## 🔄 Cambio de Estado en Tiempo Real

### Opción A: GitHub Pages (manual)
1. Abre `admin.html`
2. Cambia el estado del jugador
3. Haz clic en **"↓ Exportar JSON"**
4. Sube el nuevo `players.json` al repo → `git push`

### Opción B: Google Sheets como Backend (automático)
1. Crea un Google Sheet con las 5 columnas de arriba
2. Publica como app web con Google Apps Script:
```javascript
function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Jugadores');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var players = [];
  for (var i = 1; i < data.length; i++) {
    players.push({
      id: String(data[i][0]),
      nombre: data[i][1],
      dorsal: Number(data[i][2]),
      equipo: data[i][3],
      posicion: data[i][4] || 'Utility',
      foto: '',
      estado: data[i][5] || 'habilitado',
      verificado: data[i][6] === true || data[i][6] === 'TRUE',
      temporada: '2026'
    });
  }
  return ContentService.createTextOutput(JSON.stringify(players))
    .setMimeType(ContentService.MimeType.JSON);
}
```
3. En `js/app.js`, cambia la URL del `fetch` por la URL de tu Apps Script publicado.

---

## 🔒 Privacidad (GDPR/LOPD)

- ✅ La ficha pública **NO muestra**: DNI, dirección, teléfono, fecha de nacimiento
- ✅ Solo muestra un **sello de verificación** (check azul) que indica que la organización ya comprobó los datos
- ✅ Los datos sensibles se gestionan **offline** por el organizador
- ✅ No se almacenan cookies ni datos en el navegador del árbitro

---

## 📁 Estructura del Proyecto

```
Carnet Softball/
├── index.html           ← Ficha del jugador (vista del árbitro)
├── admin.html           ← Panel de administración
├── qr-generator.html   ← Generador de QR imprimibles
├── css/
│   └── style.css        ← Estilos (trading card, animaciones, admin, QR)
├── js/
│   ├── app.js           ← Lógica de la ficha
│   ├── admin.js         ← Lógica del panel admin
│   └── qr.js            ← Generación de QR codes
├── data/
│   └── players.json     ← Base de datos de jugadores
├── img/
│   └── players/         ← Fotos de los jugadores
└── README.md            ← Este archivo
```

---

## 🖼️ Fotos de Jugadores

Para añadir fotos reales:
1. Coloca las fotos en `img/players/`
2. Formato recomendado: `player_001.webp` (o `.jpg`, `.png`)
3. Tamaño ideal: **400×460px** (retrato, cara visible)
4. Actualiza el campo `foto` en `players.json` con la ruta relativa

Si no hay foto disponible, se genera un **avatar automático** con las iniciales del jugador.

---

## ⚡ Alternativas de Hosting Gratuito

| Plataforma | Ventajas |
|------------|----------|
| **GitHub Pages** | Gratis, fácil, integrado con Git |
| **Netlify** | Gratis, deploy automático, HTTPS |
| **Vercel** | Gratis, ultra rápido, preview URLs |
| **Cloudflare Pages** | Gratis, CDN global, rápido |
