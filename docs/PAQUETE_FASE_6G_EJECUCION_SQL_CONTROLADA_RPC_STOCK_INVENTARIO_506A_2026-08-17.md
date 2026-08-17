# Paquete Fase 6G — Ejecución SQL Controlada — RPC de Integridad de Stock — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app
**Fase:** 6G — Preparación del paquete de ejecución controlada del RPC/función de integridad de stock
**Fecha:** 2026-08-17
**Estado:** DOCUMENTATION ONLY — SQL NOT EXECUTED
**Commit base:** `5514cc5` — Document inventory phase 6F stock RPC design
**Fases previas:** Cierre Fase 6E (`docs/CIERRE_FASE_6E_EJECUCION_CONTROLADA_INVENTARIO_506A_2026-08-15.md`) · Diseño Fase 6F (`docs/DISENO_FASE_6F_RPC_INTEGRIDAD_STOCK_INVENTARIO_506A_2026-08-17.md`) · Paquete Fase 6C (`docs/PAQUETE_FASE_6C_EJECUCION_SQL_CONTROLADA_INVENTARIO_506A_2026-08-14.md`) · Acta Fase 6D (`docs/ACTA_FASE_6D_GO_FINAL_CONTROLADO_INVENTARIO_506A_2026-08-14.md`)

> **Este documento NO autoriza ejecución por sí mismo.** Es un paquete de preparación. Ningún bloque de este documento debe ejecutarse en Supabase hasta que Luis apruebe explícitamente ese bloque, uno a la vez, en el momento mismo de la ejecución — siguiendo exactamente el mismo modelo de autorización que la Fase 6C y la Fase 6E ya usaron para las tablas base.

---

## 1. Propósito

Este documento prepara la futura ejecución SQL controlada del RPC/función de integridad de stock diseñado en la Fase 6F (`inventory_apply_stock_movement`).

Objetivos de este paquete:

- Organizar en bloques ejecutables uno por uno el SQL necesario para crear el RPC, configurar sus permisos, y verificarlo — igual que la Fase 6C organizó la creación de las tablas base.
- Preservar la regla central del proyecto: `inventory_items.current_stock` **no debe** actualizarse directamente desde la UI ni desde ninguna ruta de `UPDATE` ordinaria.
- Garantizar que todo cambio de stock, sin excepción, cree un registro correspondiente en `inventory_movements`.

Este documento no ejecuta nada. Prepara lo que una fase de ejecución futura (Fase 6H o posterior) podría ejecutar, bloque por bloque, solo con el GO explícito de Luis.

---

## 2. Límite de seguridad (Safety boundary)

- No se ejecuta SQL en este documento.
- No se muta Supabase en este documento.
- No se crea ninguna función en Supabase.
- No se modifican permisos en Supabase.
- No se conecta ninguna interfaz de usuario.
- `index.html` permanece intacto.
- Ningún archivo de código de la aplicación cambia.
- No se toca Staff Servicios.
- No se toca el bloque Insumos legacy.
- No se toca `supply_alerts`.
- El comportamiento en producción no cambia.
- Este documento es el único artefacto creado en esta fase.

---

## 3. Alcance

### Incluido en este paquete

- Bloque de creación/reemplazo del RPC/función `public.inventory_apply_stock_movement`.
- Bloque de permisos: `REVOKE`/`GRANT EXECUTE`.
- Consultas de verificación estructural (existencia de la función, `SECURITY DEFINER`, `search_path`, permisos otorgados).
- Plan de pruebas en tiempo de ejecución (Admin positivo, Staff/no autenticado negativo), siempre dentro de transacciones reversibles.
- Bloque de rollback del RPC, no ejecutable sin aprobación explícita.

### Excluido de este paquete

