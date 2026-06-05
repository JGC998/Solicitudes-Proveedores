# Arquitectura — RFQ Manager
> Documento técnico para desarrolladores. Última actualización: 2026-06-05

---

## Visión general

**RFQ Manager** (Request for Quotation) es un sistema de gestión de solicitudes de presupuesto entre una empresa compradora y sus proveedores.

**Problema que resuelve:** Centralizar el proceso de pedir precios a varios proveedores, comparar sus ofertas y adjudicar el pedido al más competitivo, eliminando el caos de emails y hojas de cálculo.

**Usuarios:**
- **Administrador** (empresa compradora): crea solicitudes, compara cotizaciones, adjudica y genera órdenes de compra.
- **Proveedor**: recibe solicitudes, envía precios y consulta el resultado de la adjudicación.

**Contexto:** Prototipo de demostración para una empresa. Los datos viven en archivos JSON que representan directamente las tablas de la futura base de datos relacional.

---

## Stack tecnológico

| Tecnología | Versión | Rol |
|---|---|---|
| Node.js | v22 | Runtime del servidor |
| Express | 4.18 | Framework HTTP y gestión de rutas |
| express-session | 1.17 | Sesiones de usuario (almacenadas en memoria) |
| bcryptjs | última | Hashing de contraseñas (puro JS, sin dependencias nativas) |
| Chart.js | 4.4 (CDN) | Gráficas en el panel de análisis |
| nodemon | 3.0 | Reinicio automático en desarrollo |

Sin frameworks de frontend — HTML, CSS y JS vanilla puro.

---

## Arquitectura general

El sistema sigue un patrón **monolítico de una sola capa**: todo el backend vive en `server.js`. No hay separación en controladores/servicios/modelos porque es un prototipo. Una petición sigue este camino:

```
Navegador
   │
   ▼
Express (server.js)
   │
   ├── express.static ──────────────► Sirve archivos de /public/
   │
   ├── Middleware de sesión (express-session)
   │
   ├── requireAuth / requireAdmin / requireProveedor
   │       │ (401 o 403 si no autorizado)
   │       ▼
   ├── Handler de ruta (inline)
   │       │
   │       ├── readData(archivo.json)   ◄── Lee JSON del disco
   │       ├── lógica de negocio
   │       ├── writeData(archivo.json)  ──► Escribe JSON al disco
   │       │
   │       └── res.json(resultado)
   │
   └── SSE (Server-Sent Events) ──────► Broadcast en tiempo real
                                        a todos los clientes conectados
```

**Flujo de datos en el frontend:**

```
Página HTML
   │
   ├── <script src="/js/ui.js">   ← Utilidades compartidas
   │       • escapeHtml()
   │       • initHeader(rol)
   │       • initNotificaciones()
   │       • initBusqueda()
   │       • initEventos(callback)   ← Abre conexión SSE
   │       • toggleSidebar()
   │
   └── <script> inline
           • init()  → verifica sesión via /api/auth/me
           • carga de datos via fetch()
           • render de HTML con template literals
```

---

## Estructura de directorios

```
Formulario Proveedores/
│
├── server.js               # Todo el backend: rutas, lógica, helpers de I/O
├── package.json            # Dependencias: express, express-session, bcryptjs
│
├── data/                   # "Base de datos" — cada JSON es una tabla
│   ├── users.json          # Tabla de usuarios (admin + proveedores)
│   ├── solicitudes.json    # Solicitudes de presupuesto (RFQs)
│   ├── cotizaciones.json   # Cotizaciones enviadas por proveedores
│   ├── productos.json      # Catálogo de productos
│   ├── valoraciones.json   # Valoraciones del admin a proveedores
│   ├── notificaciones.json # Notificaciones del sistema por usuario
│   └── logs.json           # Auditoría de acciones (últimas 500)
│
└── public/                 # Frontend estático servido por Express
    │
    ├── login.html          # Página de acceso (ambos roles)
    ├── registro.html       # Solicitud de alta como proveedor
    ├── perfil.html         # Cambio de contraseña (ambos roles)
    │
    ├── css/
    │   └── styles.css      # Hoja de estilos completa del sistema
    │
    ├── js/
    │   └── ui.js           # Utilidades compartidas entre todas las páginas
    │
    ├── admin/              # Panel del administrador (solo rol admin)
    │   ├── dashboard.html      # KPIs + gráficas + solicitudes recientes
    │   ├── solicitudes.html    # Listado con filtros y paginación
    │   ├── nueva-solicitud.html# Formulario de creación de RFQ
    │   ├── detalle.html        # Comparativa de precios + adjudicación
    │   ├── orden-compra.html   # Documento imprimible de la OC
    │   ├── analisis.html       # KPIs avanzados + gráficas + ranking
    │   ├── productos.html      # CRUD del catálogo
    │   ├── proveedores.html    # CRUD + aprobación de proveedores
    │   ├── notificaciones.html # Bandeja de notificaciones
    │   └── logs.html           # Registro de actividad del sistema
    │
    └── proveedor/          # Panel del proveedor (solo rol proveedor)
        ├── dashboard.html      # Solicitudes activas + KPIs propios
        ├── cotizar.html        # Formulario de envío de precios
        ├── historial.html      # Cotizaciones enviadas + resultado
        └── notificaciones.html # Bandeja de notificaciones
```

