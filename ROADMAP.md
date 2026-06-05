# ROADMAP — RFQ Manager

> Última actualización: 2026-06-05  
> Generado desde `ideas.txt`

---

## 🎯 Visión general

RFQ Manager ya está integrado con el sistema de gestión de la empresa mediante una capa adaptadora: sincroniza el catálogo de artículos desde la API corporativa y envía los pedidos adjudicados de vuelta. El siguiente paso es **preparar el sistema para producción real**: base de datos robusta, HTTPS y protección ante ataques. Las mejoras de funcionalidad quedan para después de esa estabilización.

---

## 📋 Backlog completo

| ID | Tarea | Tipo | Complejidad | Estado | Depende de |
|----|-------|------|-------------|--------|------------|
| T-01 | Crear capa adaptadora para API externa (patrón adapter) | Backend | Media | ✅ Hecho | — |
| T-02 | Sincronizar catálogo de productos desde API externa | Backend | Media | ✅ Hecho | T-01 |
| T-03 | Enviar pedidos adjudicados a API externa | Backend | Media | ✅ Hecho | T-01 |
| T-04 | Panel admin: sincronización manual + estado de integración | Frontend | Pequeña | ✅ Hecho | T-02, T-03 |
| T-05 | Migrar almacenamiento de JSON a SQLite | Backend + BD | Grande | ⏳ Pendiente | — |
| T-06 | HTTPS + Nginx como proxy inverso | Infra | Media | ⏳ Pendiente | — |
| T-07 | Rate limiting en endpoints críticos | Backend | Pequeña | ⏳ Pendiente | — |
| T-08 | Tests automatizados de endpoints principales | Backend | Grande | ⏳ Pendiente | — |
| T-09 | Archivos adjuntos en solicitudes (PDFs, especificaciones) | Backend + Frontend | Media | ⏳ Pendiente | — |
| T-10 | Hilo de mensajes entre admin y proveedor por solicitud | Backend + Frontend | Grande | ⏳ Pendiente | — |
| T-11 | Exportar análisis completo a Excel (.xlsx) | Backend | Media | ⏳ Pendiente | — |
| T-12 | Multi-admin con permisos diferenciados | Backend + Frontend | Grande | ⏳ Pendiente | T-05 |
| T-13 | Filtro por rango de fechas en análisis & KPIs | Frontend | Pequeña | ⏳ Pendiente | — |
| T-14 | Plantillas de solicitud reutilizables | Backend + Frontend | Pequeña | ⏳ Pendiente | — |

---

## 🗺️ Fases propuestas

### ~~Fase 1 — Integración con la API externa~~ ✅ Completada
> Capa adaptadora construida con el esquema real de tablas de la empresa (ARTICULO, FAMILIA, SUBFAMILIA, MARCA). El mapeo de campos está documentado en `migracionAPI.md`.

- [x] **T-01** — Funciones `getProductosExternos()` y `pushPedidoExterno()` en `server.js`
- [x] **T-02** — Sincronización al arrancar + endpoint `POST /api/admin/sync-productos`
- [x] **T-03** — Envío automático al generar OC + fallback `pendiente_envio_api` + reintento
- [x] **T-04** — Panel `/admin/integracion.html`: estado, sincronización y pedidos pendientes

---

### Fase 2 — Preparación para producción
> Hacer el sistema seguro y estable antes de usarlo con datos reales. Estimación: **1 semana**.

- [ ] **T-07** — Rate limiting en endpoints críticos ⚡ _más rápido, hacer primero_  
  _`npm install express-rate-limit` y limitar `POST /api/auth/login` a ~10 intentos por minuto por IP. Sin esto el login es vulnerable a fuerza bruta. Esfuerzo: ~30 min._

