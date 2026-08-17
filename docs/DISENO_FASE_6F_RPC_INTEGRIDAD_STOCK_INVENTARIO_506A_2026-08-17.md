# Diseño Fase 6F — RPC/Función de Integridad de Stock — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app
**Versión:** v0.1 — Documento de diseño
**Fecha:** 2026-08-17
**Estado:** Documento de diseño únicamente. No ejecuta SQL. No autoriza ejecución.
**HEAD del repositorio al momento de este diseño:** `c7551ad`
**Fase previa:** Cierre Fase 6E — Ejecución Controlada (`docs/CIERRE_FASE_6E_EJECUCION_CONTROLADA_INVENTARIO_506A_2026-08-15.md`)

---

## 1. Propósito

Este documento diseña el mecanismo de integridad de stock — un RPC/función controlado en Supabase — que será la única vía aprobada para modificar `inventory_items.current_stock`.

La Fase 6E dejó la estructura de base de datos creada, con RLS habilitado y sin ninguna política que permita a Admin hacer `UPDATE` directo sobre `inventory_items`. Esa restricción fue deliberada: el `UPDATE` directo de stock queda bloqueado hasta que exista un mecanismo controlado que garantice trazabilidad completa.

La Fase 6F diseña ese mecanismo **antes** de conectar cualquier interfaz de Admin. Ninguna UI debe hablar con `current_stock` hasta que este diseño esté aprobado por Luis y, en una fase posterior separada, implementado y ejecutado.

---

## 2. Límite de seguridad (Safety boundary)

- No se ejecuta SQL en este documento.
- No se muta Supabase en este documento.
- No se crea ninguna función en Supabase.
- No se crea ninguna política RLS.
- No se crea ningún índice.
- No se conecta ninguna interfaz de usuario.
- `index.html` permanece intacto.
- Ningún archivo de código de la aplicación cambia.
- El comportamiento en producción no cambia.
- Este documento es el único artefacto creado en esta fase.

---

## 3. Estado actual de la base de datos

Resumen del estado final de la Fase 6E, tomado de `docs/CIERRE_FASE_6E_EJECUCION_CONTROLADA_INVENTARIO_506A_2026-08-15.md`:

- Existen 3 tablas en `public`: `inventory_items`, `inventory_requests`, `inventory_movements`.
- RLS habilitado en las 3 tablas.
- 11 índices en total (3 automáticos de PK + 8 creados en BLOCK 7), incluyendo el índice único de control de duplicados sobre `category` + `lower(trim(item_name))` donde `active = true`.
- 8 políticas RLS aprobadas y verificadas (21/21 pruebas OK en BLOCK 10).
- 0 filas en las 3 tablas. Ningún dato de producción insertado.
- `admin_update_inventory_items` **no fue creada**. No existe ninguna política que permita a Admin hacer `UPDATE` directo sobre `inventory_items`.
- No existe ninguna política `DELETE` en ninguna de las 3 tablas.
- La UI sigue desconectada del módulo nuevo.
- El bloque Insumos legacy (`supply_alerts`) y Staff Servicios permanecen intactos.

Este es el punto de partida exacto sobre el cual se diseña el RPC/función de esta fase.

---

## 4. Problema a resolver

Permitir que Admin ejecute un `UPDATE` ordinario sobre `inventory_items.current_stock` — vía una política RLS de tipo `admin_update_inventory_items` — sería la ruta más simple de implementar, pero es la ruta que la Fase 6E decidió explícitamente **no** habilitar. Las razones:

- **Puede cambiar el stock sin dejar historial.** Un `UPDATE` directo no obliga a que exista una fila correspondiente en `inventory_movements`. Nada impide que Admin actualice `current_stock` sin registrar por qué cambió.
- **Debilita la auditabilidad.** Sin un movimiento asociado, no hay forma de reconstruir cuándo, por qué, ni quién cambió una cantidad específica. El historial deja de ser confiable como fuente de verdad.
- **Puede romper la trazabilidad financiera y operacional.** El modelo de datos (`docs/MODELO_DATOS_INVENTARIO_REPOSICION_506A_v0.1.md`, sección 9) reserva una fase futura para vincular compras, gastos e inventario. Esa vinculación depende de que cada variación de stock tenga un movimiento asociado con `previous_stock` y `new_stock`. Un `UPDATE` directo rompe esa base desde el inicio.
- **Contradice la regla Ferran.** El principio operacional del proyecto es que todo cambio físico de inventario debe dejar evidencia. Un `UPDATE` silencioso sobre `current_stock` no deja evidencia — es exactamente lo que la regla prohíbe.

Este riesgo ya había sido identificado en el modelo de datos del inventario y quedó reforzado en el cierre de Fase 6E: toda variación de stock debe pasar por `inventory_movements` y no por `UPDATE` directo de `current_stock`. Este documento diseña esa política de aplicación.

---

## 5. Dirección de diseño aprobada

- **RPC/función primero.** El mecanismo de integridad de stock se implementa como una función de base de datos (RPC) invocada explícitamente, no como un trigger.
- **Trigger postergado.** Un trigger `BEFORE UPDATE` sobre `inventory_items` que generara movimientos automáticamente queda descartado por ahora. Un RPC explícito es más simple de razonar, de probar y de auditar en esta etapa del proyecto. Se reevaluará un trigger solo si en el futuro aparece una necesidad concreta (por ejemplo, sincronización desde un proceso externo) que lo justifique.
- **Ninguna UI de Admin antes de que el RPC/función esté diseñado y aprobado.** La conexión de UI queda fuera del alcance de esta fase y de la siguiente fase de borrador SQL. Solo después de que Luis apruebe explícitamente un paquete de ejecución para este RPC, y ese paquete se ejecute y verifique, correspondería diseñar la conexión de UI.

---

## 6. Concepto propuesto de RPC/función

**Nombre propuesto (borrador, no definitivo):**

```
inventory_apply_stock_movement
```

Este nombre es una propuesta de trabajo para este documento. La sección 15 deja abierta la decisión final del nombre.

**Parámetros de entrada mínimos (Fase 6F core):**

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `p_item_id` | `uuid` | Sí | Ítem de `inventory_items` afectado por el movimiento |
| `p_movement_type` | `text` | Sí | Tipo de movimiento (ver sección 7) |
| `p_quantity` | `numeric` | Sí | Cantidad del movimiento, siempre positiva; el tipo determina si suma o resta |
| `p_reason` | `text` | No (nullable) | Motivo del movimiento |
| `p_notes` | `text` | No (nullable) | Notas adicionales de contexto |
| `p_linked_request_id` | `uuid` | No (nullable) | Vínculo a `inventory_requests`, si el movimiento se originó desde una solicitud de Staff |

**Parámetros futuros (fuera del núcleo de Fase 6F):**

Detalle de compra, proveedor, vínculo a comprobante/recibo, y vínculo a costo/gasto quedan explícitamente marcados como **futuros**, dependientes del diseño de `inventory_purchases` (postergado según sección 9 del modelo de datos). No forman parte del diseño core de esta fase y no deben agregarse a la firma del RPC hasta que ese módulo se diseñe.

---

## 7. Reglas de tipo de movimiento

**Suman stock:**
- `entrada_compra`
- `entrada_regularizacion`
- `ajuste_admin`, cuando el ajuste positivo esté explícitamente soportado más adelante

**Restan stock:**
- `salida_consumo`
- `baja_daño`
- `baja_perdida`
- `ajuste_admin`, cuando el ajuste negativo esté explícitamente soportado más adelante

**Caso especial — `correccion_admin`:**

Este tipo requiere tratamiento cuidadoso porque su propósito es corregir un movimiento previo erróneo, no registrar una variación operacional nueva. Recomendación:

- `p_notes` debe ser **obligatorio** (no nullable) cuando `movement_type = 'correccion_admin'`, explicando qué movimiento se corrige y por qué.
- Se recomienda que `correccion_admin` **no** se habilite en la UI de Admin en el primer lanzamiento (MVP). Debe quedar disponible únicamente vía ejecución directa y controlada, hasta que exista un flujo de aprobación separado (por ejemplo, requerir referencia explícita al `id` del movimiento que se corrige).

**Recomendación de simplificación para MVP:**

Se recomienda que el MVP del RPC soporte inicialmente solo los tipos con dirección fija y sin ambigüedad: `entrada_compra`, `entrada_regularizacion`, `salida_consumo`, `baja_daño`, `baja_perdida`. El manejo de `ajuste_admin` con signo variable (positivo o negativo dentro del mismo tipo) agrega complejidad de validación — habría que decidir si el signo lo determina un parámetro adicional (`p_direction`) o si se modela como dos tipos separados (`ajuste_admin_suma` / `ajuste_admin_resta`). Esa decisión de modelado se dejaría pendiente y `correccion_admin` quedaría deshabilitado en la UI hasta una fase posterior con su propio flujo de aprobación. Esto no es una decisión tomada — se documenta como recomendación para que Luis decida (ver sección 15).

---

## 8. Reglas de validación

El RPC/función debe validar, en este orden o equivalente:

1. El usuario debe estar autenticado (`auth.uid()` no nulo).
2. El rol del usuario debe ser `admin`, verificado vía `get_my_role() = 'admin'`.
3. El ítem (`p_item_id`) debe existir en `inventory_items`.
4. El ítem debe estar activo (`active = true`).
5. `p_quantity` debe ser mayor que cero.
6. `p_movement_type` debe pertenecer al conjunto de tipos permitidos (sección 7).
7. El `new_stock` resultante debe ser mayor o igual a cero. Si el movimiento dejaría el stock en negativo, la función debe rechazar la operación completa.
8. Si `p_linked_request_id` no es nulo, la solicitud debe existir en `inventory_requests`.
9. Ninguna operación de `DELETE` está permitida dentro de este RPC ni en ningún flujo relacionado.
10. No se permite corrección silenciosa de stock: cualquier `movement_type` de tipo corrección (`correccion_admin`) requiere `p_notes` no nulo y no vacío.

Si cualquiera de estas validaciones falla, la función debe abortar sin aplicar ningún cambio parcial.

---

## 9. Comportamiento atómico

El RPC debe ejecutarse como una sola operación transaccional (comportamiento nativo de una función PL/pgSQL: si la función lanza una excepción, Postgres revierte automáticamente todo lo que la función haya hecho hasta ese punto). Secuencia lógica:

1. Leer el `current_stock` actual del ítem (`previous_stock`).
2. Calcular el `new_stock` según `movement_type` y `p_quantity` (suma o resta, según sección 7).
3. Validar que `new_stock >= 0`; si no, abortar con error, sin tocar ninguna tabla.
4. Actualizar `inventory_items.current_stock = new_stock` (y `updated_by`, `updated_at`).
5. Insertar una fila en `inventory_movements` con `item_id`, `movement_type`, `quantity`, `previous_stock`, `new_stock`, `reason`, `notes`, `created_by`, `linked_request_id`.
6. Retornar un resultado útil al llamador (ver sección 12 para el formato propuesto).
7. Si cualquier paso falla — incluida la inserción del movimiento — la función completa falla y ningún cambio queda aplicado. No debe existir un estado donde `current_stock` cambió pero no existe un movimiento correspondiente, ni viceversa.

---

## 10. Modelo de seguridad

**¿Debe ser `SECURITY DEFINER`?**

Sí, se recomienda `SECURITY DEFINER`, siguiendo el mismo patrón ya usado por `get_my_role()` en este proyecto (`STABLE SECURITY DEFINER`, `SET search_path TO 'public', 'pg_catalog'`, confirmado en `docs/RESULTADO_FASE_6A_VERIFICACION_PREVIA_INVENTARIO_506A_2026-08-14.md`). La razón es que la función necesita poder escribir en `inventory_items` e `inventory_movements` incluso cuando no exista ninguna política RLS de `UPDATE` para Admin sobre `inventory_items` — el RPC es, por diseño, la única puerta de escritura.

