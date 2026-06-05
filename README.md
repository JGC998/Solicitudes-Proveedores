# RFQ Manager

Sistema de gestión de solicitudes de presupuesto (Request for Quotation) entre una empresa compradora y sus proveedores. Permite crear solicitudes de precios, recibir y comparar cotizaciones, adjudicar pedidos y generar órdenes de compra, con notificaciones por email en tiempo real.

> **Prototipo de demostración.** Los datos se almacenan en archivos JSON que representan las futuras tablas de la base de datos relacional. Cada JSON = una tabla.

---

## Stack tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| Runtime | Node.js | v22 |
| Servidor HTTP | Express | 4.18 |
| Sesiones | express-session | 1.17 |
| Contraseñas | bcryptjs | 3.x |
| Variables de entorno | dotenv | 17.x |
| Subida de archivos | multer | 2.x |
| Emails | nodemailer | 8.x |
| Tiempo real | SSE (Server-Sent Events) | nativo |
| Gráficas | Chart.js | 4.4 (CDN) |
| Frontend | HTML + CSS + JavaScript vanilla | — |
| Dev | nodemon | 3.0 |

---

## Requisitos previos

- **Node.js** ≥ 18 (probado con v22)
- **npm** ≥ 9
- Sin base de datos externa — los datos viven en `data/*.json`
- Cuenta Gmail con verificación en dos pasos (solo si quieres emails reales)

---

## Instalación desde cero

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd rfq-manager

# 2. Instalar dependencias
npm install

# 3. Configurar el entorno
cp .env.example .env
# Edita .env con tu editor y rellena los valores (ver sección Variables de entorno)

# 4. Arrancar en desarrollo (reinicio automático al guardar)
npm run dev

# 5. O arrancar en modo producción
npm start
```

La aplicación queda disponible en **http://localhost:3000** (o la IP/puerto configurados).

Al arrancar por primera vez, el servidor migra automáticamente cualquier contraseña en texto plano a hash bcrypt — no hace falta hacer nada manual.

---

## Variables de entorno

Copia `.env.example` como `.env` y rellena los valores. El archivo `.env` está en `.gitignore` y nunca debe subirse al repositorio.

| Variable | Descripción | Requerida |
|---|---|---|
| `SESSION_SECRET` | Secreto para firmar cookies de sesión. Usa una cadena larga y aleatoria en producción. | No (tiene valor por defecto inseguro) |
| `APP_URL` | URL base del servidor visible desde la red. Se usa en los links de los emails. | No (por defecto `http://localhost:3000`) |
| `SMTP_HOST` | Servidor SMTP del proveedor de email | No |
| `SMTP_PORT` | Puerto SMTP (587 para TLS, 465 para SSL) | No |
| `SMTP_USER` | Email de la cuenta desde la que se envían los correos | No |
| `SMTP_PASS` | Contraseña de aplicación Gmail (o contraseña SMTP del proveedor) | No* |

> *Si `SMTP_PASS` está vacío, el sistema usa **Ethereal Email** (modo prueba): los emails no se envían de verdad, pero puedes verlos en https://ethereal.email/messages. Las credenciales de Ethereal se muestran en la consola al arrancar.

### Cómo obtener la Contraseña de Aplicación de Gmail

