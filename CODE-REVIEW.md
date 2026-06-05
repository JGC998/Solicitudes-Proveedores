# Code Review — RFQ Manager
> 2026-06-05 · Backend · API externa · Email · CSV · Integración

## Resumen
**Archivos analizados:** 22 (server.js completo + todos los HTML)  
**Hallazgos:** 9 total (2 críticos, 3 altos, 2 medios, 2 bajos)

| Categoría | Críticos | Altos | Medios | Bajos |
|-----------|----------|-------|--------|-------|
| Bugs confirmados | 2 | 1 | 0 | 0 |
| Bugs probables | 0 | 2 | 1 | 0 |
| Bugs potenciales | 0 | 0 | 1 | 0 |
| Arquitectura / Calidad | 0 | 0 | 0 | 2 |

---

## 🔴 Bugs Confirmados

### [BUG-01] `proveedor` puede ser `undefined` en `pushPedidoExterno` → TypeError
**Archivo:** `server.js:986-987` y `server.js:1252-1253`  
**Problema:** Si el proveedor adjudicado fue eliminado después de la adjudicación, `users.find(...)` devuelve `undefined`. La función `pushPedidoExterno` accede a `proveedor.id`, `proveedor.nombre` sin guard → **TypeError: Cannot read properties of undefined**.

**Se dispara cuando:** Un proveedor se elimina después de adjudicar pero antes de generar la OC, o al reintentar el envío.

```js
// ❌ Actual — server.js:986
const prov = allUsers.find(u => u.id === cotAdj.proveedor_id);
const resultadoApi = await pushPedidoExterno(solicitudes[idx], cotAdj, prov, allProds);
// → si prov es undefined, pushPedidoExterno falla en línea 1159: proveedor.id

// ✅ Corrección
const prov = allUsers.find(u => u.id === cotAdj.proveedor_id);
if (!prov) {
  solicitudes[idx].pendiente_envio_api = true;
  solicitudes[idx].error_api = 'Proveedor no encontrado';
} else {
  const resultadoApi = await pushPedidoExterno(solicitudes[idx], cotAdj, prov, allProds);
  // ... resto de la lógica
}
```
Aplicar la misma corrección en `POST /api/admin/reintentar-envio/:id` (línea 1252).

---

### [BUG-02] `Promise.all` del arranque sin `.catch()` → servidor no arranca silenciosamente
**Archivo:** `server.js:1285`  
**Problema:** Si `initEmail()` lanza (por ejemplo, cuando Ethereal está caído y `nodemailer.createTestAccount()` falla), la promesa rechazada no tiene manejador. El callback `.then()` nunca se ejecuta, `app.listen()` nunca se llama, y el servidor no arranca. Node.js emite un `UnhandledPromiseRejection` en la consola pero el proceso sigue vivo, sin servidor escuchando.

**Se dispara cuando:** Ethereal Email no es accesible en el arranque (red sin internet, API de Ethereal caída).

```js
// ❌ Actual — server.js:1285
Promise.all([migrarPasswordsSiNecesario(), initEmail()]).then(async () => {
  app.listen(PORT, () => { ... });
});
// → si initEmail() lanza, .then() nunca corre

// ✅ Corrección — envolver en función async con try-catch
async function main() {
  try {
    await migrarPasswordsSiNecesario();
    await initEmail().catch(e => {
      console.warn('  ⚠ Email no disponible, desactivado:', e.message);
      // El servidor arranca igualmente sin email
    });
    if (process.env.EXTERNAL_API_URL) { ... }
    app.listen(PORT, () => { ... });
  } catch (e) {
    console.error('Error fatal al arrancar:', e.message);
    process.exit(1);
  }
}
main();
```

---

### [BUG-03] URL con barra final genera doble barra en endpoints de la API
**Archivo:** `server.js:1105, 1185`  
**Problema:** Si el usuario configura `EXTERNAL_API_URL=https://api.empresa.com/v2/` (con barra final), las rutas generadas quedan `https://api.empresa.com/v2//productos` y `https://api.empresa.com/v2//pedidos`. Muchos servidores API devuelven 404 con doble barra.

**Se dispara cuando:** El usuario añade una barra al final de `EXTERNAL_API_URL` en `.env`.

```js
// ❌ Actual
const res = await fetch(`${url}/productos`, { ... });

// ✅ Corrección — normalizar al leer la variable
const url = (process.env.EXTERNAL_API_URL || '').replace(/\/$/, '');
```
Aplicar en ambas funciones: `getProductosExternos()` y `pushPedidoExterno()`.

---

## 🟠 Bugs Probables

### [BUG-04] Errores de multer devuelven HTML en lugar de JSON
**Archivo:** `server.js:264`  
**Problema:** Cuando multer rechaza un archivo (supera el límite de 2 MB, tipo no permitido), llama a `next(err)`. Sin un middleware de error en Express, la respuesta es HTML de error 500. El frontend hace `await res.json()` sobre esa respuesta HTML → **SyntaxError: Unexpected token '<'**. El botón de importar se bloquea.

**Se dispara cuando:** Alguien sube un CSV de más de 2 MB.

```js
// ❌ Actual — multer error propagado sin handler
app.post('/api/productos/importar', requireAdmin, upload.single('csv'), async (req, res) => {
  // multer errors no llegan aquí — van a Express default handler (HTML)

// ✅ Corrección — añadir al final de server.js (antes del listen)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'El archivo supera el límite de 2 MB' });
  console.error('Express error:', err.message);
  res.status(500).json({ error: err.message || 'Error interno' });
});
```

---

