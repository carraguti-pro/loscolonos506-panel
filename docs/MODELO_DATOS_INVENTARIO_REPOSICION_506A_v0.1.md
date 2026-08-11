# Modelo de Datos — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Versión:** v0.1 — Modelo conceptual\
**Fecha:** 2026-08-11\
**Estado:** Modelo conceptual únicamente. Sin SQL ejecutado. Sin implementación aprobada.\
**Diseño previo:** `docs/DISENO_INVENTARIO_REPOSICION_OPERACIONAL_506A_v0.1.md`\
**Commit de producción al momento del modelo:** `9e89a47`

---

## 1. Alcance

Este documento define el modelo de datos conceptual para el módulo "Inventario y Reposición Operacional" del panel 506-A Los Colonos.

El modelo es conceptual: describe tablas, campos, tipos, y políticas de seguridad en lenguaje natural. No contiene SQL ejecutable. No hay tablas creadas en Supabase. No hay implementación aprobada en este documento.

El paso siguiente después de aprobar este documento sería redactar un borrador SQL en un documento separado — también sin ejecutar — para revisión antes de cualquier implementación.

---

## 2. Decisiones de diseño aprobadas

Las siguientes decisiones fueron aprobadas en la Fase 1 (ver diseño de referencia) y se mantienen como base de este modelo:

- **Módulo nuevo desde cero.** El bloque actual de Insumos en Staff Servicios no se parchea como solución definitiva. El nuevo módulo se diseña de forma independiente.
- **`supply_alerts` permanece como legacy temporal.** La tabla existente no se modifica, no se migra automáticamente, y no se elimina en este ciclo. Los datos actuales quedan en su estado original.
- **Staff solo crea solicitudes.** Staff no actualiza stock directamente. Staff reporta faltantes, daños, pérdidas o necesidades de reposición. El Admin decide y ejecuta el cambio de stock.
- **Admin gestiona el stock.** Solo Admin puede crear ítems de catálogo, registrar entradas, registrar bajas, y modificar cantidades.
- **Todo cambio de stock crea un movimiento.** No existe actualización de stock sin registro de historial. `inventory_movements` es el registro completo y trazable de cada variación de cantidad.
- **Sin actualización directa de stock sin historial.** Ninguna operación sobreescribe `current_stock` en `inventory_items` sin pasar por un movimiento que registre estado anterior, estado nuevo, motivo y responsable.
- **Vinculación gasto + stock postergada a fase posterior.** La integración con Gastos / Reembolsos / `inventory_purchases` es importante pero se reserva para una fase posterior, cuando la base de inventario Admin esté estable. No forma parte del modelo Phase 2.

---

## 3. Tablas propuestas — primera implementación

### 3.A `inventory_items`

**Propósito:** Catálogo de ítems del inventario del departamento. Administrado exclusivamente por Admin.

| Campo | Tipo conceptual | Descripción |
|---|---|---|
| `id` | UUID, PK | Identificador único del ítem |
| `item_name` | texto, obligatorio | Nombre del ítem (ej: "Papel higiénico / Confort") |
| `category` | texto, obligatorio | Categoría del ítem (ver sección 4) |
| `unit` | texto, obligatorio | Unidad de medida (ej: "unidad", "rollo", "litro", "kg", "set") |
| `current_stock` | numérico, obligatorio | Cantidad actual en inventario. Actualizado solo vía movimientos. |
| `min_stock` | numérico, obligatorio | Cantidad mínima antes de considerar reposición necesaria |
| `notes` | texto, nullable | Notas internas del ítem (marcas preferidas, observaciones de compra) |
| `active` | booleano, default true | Permite desactivar ítems sin eliminarlos |
| `created_by` | UUID, FK auth.users | Usuario que creó el ítem |
| `created_at` | timestamp | Fecha y hora de creación |
| `updated_by` | UUID, FK auth.users, nullable | Último usuario que modificó el ítem |
| `updated_at` | timestamp, nullable | Fecha y hora de última modificación |

**Notas de diseño:**
- `current_stock` nunca se actualiza con un UPDATE directo en la aplicación. Se recalcula o actualiza únicamente como resultado de un movimiento registrado en `inventory_movements`.
- `active = false` permite retirar ítems del catálogo visible sin perder historial de movimientos.
- `min_stock` es el umbral de alerta; Admin decide si la alerta es visible o solo visible en el panel Admin.

