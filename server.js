require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ─── Multer: subida de archivos en memoria ────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

// ─── Email (Nodemailer) ───────────────────────────────────────────────────────
let transporter = null;

async function initEmail() {
  const pass = process.env.SMTP_PASS;
  if (pass && pass !== 'AQUI_TU_APP_PASSWORD_DE_GMAIL') {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      auth: {
        user: process.env.SMTP_USER || 'juangarciacardenas99@gmail.com',
        pass
      }
    });
    console.log(`  📧 Email configurado: ${process.env.SMTP_USER || 'juangarciacardenas99@gmail.com'}`);
  } else {
    const account = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: account.user, pass: account.pass }
    });
    console.log(`  📧 Email en modo prueba (Ethereal) — edita SMTP_PASS en .env para usar Gmail`);
    console.log(`  📬 Ver emails: https://ethereal.email/messages`);
  }
}

const EMAIL_FROM = `"RFQ Manager" <${process.env.SMTP_USER || 'juangarciacardenas99@gmail.com'}>`;

async function sendEmail(to, subject, html) {
  if (!transporter) return;
  try {
    const info = await transporter.sendMail({ from: EMAIL_FROM, to, subject, html });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log(`  📧 Email → ${to} | Vista previa: ${preview}`);
    else console.log(`  📧 Email enviado → ${to}`);
  } catch (e) {
    console.error(`  ⚠ Error al enviar email a ${to}:`, e.message);
  }
}

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