---

## Flujos principales

### Flujo 1 — Login de usuario

```
1. Usuario rellena email + contraseña en /login.html
2. POST /api/auth/login
3. server.js busca user por email en users.json
4. bcrypt.compare(password, user.password)
5. Si OK → req.session.user = { id, nombre, email, rol }
6. Respuesta: { user: { rol } }
7. Frontend redirige a /admin/dashboard.html o /proveedor/dashboard.html según rol
```

**Primer arranque:** La migración automática (`migrarPasswordsSiNecesario`) convierte cualquier contraseña en texto plano a hash bcrypt la primera vez que el servidor arranca.

---

### Flujo 2 — Admin crea solicitud y proveedores reciben notificación

```
1. Admin rellena /admin/nueva-solicitud.html
   - Elige productos del catálogo (con cantidad)
   - Opcionalmente selecciona proveedores específicos
   - Define fecha límite
2. POST /api/solicitudes (requireAdmin)
3. server.js guarda nueva solicitud en solicitudes.json
4. Determina destinatarios:
   - Si hay proveedores_invitados → solo esos
   - Si no → todos los proveedores activos
5. crearNotificacion() → añade entrada en notificaciones.json para cada uno
6. broadcast('nueva_solicitud', ...) → SSE a todos los clientes conectados
7. Frontend del proveedor recibe el evento SSE y actualiza el badge de notificaciones
```

---

### Flujo 3 — Proveedor cotiza y admin compara precios

```
Proveedor:
1. Abre /proveedor/cotizar.html?id=X
2. GET /api/solicitudes/:id → recibe los productos a cotizar
   (solo ve sus propias cotizaciones previas, nunca las de competidores)
3. Rellena precio unitario y plazo por cada producto
4. POST /api/cotizaciones (requireProveedor)
5. Si ya había cotizado antes → actualiza la existente (upsert)
6. crearNotificacion() al admin
7. broadcast('nueva_cotizacion', ...)

Admin:
8. Abre /admin/detalle.html?id=X
9. GET /api/analisis/solicitud/:id → comparativa completa con todos los proveedores
10. Tabla verde/rojo muestra mejor y peor precio por producto
11. Admin hace clic en "Adjudicar a [proveedor]"
12. PATCH /api/cotizaciones/:id/adjudicar
13. Todas las cotizaciones de esa solicitud se marcan adjudicada=false,
    la seleccionada adjudicada=true
14. Notificación a todos los que cotizaron (ganador y perdedores)
15. Admin puede generar orden de compra (PDF imprimible)
```

---

## Modelo de datos (JSON como tablas)

### `users.json`
```json
{
  "id": 1,
  "nombre": "Empresa Ejemplo SA",
  "email": "admin@empresa.com",
  "password": "$2b$10$...",   // bcrypt hash
  "rol": "admin",             // "admin" | "proveedor"
  "activo": true,             // false = cuenta desactivada
  "pendiente": false          // true = pendiente de aprobación
}
```

