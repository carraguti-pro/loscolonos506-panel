# Diseño Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app
**Versión:** v0.1 — Propuesta de diseño\
**Fecha:** 2026-08-11\
**Estado:** Documento de diseño únicamente. Sin implementación aprobada.\
**Commit de producción al momento del diseño:** `9e89a47`

---

## 1. Contexto

La vista Staff "Servicios" mezcla actualmente cinco responsabilidades distintas en una sola pantalla:

| Bloque | Naturaleza |
|---|---|
| Tareas operativas y checklist | Operación del turno |
| Reporte check-out / preparación de ingreso | Flujo de fin de turno |
| Pago Operación | Flujo financiero — solo cuando aplica |
| Gastos y Reembolsos | Flujo financiero — cuando Staff pagó algo |
| Insumos (lista completa) | Inventario del departamento |

El bloque **Insumos** crea ruido visual y responsabilidades incorrectas: Staff puede ver el stock completo y actualizar cantidades directamente, sin registro de quién lo hizo, cuándo, ni por qué. Esta mezcla sobrecarga la pantalla operativa del Staff y coloca en manos del Staff una acción que corresponde al control Admin.

La dirección estratégica aprobada es:

> **Staff = opera, reporta, solicita.**\
> **Admin = controla, aprueba, compra, actualiza inventario, mantiene historia.**

---

## 2. Diagnóstico del bloque Insumos actual

### 2.1 Implementación actual

La implementación actual se basa en la tabla de Supabase `supply_alerts` y reside enteramente dentro de la vista Staff Servicios.

**Ubicación en el código:**

| Elemento | Localización |
|---|---|
| Card UI | `index.html` líneas 1460–1466 — card "📦 Insumos" en vista Servicios |
| Modal alta | `id="m-insumo"` — líneas 2518–2529 |
| Modal actualizar | `id="m-reponer"` — líneas 2530–2538 |
| Variables globales | `SV_INS=[]` / `REPONER_CTX=null` — línea 2636 |
| Carga de datos | `loadServicios()` — línea 6898 |

**Funciones existentes:**

| Función | Líneas | Rol |
|---|---|---|
| `saveInsumo()` | 7549–7555 | INSERT nuevo ítem en `supply_alerts` |
| `openReponer(idx)` | 7556–7566 | Abre modal "Actualizar Stock" |
| `saveReponer()` | 7567–7577 | PATCH de `current_stock` / `min_stock` |
| `insCard(i, idx)` | 7578–7606 | Renderiza card de cada ítem |

### 2.2 Campos actuales en `supply_alerts`

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | UUID | Identificador del registro |
| `item` | text | Nombre del ítem |
| `current_stock` | number | Stock actual |
| `min_stock` | number | Stock mínimo de alerta |
| `unit` | text | Unidad de medida |

### 2.3 Lo que el bloque actual no soporta

- Solicitudes de reposición desde Staff hacia Admin.
- Entradas de compra con boleta o comprobante.
- Historial de movimientos de stock — `saveReponer()` sobreescribe directamente sin registro.
- Vínculo entre gasto operativo y entrada de inventario.
- Categorías de ítem (limpieza, baño, cocina, ropa blanca, losa, menaje, equipamiento).
- Fotos, recibos ni comprobantes.
- Registro de quién hizo qué cambio y cuándo.
- Bajas por daño, pérdida o desgaste.
- Equipamiento menor o repuestos.

### 2.4 Riesgo técnico conocido

`openReponer(idx)` usa el **índice del array `SV_INS`** como referencia del ítem activo, no el `id` del registro. Si la carga de `supply_alerts` devuelve ítems en un orden diferente entre dos renders, el contexto `REPONER_CTX` puede apuntar al ítem incorrecto. Es un bug latente que no debe ser la base de un módulo expandido.

---

## 3. Decisión estratégica

El bloque actual de Insumos **no será evolucionado como solución principal**.