---

### 3.B `inventory_requests`

**Propósito:** Solicitudes de Staff sobre ítems faltantes, con bajo stock, dañados o perdidos. Staff crea la solicitud con texto libre; el Admin la revisa y gestiona la reposición.

| Campo | Tipo conceptual | Descripción |
|---|---|---|
| `id` | UUID, PK | Identificador único de la solicitud |
| `item_free_text` | texto, obligatorio | Descripción libre del ítem o necesidad reportada por Staff |
| `reason` | texto, obligatorio | Motivo de la solicitud (ver sección 6) |
| `comment` | texto, nullable | Comentario adicional de contexto del Staff |
| `photo_url` | texto, nullable, uso futuro | URL de foto de evidencia (Supabase Storage). No implementado en Fase 2. |
| `requested_by` | UUID, FK auth.users | Usuario Staff que creó la solicitud |
| `requested_at` | timestamp | Fecha y hora de la solicitud |
| `status` | texto, obligatorio | Estado de la solicitud (ver valores abajo) |
| `resolved_by` | UUID, FK auth.users, nullable | Admin que gestionó la solicitud |
| `resolved_at` | timestamp, nullable | Fecha y hora de resolución |
| `resolution_notes` | texto, nullable | Notas de Admin al resolver la solicitud |
| `linked_item_id` | UUID, FK inventory_items, nullable, uso futuro | Vínculo al ítem del catálogo una vez identificado. No obligatorio en Fase 2. |

**Valores de `status`:**
- `pendiente` — recibida, aún sin revisión Admin
- `en_revision` — Admin la vio, está procesando
- `comprada` — ítem comprado, pendiente de ingreso al stock
- `resuelta` — stock actualizado o necesidad atendida
- `descartada` — solicitud no procedente (Admin agrega nota de motivo)

**Notas de diseño:**
- El campo `item_free_text` es libre en Fase 2 para mantener la implementación simple y no requerir que Staff haga SELECT al catálogo `inventory_items`.
- `linked_item_id` queda nullable para que en fases posteriores se pueda vincular la solicitud a un ítem específico del catálogo, permitiendo trazabilidad completa.
- `photo_url` queda como campo nullable para no requerir migración futura; no se usa en Fase 2.

---

### 3.C `inventory_movements`

**Propósito:** Registro completo e inmutable de todo cambio de stock. Cada entrada de stock, baja, ajuste o corrección genera un movimiento. Es el historial de auditoría del inventario.

| Campo | Tipo conceptual | Descripción |
|---|---|---|
| `id` | UUID, PK | Identificador único del movimiento |
| `item_id` | UUID, FK inventory_items, obligatorio | Ítem afectado |
| `movement_type` | texto, obligatorio | Tipo de movimiento (ver sección 7) |
| `quantity` | numérico, obligatorio | Cantidad del movimiento (siempre positivo; el tipo indica si es entrada o salida) |
| `previous_stock` | numérico, obligatorio | Stock antes del movimiento |
| `new_stock` | numérico, obligatorio | Stock después del movimiento |
| `reason` | texto, nullable | Motivo o descripción del movimiento |
| `notes` | texto, nullable | Notas adicionales de contexto |
| `created_by` | UUID, FK auth.users | Admin que registró el movimiento |
| `created_at` | timestamp | Fecha y hora del movimiento |
| `linked_request_id` | UUID, FK inventory_requests, nullable | Vínculo a la solicitud de Staff que originó el movimiento, si aplica |

**Notas de diseño:**
- Los movimientos son inmutables: no se editan ni eliminan. Si hay un error, se genera un movimiento de corrección (`correccion_admin`) con nota explicativa.
- `previous_stock` y `new_stock` se registran en el momento del movimiento para que el historial sea autocontenido, independiente de cambios futuros en `inventory_items.current_stock`.
- `linked_request_id` permite trazabilidad completa: solicitud Staff → revisión Admin → movimiento de stock.

---

## 4. Categorías de ítems

Las categorías definen el agrupamiento del catálogo en la vista Admin.