### `solicitudes.json`
```json
{
  "id": 1,
  "titulo": "Material de oficina Q2",
  "descripcion": "...",
  "fecha_creacion": "2026-06-01",
  "fecha_limite": "2026-06-15",
  "estado": "activa",                    // "activa" | "cerrada" | "borrador"
  "proveedores_invitados": [2, 3],       // [] = todos
  "productos": [
    { "producto_id": 1, "cantidad": 100 }
  ],
  "num_orden": "OC-2026-0001",           // presente tras generar OC
  "fecha_orden": "2026-06-10",
  "recibida": true,
  "fecha_recepcion": "2026-06-20"
}
```

### `cotizaciones.json`
```json
{
  "id": 1,
  "solicitud_id": 1,
  "proveedor_id": 2,
  "fecha": "2026-06-05",
  "notas": "Oferta válida 30 días",
  "adjudicada": null,         // null=sin decidir, true=ganador, false=perdedor
  "lineas": [
    { "producto_id": 1, "precio_unitario": 12.50, "plazo_entrega": 7 }
  ]
}
```

### `productos.json`
```json
{
  "id": 1,
  "nombre": "Papel A4 80g",
  "descripcion": "Resma 500 hojas",
  "categoria": "Oficina",
  "unidad": "resma"
}
```

### `valoraciones.json`
```json
{
  "id": 1,
  "proveedor_id": 2,
  "solicitud_id": 1,
  "admin_id": 1,
  "fecha": "2026-06-20",
  "calidad": 4,      // 1-5 estrellas
  "plazo": 5,
  "precio": 4,
  "comentario": "Buen servicio"
}
```

**Relaciones clave:**
```
users ──────────────── cotizaciones (proveedor_id → users.id)
solicitudes ─────────── cotizaciones (solicitud_id → solicitudes.id)
solicitudes.productos ── productos (producto_id → productos.id)
cotizaciones ────────── valoraciones (proveedor/solicitud_id)
users ───────────────── notificaciones (user_id → users.id)
```

---

## Autenticación y control de acceso

**Mecanismo:** Sesiones HTTP con `express-session` (almacenadas en memoria del proceso Node).

```
Sesión activa: req.session.user = { id, nombre, email, rol }
Duración: 8 horas (cookie.maxAge)
```

**Tres middlewares de guardia:**

| Middleware | Verifica | Usado en |
|---|---|---|
| `requireAuth` | Sesión activa (cualquier rol) | Lectura de solicitudes, notificaciones, productos |
| `requireAdmin` | `rol === 'admin'` | Creación/edición/borrado de todo, análisis, logs |
| `requireProveedor` | `rol === 'proveedor'` | Envío de cotizaciones |

**En el frontend:** Cada página protegida llama a `GET /api/auth/me` al cargar. Si la sesión caducó o el rol no coincide, redirige a `/login.html`.

**Contraseñas:** bcrypt con 10 rondas de salt. La migración automática en el arranque convierte contraseñas legacy en texto plano.

---

## Tiempo real — SSE (Server-Sent Events)

En lugar de polling, el sistema usa una conexión SSE persistente por cliente.

```
GET /api/eventos (requireAuth)
   │
   └── Añade cliente a sseClients (Set global)
       └── Mantiene conexión abierta
           └── Al desconectar: sseClients.delete(client)

broadcast(tipo, datos):
   └── Itera sseClients y escribe en cada res:
       data: {"tipo":"nueva_cotizacion","solicitud_id":1,...}\n\n
```

**Eventos emitidos:**

| Tipo | Cuándo |
|---|---|
| `nueva_solicitud` | Admin crea una solicitud |
| `solicitud_estado` | Admin cambia el estado |
| `nueva_cotizacion` | Proveedor envía cotización |
| `cotizacion_actualizada` | Proveedor modifica cotización existente |
| `adjudicacion` | Admin adjudica un proveedor |
| `ping` | Al conectar (comprueba que la conexión funciona) |

El cliente (`ui.js → initEventos`) reconecta automáticamente si la conexión se cae (timeout de 3s).

---

## Configuración y entornos

```
Variable de entorno    Valor por defecto          Descripción
SESSION_SECRET         'rfq-proto-secret-2025'    Secreto de firma de sesiones
PORT                   3000                       Puerto del servidor (hardcodeado)
```