Razones:
1. El modelo de datos es insuficiente para las necesidades del negocio.
2. La arquitectura de contexto por índice de array es frágil.
3. Mezclar inventario Admin con la pantalla operativa del Staff es un error de diseño, no un detalle a corregir.
4. Parchar el bloque actual acarrea deuda técnica sin resolver el problema de fondo.

La solución correcta es diseñar un **módulo independiente desde cero**, con su propio modelo de datos, sus propias funciones, y su propia sección en el panel Admin.

El bloque Insumos actual permanece como **legacy temporal** sin modificaciones hasta que el módulo de reemplazo esté en producción y validado en operación real.

---

## 4. Estructura propuesta para la página Staff

La vista Staff Servicios debería reorganizarse con este orden y visibilidad:

```
┌─────────────────────────────────────────────────────────────┐
│  Checklist del turno                                        │  ← Siempre visible
├─────────────────────────────────────────────────────────────┤
│  Reporte Check-out / Preparación de ingreso                 │  ← Siempre disponible
├─────────────────────────────────────────────────────────────┤
│  Pago Operación                                             │  ← Solo si hay reporte
│                                                             │    enviado y activo
├─────────────────────────────────────────────────────────────┤
│  Gastos y Reembolsos                                        │  ← Solo si Staff pagó
│                                                             │    algo en el turno
├─────────────────────────────────────────────────────────────┤
│  Solicitar faltante / reposición                            │  ← Reemplaza Insumos
└─────────────────────────────────────────────────────────────┘
```

La lista completa de inventario desaparece de la vista Staff. La única acción relacionada con inventario que el Staff puede tomar es reportar una necesidad.

---

## 5. Reemplazo del bloque Insumos en Staff

### 5.1 Nuevo bloque propuesto: "Solicitar faltante / reposición"

```
┌──────────────────────────────────────────┐
│  📦 Faltantes y reposiciones              │
│  ──────────────────────────────────────  │
│  [+ Reportar faltante o reposición]      │
│                                          │
│  Solicitudes del turno:                  │
│  • Jabón líquido — falta stock            │
│  • Confort — consumido completamente      │
└──────────────────────────────────────────┘
```

### 5.2 Modal "Reportar faltante"

| Campo | Tipo | Obligatorio |
|---|---|---|
| Ítem | Select del catálogo (o texto libre si no está en lista) | Sí |
| Motivo | Select: stock bajo / faltante completo / dañado / pérdida / reposición necesaria | Sí |
| Comentario | Texto libre | No |
| Foto | Upload de imagen | No (futuro) |

### 5.3 Lo que Staff puede hacer

- Reportar una necesidad de reposición.
- Ver sus propias solicitudes del turno actual.
- Ver si una solicitud fue aprobada o resuelta (estado simple).

### 5.4 Lo que Staff no puede hacer

- Ver el stock actual de todos los ítems.
- Actualizar stock directamente.
- Ver historial de movimientos.
- Ver precios de compra o montos de gastos.
- Aprobar movimientos de inventario.
- Crear entradas de stock.

---

## 6. Módulo Admin: "Inventario y Reposición Operacional"

El módulo Admin de Inventario es **exclusivo Admin**. Staff no accede a la vista completa de inventario; Staff solo accede a un formulario separado para reportar faltantes o solicitar reposición.

### 6.1 Secciones del módulo

**Alertas de stock bajo**\
Ítems donde `current_stock ≤ min_stock`. Acción directa de ingreso de stock desde la alerta.

**Solicitudes Staff pendientes**\
Solicitudes en estado pendiente. Admin puede: aprobar (compra necesaria), marcar como comprada y resuelta, o rechazar con nota.

**Catálogo de inventario**\
Vista completa de todos los ítems por categoría. Admin puede agregar ítems, editar mínimos, definir unidades, dar de baja ítems.

**Compras / Boletas**\
Registro de compras realizadas. Cada compra puede vincularse a ítems del catálogo (genera entradas de stock) y, cuando corresponde, a un gasto operativo existente (vínculo gasto + stock, sección 9).

