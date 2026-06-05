# RFQ Manager

Sistema de gestión de solicitudes de presupuesto (Request for Quotation) entre una empresa compradora y sus proveedores. Permite crear solicitudes de precios, recibir y comparar cotizaciones, adjudicar pedidos y generar órdenes de compra.

> Prototipo de demostración. Los datos se almacenan en archivos JSON que representan las futuras tablas de la base de datos relacional.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js v22 |
| Servidor | Express 4.18 |
| Sesiones | express-session 1.17 |
| Contraseñas | bcryptjs (hash bcrypt, sin dependencias nativas) |
| Tiempo real | SSE (Server-Sent Events, nativo de HTTP) |
| Gráficas | Chart.js 4.4 (CDN) |
| Frontend | HTML + CSS + JavaScript vanilla |
| Dev | nodemon 3.0 |

---

## Requisitos previos

- **Node.js** ≥ 18 (probado con v22)
- **npm** ≥ 9
- Sin base de datos externa — los datos viven en `data/*.json`

---

## Instalación y puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Arrancar en desarrollo (reinicio automático al guardar)
npm run dev

# 3. O arrancar en modo producción
npm start
```

La aplicación queda disponible en **http://localhost:3000**

Al arrancar por primera vez, el servidor migra automáticamente cualquier contraseña en texto plano a hash bcrypt.

---

## Variables de entorno

| Variable | Descripción | Valor por defecto | Requerida |
|---|---|---|---|
| `SESSION_SECRET` | Secreto para firmar las cookies de sesión | `rfq-proto-secret-2025` | No (recomendada en producción) |

Para definirla en Linux/Mac:
```bash
SESSION_SECRET=mi-secreto-seguro npm start
```

No hay archivo `.env` — se pasa directamente como variable del entorno del sistema.

---

## Credenciales de demo

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | admin@empresa.com | admin123 |
| Proveedor 1 | garcia@suministros.com | garcia123 |
| Proveedor 2 | martinez@dist.com | martinez123 |
| Proveedor 3 | lopez@componentes.com | lopez123 |
| Proveedor 4 | fernandez@industrial.com | fernandez123 |

---

## Estructura del proyecto

```
Formulario Proveedores/
│
├── server.js               # Backend completo: rutas, lógica, I/O
├── package.json
│
├── data/                   # Datos persistentes (un JSON por tabla)
│   ├── users.json          # Usuarios: admins y proveedores
│   ├── solicitudes.json    # Solicitudes de presupuesto
│   ├── cotizaciones.json   # Cotizaciones de proveedores
│   ├── productos.json      # Catálogo de productos
│   ├── valoraciones.json   # Valoraciones del admin a proveedores
│   ├── notificaciones.json # Notificaciones por usuario
│   └── logs.json           # Registro de actividad (últimas 500)
│
└── public/                 # Frontend estático
    ├── login.html
    ├── registro.html
    ├── perfil.html
    ├── css/styles.css
    ├── js/ui.js            # Utilidades compartidas (escapeHtml, SSE, etc.)
    ├── admin/              # Panel administrador
    │   ├── dashboard.html
    │   ├── solicitudes.html
    │   ├── nueva-solicitud.html
    │   ├── detalle.html
    │   ├── orden-compra.html
    │   ├── analisis.html
    │   ├── productos.html
    │   ├── proveedores.html
    │   ├── notificaciones.html
    │   └── logs.html
    └── proveedor/          # Panel proveedor
        ├── dashboard.html
        ├── cotizar.html
        ├── historial.html
        └── notificaciones.html
```

---

## Scripts disponibles

```bash
npm start      # node server.js — producción
npm run dev    # nodemon server.js — desarrollo con recarga automática
```

---

## API — Endpoints

### Autenticación

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | — | Iniciar sesión |
| `POST` | `/api/auth/logout` | — | Cerrar sesión |
| `GET` | `/api/auth/me` | ✅ | Datos del usuario de la sesión actual |
| `POST` | `/api/auth/registro` | — | Solicitar alta como proveedor (queda pendiente) |
| `PATCH` | `/api/auth/password` | ✅ | Cambiar contraseña propia |

### Productos

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/productos` | ✅ | Listar catálogo completo |
| `POST` | `/api/productos` | 🔒 Admin | Crear producto |
| `PATCH` | `/api/productos/:id` | 🔒 Admin | Editar producto |
| `DELETE` | `/api/productos/:id` | 🔒 Admin | Eliminar producto |

