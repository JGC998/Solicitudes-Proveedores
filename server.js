const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');

// ─── SSE: clientes conectados ──────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(tipo, datos = {}) {
  const msg = `data: ${JSON.stringify({ tipo, ...datos })}\n\n`;
  sseClients.forEach(c => { try { c.res.write(msg); } catch {} });
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'rfq-proto-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function readData(file) {
  const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
  return JSON.parse(raw);
}

async function writeData(file, data) {
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

function nextId(arr) {
  return arr.length > 0 ? Math.max(...arr.map(x => x.id)) + 1 : 1;
}

async function registrarLog(user, accion, descripcion, ref_id = null, ref_tipo = null) {
  try {
    const logs = await readData('logs.json');
    logs.unshift({ id: nextId(logs), fecha: new Date().toISOString(), user_id: user.id, user_nombre: user.nombre, accion, descripcion, referencia_id: ref_id, tipo_referencia: ref_tipo });
    if (logs.length > 500) logs.splice(500);
    await writeData('logs.json', logs);
  } catch {}
}

async function crearNotificacion(user_id, tipo, mensaje, ref_id = null) {
  try {
    const notifs = await readData('notificaciones.json');
    notifs.unshift({ id: nextId(notifs), user_id, tipo, mensaje, referencia_id: ref_id, fecha: new Date().toISOString(), leida: false });
    await writeData('notificaciones.json', notifs);
  } catch {}
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.rol !== 'admin')
    return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

function requireProveedor(req, res, next) {
  if (!req.session.user || req.session.user.rol !== 'proveedor')
    return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = await readData('users.json');
    const pendiente = users.find(u => u.email === email && u.pendiente);
    if (pendiente) return res.status(401).json({ error: 'Tu cuenta está pendiente de aprobación por el administrador.' });
    const candidate = users.find(u => u.email === email && u.activo !== false && !u.pendiente);
    if (!candidate || !(await bcrypt.compare(password, candidate.password)))
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const user = candidate;
    req.session.user = { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol };
    res.json({ user: req.session.user });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'No autenticado' });
  res.json({ user: req.session.user });
});

app.post('/api/auth/registro', async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    const users = await readData('users.json');
    if (users.find(u => u.email === email))
      return res.status(400).json({ error: 'Ya existe una cuenta con ese email' });
    const nuevo = { id: nextId(users), nombre, email, password: await bcrypt.hash(password, 10), rol: 'proveedor', activo: false, pendiente: true };
    users.push(nuevo);
    await writeData('users.json', users);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al registrar' });
  }
});

// ─── Productos ────────────────────────────────────────────────────────────────
app.get('/api/productos', requireAuth, async (req, res) => {
  try {
    res.json(await readData('productos.json'));
  } catch (e) {
    res.status(500).json({ error: 'Error al leer productos' });
  }
});

app.post('/api/productos', requireAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, unidad } = req.body;
    if (!nombre || !unidad) return res.status(400).json({ error: 'Nombre y unidad son obligatorios' });
    const productos = await readData('productos.json');
    const nuevo = { id: nextId(productos), nombre, descripcion: descripcion || '', unidad };
    productos.push(nuevo);
    await writeData('productos.json', productos);
    res.status(201).json(nuevo);
  } catch (e) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