- Ninguna implementación de UI.
- Ningún cambio a Staff (ni a su UI, ni a sus permisos, ni a `supply_alerts`).
- Ningún cambio al bloque Insumos legacy.
- Ningún trigger. La Fase 6F confirmó la dirección RPC/función primero; el trigger queda postergado.
- Ningún módulo de compras (`inventory_purchases`).
- Ninguna política `admin_update_inventory_items` ni ninguna otra ruta de `UPDATE` directo sobre `inventory_items` para Admin.
- Ninguna migración de datos.
- Ninguna carga de datos semilla (`seed data`).

---

## 4. Precondiciones

Antes de que cualquier bloque de este paquete pueda ejecutarse en una fase futura, deben cumplirse (y reverificarse en BLOCK 0, no asumirse por este documento):

- `inventory_items`, `inventory_requests` e `inventory_movements` existen en `public`.
- RLS está habilitado en las 3 tablas.
- La Fase 6E fue cerrada exitosamente (`docs/CIERRE_FASE_6E_EJECUCION_CONTROLADA_INVENTARIO_506A_2026-08-15.md`).
- Se espera que las 3 tablas de inventario tengan 0 filas de producción, salvo que se verifique lo contrario en el momento mismo de la ejecución — este documento no asume que esa condición sigue siendo cierta al momento de ejecutar.
- `get_my_role()` existe y sigue siendo `STABLE SECURITY DEFINER` con `SET search_path TO 'public', 'pg_catalog'`.
- Los roles `admin` y `staff` en `public.profiles` ya fueron validados (Fase 6A).
- La ejecución debe hacerse bloque por bloque, únicamente después de la aprobación explícita de Luis para ese bloque específico — nunca por un GO general.

---

## 5. Bloques de ejecución controlada

> **Cada bloque está marcado individualmente como `BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS`. Ninguno de estos bloques ha sido ejecutado.**

- BLOCK 0 — Preflight de solo lectura
- BLOCK 1 — Crear/reemplazar RPC `inventory_apply_stock_movement`
- BLOCK 2 — Revocar/otorgar permisos de ejecución
- BLOCK 3 — Verificar existencia de la función y sus permisos
- BLOCK 4 — Prueba positiva Admin en tiempo de ejecución, dentro de transacción
- BLOCK 5 — Prueba negativa Staff / no autenticado
- BLOCK 6 — Verificar rollback / ausencia de datos de prueba remanentes
- BLOCK 7 — Verificación final
- BLOCK 8 — Plan de rollback del RPC, no ejecutable sin aprobación explícita

---

### BLOCK 0 — Preflight de solo lectura

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

```sql
-- Confirmar que las 3 tablas base siguen existiendo
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('inventory_items', 'inventory_requests', 'inventory_movements')
ORDER BY table_name;
-- Esperado: 3 filas.

-- Confirmar RLS habilitado en las 3 tablas
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('inventory_items', 'inventory_requests', 'inventory_movements')
ORDER BY c.relname;
-- Esperado: rls_enabled = true en las 3 filas.

-- Confirmar conteo de filas actual (no asumir 0; solo verificar)
SELECT 'inventory_items' AS tabla, count(*) FROM inventory_items
UNION ALL
SELECT 'inventory_requests', count(*) FROM inventory_requests
UNION ALL
SELECT 'inventory_movements', count(*) FROM inventory_movements;

-- Confirmar que get_my_role() existe y sigue siendo SECURITY DEFINER
SELECT p.proname AS function_name,
       p.prosecdef AS is_security_definer,
       p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_my_role';
-- Esperado: 1 fila, is_security_definer = true.

-- Confirmar que la función RPC de esta fase AÚN NO existe
SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'inventory_apply_stock_movement';
-- Esperado: 0 filas si es la primera ejecución. Si aparece 1 fila,
-- detenerse y confirmar con Luis antes de usar CREATE OR REPLACE.

-- Confirmar que NO existe ninguna política admin_update_inventory_items
SELECT polname
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'inventory_items'
  AND pol.polname = 'admin_update_inventory_items';
-- Esperado: 0 filas.

-- Confirmar roles admin/staff vigentes
SELECT DISTINCT role FROM public.profiles ORDER BY role;
-- Esperado: admin, staff (minúsculas).
```

