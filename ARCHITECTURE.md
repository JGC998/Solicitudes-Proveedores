# Arquitectura — RFQ Manager
> Documento técnico para desarrolladores. Última actualización: 2026-06-05

---

## Visión general

**RFQ Manager** (Request for Quotation) es un sistema de gestión de solicitudes de presupuesto entre una empresa compradora y sus proveedores.

**Problema que resuelve:** Centralizar el proceso de pedir precios a varios proveedores, comparar sus ofertas, adjudicar el pedido al más competitivo y notificar a todos los implicados por email, eliminando el caos de emails manuales y hojas de cálculo.

**Usuarios:**
- **Administrador** (empresa compradora): crea solicitudes, compara cotizaciones, adjudica, genera órdenes de compra y valora proveedores.
- **Proveedor**: recibe solicitudes por email, envía precios y consulta el resultado de la adjudicación.

**Contexto:** Prototipo de demostración para una empresa. Los datos viven en archivos JSON que representan directamente las tablas de la futura base de datos relacional.

---

## Stack tecnológico

| Tecnología | Versión | Rol |
|---|---|---|
| Node.js | v22 | Runtime del servidor |
| Express | 4.18 | Framework HTTP y gestión de rutas |
| express-session | 1.17 | Sesiones de usuario (almacenadas en memoria del proceso) |
| bcryptjs | 3.x | Hashing de contraseñas (puro JS, sin dependencias nativas) |
| dotenv | 17.x | Carga de variables de entorno desde `.env` al arrancar |
| multer | 2.x | Recepción de archivos subidos (CSV de productos, memoria) |
| nodemailer | 8.x | Envío de emails SMTP con soporte Ethereal para pruebas |
| Chart.js | 4.4 (CDN) | Gráficas en el panel de análisis |
| HTML/CSS/JS vanilla | — | Frontend completo sin framework ni bundler |
| nodemon | 3.0 (dev) | Reinicio automático del servidor en desarrollo |

---

## Arquitectura general

El sistema sigue un patrón **monolítico de una sola capa**: todo el backend vive en `server.js`. Una petición sigue este camino:

```
Navegador
   │
   ▼
Express (server.js)
   │
   ├── dotenv ───────────────────────► Carga .env al arrancar
   │
   ├── express.static ───────────────► Sirve /public/ (HTML, CSS, JS)
   │
   ├── Middleware de sesión (express-session)
   │
   ├── requireAuth / requireAdmin / requireProveedor
   │       │ (401 o 403 si no autorizado)
   │       ▼
   ├── Handler de ruta (inline en server.js)
   │       │
   │       ├── readData(archivo.json)    ◄── Lee y parsea JSON del disco
   │       ├── lógica de negocio
   │       ├── writeData(archivo.json)   ──► Serializa y escribe JSON
   │       │
   │       ├── crearNotificacion()       ──► notificaciones.json
   │       ├── registrarLog()            ──► logs.json
   │       ├── sendEmail()               ──► Nodemailer → SMTP / Ethereal
   │       └── broadcast()              ──► SSE a clientes conectados
   │
   └── res.json(resultado)
```

**Flujo de datos en el frontend:**

```
Página HTML carga
   │
   ├── <script src="/js/ui.js">      ← Utilidades globales (se ejecuta último)
   │       • escapeHtml()            ← Prevención XSS en innerHTML
   │       • initHeader(rol)         ← Inyecta barra de búsqueda / notif
   │       • initNotificaciones()    ← Actualiza badge del campana
   │       • initEventos(callback)   ← Abre conexión SSE
   │       • toggleSidebar()         ← Menú móvil
   │
   └── <script> inline
           • init()  → GET /api/auth/me → redirige si sesión inválida
           • carga de datos con fetch()
           • render con template literals + escapeHtml()
```

---

## Estructura de directorios

