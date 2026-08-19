# Diseño Fase 6I — Integración UI Admin Inventario con RPC de stock 506-A

## 1. Metadata

- **Proyecto:** Oasis / Los Colonos 506-A Panel
- **Fecha:** 2026-08-19
- **Base:** `main` — `37a02af` (Document phase 6H RPC stock execution closure)
- **Fase previa:** Fase 6H cerrada exitosamente a nivel de base de datos / RPC
- **Alcance:** diseño de integración UI Admin únicamente
- **Estado de implementación:** NO autorizado

---

## 2. Resumen ejecutivo

La capa de base de datos / RPC está lista: `public.inventory_apply_stock_movement` existe, tiene `SECURITY DEFINER` con `search_path` fijado, `anon` no tiene `EXECUTE`, `authenticated` sí lo tiene, RLS está habilitado en las tres tablas de inventario, y las pruebas de ejecución real (positiva Admin, negativa Staff, negativa anon) pasaron con criterios exactos de SQLSTATE. Ningún dato de prueba quedó persistido.

Esta fase **no conecta ninguna UI**. Su único propósito es diseñar, en documento, cómo Admin debería operar el inventario de forma segura a través del RPC ya verificado — qué pantallas, qué acciones permitidas, qué acciones prohibidas, y qué contrato exacto debe respetar la UI al llamar al RPC. No se escribe ni se modifica ningún código de aplicación en esta fase.

---

## 3. Principios rectores

- Paso a pasito, con cuidadito.
- No arreglar una cosa rompiendo otra.
- Ningún UPDATE directo de stock desde la UI.
- Todo cambio de stock debe pasar por `public.inventory_apply_stock_movement`.
- Staff no debe realizar movimientos de stock.
- Staff solo puede reportar necesidades o faltantes.
- Insumos legacy permanece intacto.
- `supply_alerts` permanece intacto.
- La UI no debe crear atajos de seguridad.
- No basta con que funcione. Tiene que funcionar sin dejar puertas abiertas.

---

## 4. Alcance funcional para UI Admin

Solo diseño, sin implementación:

- Dashboard/listado de inventario.
- Creación de ítem.
- Detalle de ítem.
- Formulario de movimiento de stock.
- Historial de movimientos.
- Indicadores de stock bajo.
- Visibilidad/manejo de ítems inactivos.
- Filtros básicos por categoría, estado activo, stock bajo.

---

## 5. Acciones permitidas para Admin

- Crear ítem de inventario.
- Ver listado de ítems.
- Ver detalle de ítem.
- Crear movimiento de stock **únicamente a través del RPC**, con los siguientes `movement_type`:
  - `entrada_compra`
  - `entrada_regularizacion`
  - `salida_consumo`
  - `baja_daño`
  - `baja_perdida`
- Ver historial de movimientos.
- Ver solicitudes de inventario pendientes/relacionadas, si aplica.

---

## 6. Acciones prohibidas

Explícitamente prohibido en esta fase y en cualquier implementación futura de Admin UI:

- UPDATE directo de `current_stock` desde la UI.
- INSERT directo en `inventory_movements` desde la UI.
- Ejecución de movimientos de stock por parte de Staff.
- Exponer el RPC a `anon`.
- Conectar Insumos legacy.
- Modificar `supply_alerts`.
- Tocar Staff Servicios en esta fase.
- Eliminar movimientos de inventario.
- Eliminar ítems de inventario en el MVP.
- Implementar cualquier parte de esto sin un GO separado de Luis.

---

## 7. Ubicación propuesta en la UI Admin

- Nueva sección de menú Admin: **"Inventario"**.
- No dentro de Staff Servicios.
- No reemplaza todavía a Insumos legacy.
- Separación clara respecto de los flujos existentes de revisión operacional/pagos.

---

## 8. Pantallas propuestas (diseño conceptual)

**A. Listado de inventario**
Tabla de ítems con nombre, categoría, unidad, stock actual, stock mínimo, estado activo/inactivo. Filtros por categoría, estado activo, y stock bajo (`current_stock <= min_stock`).

**B. Formulario de nuevo ítem**
Campos: nombre, categoría, unidad, stock mínimo. **No incluye un campo de stock inicial editable.** La creación de un ítem es exclusivamente metadata: `current_stock` queda en `0` (o el valor por defecto de la columna) al momento de crear el ítem. Cualquier stock inicial debe registrarse inmediatamente después, como un movimiento explícito vía `public.inventory_apply_stock_movement` (típicamente `entrada_compra` o `entrada_regularizacion`), nunca como parte del formulario de creación. Esto asegura que la creación del ítem y todo cambio de `current_stock` queden siempre separados, y que todo cambio de stock quede siempre registrado con su propia fila de auditoría en `inventory_movements`.

**C. Detalle de ítem**
Datos del ítem, stock actual, stock mínimo, estado activo/inactivo, acceso al historial de movimientos de ese ítem, y botón para iniciar un nuevo movimiento de stock.

**D. Modal/formulario de movimiento de stock**
Selección de `movement_type`, cantidad, motivo/razón, notas opcionales, y `linked_request_id` opcional si el movimiento responde a una solicitud existente. Este formulario es la única vía de la UI para modificar `current_stock`, siempre a través del RPC.

**E. Historial de movimientos**
Listado cronológico de movimientos por ítem (o global, filtrable por ítem): tipo, cantidad, stock anterior/nuevo, quién lo realizó, cuándo, motivo.

**F. Revisión de stock bajo**
Vista o sección del dashboard que resalta ítems con `current_stock <= min_stock`, para que Admin priorice reposición.

---

## 9. Uso del modelo de datos