1. Ve a [myaccount.google.com/security](https://myaccount.google.com/security)
2. Activa **Verificación en dos pasos** si no la tienes
3. Busca **Contraseñas de aplicación**
4. Crea una nueva → tipo "Correo" → "Otro" → nombre "RFQ Manager"
5. Copia los 16 caracteres que aparecen y pégalos en `SMTP_PASS` del `.env`

### Encontrar tu IP local para APP_URL

```bash
node -e "const os=require('os');console.log(Object.values(os.networkInterfaces()).flat().find(n=>n.family==='IPv4'&&!n.internal)?.address)"
```

---

## Credenciales de demo

> Las contraseñas de los usuarios demo están en `data/users.json` ya hasheadas con bcrypt. Para cambiar el email del admin, edita directamente ese archivo.

| Rol | Email de login | Contraseña |
|---|---|---|
| Administrador | *(ver users.json → id:1 → email)* | admin123 |
| Proveedor 1 | garcia@suministros.com | garcia123 |
| Proveedor 2 | martinez@dist.com | martinez123 |
| Proveedor 3 | lopez@componentes.com | lopez123 |
| Proveedor 4 | fernandez@industrial.com | fernandez123 |

---

## Estructura del proyecto

```
rfq-manager/
│
├── server.js               # Backend completo (~1000 líneas): rutas, lógica, I/O
├── package.json
├── .env                    # Variables de entorno (NO subir al repo, está en .gitignore)
├── .env.example            # Plantilla de configuración con instrucciones
│
├── data/                   # "Base de datos" — un JSON por tabla
│   ├── users.json          # Usuarios (admins y proveedores)
│   ├── solicitudes.json    # Solicitudes de presupuesto (RFQs)
│   ├── cotizaciones.json   # Cotizaciones enviadas por proveedores
│   ├── productos.json      # Catálogo de productos
│   ├── valoraciones.json   # Valoraciones del admin a proveedores (1-5 ★)
│   ├── notificaciones.json # Notificaciones por usuario (bandeja interna)
│   └── logs.json           # Auditoría de acciones (últimas 500)
│
└── public/                 # Frontend estático servido por Express
    ├── login.html          # Acceso (ambos roles)
    ├── registro.html       # Alta de proveedor (pendiente de aprobación)
    ├── perfil.html         # Cambio de contraseña (ambos roles)
    ├── css/styles.css      # Hoja de estilos completa
    ├── js/ui.js            # Utilidades compartidas: escapeHtml, SSE, notificaciones, búsqueda
    │
    ├── admin/              # Panel del administrador
    │   ├── dashboard.html      # KPIs + gráficas + alertas de vencimiento
    │   ├── solicitudes.html    # Listado con filtros, paginación y colores por estado
    │   ├── nueva-solicitud.html# Formulario de creación de RFQ
    │   ├── detalle.html        # Comparativa de precios + adjudicación
    │   ├── orden-compra.html   # Documento imprimible de la OC
    │   ├── analisis.html       # KPIs avanzados + gráficas + ranking de proveedores
    │   ├── productos.html      # CRUD del catálogo + importación CSV
    │   ├── proveedores.html    # CRUD + aprobación de proveedores
    │   ├── notificaciones.html # Bandeja de notificaciones
    │   └── logs.html           # Registro de actividad
    │
    └── proveedor/          # Panel del proveedor
        ├── dashboard.html      # Solicitudes activas + KPIs propios
        ├── cotizar.html        # Formulario de precios por producto
        ├── historial.html      # Cotizaciones enviadas + estadísticas (tasa de éxito)
        └── notificaciones.html # Bandeja de notificaciones
```

---

## Scripts disponibles

```bash
npm start      # node server.js — arranque estable
npm run dev    # nodemon server.js — desarrollo con recarga automática al guardar
```

---

## API — Endpoints

### Autenticación

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `POST` | `/api/auth/login` | — | Iniciar sesión |
| `POST` | `/api/auth/logout` | — | Cerrar sesión |
| `GET` | `/api/auth/me` | ✅ | Datos del usuario de la sesión actual |
| `POST` | `/api/auth/registro` | — | Solicitar alta como proveedor (queda pendiente de aprobación) |
| `PATCH` | `/api/auth/password` | ✅ | Cambiar contraseña propia |

### Productos

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/productos` | ✅ | Listar catálogo completo |
| `POST` | `/api/productos` | 🔒 Admin | Crear producto |
| `PATCH` | `/api/productos/:id` | 🔒 Admin | Editar producto |
| `DELETE` | `/api/productos/:id` | 🔒 Admin | Eliminar producto |
| `POST` | `/api/productos/importar` | 🔒 Admin | Importar productos desde CSV (multipart/form-data, campo `csv`) |

### Solicitudes de presupuesto

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/solicitudes` | ✅ | Listar (proveedores solo ven activas/cerradas de su ámbito) |
| `GET` | `/api/solicitudes/:id` | ✅ | Detalle + cotizaciones (proveedores solo ven la suya) |
| `POST` | `/api/solicitudes` | 🔒 Admin | Crear solicitud → notificación + email a proveedores |
| `PATCH` | `/api/solicitudes/:id/estado` | 🔒 Admin | Cambiar estado: `activa` / `cerrada` / `borrador` |
| `DELETE` | `/api/solicitudes/:id` | 🔒 Admin | Eliminar solicitud y sus cotizaciones |
| `POST` | `/api/solicitudes/:id/duplicar` | 🔒 Admin | Duplicar con nueva fecha (+14 días) |
| `POST` | `/api/solicitudes/:id/orden-compra` | 🔒 Admin | Generar número de OC (`OC-YYYY-XXXX`) |
| `PATCH` | `/api/solicitudes/:id/recibir` | 🔒 Admin | Marcar pedido como recibido |

### Cotizaciones

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/cotizaciones` | ✅ | Listar (proveedores solo ven las suyas) |
| `POST` | `/api/cotizaciones` | 🔒 Proveedor | Enviar o actualizar cotización → email al admin |
| `PATCH` | `/api/cotizaciones/:id/adjudicar` | 🔒 Admin | Adjudicar → email a ganador y perdedores |
| `PATCH` | `/api/cotizaciones/:id/desadjudicar` | 🔒 Admin | Retirar adjudicación |

### Proveedores

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/proveedores` | 🔒 Admin | Listar (sin contraseñas) |
| `POST` | `/api/proveedores` | 🔒 Admin | Crear proveedor manualmente |
| `PATCH` | `/api/proveedores/:id` | 🔒 Admin | Editar datos o contraseña (se hashea automáticamente) |
| `DELETE` | `/api/proveedores/:id` | 🔒 Admin | Eliminar proveedor |
| `PATCH` | `/api/proveedores/:id/aprobar` | 🔒 Admin | Aprobar registro pendiente → email de bienvenida interno |

### Análisis y KPIs

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/analisis/kpis` | 🔒 Admin | KPIs globales, ranking, histórico de precios, ahorro potencial |
| `GET` | `/api/analisis/solicitud/:id` | 🔒 Admin | Comparativa detallada por producto y proveedor |

### Utilidades

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/buscar?q=` | 🔒 Admin | Búsqueda global (Ctrl+K): solicitudes, proveedores, productos |
| `GET` | `/api/logs` | 🔒 Admin | Últimos 200 eventos de actividad |
| `GET` | `/api/notificaciones` | ✅ | Notificaciones del usuario actual (máx. 30) |
| `POST` | `/api/notificaciones/leer` | ✅ | Marcar todas como leídas |
| `POST` | `/api/valoraciones` | 🔒 Admin | Crear o actualizar valoración a un proveedor |
| `GET` | `/api/valoraciones` | 🔒 Admin | Listar valoraciones con media calculada |
| `GET` | `/api/eventos` | ✅ | Conexión SSE para actualizaciones en tiempo real |

**Leyenda:** ✅ Sesión activa · 🔒 Admin Solo administradores · 🔒 Proveedor Solo proveedores

---

## Importar productos desde CSV

El administrador puede importar productos en masa desde Catálogo → botón **⬆ Importar CSV**.

**Formato esperado** (separador `;` o `,`):

```csv
nombre;unidad;categoria;descripcion
Papel A4 80g;resma;Oficina;500 hojas blancas
Tornillos M8x30;caja/100u;Componentes;Acero galvanizado
Ratón inalámbrico;unidad;Informática;
```

- Columnas **obligatorias**: `nombre`, `unidad`
- Columnas **opcionales**: `categoria`, `descripcion`
- Los productos con el mismo nombre que uno existente se omiten (no duplica)
- El sistema acepta BOM UTF-8 (exportaciones de Excel en Windows)

---

## Notificaciones por email

El sistema envía emails automáticamente en tres momentos:

| Evento | Destinatario | Contenido |
|---|---|---|
| Nueva solicitud creada | Todos los proveedores invitados | Nombre de la solicitud, fecha límite y botón directo a cotizar |
| Proveedor envía cotización | Administrador | Quién cotizó, para qué solicitud y botón a ver comparativa |
| Pedido adjudicado | Todos los que cotizaron | Ganador: enhorabuena + link al historial · Perdedores: agradecimiento + link a activas |

Los links de los emails usan la URL configurada en `APP_URL`.

**Campo `email_notificaciones` en `users.json`:** Si un proveedor tiene este campo, los emails se envían ahí en lugar de a `email`. Útil para pruebas en las que todos los proveedores demo redirigen a una única bandeja de entrada real.

---

## Modelo de datos

Cada JSON es una tabla. Relaciones principales:

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

### Esquema de usuarios (`users.json`)
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
- `email`: email de login y contacto principal
- `email_notificaciones`: si existe, los emails van aquí (útil para pruebas)
- `password`: siempre hasheado con bcrypt — nunca en texto plano
- `pendiente: true`: cuenta registrada pero no aprobada por el admin

---

## Seguridad implementada

- Contraseñas hasheadas con **bcrypt** (10 rondas de salt)
- Migración automática al arrancar: las contraseñas en texto plano se hashean sin intervención manual
- Control de acceso por rol en **todos** los endpoints del servidor
- Los proveedores **nunca ven** las cotizaciones de la competencia (filtrado en el servidor)
- Datos de usuario escapados con `escapeHtml()` en todas las páginas (prevención XSS)
- Validación de enum de estados en la API (`activa` / `cerrada` / `borrador`)
- Emails enviados sobre TLS (puerto 587)
- `.env` excluido del repositorio por `.gitignore`

---

## Limitaciones del prototipo

Estas funciones **no están implementadas** y serían necesarias en producción:

| Limitación | Solución recomendada |
|---|---|
| Sesiones se pierden al reiniciar (almacenadas en memoria) | Redis o `connect-pg-simple` con PostgreSQL |
| Sin rate limiting en el endpoint de login | `express-rate-limit` |
| Sin HTTPS | Nginx con TLS delante del servidor Node |
| Escrituras JSON sin transacciones (riesgo de race condition bajo carga) | Migrar a SQLite o PostgreSQL |
| Sin validación de esquema estricta en el body de las peticiones | `zod` o `joi` |
| Sin tests automatizados | `jest` + `supertest` para los endpoints |