`SECURITY DEFINER` sin controles adicionales sería peligroso. Salvaguardas obligatorias si se aprueba este enfoque:

- Verificación explícita `get_my_role() = 'admin'` **dentro** del cuerpo de la función, ejecutada antes de cualquier lectura o escritura — no basta con que el llamador diga que es Admin.
- `SET search_path = public, pg_catalog` en la definición de la función, para evitar secuestro de search_path.
- No confiar en ninguna suposición de rol proveniente del frontend. El frontend puede enviar cualquier parámetro; la única fuente de verdad del rol es `get_my_role()` evaluado server-side dentro de la función.
- `REVOKE EXECUTE FROM PUBLIC` es obligatorio. Ninguna función `SECURITY DEFINER` debe quedar con el permiso de ejecución por defecto abierto a `PUBLIC`.
- `REVOKE EXECUTE FROM anon` es obligatorio. Sin acceso anónimo a esta función, explícitamente revocado, no solo omitido.
- `GRANT EXECUTE` únicamente al rol `authenticated`. Ningún otro rol de base de datos debe tener permiso de ejecución.
- Aun con `GRANT EXECUTE` otorgado a `authenticated`, la función debe seguir validando `get_my_role() = 'admin'` internamente. El `GRANT` a nivel de rol de base de datos no reemplaza la verificación de rol de negocio: cualquier usuario autenticado (incluyendo Staff) puede invocar la función a nivel de permisos SQL, y es la verificación interna la que rechaza a quien no sea Admin.
- La `service_role` de Supabase nunca debe usarse desde el frontend, ni para este RPC ni para ninguna otra operación.

---

## 11. Relación con RLS

- Actualmente Admin **no puede** hacer `UPDATE` directo sobre `inventory_items` — no existe ninguna política que lo permita (confirmado en Fase 6E, BLOCK 10, 21/21 pruebas).
- Admin **sí puede** hacer `INSERT` y `SELECT` sobre `inventory_movements` mediante las políticas aprobadas `admin_insert_inventory_movements` y `admin_select_inventory_movements`.
- El RPC/función debe ser la **única** vía aprobada para modificar `current_stock`. Al ser `SECURITY DEFINER`, el RPC no depende de que exista una política de `UPDATE` para Admin sobre `inventory_items` — opera con los privilegios del dueño de la función, tras verificar el rol internamente.
- Explícitamente: **no se debe crear `admin_update_inventory_items` como atajo.** Crear esa política abriría una segunda vía de escritura sobre `current_stock` que no pasa por el RPC, reintroduciendo exactamente el problema que la Fase 6E dejó bloqueado a propósito (sección 4 de este documento). El RPC y una política de `UPDATE` directa son mutuamente excluyentes como estrategia; este documento recomienda el RPC como único camino.

---

## 12. Borrador de SQL

> **BORRADOR — NO EJECUTAR**
>
> El siguiente bloque es un esqueleto conceptual para discusión y revisión. No ha sido probado, no ha sido revisado línea por línea, y no está aprobado para ejecución. No se ejecuta en esta fase ni en ninguna fase hasta que Luis apruebe explícitamente un paquete de ejecución separado.