```
rfq-manager/
│
├── server.js               # Todo el backend: rutas, lógica, helpers de I/O, email
├── package.json
├── .env                    # Variables de entorno reales (NO en el repo)
├── .env.example            # Plantilla con instrucciones para configurar el proyecto
│
├── data/                   # Persistencia — cada JSON es una tabla
│   ├── users.json          # Usuarios: admin y proveedores
│   ├── solicitudes.json    # RFQs creadas por el admin
│   ├── cotizaciones.json   # Cotizaciones de proveedores
│   ├── productos.json      # Catálogo de productos
│   ├── valoraciones.json   # Valoraciones admin→proveedor por solicitud
│   ├── notificaciones.json # Notificaciones internas por usuario
│   └── logs.json           # Registro de actividad (últimas 500 entradas)
│
└── public/                 # Frontend estático
    ├── login.html
    ├── registro.html
    ├── perfil.html
    ├── css/styles.css
    ├── js/ui.js            # Utilidades compartidas (escapeHtml, SSE, etc.)
    ├── admin/
    │   ├── dashboard.html      # KPIs + gráficas + alertas de vencimiento inminente
    │   ├── solicitudes.html    # Tabla con color por estado + ordenación inteligente
    │   ├── nueva-solicitud.html
    │   ├── detalle.html        # Comparativa de precios + adjudicación
    │   ├── orden-compra.html   # Documento imprimible
    │   ├── analisis.html       # Ranking, histórico, ahorro potencial
    │   ├── productos.html      # CRUD + botón Importar CSV
    │   ├── proveedores.html
    │   ├── notificaciones.html
    │   └── logs.html
    └── proveedor/
        ├── dashboard.html
        ├── cotizar.html
        ├── historial.html      # KPIs propios: tasa de éxito, adjudicaciones
        └── notificaciones.html
```

---

## Flujos principales

### Flujo 1 — Login y migración automática de contraseñas

```
Arranque del servidor:
  Promise.all([
    migrarPasswordsSiNecesario(),  ← Hashea con bcrypt las contraseñas en texto plano
    initEmail()                    ← Configura SMTP (Gmail o Ethereal según .env)
  ]).then(() => app.listen(PORT))

Login:
  1. POST /api/auth/login { email, password }
  2. Busca usuario por email en users.json
  3. bcrypt.compare(password, user.password)
  4. Si OK → req.session.user = { id, nombre, email, rol }
  5. Frontend redirige según rol: /admin/dashboard.html o /proveedor/dashboard.html
```

---

### Flujo 2 — Admin crea solicitud → email a proveedores

```
1. Admin rellena /admin/nueva-solicitud.html
   - Selecciona productos del catálogo con cantidad
   - Opcionalmente elige proveedores específicos (invitados)
   - Define fecha límite de respuesta

2. POST /api/solicitudes (requireAdmin)

3. server.js:
   a. Guarda solicitud en solicitudes.json
   b. Determina destinatarios:
      - proveedores_invitados[] → solo esos
      - vacío → todos los proveedores activos
   c. crearNotificacion() → notificaciones.json para cada proveedor
   d. sendEmail() → Nodemailer → SMTP
      Subject: "Nueva solicitud de presupuesto: «título»"
      Body:    nombre, fecha límite, descripción
      Botón:   "Enviar cotización →" → APP_URL/proveedor/cotizar.html?id=X
   e. broadcast('nueva_solicitud') → SSE → badge de notificaciones
```

---

### Flujo 3 — Proveedor cotiza → email al admin

```
Proveedor:
  1. Recibe email con link directo a cotizar.html?id=X
  2. GET /api/solicitudes/:id → solo ve sus propias cotizaciones previas
  3. Rellena precio unitario y plazo por producto
  4. POST /api/cotizaciones (requireProveedor)
     → Si ya había cotizado: actualiza (upsert por solicitud+proveedor)

  server.js tras guardar:
     a. crearNotificacion() al admin
     b. sendEmail() al admin:
        Subject: "💬 Nueva cotización recibida — «título»"
        Botón:   "Ver comparativa de precios →" → APP_URL/admin/detalle.html?id=X
     c. broadcast('nueva_cotizacion')

Admin:
  5. Abre detalle.html → GET /api/analisis/solicitud/:id → comparativa completa
  6. Tabla verde/rojo muestra mejor y peor precio por producto y fila de totales
  7. "Adjudicar a [proveedor]" → PATCH /api/cotizaciones/:id/adjudicar
     → Todas las cotizaciones de la solicitud: adjudicada=false
     → La seleccionada: adjudicada=true
     → sendEmail() a cada cotizante:
        Ganador:   asunto verde + link al historial
        Perdedor:  asunto gris + link a solicitudes activas
```