| Categoría | Descripción de uso |
|---|---|
| `Limpieza` | Productos de limpieza general: CIF, detergente, limpia pisos desechables, bolsas basura |
| `Baño` | Artículos de baño: jabón líquido, papel higiénico / Confort, shampoo de cortesía |
| `Cocina` | Artículos de cocina: Quix lavalozas, paños de cocina, esponjas |
| `Ropa blanca` | Sábanas, fundas, toallas, bajada de cama, cubrecama |
| `Losa y menaje` | Platos, vasos, tazas, cubiertos, ollas, otros utensilios |
| `Equipamiento menor` | Artículos de menor valor como escoba, trapeador, balde, plancha, secador de pelo, perchas, controles, pilas |
| `Mantención / repuestos` | Repuestos de artefactos, pilas, ampolletas u otros ítems de mantención que sí se inventarían |
| `Otros` | Ítems que no encajan en categorías anteriores |

**Nota:** Los materiales de obra utilizados en reparaciones — yeso, masilla, pintura, materiales de lijado y similares — son insumos de trabajo de mantención y **no entran al inventario del departamento**. Solo se registran como gasto operativo de mantención. Las bebidas tampoco ingresan al inventario.

---

## 5. Caja chica, alcancía y efectivo de huéspedes

### Qué no es inventario

Caja chica, alcancía, monedas o fondos menores no forman parte del inventario operacional del departamento.

Staff no recibe caja chica, no administra alcancía y no maneja fondos menores para compras operativas.

### Gastos realizados por Staff

Si Staff realiza un gasto:
- con boleta o comprobante, se gestiona como gasto / reembolso contra respaldo;
- sin comprobante, como transporte u otro gasto menor excepcional, se trata como gasto de buena fe, sujeto a revisión Admin.

### Efectivo recibido de huéspedes

Si un huésped paga en efectivo y el dinero es recibido por Staff, eso no es inventario ni caja chica. Es un ingreso financiero delicado recibido por cuenta de la administración.

Ese caso debe tratarse en un flujo separado de Finanzas / Pagos Huésped, con control especial:

- autorización previa de Admin;
- reserva y huésped asociados;
- monto exacto recibido;
- concepto del pago;
- fecha y hora;
- Staff que recibe;
- confirmación inmediata a Admin;
- entrega o depósito posterior del efectivo;
- registro financiero independiente.

El efectivo recibido de huéspedes **no puede mezclarse** con gastos Staff, reembolsos, inventario, caja chica ni pagos operacionales.

### Regla financiera: efectivo recibido de huéspedes

El efectivo recibido de huéspedes no forma parte del inventario operacional, no es caja chica, no es alcancía y no puede utilizarse para compras, pagos de servicio, transporte, reembolsos ni gastos operativos.

Si excepcionalmente un huésped paga en efectivo y el dinero es recibido por Staff, ese monto debe integrarse 100% al control Admin como ingreso de reserva.

No se permite netear, compensar ni descontar gastos desde ese efectivo. Ejemplo prohibido: recibir dinero del huésped, usar una parte para comprar insumos o pagar servicios, y entregar solo el saldo.

Todo pago en efectivo recibido por Staff debe registrarse separadamente con:
- reserva asociada;
- nombre del huésped;
- monto exacto recibido;
- concepto del pago;
- fecha y hora;
- Staff que recibe;
- autorización o confirmación Admin;
- entrega o depósito posterior del efectivo;
- conciliación entre monto recibido y monto entregado / depositado.

Cualquier gasto operativo debe registrarse por separado como gasto / reembolso, con boleta, comprobante o justificación según corresponda.

**Principio: Con platas no se juega; y si son ajenas, menos.**

---

## 6. Motivos de solicitud (`inventory_requests.reason`)

| Valor | Descripción |
|---|---|
| `stock_bajo` | El ítem existe pero hay poca cantidad; se anticipa necesidad |
| `faltante` | El ítem no está disponible en el departamento |
| `dañado` | El ítem está presente pero inutilizable por daño |
| `perdido` | El ítem no se encuentra y se presume pérdida |
| `reposicion_necesaria` | Reposición general necesaria sin causa específica |
| `otro` | Motivo no contemplado en las opciones anteriores; describir en `comment` |

---