### Solicitudes de presupuesto

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/solicitudes` | ✅ | Listar solicitudes (filtradas por rol) |
| `GET` | `/api/solicitudes/:id` | ✅ | Detalle de solicitud con cotizaciones |
| `POST` | `/api/solicitudes` | 🔒 Admin | Crear solicitud |
| `PATCH` | `/api/solicitudes/:id/estado` | 🔒 Admin | Cambiar estado (`activa` / `cerrada` / `borrador`) |
| `DELETE` | `/api/solicitudes/:id` | 🔒 Admin | Eliminar solicitud y sus cotizaciones |
| `POST` | `/api/solicitudes/:id/duplicar` | 🔒 Admin | Duplicar solicitud con nueva fecha |
| `POST` | `/api/solicitudes/:id/orden-compra` | 🔒 Admin | Generar número de orden de compra |
| `PATCH` | `/api/solicitudes/:id/recibir` | 🔒 Admin | Marcar pedido como recibido |

### Cotizaciones

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/cotizaciones` | ✅ | Listar cotizaciones (solo las propias si es proveedor) |
| `POST` | `/api/cotizaciones` | 🔒 Proveedor | Enviar o actualizar cotización |
| `PATCH` | `/api/cotizaciones/:id/adjudicar` | 🔒 Admin | Adjudicar pedido a este proveedor |
| `PATCH` | `/api/cotizaciones/:id/desadjudicar` | 🔒 Admin | Quitar adjudicación |

### Proveedores

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/proveedores` | 🔒 Admin | Listar proveedores (sin contraseñas) |
| `POST` | `/api/proveedores` | 🔒 Admin | Crear proveedor manualmente |
| `PATCH` | `/api/proveedores/:id` | 🔒 Admin | Editar datos o contraseña |
| `DELETE` | `/api/proveedores/:id` | 🔒 Admin | Eliminar proveedor |
| `PATCH` | `/api/proveedores/:id/aprobar` | 🔒 Admin | Aprobar registro pendiente |

### Análisis y KPIs

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/analisis/kpis` | 🔒 Admin | KPIs globales, ranking, histórico de precios |
| `GET` | `/api/analisis/solicitud/:id` | 🔒 Admin | Comparativa detallada de una solicitud |

### Utilidades

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/buscar?q=` | 🔒 Admin | Búsqueda global (solicitudes, proveedores, productos) |
| `GET` | `/api/logs` | 🔒 Admin | Últimos 200 eventos de actividad |
| `GET` | `/api/notificaciones` | ✅ | Notificaciones del usuario actual |
| `POST` | `/api/notificaciones/leer` | ✅ | Marcar todas las notificaciones como leídas |
| `POST` | `/api/valoraciones` | 🔒 Admin | Crear o actualizar valoración a un proveedor |
| `GET` | `/api/valoraciones` | 🔒 Admin | Listar valoraciones con media calculada |
| `GET` | `/api/eventos` | ✅ | Conexión SSE para actualizaciones en tiempo real |

**Leyenda:** ✅ Requiere sesión activa · 🔒 Admin Requiere rol admin · 🔒 Proveedor Requiere rol proveedor

---

## Modelo de datos

Cada archivo JSON es una tabla. Sus relaciones principales:

```
users ──────────────────┬── cotizaciones.proveedor_id
                        └── notificaciones.user_id

solicitudes ────────────┬── cotizaciones.solicitud_id
    └── .productos[]    │
         └── producto_id┼── productos.id
                        └── valoraciones.solicitud_id

cotizaciones ───────────── valoraciones.proveedor_id / solicitud_id
    └── .lineas[]
         └── producto_id ── productos.id
```

---

## Funcionalidades principales

### Panel administrador
- Dashboard con KPIs y gráficas en tiempo real
- CRUD de solicitudes de presupuesto con fecha límite y lista de invitados
- Tabla comparativa de precios por producto (mejor/peor en verde/rojo)
- Adjudicación de pedido y generación de orden de compra (PDF imprimible)
- Marcado de recepción de pedido y valoración del proveedor (1-5 estrellas)
- CRUD de catálogo de productos con categorías
- Gestión de proveedores: alta manual, aprobación de registros, activar/desactivar
- Análisis avanzado: ranking de proveedores, ahorro potencial, evolución histórica de precios
- Búsqueda global (Ctrl+K) de solicitudes, proveedores y productos
- Registro de actividad del sistema

### Panel proveedor
- Vista de solicitudes activas asignadas
- Formulario de cotización por producto (precio + plazo)
- Historial de cotizaciones enviadas con resultado de adjudicación
- Notificaciones de nuevas solicitudes y resultados

---

## Seguridad implementada

- Contraseñas hasheadas con **bcrypt** (10 rondas)
- Control de acceso por rol en cada endpoint del servidor
- Los proveedores **no pueden ver** las cotizaciones de la competencia
- Datos de usuario escapados con `escapeHtml()` antes de insertar en el DOM (prevención XSS)
- Validación de valores de estado permitidos en la API

---

## Limitaciones del prototipo

Al ser una demo, estas funciones **no están implementadas** y serían necesarias en producción:

- Las sesiones se pierden al reiniciar el servidor (sin Redis ni BD de sesiones)
- Sin rate limiting en el endpoint de login
- Sin HTTPS (usar Nginx con TLS en producción)
- Sin validación de esquema estricta en los cuerpos de petición
- Sin tests automatizados
- Escrituras concurrentes en JSON pueden solaparse bajo carga real