---

### Flujo 4 — Importar productos desde CSV

```
1. Admin abre Catálogo → "⬆ Importar CSV"
2. Selecciona archivo .csv del disco
3. POST /api/productos/importar (multipart/form-data, campo 'csv')
   - multer almacena el archivo en memoria (no toca el disco)
   - Detecta separador ; o ,
   - Elimina BOM UTF-8 (exportaciones de Excel)
   - Lee cabeceras: nombre (obligatorio), unidad (obligatorio),
                    categoria (opcional), descripcion (opcional)
   - Por cada fila: omite si nombre ya existe en productos.json
   - Escribe productos nuevos en productos.json
   - registrarLog() con el número de productos importados
4. Respuesta: { añadidos: N, omitidos: M }
5. Frontend recarga el catálogo y muestra mensaje de resultado
```

---

## Modelo de datos (JSON como tablas)

### `users.json`
```json
{
  "id": 1,
  "nombre": "Empresa Ejemplo SA",
  "email": "admin@empresa.com",
  "email_notificaciones": "otro@gmail.com",
  "password": "$2b$10$...",
  "rol": "admin",
  "activo": true,
  "pendiente": false
}
```
- `email`: email de login (único en el sistema)
- `email_notificaciones`: si existe, los emails van aquí en lugar de a `email`; útil para redirigir todos los avisos de los proveedores demo a una bandeja real sin cambiar sus credenciales de login
- `password`: **siempre** hash bcrypt — nunca texto plano
- `pendiente: true`: registro pendiente de aprobación por el admin

### `solicitudes.json`
```json
{
  "id": 1,
  "titulo": "Material de oficina Q2",
  "descripcion": "...",
  "fecha_creacion": "2026-06-01",
  "fecha_limite": "2026-06-15",
  "estado": "activa",
  "proveedores_invitados": [2, 3],
  "productos": [{ "producto_id": 1, "cantidad": 100 }],
  "num_orden": "OC-2026-0001",
  "fecha_orden": "2026-06-10",
  "recibida": true,
  "fecha_recepcion": "2026-06-20"
}
```
- `estado`: siempre uno de `"activa"` / `"cerrada"` / `"borrador"` (validado en API)
- `proveedores_invitados`: `[]` = todos los proveedores activos ven la solicitud
- `num_orden`, `fecha_orden`, `recibida`, `fecha_recepcion`: se añaden tras adjudicar

### `cotizaciones.json`
```json
{
  "id": 1,
  "solicitud_id": 1,
  "proveedor_id": 2,
  "fecha": "2026-06-05",
  "notas": "Oferta válida 30 días",
  "adjudicada": null,
  "lineas": [
    { "producto_id": 1, "precio_unitario": 12.50, "plazo_entrega": 7 }
  ]
}
```
- `adjudicada`: `null` = sin decidir · `true` = ganador · `false` = no seleccionado
- Las cotizaciones son un upsert: si un proveedor ya cotizó esa solicitud, se actualiza la existente

### Relaciones
```
users ──────────────────┬── cotizaciones.proveedor_id
                        └── notificaciones.user_id

solicitudes ────────────┬── cotizaciones.solicitud_id
    └── .productos[]    │
         └── producto_id┼── productos.id
                        └── valoraciones.solicitud_id

cotizaciones.lineas[]
    └── producto_id ──────── productos.id
```

---

## Autenticación y control de acceso

**Mecanismo:** Sesiones HTTP con `express-session` (en memoria del proceso Node).

```
Sesión activa: req.session.user = { id, nombre, email, rol }
Duración:      8 horas (cookie.maxAge)
Secret:        process.env.SESSION_SECRET (valor por defecto inseguro en .env.example)
```

