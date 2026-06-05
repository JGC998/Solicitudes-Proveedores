# Guía de migración a la API externa — RFQ Manager

> Documento para el desarrollador que conecte RFQ Manager con el sistema de gestión de la empresa.  
> Última actualización: 2026-06-05

---

## ¿Qué hace esta integración?

RFQ Manager se conecta con el sistema de gestión de la empresa en **dos direcciones**:

```
Sistema empresa ──── GET /productos ───► RFQ Manager
                                         (catálogo de artículos actualizado)

RFQ Manager ─────── POST /pedidos ────► Sistema empresa
                                         (pedido adjudicado con proveedor y precios)
```

Mientras no esté configurada la API, el sistema funciona en **modo demo** con JSON locales sin ningún cambio visible para el usuario.

---

## Esquema de base de datos de la empresa

El sistema de la empresa maneja estas tablas. La API debería devolver los datos ya con el JOIN hecho (nombres resueltos, no solo códigos).

### TABLA ARTICULO

| Campo | Tipo | Descripción |
|---|---|---|
| `codigo_articulo` | CHAR(10) | **Clave primaria** — código único alfanumérico del artículo |
| `nombre_articulo` | CHAR(50) | Nombre descriptivo del artículo |
| `codigo_barras` | CHAR(20) | Código de barras EAN/UPC |
| `codigo_familia` | CHAR(10) | FK → TABLA FAMILIA |
| `codigo_subfamilia` | CHAR(10) | FK → TABLA SUBFAMILIA |
| `codigo_marca` | CHAR(10) | FK → TABLA MARCA |
| `unidades_por_caja` | FLOAT | Cuántas unidades van en cada caja (para pedidos por caja) |

### TABLA FAMILIA

| Campo | Tipo | Descripción |
|---|---|---|
| `codigo_familia` | CHAR(10) | Clave primaria |
| `nombre_familia` | CHAR(50) | Nombre de la familia (se usa como **categoría** en RFQ Manager) |

### TABLA SUBFAMILIA

| Campo | Tipo | Descripción |
|---|---|---|
| `codigo_familia` | CHAR(10) | FK → TABLA FAMILIA |
| `codigo_subfamilia` | CHAR(10) | Clave compuesta |
| `nombre_subfamilia` | CHAR(50) | Nombre de la subfamilia (aparece en la descripción del producto) |

### TABLA MARCA

| Campo | Tipo | Descripción |
|---|---|---|
| `codigo_marca` | CHAR(10) | Clave primaria |
| `nombre_marca` | CHAR(50) | Nombre de la marca (aparece en la descripción del producto) |

---

## Cómo mapea RFQ Manager estos campos

| Campo API (empresa) | Campo RFQ Manager | Notas |
|---|---|---|
| `codigo_articulo` | `codigo_articulo` | Se guarda tal cual. **No** se usa como ID interno (ese es numérico secuencial) |
| `nombre_articulo` | `nombre` | Nombre principal del producto en el catálogo |
| `nombre_marca` + `nombre_subfamilia` | `descripcion` | Se concatenan: `"HP · Papel"` |
| `nombre_familia` | `categoria` | Agrupa los productos en el catálogo |
| `unidades_por_caja` | `unidad` | `1` → `"unidad"` · `5.0` → `"caja/5u"` · `100` → `"caja/100u"` |
| `codigo_barras` | `codigo_barras` | Se guarda para incluirlo en los pedidos enviados |

> **Nota sobre IDs:** `codigo_articulo` es alfanumérico (ej: `"ART-001"`). RFQ Manager necesita IDs numéricos para su lógica interna de cotizaciones, por eso asigna un `id` secuencial propio (1, 2, 3…) y guarda el código original en `codigo_articulo`. Al enviar un pedido a la empresa, se usa `codigo_articulo`, no el `id` interno.

---

## Respuesta JSON esperada de la API de productos

La API debe devolver los artículos con el JOIN ya hecho (nombres resueltos). RFQ Manager acepta tanto `snake_case` como `camelCase`:

```json
[
  {
    "codigo_articulo":  "ART-001",
    "nombre_articulo":  "Papel A4 80g",
    "codigo_barras":    "8412345678901",
    "nombre_familia":   "Oficina",
    "nombre_subfamilia":"Papel",
    "nombre_marca":     "HP",
    "unidades_por_caja": 5.0
  },
  {
    "codigo_articulo":  "ART-002",
    "nombre_articulo":  "Tornillos M8x30",
    "codigo_barras":    "8412345678902",
    "nombre_familia":   "Componentes",
    "nombre_subfamilia":"Tornillería",
    "nombre_marca":     "Fischer",
    "unidades_por_caja": 100.0
  }
]
```

> Si la API devuelve los datos dentro de un objeto (ej: `{ "articulos": [...] }` o `{ "data": [...] }`), edita la línea en `server.js`:
> ```js
> const lista = Array.isArray(raw) ? raw : (raw.data ?? raw.articulos ?? raw.items ?? []);
> ```

---

## Payload que RFQ Manager envía al crear un pedido

Cuando el admin genera una Orden de Compra, RFQ Manager hace `POST {EXTERNAL_API_URL}/pedidos` con este JSON:

```json
{
  "referencia":   "OC-2026-0001",
  "fecha_pedido": "2026-06-10",
  "proveedor": {
    "id":     2,
    "nombre": "Suministros García SL",
    "email":  "garcia@suministros.com"
  },
  "lineas": [
    {
      "codigo_articulo":   "ART-001",
      "codigo_barras":     "8412345678901",
      "producto_nombre":   "Papel A4 80g",
      "cantidad":          100,
      "unidades_por_caja": "caja/5u",
      "precio_unitario":   4.50,
      "plazo_entrega":     7,
      "total_linea":       450.00
    }
  ],
  "total_pedido": 450.00
}
```

Si el sistema de la empresa espera campos con nombres distintos, edita el objeto `payload` en la función `pushPedidoExterno()` de `server.js`.

---

## Paso 1 — Configurar `.env`

```env
EXTERNAL_API_URL=https://api.empresa.com/v2
EXTERNAL_API_KEY=el-token-que-te-han-dado
```

Al reiniciar, el servidor sincronizará los productos automáticamente y mostrará:
```
🔗 API externa configurada — sincronizando productos...
✓ N productos sincronizados desde API externa
```

---

## Paso 2 — Verificar el mapeo de productos

1. Configura `EXTERNAL_API_URL` y reinicia el servidor
2. Abre **Admin → Integración API** y pulsa **"🔄 Sincronizar ahora"**
3. Ve a **Admin → Catálogo** y comprueba que los artículos aparecen correctamente:
   - El **nombre** es `nombre_articulo`
   - La **categoría** es `nombre_familia`
   - La **descripción** muestra marca y subfamilia
   - La **unidad** refleja bien las `unidades_por_caja`

Si algo no cuadra, añade temporalmente este log en `getProductosExternos()` justo después de `await res.json()`:
```js
console.log('Primer artículo de la API:', JSON.stringify(raw[0] ?? raw, null, 2));
```
Reinicia y sincroniza para ver la estructura real que devuelve la API.

---

## Paso 3 — Verificar el envío de pedidos

1. Crea una solicitud de prueba con artículos del catálogo sincronizado
2. Añade una cotización como proveedor
3. Adjudica y genera la Orden de Compra
4. Comprueba en el sistema de la empresa que llegó el pedido con:
   - El `codigo_articulo` correcto (no el ID interno de RFQ Manager)
   - Los campos `cantidad`, `precio_unitario` y `total_linea` correctos
5. Si hay error, aparecerá en **Admin → Integración API → Pedidos pendientes de envío**

---

## Ajustes que puede necesitar el nombre de los campos en la API

Si la API usa nombres de campo distintos a los del esquema de la BD, ajusta el mapeo en `getProductosExternos()` en `server.js`. Ejemplo de variantes comunes:

| La API devuelve | Cambiar en el mapeo |
|---|---|
| `"code"` en vez de `"codigo_articulo"` | `p.codigo_articulo ?? p.code` |
| `"description"` en vez de `"nombre_articulo"` | `p.nombre_articulo ?? p.description` |
| `"family"` en vez de `"nombre_familia"` | `p.nombre_familia ?? p.family` |
| `"brand"` en vez de `"nombre_marca"` | `p.nombre_marca ?? p.brand` |
| `"boxQty"` en vez de `"unidades_por_caja"` | `p.unidades_por_caja ?? p.boxQty` |

---

## Errores comunes y soluciones

| Error | Causa probable | Solución |
|---|---|---|
| `ECONNREFUSED` | URL no accesible | Verificar URL y posibles firewalls |
| `401 Unauthorized` | Token incorrecto o caducado | Actualizar `EXTERNAL_API_KEY` en `.env` |
| `403 Forbidden` | Token sin permisos | Pedir permisos de lectura de artículos y escritura de pedidos |
| `404 Not Found` | Ruta del endpoint incorrecta | Confirmar si es `/productos` o `/articulos` o `/items` |
| Productos sin categoría | `nombre_familia` no viene en la respuesta | Verificar que el JOIN está hecho en la API |
| `codigo_articulo` aparece como número en el pedido | Falta el campo en el catálogo sincronizado | Hacer una nueva sincronización tras configurar la URL |
| Pedido rechazado (400/422) | El payload no tiene el formato esperado | Compartir el error exacto con el equipo de la empresa y ajustar `pushPedidoExterno()` |

---

## Referencia rápida — Dónde está cada cosa en `server.js`

| Qué | Dónde |
|---|---|
| Mapeo de campos API → RFQ Manager | `getProductosExternos()` → bloque `── Normalización de campos ──` |
| Formato del payload de pedidos | `pushPedidoExterno()` → bloque `── Payload enviado a la API externa ──` |
| Cuándo se dispara el envío del pedido | `POST /api/solicitudes/:id/orden-compra` |
| Sincronización manual desde UI | `POST /api/admin/sync-productos` |
| Reintento de pedidos fallidos | `POST /api/admin/reintentar-envio/:id` |
| Panel de estado en el navegador | `/admin/integracion.html` |

---

*¿Dudas sobre la arquitectura general? Consulta `ARCHITECTURE.md`.*  
*¿Próximas mejoras planificadas? Consulta `ROADMAP.md`.*