```sql
-- BORRADOR — NO EJECUTAR
-- Fase 6F — Esqueleto conceptual del RPC de integridad de stock.
-- No probado. No revisado línea por línea. No aprobado para ejecución.

CREATE OR REPLACE FUNCTION public.inventory_apply_stock_movement(
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_linked_request_id uuid DEFAULT NULL
)
RETURNS TABLE (
  movement_id uuid,
  item_id uuid,
  previous_stock numeric,
  new_stock numeric,
  movement_type text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid;
  v_role text;
  v_active boolean;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_delta numeric;
  v_movement_id uuid;
  v_movement_created_at timestamptz;
  v_request_item_id uuid;
BEGIN
  -- 0. Validación de autenticación.
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado: usuario no autenticado';
  END IF;

  -- 1. Verificación de rol (no confiar en el frontend).
  v_role := get_my_role();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol admin';
  END IF;

  -- 2. Validación de tipo de movimiento permitido.
  IF p_movement_type NOT IN (
    'entrada_compra', 'entrada_regularizacion',
    'salida_consumo', 'baja_daño', 'baja_perdida'
    -- 'ajuste_admin' y 'correccion_admin': ver sección 7 y 15 (pendiente de decisión de modelado)
  ) THEN
    RAISE EXCEPTION 'movement_type no permitido: %', p_movement_type;
  END IF;

  -- 3. Validación de cantidad.
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'p_quantity debe ser mayor que cero';
  END IF;

  -- 4. Lectura de stock actual + bloqueo de fila para evitar condiciones de carrera.
  SELECT current_stock, active
    INTO v_previous_stock, v_active
    FROM public.inventory_items
    WHERE id = p_item_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ítem no encontrado: %', p_item_id;
  END IF;

  IF NOT v_active THEN
    RAISE EXCEPTION 'Ítem inactivo: %', p_item_id;
  END IF;

  -- 5. Validación de solicitud vinculada, si corresponde.
  IF p_linked_request_id IS NOT NULL THEN
    SELECT linked_item_id
      INTO v_request_item_id
      FROM public.inventory_requests
      WHERE id = p_linked_request_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Solicitud vinculada no encontrada: %', p_linked_request_id;
    END IF;

    -- Si la solicitud ya tiene un ítem de catálogo vinculado, debe coincidir con p_item_id.
    IF v_request_item_id IS NOT NULL AND v_request_item_id <> p_item_id THEN
      RAISE EXCEPTION 'La solicitud % está vinculada a un ítem distinto de %', p_linked_request_id, p_item_id;
    END IF;

    -- Si v_request_item_id es NULL, se permite por ahora: la solicitud pudo haber iniciado
    -- como texto libre (item_free_text) sin ítem de catálogo asociado. Pendiente de revisión
    -- en un futuro flujo Admin (ver sección 15).
  END IF;

  -- 6. Cálculo de delta según tipo de movimiento.
  v_delta := CASE
    WHEN p_movement_type IN ('entrada_compra', 'entrada_regularizacion') THEN p_quantity
    WHEN p_movement_type IN ('salida_consumo', 'baja_daño', 'baja_perdida') THEN -p_quantity
    ELSE 0
  END;

  v_new_stock := v_previous_stock + v_delta;

  -- 7. Rechazo de stock negativo.
  IF v_new_stock < 0 THEN
    RAISE EXCEPTION 'Operación rechazada: stock resultante negativo (% -> %)',
      v_previous_stock, v_new_stock;
  END IF;

  -- 8. Actualización de inventory_items (única escritura de current_stock aprobada).
  UPDATE public.inventory_items
    SET current_stock = v_new_stock,
        updated_by = v_user_id,
        updated_at = now()
    WHERE id = p_item_id;

  -- 9. Inserción del movimiento correspondiente (evidencia obligatoria).
  INSERT INTO public.inventory_movements (
    item_id, movement_type, quantity, previous_stock, new_stock,
    reason, notes, created_by, linked_request_id
  ) VALUES (
    p_item_id, p_movement_type, p_quantity, v_previous_stock, v_new_stock,
    p_reason, p_notes, v_user_id, p_linked_request_id
  )
  RETURNING id, created_at INTO v_movement_id, v_movement_created_at;

  -- 10. Resultado.
  RETURN QUERY
    SELECT v_movement_id, p_item_id, v_previous_stock, v_new_stock, p_movement_type, v_movement_created_at;
END;
$$;

-- Propuesta de permisos (borrador, no ejecutado):
-- REVOKE ALL ON FUNCTION public.inventory_apply_stock_movement(
--   uuid, text, numeric, text, text, uuid
-- ) FROM PUBLIC;
-- REVOKE ALL ON FUNCTION public.inventory_apply_stock_movement(
--   uuid, text, numeric, text, text, uuid
-- ) FROM anon;
-- GRANT EXECUTE ON FUNCTION public.inventory_apply_stock_movement(
--   uuid, text, numeric, text, text, uuid
-- ) TO authenticated;
-- Sin uso de service_role desde el frontend.
```