**Tres middlewares de guardia:**

| Middleware | Verifica | Usado en |
|---|---|---|
| `requireAuth` | Sesión activa (cualquier rol) | Lectura de solicitudes, notificaciones, cotizaciones propias |
| `requireAdmin` | `rol === 'admin'` | Toda la gestión: crear/editar/borrar, análisis, logs, proveedores |
| `requireProveedor` | `rol === 'proveedor'` | Envío de cotizaciones |

**En el frontend:** Cada página protegida llama a `GET /api/auth/me` en su `init()`. Si la respuesta es 401, redirige a `/login.html`.

---

## Sistema de email (Nodemailer)

```
initEmail() — se llama al arrancar el servidor:
  ├── Si SMTP_PASS está configurado en .env:
  │     Usa Gmail (o el SMTP configurado) con las credenciales del .env
  │
  └── Si SMTP_PASS está vacío:
        Crea cuenta de prueba en Ethereal Email automáticamente
        Muestra credenciales y URL de visualización en la consola
        Los emails se "envían" pero se pueden ver en ethereal.email/messages

sendEmail(to, subject, html):
  ├── Usa EMAIL_FROM = process.env.SMTP_USER (remitente configurado)
  ├── Emails con HTML estilizado: cabecera, cuerpo y botón de acción
  └── Si falla el envío: log de error en consola, NO interrumpe la petición HTTP

Campo email_notificaciones en users.json:
  └── Si existe, los emails se envían a ese campo en lugar de a email
      (útil para pruebas: todos los proveedores demo apuntan a una bandeja real)
```

**Emails que se envían automáticamente:**

| Trigger | Destinatario | Botón en el email |
|---|---|---|
| Admin crea solicitud | Proveedores invitados | "Enviar cotización →" (cotizar.html?id=X) |
| Proveedor cotiza | Admin | "Ver comparativa de precios →" (detalle.html?id=X) |
| Admin adjudica (ganador) | Proveedor ganador | "Ver mis cotizaciones →" (historial.html) |
| Admin adjudica (perdedor) | Proveedores perdedores | "Ver solicitudes activas →" (dashboard.html) |

---

## Tiempo real — SSE (Server-Sent Events)

```
GET /api/eventos (requireAuth):
  └── Añade cliente al Set global sseClients
      └── Mantiene conexión HTTP abierta
          └── Al desconectar: sseClients.delete(client)

broadcast(tipo, datos):
  └── Itera sseClients y escribe en cada res:
      data: {"tipo":"nueva_cotizacion","solicitud_id":1,...}\n\n
```

El cliente (`ui.js → initEventos`) reconecta automáticamente si la conexión se cae (timeout 3s).

**Eventos emitidos:**

| Tipo | Cuándo |
|---|---|
| `nueva_solicitud` | Admin crea una solicitud |
| `solicitud_estado` | Admin cambia el estado |
| `nueva_cotizacion` | Proveedor envía cotización |
| `cotizacion_actualizada` | Proveedor modifica cotización existente |
| `adjudicacion` | Admin adjudica un proveedor |
| `ping` | Al conectar (keepalive) |

---

## Configuración y entornos

```
Variable          Valor si no está         Descripción
SESSION_SECRET    'rfq-proto-secret-2025'  Secreto de sesiones (¡cambiar en producción!)
APP_URL           'http://localhost:3000'  URL base para links en emails
SMTP_HOST         'smtp.gmail.com'         Servidor SMTP
SMTP_PORT         587                      Puerto SMTP (TLS)
SMTP_USER         (ninguno)               Cuenta de email remitente
SMTP_PASS         (ninguno → Ethereal)    Contraseña SMTP / App Password de Gmail
```

**Arranque en desarrollo:**
```bash
npm run dev    # nodemon — reinicia al guardar
```

**Arranque en producción:**
```bash
npm start      # node server.js
```

---

## Decisiones técnicas

### ¿Por qué JSON en vez de SQLite/MySQL?
Prototipo de demostración: cada `.json` representa visualmente una tabla de la futura BD relacional. Permite que el equipo de la empresa entienda la estructura de datos sin instalar nada.