app.patch('/api/productos/:id', requireAdmin, async (req, res) => {
  try {
    const productos = await readData('productos.json');
    const idx = productos.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    const { id, ...changes } = req.body;
    productos[idx] = { ...productos[idx], ...changes };
    await writeData('productos.json', productos);
    res.json(productos[idx]);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

app.delete('/api/productos/:id', requireAdmin, async (req, res) => {
  try {
    const productos = await readData('productos.json');
    const idx = productos.findIndex(p => p.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Producto no encontrado' });
    productos.splice(idx, 1);
    await writeData('productos.json', productos);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// ─── Solicitudes ──────────────────────────────────────────────────────────────
app.get('/api/solicitudes', requireAuth, async (req, res) => {
  try {
    const [solicitudes, productos, cotizaciones] = await Promise.all([
      readData('solicitudes.json'),
      readData('productos.json'),
      readData('cotizaciones.json')
    ]);

    const enrich = s => ({
      ...s,
      productos: s.productos.map(p => ({
        ...p,
        producto: productos.find(pr => pr.id === p.producto_id) || null
      })),
      num_cotizaciones: cotizaciones.filter(c => c.solicitud_id === s.id).length
    });

    if (req.session.user.rol === 'proveedor') {
      const uid = req.session.user.id;
      const cotizacionesProveedor = cotizaciones.filter(c => c.proveedor_id === uid);
      return res.json(
        solicitudes
          .filter(s => {
            if (s.estado !== 'activa' && s.estado !== 'cerrada') return false;
            if (!s.proveedores_invitados || s.proveedores_invitados.length === 0) return true;
            return s.proveedores_invitados.includes(uid);
          })
          .map(s => ({
            ...enrich(s),
            ya_cotizado: cotizacionesProveedor.some(c => c.solicitud_id === s.id)
          }))
      );
    }

    res.json(solicitudes.map(enrich));
  } catch (e) {
    res.status(500).json({ error: 'Error al leer solicitudes' });
  }
});

app.get('/api/solicitudes/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [solicitudes, productos, cotizaciones, users] = await Promise.all([
      readData('solicitudes.json'),
      readData('productos.json'),
      readData('cotizaciones.json'),
      readData('users.json')
    ]);

    const solicitud = solicitudes.find(s => s.id === id);
    if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const cotsForThis = cotizaciones
      .filter(c => c.solicitud_id === id)
      .map(c => ({
        ...c,
        proveedor: users.find(u => u.id === c.proveedor_id) || null
      }));

    const cotsParaRespuesta = req.session.user.rol === 'admin'
      ? cotsForThis
      : cotsForThis.filter(c => c.proveedor_id === req.session.user.id);

    res.json({
      ...solicitud,
      productos: solicitud.productos.map(p => ({
        ...p,
        producto: productos.find(pr => pr.id === p.producto_id) || null
      })),
      cotizaciones: cotsParaRespuesta
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al leer solicitud' });
  }
});

app.post('/api/solicitudes', requireAdmin, async (req, res) => {
  try {
    const { titulo, descripcion, fecha_limite, productos, proveedores_invitados } = req.body;
    if (!titulo || !fecha_limite || !productos || productos.length === 0)
      return res.status(400).json({ error: 'Datos incompletos' });

    const solicitudes = await readData('solicitudes.json');
    const nueva = {
      id: nextId(solicitudes),
      titulo,
      descripcion: descripcion || '',
      fecha_creacion: new Date().toISOString().split('T')[0],
      fecha_limite,
      estado: 'activa',
      proveedores_invitados: proveedores_invitados || [],
      productos
    };

    solicitudes.push(nueva);
    await writeData('solicitudes.json', solicitudes);

    await registrarLog(req.session.user, 'solicitud_creada', `Solicitud creada: "${nueva.titulo}"`, nueva.id, 'solicitud');

    // Notificar a proveedores invitados (o todos si no hay invitados específicos)
    const allUsers = await readData('users.json');
    const provs = allUsers.filter(u => u.rol === 'proveedor' && u.activo !== false && !u.pendiente);
    const destinatarios = nueva.proveedores_invitados?.length > 0
      ? provs.filter(p => nueva.proveedores_invitados.includes(p.id))
      : provs;
    await Promise.all(destinatarios.map(p =>
      crearNotificacion(p.id, 'nueva_solicitud', `Nueva solicitud: "${nueva.titulo}"`, nueva.id)
    ));

    broadcast('nueva_solicitud', { solicitud_id: nueva.id, titulo: nueva.titulo });
    res.status(201).json(nueva);
  } catch (e) {
    res.status(500).json({ error: 'Error al crear solicitud' });
  }
});

app.patch('/api/solicitudes/:id/estado', requireAdmin, async (req, res) => {
  try {
    const solicitudes = await readData('solicitudes.json');
    const idx = solicitudes.findIndex(s => s.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
    const ESTADOS_VALIDOS = ['activa', 'cerrada', 'borrador'];
    if (!ESTADOS_VALIDOS.includes(req.body.estado))
      return res.status(400).json({ error: 'Estado no válido' });
    solicitudes[idx].estado = req.body.estado;
    await writeData('solicitudes.json', solicitudes);
    broadcast('solicitud_estado', { solicitud_id: solicitudes[idx].id, estado: req.body.estado });
    res.json(solicitudes[idx]);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

app.delete('/api/solicitudes/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let solicitudes = await readData('solicitudes.json');
    const idx = solicitudes.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
    solicitudes.splice(idx, 1);
    await writeData('solicitudes.json', solicitudes);

    let cotizaciones = await readData('cotizaciones.json');
    cotizaciones = cotizaciones.filter(c => c.solicitud_id !== id);
    await writeData('cotizaciones.json', cotizaciones);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

// ─── Cotizaciones ─────────────────────────────────────────────────────────────
app.get('/api/cotizaciones', requireAuth, async (req, res) => {
  try {
    const [cotizaciones, solicitudes, productos, users] = await Promise.all([
      readData('cotizaciones.json'),
      readData('solicitudes.json'),
      readData('productos.json'),
      readData('users.json')
    ]);

    let filtered = req.session.user.rol === 'proveedor'
      ? cotizaciones.filter(c => c.proveedor_id === req.session.user.id)
      : cotizaciones;

    res.json(filtered.map(c => ({
      ...c,
      solicitud: solicitudes.find(s => s.id === c.solicitud_id) || null,
      proveedor: users.find(u => u.id === c.proveedor_id) || null,
      lineas: c.lineas.map(l => ({
        ...l,
        producto: productos.find(p => p.id === l.producto_id) || null
      }))
    })));
  } catch (e) {
    res.status(500).json({ error: 'Error al leer cotizaciones' });
  }
});

app.post('/api/cotizaciones', requireProveedor, async (req, res) => {
  try {
    const { solicitud_id, lineas, notas } = req.body;
    if (!solicitud_id || !lineas || lineas.length === 0)
      return res.status(400).json({ error: 'Datos incompletos' });

    const solicitudes = await readData('solicitudes.json');
    const solicitud = solicitudes.find(s => s.id === solicitud_id);
    if (!solicitud || solicitud.estado !== 'activa')
      return res.status(400).json({ error: 'Solicitud no disponible para cotizar' });

    let cotizaciones = await readData('cotizaciones.json');
    const existente = cotizaciones.find(
      c => c.solicitud_id === solicitud_id && c.proveedor_id === req.session.user.id
    );

    if (existente) {
      existente.lineas = lineas;
      existente.notas = notas || '';
      existente.fecha = new Date().toISOString().split('T')[0];
      await writeData('cotizaciones.json', cotizaciones);
      broadcast('cotizacion_actualizada', { solicitud_id, proveedor: req.session.user.nombre });
      return res.json(existente);
    }

    const nueva = {
      id: nextId(cotizaciones),
      solicitud_id,
      proveedor_id: req.session.user.id,
      fecha: new Date().toISOString().split('T')[0],
      notas: notas || '',
      adjudicada: null,
      lineas
    };

    cotizaciones.push(nueva);
    await writeData('cotizaciones.json', cotizaciones);

    const solData = solicitudes.find(s => s.id === solicitud_id);
    await registrarLog(req.session.user, 'cotizacion_enviada',
      `${req.session.user.nombre} envió cotización para "${solData?.titulo}"`, solicitud_id, 'solicitud');

    // Notificar al admin
    const allU = await readData('users.json');
    const admins = allU.filter(u => u.rol === 'admin');
    await Promise.all(admins.map(a =>
      crearNotificacion(a.id, 'nueva_cotizacion',
        `${req.session.user.nombre} ha enviado cotización para "${solData?.titulo}"`, solicitud_id)
    ));

    broadcast('nueva_cotizacion', { solicitud_id, proveedor: req.session.user.nombre, titulo: solData?.titulo });
    res.status(201).json(nueva);
  } catch (e) {
    res.status(500).json({ error: 'Error al guardar cotización' });
  }
});

// ─── Proveedores (para admin) ─────────────────────────────────────────────────
app.get('/api/proveedores', requireAdmin, async (req, res) => {
  try {
    const users = await readData('users.json');
    res.json(users.filter(u => u.rol === 'proveedor').map(({ password, ...rest }) => rest));
  } catch (e) {
    res.status(500).json({ error: 'Error al leer proveedores' });
  }
});

app.post('/api/proveedores', requireAdmin, async (req, res) => {
  try {
    const { nombre, email, password } = req.body;
    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' });
    const users = await readData('users.json');
    if (users.find(u => u.email === email))
      return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    const nuevo = { id: nextId(users), nombre, email, password: await bcrypt.hash(password, 10), rol: 'proveedor', activo: true };
    users.push(nuevo);
    await writeData('users.json', users);
    const { password: _, ...safe } = nuevo;
    res.status(201).json(safe);
  } catch (e) {
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

app.patch('/api/proveedores/:id', requireAdmin, async (req, res) => {
  try {
    const users = await readData('users.json');
    const idx = users.findIndex(u => u.id === parseInt(req.params.id) && u.rol === 'proveedor');
    if (idx === -1) return res.status(404).json({ error: 'Proveedor no encontrado' });
    if (req.body.email && req.body.email !== users[idx].email) {
      if (users.find(u => u.email === req.body.email && u.id !== users[idx].id))
        return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    }
    const { id, rol, ...changes } = req.body;
    if (changes.password) changes.password = await bcrypt.hash(changes.password, 10);
    users[idx] = { ...users[idx], ...changes };
    await writeData('users.json', users);
    const { password, ...safe } = users[idx];
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

app.delete('/api/proveedores/:id', requireAdmin, async (req, res) => {
  try {
    const users = await readData('users.json');
    const idx = users.findIndex(u => u.id === parseInt(req.params.id) && u.rol === 'proveedor');
    if (idx === -1) return res.status(404).json({ error: 'Proveedor no encontrado' });
    users.splice(idx, 1);
    await writeData('users.json', users);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al eliminar proveedor' });
  }
});

// ─── Aprobar proveedor pendiente ──────────────────────────────────────────────
app.patch('/api/proveedores/:id/aprobar', requireAdmin, async (req, res) => {
  try {
    const users = await readData('users.json');
    const idx = users.findIndex(u => u.id === parseInt(req.params.id) && u.rol === 'proveedor');
    if (idx === -1) return res.status(404).json({ error: 'Proveedor no encontrado' });
    users[idx].activo = true;
    users[idx].pendiente = false;
    await writeData('users.json', users);
    await registrarLog(req.session.user, 'proveedor_aprobado', `Proveedor aprobado: "${users[idx].nombre}"`);
    await crearNotificacion(users[idx].id, 'cuenta_aprobada', '✅ Tu cuenta ha sido aprobada. Ya puedes iniciar sesión.');
    const { password, ...safe } = users[idx];
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: 'Error al aprobar proveedor' });
  }
});

// ─── Adjudicar / desadjudicar cotización ─────────────────────────────────────
app.patch('/api/cotizaciones/:id/adjudicar', requireAdmin, async (req, res) => {
  try {
    const cotId = parseInt(req.params.id);
    const cotizaciones = await readData('cotizaciones.json');
    const cot = cotizaciones.find(c => c.id === cotId);
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    // Rechazar todas las demás de la misma solicitud, adjudicar esta
    cotizaciones.forEach(c => {
      if (c.solicitud_id === cot.solicitud_id) c.adjudicada = false;
    });
    cot.adjudicada = true;
    await writeData('cotizaciones.json', cotizaciones);

    const solData2 = (await readData('solicitudes.json')).find(s => s.id === cot.solicitud_id);
    const allU2 = await readData('users.json');
    const ganador = allU2.find(u => u.id === cot.proveedor_id);
    await registrarLog(req.session.user, 'adjudicacion',
      `Pedido adjudicado a "${ganador?.nombre}" para "${solData2?.titulo}"`, cot.solicitud_id, 'solicitud');

    // Notificar a todos los que cotizaron
    broadcast('adjudicacion', { solicitud_id: cot.solicitud_id });
    cotizaciones.filter(c => c.solicitud_id === cot.solicitud_id).forEach(c => {
      const msg = c.id === cot.id
        ? `✅ Tu cotización para "${solData2?.titulo}" ha sido seleccionada`
        : `Tu cotización para "${solData2?.titulo}" no fue seleccionada esta vez`;
      crearNotificacion(c.proveedor_id, c.id === cot.id ? 'adjudicado' : 'no_adjudicado', msg, cot.solicitud_id);
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al adjudicar' });
  }
});

app.patch('/api/cotizaciones/:id/desadjudicar', requireAdmin, async (req, res) => {
  try {
    const cotId = parseInt(req.params.id);
    const cotizaciones = await readData('cotizaciones.json');
    const cot = cotizaciones.find(c => c.id === cotId);
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    cotizaciones.forEach(c => {
      if (c.solicitud_id === cot.solicitud_id) c.adjudicada = null;
    });
    await writeData('cotizaciones.json', cotizaciones);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al desadjudicar' });
  }
});

// ─── Análisis / KPIs ──────────────────────────────────────────────────────────
app.get('/api/analisis/kpis', requireAdmin, async (req, res) => {
  try {
    const [solicitudes, cotizaciones, users, productos] = await Promise.all([
      readData('solicitudes.json'),
      readData('cotizaciones.json'),
      readData('users.json'),
      readData('productos.json')
    ]);

    const proveedores = users.filter(u => u.rol === 'proveedor');
    const totalSolicitudes = solicitudes.length;
    const totalCotizaciones = cotizaciones.length;
    const solicitudesActivas = solicitudes.filter(s => s.estado === 'activa').length;
    const tasaRespuesta = totalSolicitudes > 0 && proveedores.length > 0
      ? Math.round((totalCotizaciones / (totalSolicitudes * proveedores.length)) * 100)
      : 0;

    // Cotizaciones por proveedor
    const cotizacionesPorProveedor = proveedores.map(p => ({
      nombre: p.nombre,
      total: cotizaciones.filter(c => c.proveedor_id === p.id).length
    }));

    // Estado de solicitudes
    const estadosSolicitudes = {
      activa: solicitudes.filter(s => s.estado === 'activa').length,
      cerrada: solicitudes.filter(s => s.estado === 'cerrada').length,
      borrador: solicitudes.filter(s => s.estado === 'borrador').length
    };

    // Precios promedio por producto (de todas las cotizaciones)
    const preciosPorProducto = {};
    cotizaciones.forEach(c => {
      c.lineas.forEach(l => {
        if (!preciosPorProducto[l.producto_id]) preciosPorProducto[l.producto_id] = [];
        preciosPorProducto[l.producto_id].push(l.precio_unitario);
      });
    });

    const resumenPrecios = Object.entries(preciosPorProducto).map(([id, precios]) => {
      const prod = productos.find(p => p.id === parseInt(id));
      const avg = precios.reduce((a, b) => a + b, 0) / precios.length;
      return {
        nombre: prod ? prod.nombre : 'Desconocido',
        min: Math.min(...precios),
        max: Math.max(...precios),
        avg: Math.round(avg * 100) / 100,
        ahorro: Math.round((Math.max(...precios) - Math.min(...precios)) * 100) / 100,
        ahorro_pct: Math.max(...precios) > 0
          ? Math.round(((Math.max(...precios) - Math.min(...precios)) / Math.max(...precios)) * 100)
          : 0
      };
    });

    // Comparativa de precios por proveedor (para gráfica agrupada)
    const comparativaProveedores = proveedores.map(prov => {
      const cotsProveedor = cotizaciones.filter(c => c.proveedor_id === prov.id);
      const precios = productos.map(prod => {
        let precio = null;
        cotsProveedor.forEach(c => {
          const linea = c.lineas.find(l => l.producto_id === prod.id);
          if (linea) precio = linea.precio_unitario;
        });
        return precio;
      });
      return { nombre: prov.nombre, precios };
    });

    const productosConDatos = productos.filter(p =>
      Object.keys(preciosPorProducto).includes(String(p.id))
    ).map(p => p.nombre);

    // ── Ranking de proveedores ────────────────────────────────────────────────
    const ranking = proveedores.map(prov => {
      const cotsProv = cotizaciones.filter(c => c.proveedor_id === prov.id);

      const solicitudesVisibles = solicitudes.filter(s => {
        if (s.estado !== 'activa' && s.estado !== 'cerrada') return false;
        if (!s.proveedores_invitados || s.proveedores_invitados.length === 0) return true;
        return s.proveedores_invitados.includes(prov.id);
      }).length;

      const tasa = solicitudesVisibles > 0
        ? Math.round((cotsProv.length / solicitudesVisibles) * 100) : 0;

      const plazos = cotsProv.flatMap(c => c.lineas.map(l => l.plazo_entrega).filter(Boolean));
      const plazoMedio = plazos.length > 0
        ? Math.round(plazos.reduce((a, b) => a + b, 0) / plazos.length) : null;

      let sumaRatios = 0, numRatios = 0;
      cotsProv.forEach(c => {
        c.lineas.forEach(l => {
          const todos = cotizaciones.flatMap(x => x.lineas.filter(ll => ll.producto_id === l.producto_id).map(ll => ll.precio_unitario));
          if (todos.length > 0) {
            const avg = todos.reduce((a, b) => a + b, 0) / todos.length;
            if (avg > 0) { sumaRatios += l.precio_unitario / avg; numRatios++; }
          }
        });
      });
      const precioRelativo = numRatios > 0 ? Math.round((sumaRatios / numRatios - 1) * 100) : null;
      const adjudicaciones = cotizaciones.filter(c => c.proveedor_id === prov.id && c.adjudicada === true).length;

      return { id: prov.id, nombre: prov.nombre, cotizaciones: cotsProv.length, solicitudesVisibles, tasa, plazoMedio, precioRelativo, adjudicaciones };
    }).sort((a, b) => b.tasa - a.tasa);

    // ── Histórico de precios por producto ─────────────────────────────────────
    const histMap = {};
    cotizaciones.forEach(c => {
      const sol = solicitudes.find(s => s.id === c.solicitud_id);
      const prov = proveedores.find(p => p.id === c.proveedor_id);
      if (!sol || !prov) return;
      c.lineas.forEach(l => {
        if (!histMap[l.producto_id]) histMap[l.producto_id] = {};
        if (!histMap[l.producto_id][c.solicitud_id]) {
          histMap[l.producto_id][c.solicitud_id] = { nombre: sol.titulo, fecha: sol.fecha_creacion, precios: [] };
        }
        histMap[l.producto_id][c.solicitud_id].precios.push({ proveedor_id: prov.id, proveedor: prov.nombre, precio: l.precio_unitario });
      });
    });

    const historico = Object.entries(histMap).map(([prodId, solsData]) => {
      const prod = productos.find(p => p.id === parseInt(prodId));
      return {
        producto_id: parseInt(prodId),
        producto_nombre: prod?.nombre || 'Desconocido',
        solicitudes: Object.entries(solsData)
          .sort((a, b) => a[1].fecha.localeCompare(b[1].fecha))
          .map(([solId, d]) => ({ solicitud_id: parseInt(solId), nombre: d.nombre, fecha: d.fecha, precios: d.precios }))
      };
    });

    res.json({
      kpis: { totalSolicitudes, totalCotizaciones, solicitudesActivas, tasaRespuesta, totalProveedores: proveedores.length },
      cotizacionesPorProveedor,
      estadosSolicitudes,
      resumenPrecios,
      comparativaProveedores,
      productosConDatos,
      ranking,
      historico
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al calcular KPIs' });
  }
});

// Comparativa detallada de una solicitud
app.get('/api/analisis/solicitud/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [solicitudes, cotizaciones, productos, users] = await Promise.all([
      readData('solicitudes.json'),
      readData('cotizaciones.json'),
      readData('productos.json'),
      readData('users.json')
    ]);

    const solicitud = solicitudes.find(s => s.id === id);
    if (!solicitud) return res.status(404).json({ error: 'No encontrada' });

    const cotsForThis = cotizaciones.filter(c => c.solicitud_id === id);
    const proveedoresQueRespondieron = cotsForThis.map(c => ({
      id: c.proveedor_id,
      cotizacion_id: c.id,
      nombre: users.find(u => u.id === c.proveedor_id)?.nombre || 'Desconocido',
      notas: c.notas,
      fecha: c.fecha,
      adjudicada: c.adjudicada ?? null
    }));

    // Proveedores invitados enriquecidos
    const invitados = (solicitud.proveedores_invitados || []).map(uid => {
      const u = users.find(x => x.id === uid);
      return u ? { id: u.id, nombre: u.nombre } : null;
    }).filter(Boolean);

    const comparacion = solicitud.productos.map(sp => {
      const prod = productos.find(p => p.id === sp.producto_id);
      const precios = cotsForThis.map(c => {
        const linea = c.lineas.find(l => l.producto_id === sp.producto_id);
        return {
          proveedor_id: c.proveedor_id,
          precio: linea ? linea.precio_unitario : null,
          plazo: linea ? linea.plazo_entrega : null
        };
      });

      const validos = precios.filter(p => p.precio !== null).map(p => p.precio);
      return {
        producto_id: sp.producto_id,
        nombre: prod?.nombre || 'Desconocido',
        unidad: prod?.unidad || '',
        cantidad: sp.cantidad,
        precios,
        precio_min: validos.length > 0 ? Math.min(...validos) : null,
        precio_max: validos.length > 0 ? Math.max(...validos) : null
      };
    });

    res.json({ solicitud, proveedores: proveedoresQueRespondieron, comparacion, invitados });
  } catch (e) {
    res.status(500).json({ error: 'Error al generar comparativa' });
  }
});

// ─── Búsqueda global ─────────────────────────────────────────────────────────
app.get('/api/buscar', requireAdmin, async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (q.length < 2) return res.json({ solicitudes: [], proveedores: [], productos: [] });
    const [solicitudes, users, productos] = await Promise.all([
      readData('solicitudes.json'), readData('users.json'), readData('productos.json')
    ]);
    res.json({
      solicitudes: solicitudes.filter(s => s.titulo.toLowerCase().includes(q) || (s.descripcion || '').toLowerCase().includes(q)).slice(0, 5).map(s => ({ id: s.id, titulo: s.titulo, estado: s.estado })),
      proveedores: users.filter(u => u.rol === 'proveedor' && !u.pendiente && (u.nombre.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))).slice(0, 5).map(u => ({ id: u.id, nombre: u.nombre, email: u.email })),
      productos: productos.filter(p => p.nombre.toLowerCase().includes(q)).slice(0, 5).map(p => ({ id: p.id, nombre: p.nombre, unidad: p.unidad, categoria: p.categoria }))
    });
  } catch (e) { res.status(500).json({ error: 'Error en búsqueda' }); }
});

// ─── Logs de actividad ────────────────────────────────────────────────────────
app.get('/api/logs', requireAdmin, async (req, res) => {
  try { res.json((await readData('logs.json')).slice(0, 200)); }
  catch (e) { res.json([]); }
});

// ─── Notificaciones ───────────────────────────────────────────────────────────
app.get('/api/notificaciones', requireAuth, async (req, res) => {
  try {
    const notifs = await readData('notificaciones.json');
    const mias = notifs.filter(n => n.user_id === req.session.user.id);
    res.json({ notificaciones: mias.slice(0, 30), no_leidas: mias.filter(n => !n.leida).length });
  } catch { res.json({ notificaciones: [], no_leidas: 0 }); }
});

app.post('/api/notificaciones/leer', requireAuth, async (req, res) => {
  try {
    const notifs = await readData('notificaciones.json');
    notifs.forEach(n => { if (n.user_id === req.session.user.id) n.leida = true; });
    await writeData('notificaciones.json', notifs);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ─── Duplicar solicitud ───────────────────────────────────────────────────────
app.post('/api/solicitudes/:id/duplicar', requireAdmin, async (req, res) => {
  try {
    const solicitudes = await readData('solicitudes.json');
    const original = solicitudes.find(s => s.id === parseInt(req.params.id));
    if (!original) return res.status(404).json({ error: 'No encontrada' });
    const limite = new Date(); limite.setDate(limite.getDate() + 14);
    const { num_orden, fecha_orden, recibida, fecha_recepcion, ...rest } = original;
    const copia = { ...rest, id: nextId(solicitudes), titulo: original.titulo + ' (copia)', fecha_creacion: new Date().toISOString().split('T')[0], fecha_limite: limite.toISOString().split('T')[0], estado: 'activa' };
    solicitudes.push(copia);
    await writeData('solicitudes.json', solicitudes);
    await registrarLog(req.session.user, 'solicitud_duplicada', `Duplicada: "${original.titulo}" → "${copia.titulo}"`, copia.id, 'solicitud');
    res.status(201).json(copia);
  } catch (e) { res.status(500).json({ error: 'Error al duplicar' }); }
});

// ─── Generar orden de compra ──────────────────────────────────────────────────
app.post('/api/solicitudes/:id/orden-compra', requireAdmin, async (req, res) => {
  try {
    const solicitudes = await readData('solicitudes.json');
    const idx = solicitudes.findIndex(s => s.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
    const num = `OC-${new Date().getFullYear()}-${String(parseInt(req.params.id)).padStart(4, '0')}`;
    solicitudes[idx].num_orden = num;
    solicitudes[idx].fecha_orden = new Date().toISOString().split('T')[0];
    await writeData('solicitudes.json', solicitudes);
    await registrarLog(req.session.user, 'orden_compra_generada', `Orden ${num} generada para "${solicitudes[idx].titulo}"`, solicitudes[idx].id, 'solicitud');
    res.json({ num_orden: num, fecha_orden: solicitudes[idx].fecha_orden });
  } catch (e) { res.status(500).json({ error: 'Error al generar orden' }); }
});

// ─── Marcar pedido como recibido ──────────────────────────────────────────────
app.patch('/api/solicitudes/:id/recibir', requireAdmin, async (req, res) => {
  try {
    const solicitudes = await readData('solicitudes.json');
    const idx = solicitudes.findIndex(s => s.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
    solicitudes[idx].recibida = true;
    solicitudes[idx].fecha_recepcion = new Date().toISOString().split('T')[0];
    await writeData('solicitudes.json', solicitudes);
    await registrarLog(req.session.user, 'pedido_recibido', `Pedido recibido: "${solicitudes[idx].titulo}"`, solicitudes[idx].id, 'solicitud');
    res.json(solicitudes[idx]);
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ─── Valoraciones ─────────────────────────────────────────────────────────────
app.post('/api/valoraciones', requireAdmin, async (req, res) => {
  try {
    const { proveedor_id, solicitud_id, calidad, plazo, precio, comentario } = req.body;
    if (!proveedor_id || !solicitud_id || !calidad || !plazo || !precio)
      return res.status(400).json({ error: 'Datos incompletos' });
    const valoraciones = await readData('valoraciones.json');
    const existente = valoraciones.find(v => v.solicitud_id === solicitud_id && v.proveedor_id === proveedor_id);
    if (existente) {
      Object.assign(existente, { calidad, plazo, precio, comentario: comentario || '', fecha: new Date().toISOString().split('T')[0] });
      await writeData('valoraciones.json', valoraciones);
      return res.json(existente);
    }
    const nueva = { id: nextId(valoraciones), proveedor_id, solicitud_id, admin_id: req.session.user.id, fecha: new Date().toISOString().split('T')[0], calidad, plazo, precio, comentario: comentario || '' };
    valoraciones.push(nueva);
    await writeData('valoraciones.json', valoraciones);
    const users = await readData('users.json');
    const prov = users.find(u => u.id === proveedor_id);
    await registrarLog(req.session.user, 'valoracion_enviada', `Valoración a "${prov?.nombre}": Cal.${calidad} Pla.${plazo} Pre.${precio}`, solicitud_id, 'solicitud');
    res.status(201).json(nueva);
  } catch (e) { res.status(500).json({ error: 'Error al guardar valoración' }); }
});

app.get('/api/valoraciones', requireAdmin, async (req, res) => {
  try {
    const [valoraciones, users, solicitudes] = await Promise.all([
      readData('valoraciones.json'), readData('users.json'), readData('solicitudes.json')
    ]);
    res.json(valoraciones.map(v => ({
      ...v,
      proveedor: users.find(u => u.id === v.proveedor_id) || null,
      solicitud: solicitudes.find(s => s.id === v.solicitud_id) || null,
      media: Math.round((v.calidad + v.plazo + v.precio) / 3 * 10) / 10
    })));
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

// ─── Cambio de contraseña ─────────────────────────────────────────────────────
app.patch('/api/auth/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (new_password.length < 6)
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });

    const users = await readData('users.json');
    const idx = users.findIndex(u => u.id === req.session.user.id);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!(await bcrypt.compare(current_password, users[idx].password)))
      return res.status(401).json({ error: 'La contraseña actual no es correcta' });

    users[idx].password = await bcrypt.hash(new_password, 10);
    await writeData('users.json', users);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
});

// ─── SSE endpoint ─────────────────────────────────────────────────────────────
app.get('/api/eventos', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { id: req.session.user.id, rol: req.session.user.rol, res };
  sseClients.add(client);
  res.write('data: {"tipo":"ping"}\n\n');

  req.on('close', () => sseClients.delete(client));
});

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/login.html'));

// ─── Migración automática de contraseñas a bcrypt ─────────────────────────────
async function migrarPasswordsSiNecesario() {
  try {
    const users = await readData('users.json');
    let migrado = false;
    for (const u of users) {
      if (u.password && !u.password.startsWith('$2')) {
        u.password = await bcrypt.hash(u.password, 10);
        migrado = true;
      }
    }
    if (migrado) {
      await writeData('users.json', users);
      console.log('  ✓ Contraseñas migradas a bcrypt');
    }
  } catch (e) { console.error('Error en migración de contraseñas:', e); }
}

migrarPasswordsSiNecesario().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✅ RFQ Manager corriendo en http://localhost:${PORT}\n`);
    console.log('   Credenciales demo:');
    console.log('   Admin     → admin@empresa.com / admin123');
    console.log('   Proveedor → garcia@suministros.com / garcia123\n');
  });
});