Arranque en **desarrollo:**
```bash
npm run dev    # nodemon server.js — reinicia al guardar
```

Arranque en **producción:**
```bash
npm start      # node server.js
```

No hay archivo `.env` — las variables se definen en el entorno del sistema operativo si se quieren sobreescribir.

---

## Decisiones técnicas

### ¿Por qué JSON en vez de SQLite/MySQL?
Prototipo de demostración: cada `.json` representa visualmente una tabla de la futura BD relacional. Facilita que el equipo de la empresa entienda la estructura de datos sin instalar nada.

### ¿Por qué sin framework frontend (React, Vue...)?
Máxima transparencia para el cliente: el código HTML es legible directamente, sin paso de compilación. Cualquier desarrollador puede abrir el archivo y entender la UI.

### ¿Por qué SSE en vez de WebSockets?
SSE es unidireccional (servidor → cliente), que es exactamente lo que se necesita para notificaciones. Es más simple que WebSockets y funciona sobre HTTP estándar sin librerías adicionales.

### ¿Por qué bcryptjs en vez de bcrypt?
`bcryptjs` es puro JavaScript — no requiere compilar módulos nativos (`node-gyp`). Más fácil de instalar en cualquier entorno de desarrollo o servidor sin herramientas de compilación.

### Patrón de acceso a datos
Todas las operaciones siguen el mismo patrón:
```js
const data = await readData('archivo.json');   // fs.readFile + JSON.parse
// ... modificar data ...
await writeData('archivo.json', data);         // JSON.stringify + fs.writeFile
```
No hay ORM ni capa de abstracción adicional — la lógica de negocio y el acceso a datos están inline en cada handler.

---

## Limitaciones conocidas y deuda técnica

### Limitaciones por diseño del prototipo

| Limitación | Impacto | Solución en producción |
|---|---|---|
| JSON sin transacciones | Dos escrituras simultáneas pueden solaparse | Migrar a SQLite (mejor opción mínima) o PostgreSQL |
| `nextId()` no es atómico | IDs duplicados bajo carga concurrente | Usar autoincrement de BD o UUID |
| Sesiones en memoria | Se pierden al reiniciar el servidor | Redis o sesiones en BD |
| Sin rate limiting | Endpoint de login vulnerable a fuerza bruta | `express-rate-limit` |
| Sin HTTPS | Sesión y contraseñas viajan sin cifrar | Nginx con TLS delante del servidor |

### Deuda técnica

- **`server.js` monolítico (~950 líneas):** Todo en un archivo. En producción se separaría en `routes/`, `controllers/`, `services/`, `middleware/`.
- **Sin validación de esquema:** Los cuerpos de las peticiones se usan sin validar tipos ni longitudes máximas. En producción: `zod` o `joi`.
- **Logs básicos:** Solo se registran acciones de negocio. Sin logs de errores HTTP ni de rendimiento. En producción: `winston` o `pino`.
- **Sin tests:** No hay tests unitarios ni de integración. El sistema se verificó manualmente.

---

## Guía rápida para un desarrollador nuevo

```bash
# 1. Clonar e instalar
npm install

# 2. Arrancar en desarrollo
npm run dev

# 3. Abrir en el navegador
http://localhost:3000

# Credenciales demo
Admin:     admin@empresa.com     / admin123
Proveedor: garcia@suministros.com / garcia123
```

**Para añadir un nuevo endpoint:**
1. En `server.js`, añadir `app.get/post/patch/delete('/api/...')` con el middleware de guardia adecuado.
2. Usar `readData('archivo.json')` para leer y `writeData('archivo.json', data)` para guardar.
3. Llamar a `registrarLog()` si la acción debe aparecer en el registro de actividad.
4. Llamar a `crearNotificacion()` si algún usuario debe recibir un aviso.
5. Llamar a `broadcast()` si los clientes conectados deben actualizar su UI en tiempo real.

**Para añadir una nueva página:**
1. Crear el `.html` en `public/admin/` o `public/proveedor/`.
2. Incluir `<script src="/js/ui.js"></script>`.
3. En `init()`, verificar sesión con `fetch('/api/auth/me')` y redirigir si no está autenticado.
4. Usar `escapeHtml()` al insertar cualquier dato de usuario en `innerHTML`.