### ¿Por qué sin framework frontend (React, Vue...)?
Máxima transparencia para el cliente: el código HTML es legible directamente, sin paso de compilación. Cualquier desarrollador puede abrir el archivo y entender la UI.

### ¿Por qué SSE en vez de WebSockets?
SSE es unidireccional (servidor → cliente), exactamente lo que se necesita para notificaciones. Más simple que WebSockets y funciona sobre HTTP estándar sin librerías adicionales.

### ¿Por qué bcryptjs en vez de bcrypt (nativo)?
`bcryptjs` es puro JavaScript, sin módulos nativos que compilar. Funciona en cualquier entorno sin herramientas de compilación (`node-gyp`).

### ¿Por qué Ethereal Email como fallback?
Permite demostrar el sistema de email sin ninguna configuración: al arrancar sin `SMTP_PASS`, el servidor crea automáticamente una cuenta temporal en Ethereal y muestra la URL de visualización en consola. Cero fricción para el primer arranque.

### ¿Por qué multer con memoria (no disco)?
Los CSV de productos son pequeños (< 2 MB). Almacenarlos en memoria evita gestionar archivos temporales en disco y simplifica el código de cleanup.

### Patrón de acceso a datos
Todas las operaciones de BD siguen el mismo patrón:
```js
const data = await readData('archivo.json');   // fs.readFile + JSON.parse
// ... modificar data en memoria ...
await writeData('archivo.json', data);         // JSON.stringify + fs.writeFile
```
Sin ORM ni capa de abstracción adicional — la lógica de negocio y el acceso a datos están inline en cada handler de ruta.

---

## Limitaciones conocidas y deuda técnica

### Limitaciones por diseño del prototipo

| Limitación | Impacto | Solución en producción |
|---|---|---|
| JSON sin transacciones | Dos escrituras simultáneas pueden solaparse | SQLite (mínimo) o PostgreSQL |
| `nextId()` no es atómico | IDs duplicados bajo carga concurrente | Autoincrement de BD o UUID |
| Sesiones en memoria | Se pierden al reiniciar el servidor | Redis o sesiones en BD |
| Sin rate limiting | Login vulnerable a fuerza bruta | `express-rate-limit` |
| Sin HTTPS | Sesión y tokens viajan sin cifrar | Nginx + TLS delante del servidor |

### Deuda técnica

- **`server.js` monolítico (~1000 líneas):** En producción, separar en `routes/`, `controllers/`, `services/`, `middleware/`
- **Sin validación de esquema:** Los cuerpos de petición se usan sin validar tipos ni longitudes. En producción: `zod` o `joi`
- **Sin tests:** No hay tests unitarios ni de integración. En producción: `jest` + `supertest`
- **Sin logs estructurados:** Solo `console.log`. En producción: `winston` o `pino` con nivel y formato JSON

---

## Guía rápida para un desarrollador nuevo

```bash
# Arrancar
npm install && cp .env.example .env && npm run dev

# Login demo
# Admin:     (ver users.json → id:1 → email) / admin123
# Proveedor: garcia@suministros.com / garcia123
```

**Para añadir un nuevo endpoint en `server.js`:**
1. `app.get/post/patch/delete('/api/...')` con el middleware de guardia adecuado
2. `readData('archivo.json')` para leer, `writeData('archivo.json', data)` para guardar
3. `registrarLog()` si la acción debe aparecer en el registro de actividad
4. `crearNotificacion()` si algún usuario debe recibir un aviso interno
5. `sendEmail()` si debe enviarse un email
6. `broadcast()` si los clientes conectados deben actualizar su UI en tiempo real

**Para añadir una nueva página en `public/`:**
1. Crear el `.html` en `public/admin/` o `public/proveedor/`
2. Incluir `<script src="/js/ui.js"></script>` (puede ir al final del body)
3. En `init()`, verificar sesión con `fetch('/api/auth/me')` y redirigir si 401
4. Usar `escapeHtml()` **siempre** que se inserte contenido de usuario en `innerHTML`