- [ ] **T-06** — HTTPS y Nginx como proxy inverso  
  _Poner Nginx delante de Node: termina TLS (Let's Encrypt), sirve `/public/` directamente y hace reverse proxy al puerto 3000. Sin HTTPS las sesiones no son seguras en red corporativa. Esfuerzo: ~3h._

- [ ] **T-05** — Migrar almacenamiento de JSON a SQLite  
  _Sustituir `readData/writeData` por `better-sqlite3` (síncrono, sin servidor). Cada JSON actual = una tabla. Elimina las race conditions y hace el sistema apto para carga real. Esfuerzo: ~2 días._

---

### Fase 3 — Mejoras de funcionalidad *(futuro)*
> Una vez la integración y producción estén resueltas. Estimación: según prioridad.

- [ ] **T-08** — Tests automatizados de endpoints  
  _`jest` + `supertest`. Imprescindible cuando el sistema maneje datos reales de la empresa._

- [ ] **T-09** — Archivos adjuntos en solicitudes  
  _PDFs/imágenes de especificaciones técnicas. `multer` ya está instalado; solo falta la ruta de descarga autenticada y la UI._

- [ ] **T-10** — Hilo de mensajes dentro de una solicitud  
  _Chat básico admin ↔ proveedor por solicitud. SSE ya está lista para notificar en tiempo real._

- [ ] **T-11** — Exportar análisis completo a Excel (.xlsx)  
  _`exceljs` + varias hojas: comparativa, ranking, histórico. Más completo que el CSV actual._

- [ ] **T-12** — Multi-admin con permisos diferenciados  
  _Varios admins, posible rol "solo lectura". Requiere T-05 primero._

---

## ⚡ Quick wins

Tareas pequeñas que se pueden intercalar en cualquier momento:

- [ ] **T-07** — Rate limiting en login (~30 min) ← **recomendado hacerlo ya**
- [ ] **T-13** — Filtro por rango de fechas en Análisis & KPIs (~2h)  
  _Dos inputs de fecha en `analisis.html` que filtren histórico y ranking por período._
- [ ] **T-14** — Plantillas de solicitud reutilizables (~2h)  
  _"Guardar como plantilla" en detalle + "Cargar plantilla" en nueva-solicitud._

---

## 🚧 Dependencias y bloqueos

- **T-12** (multi-admin) requiere **T-05** (SQLite): permisos granulares en JSON son frágiles.
- **T-08** (tests) es independiente pero se vuelve crítico antes de activar la API real en producción.
- **API externa:** la integración está lista en modo mock. Para activarla con datos reales solo hay que añadir `EXTERNAL_API_URL` y `EXTERNAL_API_KEY` al `.env` → ver `migracionAPI.md`.

---

## 💡 Ideas descartadas o pospuestas

- **WebSockets en lugar de SSE** — SSE cubre el caso actual. Solo aporta si se implementa T-10 (mensajes bidireccionales).
- **App móvil nativa** — Fuera de scope. La web ya es responsive.

---

## ✅ Completado

**Integración API externa (Fase 1 — junio 2026)**
- T-01 · T-02 · T-03 · T-04 — Adaptador completo con mapeo del esquema real (ARTICULO/FAMILIA/SUBFAMILIA/MARCA)
- Campo `codigo_articulo` (alfanumérico) preservado y enviado en pedidos a la empresa
- `unidades_por_caja` → formateado como unidad de medida (`"caja/5u"`, `"unidad"`)
- Documentación en `migracionAPI.md` con el esquema exacto de tablas

**Sistema base**
- Autenticación con sesiones, registro de proveedores con aprobación
- CRUD de solicitudes, productos, proveedores y cotizaciones
- Comparativa de precios con tabla verde/rojo y fila de totales
- Adjudicación, orden de compra y marcado de recepción
- Valoraciones de proveedores (1–5 estrellas)
- Análisis & KPIs: ranking, histórico de precios, ahorro potencial
- Importación de productos desde CSV
- Notificaciones en tiempo real (SSE) + bandeja interna
- Emails automáticos con links directos (Gmail / Ethereal)
- Alertas visuales de vencimiento inminente en el dashboard
- KPIs de rendimiento propio en el historial del proveedor
- Tabla de solicitudes con colores por estado y orden inteligente
- Búsqueda global (Ctrl+K), logs de actividad
- Contraseñas hasheadas con bcrypt + migración automática
- Prevención XSS con `escapeHtml()` en todos los templates
- Documentación completa: README, ARCHITECTURE, CODE-REVIEW, ROADMAP, migracionAPI.md, .env.example

---

*Para añadir nuevas ideas, escríbelas en `ideas.txt` y vuelve a ejecutar `/roadmap`.*