- **`inventory_items`:** lectura para listado/detalle/filtros. Un `INSERT` directo de Admin está permitido **únicamente para metadata del ítem** (nombre, categoría, unidad, stock mínimo, estado activo) y debe crear el ítem con `current_stock = 0` o el valor por defecto de la columna — nunca con un valor de stock mayor que `0`. `current_stock` se lee desde la UI, y su único mecanismo de escritura, en cualquier momento posterior a la creación del ítem (incluyendo el stock inicial), es `public.inventory_apply_stock_movement`.
- **`inventory_movements`:** exclusivamente de lectura desde la UI (historial). La única escritura sobre esta tabla ocurre dentro del cuerpo del RPC, nunca por `INSERT` directo de la UI.
- **`inventory_requests`:** lectura para mostrar solicitudes pendientes/relacionadas si la UI decide vincular movimientos a solicitudes vía `linked_request_id`.
- **`public.inventory_apply_stock_movement`:** único punto de escritura para cualquier cambio de `current_stock`.

---

## 10. Contrato de llamada al RPC desde la UI

Parámetros del RPC `public.inventory_apply_stock_movement`:

- `p_item_id`
- `p_movement_type`
- `p_quantity`
- `p_reason`
- `p_notes`
- `p_linked_request_id`

La UI debe llamar al RPC y usar su respuesta (`previous_stock`, `new_stock`, etc.) como fuente de verdad. La UI **no debe calcular el stock final por su cuenta** ni asumir que una llamada exitosa implica un resultado específico sin leer la respuesta del RPC — el backend es la única autoridad sobre el valor final de `current_stock`.

---

## 11. Reglas de validación en UI

- Ítem requerido.
- `movement_type` requerido.
- Cantidad requerida y mayor que `0`.
- Motivo/razón recomendado o requerido según el tipo de movimiento (a definir por Luis, ver sección de decisiones abiertas).
- Confirmación explícita para movimientos destructivos como `baja_daño`/`baja_perdida`.
- La UI puede mostrar una previsualización del resultado esperado, pero **no debe tratar esa previsualización como autoridad** — el RPC en el backend sigue siendo la autoridad final; cualquier discrepancia entre lo previsualizado y lo devuelto por el RPC debe reflejar lo que devuelve el RPC.

---

## 12. Diseño de manejo de errores

Errores esperados que la UI debe anticipar y presentar de forma clara a Admin:

- No autenticado.
- No es Admin (rechazo interno por `get_my_role()`).
- `movement_type` inválido.
- Cantidad `<= 0`.
- Ítem inactivo.
- Ítem no encontrado.
- Stock resultante negativo.
- Desajuste de `linked_request_id`.

---

## 13. Auditabilidad y trazabilidad

Todo cambio de stock debe generar una fila de movimiento con:

- `previous_stock`
- `new_stock`
- `movement_type`
- `quantity`
- `created_by`
- `created_at`
- `reason`/`notes`
- `linked_request_id` (opcional)

Esto ya está garantizado por el diseño del RPC verificado en Fase 6H; la UI no necesita (ni debe) intentar reconstruir o duplicar este registro por su cuenta.

---

## 14. Relación con Staff

Staff no ajusta inventario. Staff podría, en una fase posterior y separada, enviar solicitudes o reportar faltantes a través de un flujo propio de Staff — pero **cualquier integración de un flujo de Staff queda fuera del alcance de esta fase** y requiere una fase futura aprobada explícitamente por Luis.

---

## 15. Separación de lo legacy

- Insumos legacy permanece congelado/intacto.
- No hay migración en la Fase 6I.
- No hay eliminación de tablas legacy.
- No hay mezcla de UI entre el nuevo módulo y lo legacy hasta que Luis apruebe un plan de migración/transición.

---

## 16. Requisitos de seguridad antes de implementar

Antes de iniciar cualquier implementación (Fase 6J o posterior):

- Confirmar el estado actual de RLS.
- Confirmar los permisos del RPC.
- Confirmar que no hay exposición a `anon`.
- Confirmar la ruta de verificación del rol Admin.
- Confirmar que no existe ningún endpoint de actualización directa de stock en la UI.
- Probar en pasos controlados, de tipo desarrollo, antes de cualquier despliegue a producción.

---

## 17. Límites de implementación para la futura Fase 6J

Esta Fase 6I **no autoriza implementación**. Una futura Fase 6J podría implementar una UI Admin mínima, únicamente después de un GO explícito y separado de Luis. Ningún trabajo de código queda habilitado por este documento.

---

## 18. Criterios de aceptación para la Fase 6I

Lo que debe aprobarse antes de escribir código:

- Ubicación de la UI.
- Acciones permitidas de Admin.
- Acciones prohibidas.
- Cambios de stock exclusivamente vía RPC.
- Ningún permiso de movimiento de stock para Staff.
- Ningún cambio a Insumos legacy.
- Ningún deploy hasta haber sido probado.

---

## 19. Decisiones abiertas para Luis

- Nombre del módulo visible en la UI.
- Categorías mostradas por defecto.
- Si la alerta de stock bajo aparece en el dashboard de Admin.
- Si la creación de ítems se permite de inmediato o solo después de un catálogo semilla (seed).
- Si el motivo/razón es obligatorio para todos los tipos de movimiento.
- Si fotos/comprobantes quedan diferidos para una fase posterior.

---

## 20. Siguiente paso recomendado

Revisión completa de este documento de diseño. Si se aprueba, preparar un plan de implementación para la Fase 6J. Ningún código se escribe hasta que Luis apruebe.

---

*Documento generado: 2026-08-19*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