Este bloque repite verificaciones ya hechas en fases anteriores porque el tiempo transcurrido entre este documento y una ejecución real puede haber cambiado el estado de la base de datos.

---

### BLOCK 1 — Crear/reemplazar RPC `inventory_apply_stock_movement`

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Este bloque sigue exactamente el diseño aprobado en la Fase 6F (`docs/DISENO_FASE_6F_RPC_INTEGRIDAD_STOCK_INVENTARIO_506A_2026-08-17.md`, sección 12), con el conjunto MVP de tipos de movimiento (sin `ajuste_admin` ni `correccion_admin`, según la recomendación de simplificación de esa fase — ver decisión pendiente en sección 15 del diseño). El `RETURNS TABLE` de este paquete agrega `quantity` a la salida, para que el llamador reciba también la cantidad aplicada junto con el resto del resultado del movimiento.

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- Fase 6G — RPC de integridad de stock, según diseño aprobado en Fase 6F.

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
  quantity numeric,
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

  -- 2. Validación de tipo de movimiento permitido (conjunto MVP, sin signo variable).
  --    NULL se rechaza explícitamente: NOT IN con NULL evalúa a NULL (no a TRUE),
  --    por lo que sin este chequeo un p_movement_type NULL pasaría de largo.
  IF p_movement_type IS NULL OR p_movement_type NOT IN (
    'entrada_compra', 'entrada_regularizacion',
    'salida_consumo', 'baja_daño', 'baja_perdida'
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

    IF v_request_item_id IS NOT NULL AND v_request_item_id <> p_item_id THEN
      RAISE EXCEPTION 'La solicitud % está vinculada a un ítem distinto de %', p_linked_request_id, p_item_id;
    END IF;
    -- Si v_request_item_id es NULL, se permite: la solicitud pudo haber iniciado
    -- como texto libre (item_free_text) sin ítem de catálogo asociado.
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
    SELECT v_movement_id, p_item_id, v_previous_stock, v_new_stock,
           p_movement_type, p_quantity, v_movement_created_at;
END;
$$;
```

---

### BLOCK 2 — Revocar/otorgar permisos de ejecución

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- Fase 6G — Permisos del RPC de integridad de stock.

REVOKE ALL ON FUNCTION public.inventory_apply_stock_movement(
  uuid, text, numeric, text, text, uuid
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.inventory_apply_stock_movement(
  uuid, text, numeric, text, text, uuid
) FROM anon;

GRANT EXECUTE ON FUNCTION public.inventory_apply_stock_movement(
  uuid, text, numeric, text, text, uuid
) TO authenticated;
```

**Nota importante:** otorgar `EXECUTE` a `authenticated` **no es suficiente** por sí solo. Cualquier usuario autenticado — incluyendo Staff — puede invocar la función a nivel de permisos SQL una vez que este `GRANT` existe. La función sigue validando `get_my_role() = 'admin'` **internamente** (paso 1 del cuerpo de la función, BLOCK 1) como el único mecanismo real de control de acceso por rol. El `GRANT EXECUTE` resuelve quién puede *intentar* llamar la función; la verificación interna resuelve quién puede *tener éxito* al llamarla.

---

### BLOCK 3 — Verificar existencia de la función y sus permisos

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

```sql
-- Confirmar que la función existe, con la firma esperada
SELECT p.proname AS function_name,
       pg_get_function_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS is_security_definer,
       p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'inventory_apply_stock_movement';
-- Esperado: 1 fila. is_security_definer = true.
-- config_settings debe incluir search_path=public, pg_catalog.

-- Confirmar permisos otorgados (debe aparecer únicamente authenticated)
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'inventory_apply_stock_movement'
ORDER BY grantee;
-- Esperado: solo la fila authenticated / EXECUTE.
-- No debe aparecer PUBLIC ni anon.

-- Verificación más estricta con has_function_privilege(), por rol, sobre la firma exacta.
SELECT has_function_privilege(
  'anon',
  'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
  'EXECUTE'
) AS anon_can_execute;
-- Esperado: false.

SELECT has_function_privilege(
  'authenticated',
  'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
  'EXECUTE'
) AS authenticated_can_execute;
-- Esperado: true.
```

---

### Nota obligatoria sobre autenticación antes de las pruebas en tiempo de ejecución (BLOCK 4 y BLOCK 5)

**El editor SQL de Supabase no impersona automáticamente a los usuarios Admin o Staff de la aplicación.** Ejecutar una consulta en el SQL Editor normalmente corre con privilegios de administrador de la base de datos, no como un usuario autenticado real de `auth.users` — `auth.uid()` no queda poblado solo porque el SQL se ejecuta dentro de un proyecto de Supabase.

Antes de ejecutar BLOCK 4 o BLOCK 5, el método de autenticación debe definirse explícitamente, por una de estas dos vías:

- **Vía PostgREST/RPC con un JWT real** del usuario de prueba correspondiente (Admin o Staff), llamando a la función a través de la API — este es el método que refleja el comportamiento real de producción.
- **Vía simulación controlada de claims JWT dentro del SQL Editor** (por ejemplo, fijando `request.jwt.claims` o el rol de sesión para que `auth.uid()` devuelva el UUID del usuario de prueba), **únicamente si Luis aprueba explícitamente ese método** para esta ejecución.

**Los bloques `DO $$ ... $$` de BLOCK 4 y BLOCK 5, tal como están escritos en este documento, son ejecutables literalmente únicamente bajo el método de simulación controlada de claims JWT en el SQL Editor, y solo si Luis aprueba explícitamente ese método.** Un bloque `DO` es un bloque anónimo de PL/pgSQL ejecutado directamente contra la base de datos; no es una llamada de API y no puede invocarse a través de PostgREST.

Si Luis opta por el método PostgREST/RPC con JWT real, los bloques `DO` de BLOCK 4 y BLOCK 5 **no deben ejecutarse literalmente** a través de PostgREST — no es una operación válida bajo ese método. En ese caso, las pruebas descritas en BLOCK 4 y BLOCK 5 deben traducirse a llamadas equivalentes a la API/RPC (una llamada `POST` a `/rest/v1/rpc/inventory_apply_stock_movement` por cada paso, autenticada con el JWT del usuario de prueba correspondiente), verificando los mismos resultados esperados (valores de `previous_stock`/`new_stock`, o el código de error/excepción devuelto) por los medios propios de ese cliente, no por `RAISE EXCEPTION` dentro de un `DO` block.

Ningún bloque de prueba de esta sección debe ejecutarse asumiendo que `auth.uid()` está poblado por defecto. Esta decisión de método queda pendiente de aprobación de Luis (ver también sección 9, checklist final).

---

### BLOCK 4 — Prueba positiva Admin en tiempo de ejecución, dentro de transacción

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Esta prueba debe ejecutarse autenticado como el usuario de prueba Admin (`reservas@ferranpropiedades.cl`, confirmado en el Cierre de Fase 6E), usando uno de los dos métodos de autenticación descritos en la nota anterior, y **siempre dentro de una transacción que termina en `ROLLBACK`**, para no dejar ningún dato de prueba permanente.

El bloque se escribe como un `DO $$ ... $$` autocontenido con una variable local (`v_test_item_id`), en lugar de una variable de sustitución de cliente SQL (tipo `:test_item_id`), para que sea ejecutable literalmente tal como está escrito, sin depender de que el cliente (psql, Supabase SQL Editor, etc.) soporte variables de sesión.

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- Ejecutar autenticado como el usuario de prueba Admin (ver nota de autenticación arriba).

BEGIN;

DO $$
DECLARE
  v_test_item_id uuid;
  v_result record;
BEGIN
  -- 4.1. Crear un ítem de prueba temporal (dentro de la misma transacción).
  INSERT INTO public.inventory_items (item_name, category, unit, current_stock, min_stock, created_by)
  VALUES ('__PRUEBA_6G__ Ítem temporal', 'Otros', 'unidad', 10, 2, auth.uid())
  RETURNING id INTO v_test_item_id;

  -- 4.2. Aplicar una entrada de regularización.
  SELECT * INTO v_result FROM public.inventory_apply_stock_movement(
    v_test_item_id, 'entrada_regularizacion', 5, 'Prueba Fase 6G', 'Prueba en transacción, no persistente', NULL
  );
  IF v_result.previous_stock IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION '4.2: previous_stock esperado 10, obtenido %', v_result.previous_stock;
  END IF;
  IF v_result.new_stock IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION '4.2: new_stock esperado 15, obtenido %', v_result.new_stock;
  END IF;

  -- 4.3. Aplicar una salida de consumo.
  SELECT * INTO v_result FROM public.inventory_apply_stock_movement(
    v_test_item_id, 'salida_consumo', 3, 'Prueba Fase 6G', 'Prueba en transacción, no persistente', NULL
  );
  IF v_result.previous_stock IS DISTINCT FROM 15 THEN
    RAISE EXCEPTION '4.3: previous_stock esperado 15, obtenido %', v_result.previous_stock;
  END IF;
  IF v_result.new_stock IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION '4.3: new_stock esperado 12, obtenido %', v_result.new_stock;
  END IF;

  -- 4.4. Verificar current_stock actualizado y movimientos insertados.
  IF (SELECT current_stock FROM public.inventory_items WHERE id = v_test_item_id) IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION '4.4: current_stock final esperado 12';
  END IF;

  IF (SELECT count(*) FROM public.inventory_movements WHERE item_id = v_test_item_id) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION '4.4: se esperaban exactamente 2 movimientos registrados para el ítem de prueba';
  END IF;

  RAISE NOTICE 'BLOCK 4: todas las verificaciones pasaron para v_test_item_id = %', v_test_item_id;
END;
$$;

ROLLBACK;
-- Obligatorio: revertir todo lo hecho en este bloque de prueba, incluyendo el ítem
-- y los movimientos creados dentro del DO block.
```

---

### BLOCK 5 — Prueba negativa Staff / no autenticado

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Este bloque cubre explícitamente seis casos de rechazo: stock negativo, `p_movement_type` NULL, `movement_type` inválido, Staff, no autenticado, y `linked_request_id` incompatible. Ver la nota de autenticación antes de BLOCK 4 para el método a usar en 5.1 y 5.2.

Los casos 5.3 a 5.6 se ejecutan autenticados como Admin, y usan el mismo patrón de `DO $$ ... $$` con captura de excepción vía `BEGIN ... EXCEPTION WHEN OTHERS` para verificar que la función efectivamente rechaza el caso, en lugar de solo documentar el resultado esperado en un comentario.

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS

-- 5.1. Staff rechazado.
-- Ejecutar autenticado como el usuario de prueba Staff
-- (francisca.cabanas@gmail.com, confirmado en el Cierre de Fase 6E).
BEGIN;

SELECT * FROM public.inventory_apply_stock_movement(
  (SELECT id FROM public.inventory_items LIMIT 1),
  'entrada_regularizacion', 1, 'Prueba Fase 6G — debe fallar', NULL, NULL
);
-- Esperado: excepción "No autorizado: se requiere rol admin".
-- Ningún cambio debe quedar aplicado.

ROLLBACK;

-- 5.2. No autenticado rechazado.
-- Ejecutar sin sesión autenticada (rol anon, o token inválido/expirado),
-- normalmente probado desde el cliente API (PostgREST), no desde el editor SQL.
-- Esperado a nivel de API: rechazo por falta de permiso de ejecución (BLOCK 2, sin GRANT a anon)
-- y, si se llegara a invocar autenticada con auth.uid() nulo, excepción
-- "No autorizado: usuario no autenticado" desde dentro de la función.
```

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- 5.3 a 5.6: ejecutar autenticado como el usuario de prueba Admin.

BEGIN;

DO $$
DECLARE
  v_test_item_id uuid;
  v_other_item_id uuid;
  v_test_request_id uuid;
  v_error_caught boolean;
BEGIN
  -- Ítem base para las pruebas de este bloque.
  INSERT INTO public.inventory_items (item_name, category, unit, current_stock, min_stock, created_by)
  VALUES ('__PRUEBA_6G__ Ítem negativo A', 'Otros', 'unidad', 5, 1, auth.uid())
  RETURNING id INTO v_test_item_id;

  -- 5.3. movement_type inválido rechazado.
  v_error_caught := false;
  BEGIN
    PERFORM * FROM public.inventory_apply_stock_movement(
      v_test_item_id, 'tipo_invalido', 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    RAISE NOTICE '5.3 excepción esperada capturada: %', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION '5.3: se esperaba excepción por movement_type inválido';
  END IF;

  -- 5.4. p_movement_type NULL rechazado.
  v_error_caught := false;
  BEGIN
    PERFORM * FROM public.inventory_apply_stock_movement(
      v_test_item_id, NULL, 1, NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    RAISE NOTICE '5.4 excepción esperada capturada: %', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION '5.4: se esperaba excepción por movement_type NULL';
  END IF;

  -- 5.5. Stock negativo rechazado (current_stock = 5, salida de 999).
  v_error_caught := false;
  BEGIN
    PERFORM * FROM public.inventory_apply_stock_movement(
      v_test_item_id, 'salida_consumo', 999, 'Prueba Fase 6G — debe fallar', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    RAISE NOTICE '5.5 excepción esperada capturada: %', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION '5.5: se esperaba excepción por stock resultante negativo';
  END IF;
  IF (SELECT current_stock FROM public.inventory_items WHERE id = v_test_item_id) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '5.5: current_stock no debe haber cambiado tras el rechazo';
  END IF;

  -- 5.6. linked_request_id con linked_item_id incompatible, rechazado.
  INSERT INTO public.inventory_items (item_name, category, unit, current_stock, min_stock, created_by)
  VALUES ('__PRUEBA_6G__ Ítem negativo B', 'Otros', 'unidad', 5, 1, auth.uid())
  RETURNING id INTO v_other_item_id;

  INSERT INTO public.inventory_requests (item_free_text, reason, requested_by, status, linked_item_id)
  VALUES ('__PRUEBA_6G__ Solicitud de prueba', 'reposicion_necesaria', auth.uid(), 'en_revision', v_other_item_id)
  RETURNING id INTO v_test_request_id;

  v_error_caught := false;
  BEGIN
    -- v_test_item_id es distinto del linked_item_id de la solicitud (v_other_item_id).
    PERFORM * FROM public.inventory_apply_stock_movement(
      v_test_item_id, 'entrada_regularizacion', 1, NULL, NULL, v_test_request_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    RAISE NOTICE '5.6 excepción esperada capturada: %', SQLERRM;
  END;
  IF NOT v_error_caught THEN
    RAISE EXCEPTION '5.6: se esperaba excepción por linked_request_id incompatible con p_item_id';
  END IF;

  RAISE NOTICE 'BLOCK 5 (5.3-5.6): todas las verificaciones pasaron.';
END;
$$;

ROLLBACK;
-- Obligatorio: revertir todo lo hecho en este bloque, incluyendo ítems y solicitud de prueba.
```

---

### BLOCK 6 — Verificar rollback / ausencia de datos de prueba remanentes

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

```sql
-- Confirmar que ningún ítem de prueba de BLOCK 4/5 quedó persistido.
SELECT count(*) FROM public.inventory_items WHERE item_name LIKE '__PRUEBA_6G__%';
-- Esperado: 0.

-- Confirmar que ningún movimiento de prueba quedó persistido.
SELECT count(*) FROM public.inventory_movements WHERE reason LIKE 'Prueba Fase 6G%';
-- Esperado: 0.

-- Confirmar que ninguna solicitud de prueba quedó persistida.
SELECT count(*) FROM public.inventory_requests WHERE item_free_text LIKE '__PRUEBA_6G__%';
-- Esperado: 0.

-- Confirmar que los conteos generales de las 3 tablas coinciden con el estado
-- registrado en BLOCK 0, salvo cambios de producción explícitamente esperados.
SELECT 'inventory_items' AS tabla, count(*) FROM inventory_items
UNION ALL
SELECT 'inventory_requests', count(*) FROM inventory_requests
UNION ALL
SELECT 'inventory_movements', count(*) FROM inventory_movements;
```

---

### BLOCK 7 — Verificación final

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

```sql
-- Repetir la verificación estructural completa después de todos los bloques anteriores.
SELECT p.proname AS function_name,
       p.prosecdef AS is_security_definer,
       p.proconfig AS config_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'inventory_apply_stock_movement';

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'inventory_apply_stock_movement'
ORDER BY grantee;

-- Verificación más estricta con has_function_privilege(), por rol, sobre la firma exacta
-- (misma verificación que en BLOCK 3, repetida aquí después de todos los bloques anteriores).
SELECT has_function_privilege(
  'anon',
  'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
  'EXECUTE'
) AS anon_can_execute;
-- Esperado: false.

SELECT has_function_privilege(
  'authenticated',
  'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
  'EXECUTE'
) AS authenticated_can_execute;
-- Esperado: true.

-- Confirmar que ninguna política admin_update_inventory_items fue creada
-- en ningún momento de este paquete.
SELECT polname
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'inventory_items'
  AND pol.polname = 'admin_update_inventory_items';
-- Esperado: 0 filas.

-- Confirmar que las 3 tablas base no cambiaron de estructura.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('inventory_items', 'inventory_requests', 'inventory_movements')
ORDER BY table_name, ordinal_position;
```

---

### BLOCK 8 — Plan de rollback del RPC

**PELIGROSO. NO EJECUTAR SIN APROBACIÓN EXPLÍCITA DE LUIS.**

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- PELIGROSO — solo si Luis autoriza revertir la creación del RPC.

DROP FUNCTION IF EXISTS public.inventory_apply_stock_movement(
  uuid, text, numeric, text, text, uuid
);
```

Este rollback elimina únicamente la función `inventory_apply_stock_movement`. **Nunca** debe tocar `inventory_items`, `inventory_requests`, `inventory_movements`, `supply_alerts`, `inventario_items`, `insumos`, `checkout_reports` ni `reservation_payments`. Si además se requiere revertir las tablas base, ese es el alcance del BLOCK 11 de la Fase 6C, no de este documento.

---

## 6. Bloque de permisos — resumen

Ver BLOCK 2 para el SQL completo. Resumen de la política de permisos:

- `REVOKE ALL ... FROM PUBLIC` — obligatorio, elimina el permiso de ejecución por defecto.
- `REVOKE ALL ... FROM anon` — obligatorio, sin acceso anónimo.
- `GRANT EXECUTE ... TO authenticated` — el único rol de base de datos con permiso de ejecución.
- `authenticated` no es suficiente por sí solo: la función sigue validando `get_my_role() = 'admin'` internamente antes de aplicar cualquier cambio. El `GRANT` controla quién puede intentar la llamada a nivel de Postgres/PostgREST; la validación interna controla quién puede tener éxito.

---

## 7. Plan de pruebas

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Admin aplica `entrada_regularizacion` | `current_stock` aumenta correctamente, movimiento insertado |
| 2 | Admin aplica `salida_consumo` | `current_stock` disminuye correctamente, movimiento insertado |
| 3 | Movimiento que dejaría stock negativo | Rechazado, sin cambios aplicados |
| 4 | Staff intenta ejecutar el RPC | Rechazado por verificación interna de rol |
| 5 | Usuario no autenticado intenta ejecutar el RPC | Rechazado (sin `GRANT` a `anon`, y por verificación interna de `auth.uid()`) |
| 6 | `movement_type` inválido | Rechazado |
| 7 | `p_movement_type` NULL | Rechazado |
| 8 | `linked_request_id` con `linked_item_id` incompatible con `p_item_id` | Rechazado |
| 9 | Todas las pruebas anteriores ejecutadas dentro de transacción con `ROLLBACK` | 0 filas de prueba remanentes en `inventory_items`, `inventory_movements` e `inventory_requests` tras el rollback |

Todas las pruebas de este plan deben ejecutarse dentro de transacciones explícitas terminadas en `ROLLBACK`, salvo que Luis autorice explícitamente una prueba con datos persistentes reales (no recomendado para esta fase).

---

## 8. Controles de riesgo

- No conectar ninguna UI hasta que el RPC esté ejecutado, verificado y probado según este paquete.
- Ninguna mutación de datos de producción durante las pruebas, salvo dentro de una transacción controlada con `ROLLBACK`.
- Ninguna corrección silenciosa de stock: el conjunto de tipos de movimiento de este paquete no incluye `ajuste_admin` ni `correccion_admin` (ver sección 15 del diseño de Fase 6F, decisión pendiente).
- Ninguna edición ni eliminación directa de `current_stock` fuera del RPC.
- Ningún `DELETE` en ninguna tabla del módulo, en ningún bloque de este paquete.
- Ningún trigger se introduce en esta fase.

---

## 9. Checklist final GO/NO-GO

- [ ] SQL de los BLOCK 0–8 revisado por Luis.
- [ ] Cada bloque de ejecución aprobado individualmente por Luis en el momento de ejecutar.
- [ ] Proyecto Supabase de destino confirmado (producción vs. cualquier entorno de prueba).
- [ ] Decisión sobre backup/export confirmada, si Luis lo considera necesario antes de ejecutar.
- [ ] Usuarios de prueba Admin y Staff confirmados (ya confirmados en el Cierre de Fase 6E: `reservas@ferranpropiedades.cl` / `francisca.cabanas@gmail.com`).
- [ ] Método de autenticación para las pruebas en tiempo de ejecución (BLOCK 4/BLOCK 5) confirmado por Luis: **PostgREST/RPC con JWT real** o **SQL Editor con simulación controlada de claims JWT**. El método de simulación en el SQL Editor requiere aprobación explícita antes de usarse; si se elige PostgREST/RPC, los bloques `DO` deben traducirse a llamadas de API equivalentes (ver nota antes de BLOCK 4).
- [ ] Camino de rollback (BLOCK 8) entendido y aceptado antes de ejecutar BLOCK 1.
- [ ] Confirmación de que la UI permanece desconectada durante y después de la ejecución de este paquete.

Ningún ítem de este checklist está marcado como completado por este documento. Es responsabilidad de Luis marcarlos en el momento de decidir la ejecución.

---

## 10. Conclusión final

La Fase 6G únicamente prepara el paquete de ejecución controlada del RPC de integridad de stock diseñado en la Fase 6F. Ningún SQL de este documento fue ejecutado. Una futura Fase 6H, o posterior, podría ejecutar este paquete — bloque por bloque — solo con el GO explícito de Luis para cada bloque individual, siguiendo el mismo modelo de autorización usado en la Fase 6E para las tablas base.

---

*Documento generado: 2026-08-17*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