Este esqueleto no cubre: manejo de `ajuste_admin` con signo variable, habilitación de `correccion_admin`, ni ningún campo de compra/proveedor/costo — todos quedan pendientes según las secciones 7 y 15.

---

## 13. Plan de pruebas para una fase posterior

Las siguientes pruebas quedan documentadas para cuando exista un paquete de ejecución aprobado. **No se ejecutan en esta fase.**

- Admin ejecuta un movimiento válido de tipo entrada → `current_stock` aumenta correctamente.
- Admin ejecuta un movimiento válido de tipo salida/baja → `current_stock` disminuye correctamente.
- Admin intenta un movimiento que dejaría el stock en negativo → la operación es rechazada, sin cambios aplicados.
- Staff intenta ejecutar el RPC → rechazado por verificación de rol.
- Un usuario no autenticado intenta ejecutar el RPC → rechazado.
- Todo movimiento aplicado genera exactamente una fila correspondiente en `inventory_movements`.
- `inventory_items.current_stock` e `inventory_movements` permanecen consistentes en todo momento (el último `new_stock` de un ítem coincide con su `current_stock`).
- El manejo de `p_linked_request_id` funciona: un movimiento vinculado a una solicitud existente se registra correctamente; un `p_linked_request_id` inexistente es rechazado.
- Ante una falla simulada dentro de la función (por ejemplo, en el paso de `INSERT` a `inventory_movements`), no queda ninguna actualización parcial en `inventory_items` — la transacción completa se revierte.

---

## 14. Implicancias de UI, sin implementación de UI

- Cuando exista una UI de Admin para el módulo de inventario, esa UI debe invocar **únicamente** el RPC/función de movimiento de stock para cualquier cambio de `current_stock`.
- La UI de Admin **no debe** enviar un `PATCH`/`UPDATE` directo a `inventory_items.current_stock` bajo ninguna circunstancia, ni siquiera como atajo temporal.
- La UI de Staff permanece limitada a crear solicitudes (`inventory_requests`); no cambia en esta fase ni en el diseño de este RPC.
- El bloque Insumos legacy y su tabla `supply_alerts` permanecen intactos hasta que exista una decisión explícita de migración o retiro.

Ninguna conexión de UI se implementa en esta fase.

---

## 15. Decisiones abiertas para Luis

- Nombre final de la función (`inventory_apply_stock_movement` es una propuesta, no una decisión tomada).
- Modelo exacto de ajuste permitido: si `ajuste_admin` se modela con un parámetro de dirección adicional, con dos tipos separados, o se excluye del MVP por completo.
- Si `correccion_admin` se habilita en el MVP de la UI de Admin, o permanece deshabilitado hasta un flujo de aprobación separado.
- Formato de retorno del RPC (tabla, JSON, o un tipo compuesto específico).
- Si el `status` de una `inventory_request` vinculada (`p_linked_request_id`) se actualiza dentro del mismo RPC (por ejemplo, a `resuelta`), o si eso se maneja en un flujo de Admin posterior y separado.
- Si los campos de compra/proveedor/comprobante/costo esperan a un futuro módulo de compras (`inventory_purchases`), como recomienda este documento, o si alguna variante mínima se adelanta.

---

## 16. Conclusión final

La Fase 6F es solo de diseño. Ningún SQL debe ejecutarse hasta que Luis apruebe explícitamente un paquete de ejecución futuro, separado de este documento, siguiendo el mismo patrón de control bloque por bloque usado en la Fase 6E.

---

*Documento generado: 2026-08-17*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