## 7. Tipos de movimiento (`inventory_movements.movement_type`)

| Valor | Descripción | Efecto en stock |
|---|---|---|
| `entrada_compra` | Ingreso de ítems por compra | Aumenta `current_stock` |
| `entrada_regularizacion` | Ingreso por regularización de inventario inicial o compras previas no registradas | Aumenta `current_stock` |
| `salida_consumo` | Salida por uso o consumo normal durante estadía | Disminuye `current_stock` |
| `baja_daño` | Baja por ítem dañado o inutilizable | Disminuye `current_stock` |
| `baja_perdida` | Baja por pérdida del ítem | Disminuye `current_stock` |
| `ajuste_admin` | Ajuste discrecional de stock por Admin (con nota obligatoria) | Aumenta o disminuye según cantidad |
| `correccion_admin` | Corrección de un movimiento anterior erróneo (contrapartida) | Aumenta o disminuye según corrección |

---

## 8. Política RLS conceptual

Las siguientes políticas se describen en lenguaje natural. No son SQL ejecutable. Deben ser implementadas y verificadas en Supabase antes de habilitar cualquier interfaz de usuario.

### `inventory_items`
- **Admin:** puede SELECT (leer todos los ítems activos e inactivos), INSERT (crear nuevos ítems), UPDATE (modificar campos del catálogo).
- **Staff:** no puede SELECT `inventory_items` en Fase 2. El formulario de solicitud usa texto libre (`item_free_text`) precisamente para evitar que Staff necesite leer el catálogo. Esta es la decisión técnica aprobada para Fase 2: entrada de texto libre sin SELECT al catálogo.
- **Staff en fases futuras:** si en una fase posterior se decide mostrar un catálogo limitado a Staff, la política se ampliaría para permitir SELECT restringido (solo `id`, `item_name`, `category`) en ítems activos.

### `inventory_requests`
- **Staff:** puede INSERT (crear solicitudes). Puede SELECT sus propias solicitudes (filtro `requested_by = auth.uid()`) si se necesita mostrar historial de solicitudes propias en la interfaz Staff.
- **Admin:** puede SELECT todas las solicitudes. Puede UPDATE (cambiar `status`, `resolved_by`, `resolved_at`, `resolution_notes`).

### `inventory_movements`
- **Admin:** puede INSERT (registrar movimientos). Puede SELECT todos los movimientos.
- **Staff:** no puede SELECT `inventory_movements`. El historial de movimientos es información interna de Admin.

### Principio general de aislamiento
Staff opera únicamente con `inventory_requests`. No tiene acceso directo al catálogo ni al historial de movimientos. Esta separación es el fundamento de seguridad del módulo.

---

## 9. Por qué `inventory_purchases` se posterga

La tabla `inventory_purchases` — destinada a registrar comprobantes, montos y vínculos entre compras de insumos y asientos de Gastos — no forma parte del modelo Phase 2 por las siguientes razones:

1. **Toca flujos financieros.** Cualquier tabla de compras implica vinculación con `gastos_operativos`, montos, comprobantes en Storage, y potencialmente `reservation_payments`. Son los flujos más sensibles del panel.
2. **La base de inventario debe estar estable primero.** No conviene diseñar vínculos entre Gastos e Inventario antes de que el catálogo y el historial de movimientos estén funcionando correctamente en producción.
3. **La regla de doble registro tiene su complejidad.** La mecánica de "una compra = un asiento de gasto + una entrada de stock" requiere una interfaz cuidadosa y aprobación explícita antes de implementar.

`inventory_purchases` se diseñará en una fase posterior (Phase 6 según el diseño aprobado), una vez que las Fases 2, 3, 4 y 5 estén validadas en producción.

---

## 10. Caso de regularización agosto 2026

Las compras de agosto 2026 de insumos útiles de limpieza (jabón líquido, CIF, detergente, paños de cocina, papel higiénico / Confort, limpia pisos desechables, Quix lavalozas, bolsas basura baño) constituirán el primer caso de regularización histórica del inventario, cuando el módulo esté listo.

La regularización consistirá en:
1. Registrar la compra como gasto de mantención / reposición pagado por el propietario, en el registro financiero que corresponda cuando esa etapa sea diseñada.
2. Registrar una entrada de stock tipo `entrada_regularizacion` en `inventory_movements`, con notas explicativas de que corresponde a compras de agosto 2026.