// ─── Importar productos desde CSV ────────────────────────────────────────────
app.post('/api/productos/importar', requireAdmin, upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const text = req.file.buffer.toString('utf8').replace(/^﻿/, '');
    const sep = text.includes(';') ? ';' : ',';
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return res.status(400).json({ error: 'El archivo no tiene datos' });

    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const iNombre    = headers.indexOf('nombre');
    const iUnidad    = headers.indexOf('unidad');
    const iCategoria = ['categoria','categoría'].reduce((f, k) => f !== -1 ? f : headers.indexOf(k), -1);
    const iDesc      = ['descripcion','descripción'].reduce((f, k) => f !== -1 ? f : headers.indexOf(k), -1);

    if (iNombre === -1 || iUnidad === -1)
      return res.status(400).json({ error: 'El CSV debe tener columnas "nombre" y "unidad"' });

    const productos = await readData('productos.json');
    let añadidos = 0, omitidos = 0;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
      const nombre = cols[iNombre] || '';
      const unidad = cols[iUnidad] || '';
      if (!nombre || !unidad) { omitidos++; continue; }
      if (productos.find(p => p.nombre.toLowerCase() === nombre.toLowerCase())) { omitidos++; continue; }
      productos.push({
        id: nextId(productos),
        nombre,
        descripcion: iDesc !== -1 ? (cols[iDesc] || '') : '',
        unidad,
        categoria: iCategoria !== -1 ? (cols[iCategoria] || '') : ''
      });
      añadidos++;
    }

    if (añadidos > 0) await writeData('productos.json', productos);
    await registrarLog(req.session.user, 'productos_importados', `${añadidos} productos importados desde CSV`);
    res.json({ añadidos, omitidos });
  } catch (e) {
    res.status(500).json({ error: 'Error al procesar el CSV' });
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

    destinatarios.forEach(p => sendEmail(
      p.email_notificaciones || p.email,
      `Nueva solicitud de presupuesto: "${nueva.titulo}"`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
         <h2 style="color:#2563eb">📋 Nueva solicitud de presupuesto</h2>
         <p>Hola <strong>${p.nombre}</strong>,</p>
         <p>Se ha publicado una nueva solicitud de presupuesto en la que estás invitado a participar:</p>
         <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:1rem 1.2rem;margin:1rem 0;border-radius:4px">
           <p style="margin:0;font-size:1.1em;font-weight:700">${nueva.titulo}</p>
           ${nueva.descripcion ? `<p style="margin:.5rem 0 0;color:#64748b">${nueva.descripcion}</p>` : ''}
           <p style="margin:.5rem 0 0;color:#64748b">📅 Fecha límite: <strong>${nueva.fecha_limite}</strong></p>
         </div>
         <a href="${APP_URL}/proveedor/cotizar.html?id=${nueva.id}"
            style="display:inline-block;background:#2563eb;color:#fff;padding:.7rem 1.5rem;border-radius:6px;text-decoration:none;font-weight:600;margin:1rem 0">
           Enviar cotización →
         </a>
         <p style="color:#94a3b8;font-size:.8em;margin-top:1.5rem">RFQ Manager · <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a></p>
       </div>`
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
    admins.forEach(a => sendEmail(
      a.email,
      `💬 Nueva cotización recibida — ${solData?.titulo}`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
         <h2 style="color:#2563eb">💬 Nueva cotización recibida</h2>
         <p>Hola <strong>${a.nombre}</strong>,</p>
         <p><strong>${req.session.user.nombre}</strong> ha enviado una cotización para la solicitud:</p>
         <div style="background:#f8fafc;border-left:4px solid #2563eb;padding:1rem 1.2rem;margin:1rem 0;border-radius:4px">
           <p style="margin:0;font-size:1.1em;font-weight:700">${solData?.titulo}</p>
         </div>
         <a href="${APP_URL}/admin/detalle.html?id=${solicitud_id}"
            style="display:inline-block;background:#2563eb;color:#fff;padding:.7rem 1.5rem;border-radius:6px;text-decoration:none;font-weight:600;margin:1rem 0">
           Ver comparativa de precios →
         </a>
         <p style="color:#94a3b8;font-size:.8em;margin-top:1.5rem">RFQ Manager · <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a></p>
       </div>`
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
      const ganó = c.id === cot.id;
      const msg = ganó
        ? `✅ Tu cotización para "${solData2?.titulo}" ha sido seleccionada`
        : `Tu cotización para "${solData2?.titulo}" no fue seleccionada esta vez`;
      crearNotificacion(c.proveedor_id, ganó ? 'adjudicado' : 'no_adjudicado', msg, cot.solicitud_id);
      const prov = allU2.find(u => u.id === c.proveedor_id);
      if (prov) sendEmail(
        prov.email_notificaciones || prov.email,
        ganó ? `✅ Tu cotización ha sido seleccionada — ${solData2?.titulo}` : `Resultado de la solicitud: ${solData2?.titulo}`,
        ganó
          ? `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
               <h2 style="color:#10b981">✅ ¡Cotización seleccionada!</h2>
               <p>Hola <strong>${prov.nombre}</strong>,</p>
               <p>¡Enhorabuena! Tu cotización para la solicitud <strong>"${solData2?.titulo}"</strong> ha sido seleccionada.</p>
               <p>El equipo de compras se pondrá en contacto contigo en breve para coordinar el pedido.</p>
               <a href="${APP_URL}/proveedor/historial.html"
                  style="display:inline-block;background:#10b981;color:#fff;padding:.7rem 1.5rem;border-radius:6px;text-decoration:none;font-weight:600;margin:1rem 0">
                 Ver mis cotizaciones →
               </a>
               <p style="color:#94a3b8;font-size:.8em;margin-top:1.5rem">RFQ Manager · <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a></p>
             </div>`
          : `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
               <h2 style="color:#64748b">Resultado de la solicitud</h2>
               <p>Hola <strong>${prov.nombre}</strong>,</p>
               <p>Tu cotización para <strong>"${solData2?.titulo}"</strong> no fue seleccionada en esta ocasión.</p>
               <p>Gracias por participar. Seguiremos contando contigo en futuras solicitudes.</p>
               <a href="${APP_URL}/proveedor/dashboard.html"
                  style="display:inline-block;background:#2563eb;color:#fff;padding:.7rem 1.5rem;border-radius:6px;text-decoration:none;font-weight:600;margin:1rem 0">
                 Ver solicitudes activas →
               </a>
               <p style="color:#94a3b8;font-size:.8em;margin-top:1.5rem">RFQ Manager · <a href="${APP_URL}" style="color:#94a3b8">${APP_URL}</a></p>
             </div>`
      );
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

    // Intentar enviar el pedido a la API externa
    const cotizaciones = await readData('cotizaciones.json');
    const cotAdj = cotizaciones.find(c => c.solicitud_id === solicitudes[idx].id && c.adjudicada === true);
    if (cotAdj) {
      const [allUsers, allProds] = await Promise.all([readData('users.json'), readData('productos.json')]);
      const prov = allUsers.find(u => u.id === cotAdj.proveedor_id);
      if (!prov) {
        solicitudes[idx].pendiente_envio_api = true;
        solicitudes[idx].error_api = 'Proveedor no encontrado';
        console.warn(`  ⚠ Pedido ${num}: proveedor adjudicado no existe en el sistema`);
      } else {
        const resultadoApi = await pushPedidoExterno(solicitudes[idx], cotAdj, prov, allProds);
        if (resultadoApi.motivo === 'sin_api') {
          // No hay API configurada, es normal en modo demo
        } else if (resultadoApi.ok) {
          solicitudes[idx].pendiente_envio_api = false;
          if (resultadoApi.id_externo) solicitudes[idx].id_api_externa = resultadoApi.id_externo;
        } else {
          solicitudes[idx].pendiente_envio_api = true;
          solicitudes[idx].error_api = resultadoApi.motivo;
          console.warn(`  ⚠ Pedido ${num} no pudo enviarse a API externa: ${resultadoApi.motivo}`);
        }
      }
    }

    await writeData('solicitudes.json', solicitudes);
    await registrarLog(req.session.user, 'orden_compra_generada', `Orden ${num} generada para "${solicitudes[idx].titulo}"`, solicitudes[idx].id, 'solicitud');
    res.json({ num_orden: num, fecha_orden: solicitudes[idx].fecha_orden, pendiente_envio_api: solicitudes[idx].pendiente_envio_api ?? false });
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

// ─── Adaptador API Externa ────────────────────────────────────────────────────
// Capa de abstracción entre RFQ Manager y el sistema de gestión de la empresa.
// Hoy usa JSON locales como fallback. Cuando llegue la URL real, solo cambia
// la implementación interna sin tocar las rutas ni el frontend.

async function getProductosExternos() {
  const url = (process.env.EXTERNAL_API_URL || '').replace(/\/$/, '');
  const key = process.env.EXTERNAL_API_KEY || '';
  if (!url) return null;

  try {
    const res = await fetch(`${url}/productos`, {
      headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
    const raw = await res.json();

    // ── Normalización de campos ──────────────────────────────────────────────
    // Mapeo basado en el esquema real de la empresa (ver migracionAPI.md).
    // Acepta tanto snake_case como camelCase por si la API formatea distinto.
    const lista = Array.isArray(raw) ? raw : (raw.data ?? raw.articulos ?? raw.items ?? []);
    const productos = lista.map((p, i) => ({
      // ID interno secuencial — no usar el codigo_articulo como ID porque es
      // alfanumérico y rompería la lógica de cotizaciones (siempre numérica)
      id:              i + 1,
      // Código real del artículo en el sistema de la empresa
      codigo_articulo: String(p.codigo_articulo ?? p.codigoArticulo ?? p.CODIGO_ARTICULO ?? i + 1),
      nombre:          p.nombre_articulo  ?? p.nombreArticulo  ?? p.NOMBRE_ARTICULO  ?? p.nombre ?? 'Sin nombre',
      // Descripción enriquecida: marca · subfamilia (si vienen en el JOIN)
      descripcion: [
        p.nombre_marca        ?? p.nombreMarca        ?? p.NOMBRE_MARCA        ?? '',
        p.nombre_subfamilia   ?? p.nombreSubfamilia   ?? p.NOMBRE_SUBFAMILIA   ?? ''
      ].filter(Boolean).join(' · '),
      // Unidades por caja → "unidad" si es 1, "caja/Nu" si es mayor
      unidad:    (() => {
        const upc = p.unidades_por_caja ?? p.unidadesPorCaja ?? p.UNIDADES_POR_CAJA ?? 1;
        if (!upc || upc <= 1) return 'unidad';
        const n = Number.isInteger(upc) ? upc : parseFloat(upc.toFixed(2));
        return `caja/${n}u`;
      })(),
      categoria:   p.nombre_familia ?? p.nombreFamilia ?? p.NOMBRE_FAMILIA ?? '',
      codigo_barras: p.codigo_barras ?? p.codigoBarras ?? p.CODIGO_BARRAS ?? ''
    }));

    await writeData('productos.json', productos);
    return { ok: true, total: productos.length };
  } catch (e) {
    console.error('  ⚠ Error al sincronizar productos desde API externa:', e.message);
    return { ok: false, error: e.message };
  }
}

async function pushPedidoExterno(solicitud, cotizacion, proveedor, productos) {
  const url = (process.env.EXTERNAL_API_URL || '').replace(/\/$/, '');
  const key = process.env.EXTERNAL_API_KEY || '';
  if (!url) return { ok: false, motivo: 'sin_api' };

  // ── Payload enviado a la API externa ────────────────────────────────────────
  // Adapta los nombres de campo al formato que espera la API real.
  // Ver migracionAPI.md → sección "Paso 3: Adaptar el envío de pedidos".
  const payload = {
    referencia:   solicitud.num_orden,
    fecha_pedido: solicitud.fecha_orden,
    proveedor: {
      id:     proveedor.id,
      nombre: proveedor.nombre,
      email:  proveedor.email_notificaciones ?? proveedor.email
    },
    lineas: cotizacion.lineas.map(l => {
      const prod = productos.find(p => p.id === l.producto_id);
      const cant = solicitud.productos.find(p => p.producto_id === l.producto_id)?.cantidad ?? 1;
      return {
        // codigo_articulo es el ID real en el sistema de la empresa
        codigo_articulo: prod?.codigo_articulo ?? String(l.producto_id),
        codigo_barras:   prod?.codigo_barras   ?? '',
        producto_nombre: prod?.nombre          ?? 'Desconocido',
        cantidad:        cant,
        unidades_por_caja: prod?.unidad        ?? 'unidad',
        precio_unitario: l.precio_unitario,
        plazo_entrega:   l.plazo_entrega       ?? null,
        total_linea:     parseFloat((l.precio_unitario * cant).toFixed(2))
      };
    }),
    total_pedido: parseFloat(cotizacion.lineas.reduce((sum, l) => {
      const cant = solicitud.productos.find(p => p.producto_id === l.producto_id)?.cantidad ?? 1;
      return sum + l.precio_unitario * cant;
    }, 0).toFixed(2))
  };

  try {
    const res = await fetch(`${url}/pedidos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body.slice(0, 300)}`);
    }
    const respuesta = await res.json();
    return { ok: true, id_externo: respuesta.id ?? respuesta.pedido_id ?? null };
  } catch (e) {
    console.error('  ⚠ Error al enviar pedido a API externa:', e.message);
    return { ok: false, motivo: e.message };
  }
}

// ─── Endpoints de integración (admin) ────────────────────────────────────────
app.get('/api/admin/integracion', requireAdmin, async (req, res) => {
  const url = process.env.EXTERNAL_API_URL;
  if (!url) {
    return res.json({
      estado: 'no_configurada',
      mensaje: 'EXTERNAL_API_URL no está definida en .env. Configúrala y reinicia el servidor.'
    });
  }
  try {
    const test = await fetch(url, {
      headers: { 'Authorization': `Bearer ${process.env.EXTERNAL_API_KEY || ''}` },
      signal: AbortSignal.timeout(5000)
    });
    const solicitudes = await readData('solicitudes.json');
    res.json({
      estado: test.ok ? 'conectada' : (test.status < 500 ? 'alcanzable' : 'error'),
      codigo_http: test.status,
      url,
      pendientes_envio: solicitudes.filter(s => s.pendiente_envio_api).length
    });
  } catch (e) {
    res.json({ estado: 'error', mensaje: e.message, url });
  }
});

app.post('/api/admin/sync-productos', requireAdmin, async (req, res) => {
  const resultado = await getProductosExternos();
  if (!resultado) return res.status(400).json({ error: 'EXTERNAL_API_URL no está configurada en .env' });
  if (!resultado.ok) return res.status(502).json({ error: resultado.error });
  await registrarLog(req.session.user, 'sync_productos_api', `${resultado.total} productos sincronizados desde API externa`);
  res.json(resultado);
});

app.post('/api/admin/reintentar-envio/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [solicitudes, cotizaciones, users, productos] = await Promise.all([
      readData('solicitudes.json'), readData('cotizaciones.json'),
      readData('users.json'),       readData('productos.json')
    ]);
    const idx = solicitudes.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const cotizacion = cotizaciones.find(c => c.solicitud_id === id && c.adjudicada === true);
    if (!cotizacion) return res.status(400).json({ error: 'No hay cotización adjudicada para esta solicitud' });
    const proveedor = users.find(u => u.id === cotizacion.proveedor_id);
    if (!proveedor) return res.status(400).json({ error: 'El proveedor adjudicado no existe en el sistema' });
    const resultado = await pushPedidoExterno(solicitudes[idx], cotizacion, proveedor, productos);
    if (resultado.ok) {
      solicitudes[idx].pendiente_envio_api = false;
      if (resultado.id_externo) solicitudes[idx].id_api_externa = resultado.id_externo;
      await writeData('solicitudes.json', solicitudes);
      await registrarLog(req.session.user, 'pedido_enviado_api', `Pedido ${solicitudes[idx].num_orden} enviado a API externa`, id, 'solicitud');
    }
    res.json(resultado);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/login.html'));

// ─── Middleware de error global ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'El archivo supera el límite de 2 MB' });
  console.error('Express error no controlado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

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

async function main() {
  try {
    await migrarPasswordsSiNecesario();
    await initEmail().catch(e => {
      console.warn('  ⚠ Email no disponible, desactivado:', e.message);
    });

    if (process.env.EXTERNAL_API_URL) {
      console.log('  🔗 API externa configurada — sincronizando productos...');
      const r = await getProductosExternos();
      if (r?.ok) console.log(`  ✓ ${r.total} productos sincronizados desde API externa`);
      else console.warn(`  ⚠ Sincronización inicial fallida: ${r?.error} — usando caché local`);
    }

    app.listen(PORT, () => {
      console.log(`\n✅ RFQ Manager corriendo en http://localhost:${PORT}\n`);
      console.log('   Credenciales demo:');
      console.log('   Admin     → juangarciacardenas99@gmail.com / admin123');
      console.log('   Proveedor → garcia@suministros.com / garcia123\n');
    });
  } catch (e) {
    console.error('Error fatal al arrancar:', e.message);
    process.exit(1);
  }
}
main();