### [BUG-05] `cargar()` en integracion.html sin try-catch → página se queda cargando
**Archivo:** `public/admin/integracion.html` — función `cargar()`  
**Problema:** Si el fetch a `/api/admin/integracion` falla (servidor caído, red cortada), la promesa rechazada no se captura. La página permanece en estado "Comprobando conexión..." indefinidamente. Tampoco hay protección en `cargarPendientes()`.

**Se dispara cuando:** El servidor se reinicia mientras el admin tiene la página abierta.

```js
// ❌ Actual
async function cargar() {
  const res = await fetch('/api/admin/integracion'); // puede lanzar
  const data = await res.json();
  ...
  document.getElementById('loading').classList.add('hidden');
}

// ✅ Corrección
async function cargar() {
  try {
    const res = await fetch('/api/admin/integracion');
    const data = await res.json();
    ...
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch {
    document.getElementById('loading').innerHTML =
      '<p class="text-muted text-sm">Error al comprobar la conexión. Recarga la página.</p>';
  }
}
```

---

### [BUG-06] `querySelector` frágil en `importarCSV` → posible TypeError
**Archivo:** `public/admin/productos.html` — función `importarCSV()`  
**Problema:** `document.querySelector('button[onclick*="csv-input"]')` localiza el botón por el contenido de su atributo `onclick`. Si el HTML del botón cambia (cualquier edición futura), devuelve `null` y `btn.disabled = true` lanza **TypeError: Cannot set properties of null**.

**Se dispara cuando:** Se edita el botón de importar en el HTML.

```js
// ❌ Actual
const btn = document.querySelector('button[onclick*="csv-input"]');
btn.disabled = true; // TypeError si querySelector devuelve null

// ✅ Corrección — añadir id al botón en el HTML
// HTML: <button id="btn-importar-csv" ...>⬆ Importar CSV</button>
// JS:
const btn = document.getElementById('btn-importar-csv');
if (!btn) return;
btn.disabled = true;
```

---

## 🟡 Bugs Potenciales / Casos Borde

### [BUG-07] Estado "conectada" cuando la API devuelve HTTP 404
**Archivo:** `server.js:1223`  
**Problema:** El estado de conexión se evalúa como "conectada" cuando `test.status < 500`. Un 404 (Not Found) — que ocurre si la URL base no tiene endpoint raíz — aparece en el panel como "Conectada · 404", lo que puede confundir al pensar que la API está operativa.

```js
// ❌ Actual
estado: test.status < 500 ? 'conectada' : 'error',

// ✅ Corrección más precisa
estado: test.ok ? 'conectada' : (test.status < 500 ? 'alcanzable' : 'error'),
// Y actualizar el badge en integracion.html para mostrar 'alcanzable' en amarillo
```

---

## ⚙️ Arquitectura y Calidad

### [CODE-01] `APP_URL` calculada tres veces con tres nombres distintos
**Severidad:** Baja  
**Archivo:** `server.js:383, 528, 641`  
**Problema:** La misma expresión `process.env.APP_URL || \`http://localhost:${PORT}\`` aparece con tres nombres de variable distintos (`baseUrl`, `appUrlCot`, `appUrl`). Si se cambia la lógica, hay que actualizarla en tres sitios.

```js
// ❌ Actual — tres repeticiones con nombres distintos
const baseUrl = process.env.APP_URL || `http://localhost:${PORT}`;     // línea 383
const appUrlCot = process.env.APP_URL || `http://localhost:${PORT}`;   // línea 528
const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;      // línea 641

// ✅ Corrección — constante de módulo al principio de server.js
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
// Y usar APP_URL en los tres sitios
```

---

### [CODE-02] Falta middleware de error global en Express
**Severidad:** Baja  
**Archivo:** `server.js` (final)  
**Problema:** Express no tiene middleware de error `(err, req, res, next)`. Cualquier error que llegue vía `next(err)` (multer, errores inesperados) devuelve una respuesta HTML, no JSON. Este middleware soluciona BUG-04 y protege frente a futuros errores.

```js
// ✅ Añadir justo antes de app.listen
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ error: 'El archivo supera el límite de 2 MB' });
  console.error('Express error no controlado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});
```

---

## 🗺️ Hoja de Ruta de Correcciones

| Prioridad | ID | Descripción | Esfuerzo | Hacer antes de |
|-----------|-----|-------------|----------|----------------|
| 1 | CODE-02 | Añadir middleware de error global en Express | ~5 min | activar API real |
| 2 | BUG-04 | Multer errors → JSON (resuelto por CODE-02) | incluido | activar API real |
| 3 | BUG-01 | Guard `prov` undefined en orden-compra y reintentar | ~10 min | activar API real |
| 4 | BUG-02 | `main()` async con try-catch en el arranque | ~10 min | producción |
| 5 | BUG-03 | Normalizar URL trailing slash en adaptador | ~2 min | configurar API real |
| 6 | BUG-05 | try-catch en `cargar()` de integracion.html | ~5 min | siguiente PR |
| 7 | BUG-06 | `id` al botón importar CSV | ~2 min | siguiente PR |
| 8 | BUG-07 | Distinguir "conectada" de "alcanzable (404)" | ~5 min | — |
| 9 | CODE-01 | Constante `APP_URL` de módulo | ~3 min | — |

**Secuencia recomendada:**
1. `CODE-02` primero — el middleware de error global resuelve también `BUG-04` y hace el servidor más robusto ante cualquier error futuro.
2. `BUG-01` — crítico si la API real va a estar activa pronto.
3. `BUG-02` + `BUG-03` — par rápido antes de pasar a producción.
4. El resto son mejoras de robustez sin urgencia inmediata.