Este proceso **no se ejecuta en Phase 2.** Los datos de agosto 2026 permanecen sin tocar hasta que el módulo esté en producción y validado.

**Ítems excluidos de la regularización:**
- **Bebidas** (agua, jugos, snacks): no entran al inventario del departamento.
- **Materiales de obra** de la reparación de baños / cielos (yeso, masilla, pintura, materiales de lijado y similares): son insumos de trabajo de mantención, no stock del departamento. Solo se registran como gasto operativo de mantención.

---

## 11. Decisión sobre migración de `supply_alerts`

La tabla `supply_alerts` — actualmente el respaldo del bloque Insumos en Staff Servicios — permanece intacta:

- **No se modifica** en este ciclo.
- **No se elimina** en este ciclo.
- Los datos existentes en `supply_alerts` son válidos como referencia histórica y para el funcionamiento actual del bloque legacy.
- En una fase posterior, una vez que el nuevo módulo esté validado en producción, se evaluará si los datos de `supply_alerts` se migran manualmente al nuevo catálogo `inventory_items`, o si simplemente se abandonan en su estado actual.
- **No hay migración automática aprobada.** Cualquier migración de datos requiere autorización explícita y revisión ítem a ítem.

El bloque Insumos en Staff Servicios continuará funcionando con `supply_alerts` hasta que la Fase 8 (retiro del bloque legacy) sea autorizada explícitamente.

---

## 12. Riesgos identificados

| Riesgo | Descripción | Mitigación |
|---|---|---|
| Romper Staff Servicios | Cualquier cambio en `loadServicios()` o en las tablas que consulta puede romper el flujo actual de Staff | No tocar `loadServicios()` ni `supply_alerts` hasta que el módulo nuevo esté validado |
| Mezclar Gastos e Inventario prematuramente | Vincular compras al stock antes de que ambos módulos sean estables crea dependencias frágiles | `inventory_purchases` se posterga a Phase 6 |
| Sobrescritura directa de stock | Un UPDATE directo en `inventory_items.current_stock` sin movimiento rompe la trazabilidad | Toda variación de stock debe pasar por `inventory_movements`; política de aplicación y RLS deben reforzar esto |
| Índice de array como contexto persistente | El bug `openReponer(idx)` en el bloque legacy usa índice de array en lugar de UUID; si el orden cambia entre renders, el contexto es incorrecto | El nuevo módulo debe usar UUID de registro como contexto en todo momento, nunca índice de array |
| RLS no verificado antes del UI Staff | Si el UI Staff se habilita antes de verificar RLS, Staff podría acceder a datos de inventario no autorizados | RLS debe implementarse y verificarse en Supabase antes de desplegar cualquier interfaz Staff del módulo nuevo |

---

## 13. Paso siguiente recomendado

Una vez aprobado este documento, el paso siguiente propuesto es:

**Redactar un borrador SQL en un documento separado**, con:
- `CREATE TABLE inventory_items (...)` con todos los campos y tipos de datos exactos.
- `CREATE TABLE inventory_requests (...)` con los campos y restricciones.
- `CREATE TABLE inventory_movements (...)` con los campos y restricciones.
- Las políticas RLS correspondientes para Admin y Staff.
- Índices recomendados.

Ese documento SQL sería revisado y aprobado por Luis antes de ejecutar cualquier línea en Supabase.

**No se crea ninguna tabla en Supabase hasta que:**
1. El borrador SQL sea revisado y aprobado.
2. Luis autorice explícitamente la ejecución.

---

## 14. Estado final

**Modelo conceptual únicamente. Sin SQL ejecutado. Sin implementación aprobada.**

Este documento aprueba el diseño conceptual del modelo de datos para el módulo "Inventario y Reposición Operacional". Las tablas `inventory_items`, `inventory_requests` e `inventory_movements` están diseñadas y listas para la siguiente fase de revisión SQL.

Ninguna tabla existe en Supabase al momento de este documento. El sistema en producción (`9e89a47`) permanece intacto y sin modificaciones.

---

*Documento generado: 2026-08-11*

*Producción al momento del modelo: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
