// ── Escape HTML para prevenir XSS ────────────────────────────────────────────
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Tiempo real (SSE) ─────────────────────────────────────────────────────────
function initEventos(callback) {
  let es;
  function conectar() {
    es = new EventSource('/api/eventos');
    es.onmessage = e => {
      try {
        const evento = JSON.parse(e.data);
        if (evento.tipo !== 'ping') callback(evento);
      } catch {}
    };
    // Reconectar si se cae
    es.onerror = () => { es.close(); setTimeout(conectar, 3000); };
  }
  conectar();
}

// ── Mobile sidebar ────────────────────────────────────────────────────────────
function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('show');
}

// ── Notificaciones ────────────────────────────────────────────────────────────
async function initNotificaciones() {
  try {
    const res = await fetch('/api/notificaciones');
    if (!res.ok) return;
    const { no_leidas } = await res.json();
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = no_leidas;
    badge.style.display = no_leidas > 0 ? 'flex' : 'none';
  } catch {}
}

// ── Búsqueda global ───────────────────────────────────────────────────────────
let _searchTimer;

function initBusqueda() {
  const input = document.getElementById('global-search');
  const box   = document.getElementById('search-results');
  if (!input || !box) return;

  input.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { box.classList.add('hidden'); return; }
    _searchTimer = setTimeout(() => _doSearch(q, box), 280);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim().length >= 2) box.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) box.classList.add('hidden');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { box.classList.add('hidden'); input.value = ''; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); }
  });
}

async function _doSearch(q, box) {
  try {
    const res = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`);
    if (!res.ok) return;
    const data = await res.json();
    _renderSearch(data, box);
  } catch {}
}

function _renderSearch({ solicitudes = [], proveedores = [], productos = [] }, box) {
  const total = solicitudes.length + proveedores.length + productos.length;
  if (total === 0) {
    box.innerHTML = `<div class="search-empty">Sin resultados para esta búsqueda</div>`;
  } else {
    let html = '';
    if (solicitudes.length) {
      html += `<div class="search-group">Solicitudes</div>`;
      const badge = { activa:'badge-success', cerrada:'badge-gray', borrador:'badge-warning' };
      html += solicitudes.map(s =>
        `<a href="/admin/detalle.html?id=${s.id}" class="search-item">
          <span>${s.titulo}</span>
          <span class="badge ${badge[s.estado]||'badge-gray'} badge-xs">${s.estado}</span>
        </a>`).join('');
    }
    if (proveedores.length) {
      html += `<div class="search-group">Proveedores</div>`;
      html += proveedores.map(p =>
        `<a href="/admin/proveedores.html" class="search-item">
          <span>${p.nombre}</span>
          <span class="search-item-meta">${p.email}</span>
        </a>`).join('');
    }
    if (productos.length) {
      html += `<div class="search-group">Productos</div>`;
      html += productos.map(p =>
        `<a href="/admin/productos.html" class="search-item">
          <span>${p.nombre}</span>
          <span class="search-item-meta">${p.categoria || ''} · ${p.unidad}</span>
        </a>`).join('');
    }
    box.innerHTML = html;
  }
  box.classList.remove('hidden');
}

// ── Inyectar barra de acciones en page-header ─────────────────────────────────
function initHeader(rol) {
  const header = document.querySelector('.page-header');
  if (!header) return;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'header-right-actions';

  if (rol === 'admin') {
    actionsDiv.innerHTML = `
      <div class="search-wrapper">
        <input id="global-search" type="text" class="search-input" placeholder="🔍 Buscar... (Ctrl+K)">
        <div id="search-results" class="search-results hidden"></div>
      </div>
      <a href="/admin/notificaciones.html" class="notif-btn" id="notif-btn">
        🔔 <span id="notif-badge" class="notif-badge" style="display:none">0</span>
      </a>
    `;
  } else {
    actionsDiv.innerHTML = `
      <a href="/proveedor/notificaciones.html" class="notif-btn" id="notif-btn">
        🔔 <span id="notif-badge" class="notif-badge" style="display:none">0</span>
      </a>
    `;
  }

  header.appendChild(actionsDiv);
  if (rol === 'admin') initBusqueda();
  initNotificaciones();
}