**Entradas de stock**\
Registro de ingresos de mercadería: por compra, por reposición del propietario o por regularización inicial.

**Bajas por daño, pérdida o desgaste**\
Movimientos de salida con motivo documentado. Trazables con quién registró y cuándo.

**Historial de movimientos**\
Vista cronológica de todos los movimientos del inventario: entradas, salidas, bajas, ajustes. Con actor, timestamp, y referencia de origen cuando aplica.

### 6.2 Vista conceptual del módulo Admin

```
┌─── Inventario y Reposición Operacional ───────────────────────────────────┐
│                                                                            │
│  [⚠️ Stock bajo]  [📬 Solicitudes Staff]  [📦 Catálogo]                    │
│  [🧾 Compras]     [📊 Movimientos]                                         │
│                                                                            │
├──── ⚠️ Alertas de stock bajo ──────────────────────────────────────────────┤
│  Jabón de manos  — 1 unidad  (mínimo: 3)   [📥 Ingresar stock]            │
│  Bolsas baño     — 0 unidades (mínimo: 5)  [📥 Ingresar stock]            │
│                                                                            │
├──── 📬 Solicitudes Staff pendientes ───────────────────────────────────────┤
│  Francisca Cabañas · 2026-08-11 · 14:32                                   │
│  Quix lavalozas — consumido completamente                                  │
│  [✅ Aprobar]  [🛒 Marcar comprada]  [❌ Rechazar]                          │
│                                                                            │
├──── 📦 Catálogo de inventario ─────────────────────────────────────────────┤
│  Categoría       │ Ítem          │ Stock │ Mín │ Unidad  │ Acciones       │
│  Limpieza        │ Jabón líquido │  1    │  3  │ litros  │ [+] [-] [✏️]   │
│  Baño            │ Confort       │  0    │  2  │ unidad  │ [+] [-] [✏️]   │
│  Cocina          │ Quix          │  2    │  2  │ unidad  │ [+] [-] [✏️]   │
│                                                                            │
├──── 🧾 Compras / Boletas ──────────────────────────────────────────────────┤
│  [+ Registrar compra]                                                      │
│  2026-08-09 │ Jabón, Quix, CIF, Confort │ $15.800 │ Gasto #abc │ ✅ Stock │
│                                                                            │
├──── 📊 Historial de movimientos ───────────────────────────────────────────┤
│  2026-08-11 │ Jabón líquido │ compra   │ +3 │ Admin      │ Boleta agosto  │
│  2026-08-10 │ Confort       │ baja     │ -1 │ Francisca  │ consumo turno  │
│  2026-08-09 │ Quix          │ entrada  │ +2 │ Admin      │ regularización │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Separación entre Gastos y Inventario

Son dos módulos distintos con propósitos distintos. No son intercambiables:

| Dimensión | Gastos y Reembolsos | Inventario y Reposición |
|---|---|---|
| Pregunta que responde | ¿Quién pagó qué y a quién se le debe reembolso? | ¿Qué hay en el departamento, qué falta, qué se compró? |
| Actor principal | Staff (quien pagó) o Admin (gasto operativo) | Admin (quien compra y controla) |
| Tabla principal | `checkout_reports` (`payment_type = gasto_reembolso_operativo`) | `inventory_items` + `inventory_requests` + `inventory_movements` |
| Ejemplo | Staff compró CIF, pide reembolso de $3.200 | Entran 2 unidades de CIF al stock del departamento |
| Visibilidad Staff | Staff crea y ve sus propios gastos | Staff solo solicita reposición — no ve inventario |
| Visibilidad Admin | Admin aprueba y marca pagado | Admin controla stock, aprueba compras, actualiza |

**Regla fundamental:**

> El dinero no es el inventario. Una transacción financiera no es el mismo objeto que el estado físico del stock.

Que haya un gasto de $15.800 en insumos no actualiza el stock automáticamente. El Admin debe registrar explícitamente qué ítems entran al inventario, en qué cantidad, como acción separada — o vinculada si el flujo lo permite (sección 9).

---

## 8. Regla de negocio: doble registro (gasto + entrada de stock)

Algunas compras operativas deben registrarse dos veces: una vez como transacción económica, una vez como entrada física al inventario.

**Criterio de decisión:**

> ¿El ítem comprado queda físicamente en el departamento para uso futuro de los huéspedes o del servicio?
> - **Sí** → doble registro: gasto + entrada de stock.
> - **No** → solo gasto.

**Ejemplos:**

| Ítem | ¿Entra al inventario? | Razón |
|---|---|---|
| Jabón líquido para huéspedes | ✅ Sí | Queda en el departamento |
| Quix lavalozas | ✅ Sí | Queda en el departamento |
| Bolsas de basura | ✅ Sí | Quedan en el departamento |
| Papel higiénico / Confort | ✅ Sí | Queda en el departamento |
| CIF limpiador | ✅ Sí | Queda en el departamento |
| Limpia pisos desechables | ✅ Sí | Quedan en el departamento |
| Paños de cocina | ✅ Sí | Quedan en el departamento |
| Bebida del trabajador | ❌ No | Consumo personal inmediato, no queda |
| Pasaje de micro del Staff | ❌ No | Gasto de traslado, sin componente inventario |
| Desayuno del trabajador | ❌ No | Consumo inmediato, no queda |
| Masilla o material de obra | ❌ No | Insumo de trabajo, no es stock del departamento |

**Flujo propuesto para doble registro:**

```
Admin registra compra en módulo Inventario
  → selecciona ítems del catálogo que entran al stock
  → ingresa cantidades por ítem
  → opcionalmente vincula al gasto_reembolso_operativo existente en Gastos
  → sistema genera movimiento tipo "compra" en inventory_movements
  → stock de cada ítem se actualiza automáticamente
  → en el reporte de gastos, aparece nota "vinculado a entrada de stock"
