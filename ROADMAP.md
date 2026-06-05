# ROADMAP — RFQ Manager

> Última actualización: 2026-05-30  
> ✅ Todas las fases completadas (14/14 tareas).

---

## 🎯 Visión general

El sistema cubre el ciclo completo de compras: gestión autónoma del catálogo y proveedores, solicitudes con control de invitados, cotización y adjudicación, registro público de proveedores, y un panel de análisis con ranking, histórico de precios, filtros interactivos, exportación CSV/PDF, paginación, badges de urgencia y cambio de contraseña desde perfil.

---

## 📋 Backlog completo

| ID | Tarea | Tipo | Complejidad | Estado |
|----|-------|------|-------------|--------|
| T-01 | Dar de alta un producto al vuelo desde "Nueva solicitud" | Frontend + Backend | Pequeña | ✅ Hecho |
| T-02 | Aceptar/rechazar cotización y generar resumen de adjudicación | Backend + Frontend | Media | ✅ Hecho |
| T-03 | Panel admin: CRUD de proveedores (crear, editar, activar/desactivar) | Backend + Frontend | Media | ✅ Hecho |
| T-04 | Panel admin: CRUD de catálogo de productos | Backend + Frontend | Pequeña | ✅ Hecho |
| T-05 | Invitar proveedores específicos a una solicitud | Backend + Frontend | Media | ✅ Hecho |
| T-06 | Comparativa histórica de precios por producto entre solicitudes | Backend + Frontend | Media | ✅ Hecho |
| T-07 | Ranking de proveedores (precio medio, tasa de respuesta) | Backend + Frontend | Pequeña | ✅ Hecho |
| T-08 | Filtros en análisis: por proveedor y producto | Frontend | Media | ✅ Hecho |
| T-09 | Exportar tabla comparativa a CSV desde el navegador | Frontend | Pequeña | ✅ Hecho |
| T-10 | Exportar cotización a PDF (vista de impresión) | Frontend | Pequeña | ✅ Hecho |
| T-11 | Formulario público de registro de proveedor (requiere aprobación admin) | Backend + Frontend | Media | ✅ Hecho |
| T-12 | Cambio de contraseña desde el perfil | Backend + Frontend | Pequeña | ✅ Hecho |
| T-13 | Paginación en listados de solicitudes y cotizaciones | Frontend | Pequeña | ✅ Hecho |
| T-14 | Badge de alerta si la fecha límite de una solicitud es en ≤ 3 días | Frontend | Pequeña | ✅ Hecho |

---

## 🗺️ Fases

### ~~Fase 1 — Gestión autónoma de datos~~ ✅ Completada

- [x] **T-04** — Panel admin: CRUD de catálogo de productos  
- [x] **T-03** — Panel admin: CRUD de proveedores  
- [x] **T-01** — Dar de alta un producto al vuelo en "Nueva solicitud"  

### ~~Fase 2 — Ciclo completo: adjudicación y control de acceso~~ ✅ Completada

- [x] **T-02** — Aceptar/rechazar cotización y generar resumen de adjudicación  
- [x] **T-05** — Invitar proveedores específicos a una solicitud  
- [x] **T-11** — Formulario público de registro de proveedor  

### ~~Fase 3 — Análisis avanzado y exportaciones~~ ✅ Completada

- [x] **T-07** — Ranking de proveedores  
- [x] **T-06** — Comparativa histórica de precios  
- [x] **T-08** — Filtros en la página de análisis  
- [x] **T-09** — Exportar tabla comparativa a CSV  
- [x] **T-10** — Exportar cotización a PDF  

### ~~Fase 4 — UX y calidad~~ ✅ Completada

- [x] **T-14** — Badge de alerta para fechas próximas  
  _Badge 🔥 naranja si ≤ 3 días, ⚠ rojo si vencida o es hoy. Visible en listado admin y dashboard proveedor._

- [x] **T-12** — Cambio de contraseña desde el perfil  
  _Página `/perfil.html` con sidebar dinámico (admin/proveedor). Endpoint `PATCH /api/auth/password` con validación de contraseña actual. Enlace "⚙ Mi perfil" en todos los sidebars._

- [x] **T-13** — Paginación en listados  
  _Paginación cliente-side (8-10 items/página) en: solicitudes admin, dashboard proveedor (activas y cerradas), historial de cotizaciones proveedor._

---

## ⚡ Quick wins

- [x] **T-14** — Badge de alerta de fechas próximas
- [x] **T-09** — Exportar tabla comparativa a CSV
- [x] **T-10** — Exportar cotización a PDF con `@media print`
- [x] **T-13** — Paginación básica cliente-side
- [x] **T-12** — Cambio de contraseña

---

## 🚧 Dependencias resueltas

Todas las dependencias entre tareas han sido resueltas. La Fase 4 no tiene bloqueos.

---

## 💡 Ideas pospuestas

Ninguna idea del `ideas.txt` original se descartó. Todas están implementadas o en la Fase 4.

---

## ✅ Completado

- [x] Login con roles (admin / proveedor) + mensaje específico para cuentas pendientes
- [x] Panel admin: listado, filtrado y cambio de estado de solicitudes
- [x] Crear solicitudes de presupuesto con selección de productos y cantidad
- [x] Vista de detalle con tabla comparativa de precios (mejor/peor destacado)
- [x] Panel proveedor: ver solicitudes activas, cotizar, ver historial propio
- [x] Actualizar cotización ya enviada (re-envío)
- [x] Página de Análisis & KPIs con gráficas (Chart.js) y tabla de ahorro potencial
- [x] Datos de demo pre-cargados
- [x] **T-04** CRUD catálogo de productos (`/admin/productos.html`)
- [x] **T-03** CRUD proveedores con activar/desactivar (`/admin/proveedores.html`)
- [x] **T-01** Crear producto al vuelo desde nueva solicitud
- [x] **T-02** Adjudicación de pedido con 👑 ganador + quitar adjudicación
- [x] **T-05** Invitar proveedores específicos por solicitud (`proveedores_invitados`)
- [x] **T-11** Registro público `/registro.html` + aprobación por admin
- [x] **T-07** Ranking de proveedores (tasa respuesta, precio relativo, adjudicaciones)
- [x] **T-06** Gráfica histórica de evolución de precios por producto
- [x] **T-08** Filtros interactivos de proveedor y producto en análisis
- [x] **T-09** Exportar comparativa a CSV (con BOM para Excel)
- [x] **T-10** Imprimir / guardar PDF desde historial del proveedor (`@media print`)
- [x] **T-12** Cambio de contraseña desde `/perfil.html`, enlace ⚙ en todos los sidebars
- [x] **T-13** Paginación cliente-side (8-10 items/pág) en solicitudes, dashboard y historial
- [x] **T-14** Badge 🔥/⚠ de urgencia en fecha límite (≤ 3 días = naranja, vencida = rojo)

---

*Para añadir nuevas ideas, escríbelas en `ideas.txt` y vuelve a ejecutar `/roadmap`.*