```

Este flujo es **Admin-only**. Staff solo solicita; Admin decide qué entra, cuánto, y si corresponde vincular a un gasto.

---

## 9. Categorías propuestas

Las categorías del catálogo de inventario desde el primer día:

| Categoría | Contenido típico |
|---|---|
| Limpieza | CIF, limpia pisos, desengrasante, bolsas basura, paños, guantes |
| Baño | Jabón líquido, papel higiénico, Confort, shampoo, acondicionador |
| Cocina | Quix, lavalozas, esponjas, papel absorbente, film, aluminio |
| Ropa blanca | Sábanas, fundas, toallas, toallas de mano, bajada de cama |
| Losa y menaje | Platos, vasos, tazas, cubiertos, ollas, sartenes |
| Equipamiento menor | Escoba, trapeador, balde, plancha, secador de pelo |
| Mantención / repuestos | Ampolletas, pilas, elementos de reparación menor |
| Otros | Ítems que no encajan en categorías anteriores |

---

## 10. Modelo de datos conceptual

No se escribe SQL en esta etapa. El modelo se describe conceptualmente para orientar la Fase 2.

### `inventory_items`
Reemplaza o extiende `supply_alerts`. Campos esperados:
- `id` (UUID)
- `item` (nombre del ítem)
- `category` (categoría: limpieza, baño, cocina, ropa_blanca, losa_menaje, equipamiento, mantencion, otros)
- `current_stock` (stock actual)
- `min_stock` (stock mínimo de alerta)
- `unit` (unidad de medida)
- `notes` (notas internas del Admin)
- `created_by` (quién lo registró)
- `last_updated_at` (timestamp del último cambio)
- `active` (boolean — para dar de baja sin eliminar el registro)

**Decisión pendiente:** ¿migrar los registros de `supply_alerts` o iniciar tabla nueva y archivar la anterior?

### `inventory_requests`
Solicitudes creadas por Staff. Tabla intermedia entre Staff y Admin.
- `id` (UUID)
- `item_id` (referencia a `inventory_items`, nullable si el ítem no existe aún)
- `item_free_text` (nombre libre si no está en catálogo)
- `reason` (motivo: stock_bajo / faltante / dañado / perdido / reposicion)
- `comment` (texto libre opcional)
- `photo_url` (URL en Storage, opcional, futuro)
- `requested_by` (Staff que envió la solicitud)
- `requested_at` (timestamp)
- `status` (pendiente / aprobada / comprada / rechazada)
- `resolved_at` (timestamp)
- `resolved_by` (Admin que resolvió)
- `resolution_notes` (notas del Admin)

### `inventory_movements`
Historia completa de movimientos de stock. Solo Admin puede crear registros directamente.
- `id` (UUID)
- `item_id` (referencia a `inventory_items`)
- `movement_type` (entrada / salida / compra / baja / ajuste / regularizacion)
- `quantity` (cantidad — positivo para entradas, negativo para salidas)
- `reason` (texto: compra, consumo, daño, pérdida, desgaste, regularización)
- `linked_request_id` (referencia a `inventory_requests`, nullable)
- `linked_expense_id` (referencia a `checkout_reports.id` donde `payment_type=gasto_reembolso_operativo`, nullable)
- `created_by` (quién registró)
- `created_at` (timestamp)
- `notes` (notas adicionales)

### `inventory_purchases`
Registro de compras realizadas por el Admin o el propietario.
- `id` (UUID)
- `purchase_date` (fecha)
- `total_amount` (monto total de la compra, opcional)
- `receipt_url` (URL de boleta en Storage, opcional)
- `linked_expense_id` (referencia a `checkout_reports.id`, nullable — vínculo gasto + stock)
- `notes` (descripción libre)
- `created_by` (quien la registró)
- `created_at` (timestamp)
- Cada compra tiene líneas `inventory_movements` de tipo `compra` que actualizan el stock de cada ítem incluido.

---

## 11. Fases de implementación propuestas

Cada fase requiere aprobación explícita de Luis antes de iniciar.

| Fase | Nombre | Alcance | Riesgo |
|---|---|---|---|
| **1** | Aprobación de diseño | Este documento | Ninguno |
| **2** | Modelo de datos | Nuevas tablas en Supabase. RLS por tabla. Sin código. | Bajo — solo Supabase |
| **3** | Módulo Admin — Inventario | Catálogo, alertas, entradas de stock, historial. Sección Admin independiente. | Medio — nueva sección, no toca Staff |
| **4** | Flujo Staff — Solicitud | Bloque "Solicitar faltante" en Staff Servicios. Modal de solicitud. | Medio — toca Staff Servicios, solo agrega bloque |
| **5** | Movimientos y bajas | Bajas por daño, pérdida, desgaste. Historial completo trazable. | Bajo — solo Admin |
| **6** | Vínculo gasto + stock | Al registrar compra en Inventario, opción de vincular a gasto existente. Stock se actualiza. | Alto — toca Inventario y Gastos |
| **7** | Regularización agosto 2026 | Registrar compras de agosto como primer caso de regularización histórica. | Bajo — datos, no código |
| **8** | Retiro del bloque legacy Insumos | Ocultar o eliminar bloque actual en Staff. Solo después de que Fases 3 y 4 estén validadas en producción. | Bajo si todo lo anterior funciona |

---

## 12. Caso de regularización: agosto 2026

Este caso sirve como primer caso real para la Fase 7.

### 12.1 Trabajo de mantención — Orlando Barría

Trabajo realizado en dos baños del departamento 506-A:
- Raspado de hongos en cielo.
- Aplicación de yeso y masilla.
- Lijado.
- Pintura.

Los materiales de obra utilizados en la reparación — yeso, masilla, pintura, materiales de lijado y similares — son insumos de trabajo de mantención. **No entran al inventario del departamento.** Solo se registran como gasto operativo de mantención.

### 12.2 Insumos de limpieza — compra agosto 2026

Lista de insumos útiles (para uso continuo del departamento):
- Jabón líquido
- CIF limpiador
- Detergente
- Paños de cocina
- Papel higiénico / Confort
- Limpia pisos desechables
- Quix lavalozas
- Bolsas basura baño

Estos ítems **deben registrarse como doble entrada**: gasto operativo pagado por el propietario + entrada de stock al inventario del departamento.

### 12.3 Bebida del trabajador

La bebida consumida por el trabajador **no entra al inventario**. Es consumo personal inmediato del personal de servicio. Solo se registra como gasto operativo si fue pagada por el propietario o el Admin.

---

## 13. Decisiones pendientes de Luis

Las siguientes decisiones son necesarias antes de iniciar la Fase 2:

**Sobre visibilidad Staff:**
- ¿Staff solo ve el botón "Solicitar faltante" (sin información de inventario), o también debería ver una alerta simple cuando hay ítems en crítico — por ejemplo, una nota "📦 3 ítems bajo stock mínimo — avisa a Admin"?

**Sobre boletas y comprobantes:**
- ¿Las fotos de boletas de compra se suben directamente en el módulo Inventario como archivo propio, o se vinculan desde el gasto existente en "Gastos y Reembolsos" (que ya sube comprobantes a Supabase Storage)?

**Sobre la tabla `supply_alerts`:**
- ¿Los registros actuales de `supply_alerts` se migran al nuevo modelo (`inventory_items`), o se abandona la tabla y se inicia desde cero con el nuevo catálogo?

**Sobre ropa blanca y losa:**
- ¿El control de ropa blanca y losa/menaje se hace por unidades individuales, por juegos, o por estado de condición (bueno / desgastado / dado de baja)?

**Sobre la regularización de agosto:**
- ¿Las compras de agosto 2026 se usan como primer caso de regularización histórica en la Fase 7, o se espera a tener el módulo completo antes de ingresar cualquier dato?

---

## 14. Principios de seguridad del diseño

- **No romper Staff Servicios.** El bloque legacy Insumos queda intacto hasta que el módulo de reemplazo esté validado en producción.
- **No parchear el bloque actual como solución principal.** La evolución del bloque Insumos no es el camino.
- **No mezclar complejidad Admin en Staff.** El módulo Admin de Inventario es una sección separada, cargada con su propia función, invisible al Staff.
- **No permitir actualizaciones de stock sin historial de movimientos.** Toda entrada o salida genera un registro en `inventory_movements` con actor y timestamp.
- **No usar índice de array como referencia persistente.** El nuevo módulo usa `id` del registro (UUID) como referencia en todos los contextos.
- **Verificar RLS antes de habilitar el flujo Staff.** Staff no puede SELECT el inventario completo (stock, mínimos, movimientos). Para el formulario de solicitud, Staff puede operar de dos formas — decisión técnica pendiente antes de implementar: (a) vista de catálogo limitada que expone solo nombre y categoría de ítems activos, sin valores de stock; o (b) entrada de texto libre en la Fase 1, sin SELECT a `inventory_items`. En ningún caso Staff puede SELECT de `inventory_movements` ni ver cantidades de stock. La política RLS correspondiente debe existir en Supabase antes de desplegar el bloque Staff.
- **Paso a pasito con cuidadito.** Cada fase requiere aprobación de Luis antes de iniciar. Sin atajos. Sin cambios acumulados.

---

## 15. Estado final del documento

Este es un documento de diseño estratégico únicamente.

**Ninguna de las propuestas aquí descritas ha sido implementada.**

El módulo "Inventario y Reposición Operacional" existe como diseño conceptual en este documento. No hay código, no hay tablas nuevas en Supabase, no hay UI desarrollada.

Para iniciar cualquier fase de implementación se requiere aprobación explícita de Luis Figueroa.

**No iniciar ninguna modificación al sistema sin autorización explícita de Luis.**

---

*Documento generado: 2026-08-11*

*Producción al momento del diseño: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
