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
- BLOCK 5 — Prueba negativa Staff / no autenticado (BLOCK 5.0 precheck, BLOCK 5A Staff, BLOCK 5B anon, BLOCK 5C clean verify — Fase 6H)
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

  IF v_active IS DISTINCT FROM true THEN
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
  --    Se usa el alias "im" y se califican id/created_at para evitar ambigüedad
  --    en PL/pgSQL: RETURNS TABLE declara "created_at" como variable implícita,
  --    y una referencia sin calificar en el RETURNING colisionaría con esa
  --    variable bajo plpgsql.variable_conflict = error.
  INSERT INTO public.inventory_movements AS im (
    item_id, movement_type, quantity, previous_stock, new_stock,
    reason, notes, created_by, linked_request_id
  ) VALUES (
    p_item_id, p_movement_type, p_quantity, v_previous_stock, v_new_stock,
    p_reason, p_notes, v_user_id, p_linked_request_id
  )
  RETURNING im.id, im.created_at INTO v_movement_id, v_movement_created_at;

  -- 10. Resultado.
  RETURN QUERY
    SELECT v_movement_id, p_item_id, v_previous_stock, v_new_stock,
           p_movement_type, p_quantity, v_movement_created_at;
END;
$$;
```

**Nota de seguridad operacional — secuencia BLOCK 1 → BLOCK 2 (Fase 6H):**

- PostgreSQL otorga `EXECUTE` a `PUBLIC` por defecto en toda función recién creada, salvo que los privilegios por defecto hayan sido modificados de antemano (no es el caso aquí: ni BLOCK 0 ni BLOCK 1 alteran privilegios por defecto).
- Por lo tanto, inmediatamente después de que BLOCK 1 se ejecute con éxito, y antes de que BLOCK 2 se ejecute, la función queda técnicamente invocable por `PUBLIC` — lo que en Supabase incluye a `anon` y a cualquier `authenticated` no-admin, vía PostgREST.
- En consecuencia: si BLOCK 1 se ejecuta, BLOCK 2 debe solicitarse a Luis y ejecutarse **inmediatamente a continuación**, sin ninguna acción no relacionada de por medio.
- BLOCK 1 y BLOCK 2 siguen siendo bloques separados, cada uno con aprobación explícita independiente. Esta nota **no autoriza combinarlos en un solo GO**; el modelo de autorización bloque por bloque (sección "Modelo de autorización de ejecución" del Acta Fase 6D) se mantiene sin cambios.
- Esta ventana de exposición temporal está mitigada — no eliminada — por las validaciones internas de la función: el paso 0 (`auth.uid() IS NULL` → excepción) y el paso 1 (`get_my_role() IS DISTINCT FROM 'admin'` → excepción) se ejecutan antes de cualquier lectura con bloqueo o escritura. Ningún llamador `anon` o `authenticated` no-admin puede completar una mutación durante esta ventana, aun si técnicamente puede invocar la función. Sin embargo, el límite de defensa en profundidad previsto por diseño (permisos a nivel SQL) no queda completo hasta que BLOCK 2 se ejecute.
- Si BLOCK 1 se ejecuta con éxito pero BLOCK 2 no puede ejecutarse de inmediato por cualquier motivo, **detenerse y reportar a Luis antes de realizar cualquier otra acción**, incluyendo tareas no relacionadas con esta fase.

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

**Decisión aprobada para BLOCK 4 (exclusivamente):** Luis aprueba explícitamente el método de simulación controlada de claims JWT en el SQL Editor **únicamente para la ejecución de BLOCK 4**. Este método **no refleja el comportamiento real de producción** — en producción, `auth.uid()` se resuelve desde un JWT real emitido por Supabase Auth y recibido vía PostgREST. Esta simulación es exclusivamente una prueba controlada a nivel de base de datos, ejecutada directamente en el SQL Editor, con `auth.uid()` fijado artificialmente mediante `request.jwt.claims` dentro de la misma transacción que BLOCK 4 revierte con `ROLLBACK`. **Esta aprobación no se extiende a BLOCK 5**; el método de autenticación para BLOCK 5 permanece pendiente de decisión separada de Luis.

---

### BLOCK 4 — Prueba positiva Admin en tiempo de ejecución, dentro de transacción

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Esta prueba debe ejecutarse autenticado como el usuario de prueba Admin (`reservas@ferranpropiedades.cl`, confirmado en el Cierre de Fase 6E), usando el método de simulación controlada de claims JWT en el SQL Editor aprobado exclusivamente para este bloque (ver nota de autenticación arriba), y **siempre dentro de una transacción que termina en `ROLLBACK`**, para no dejar ningún dato de prueba permanente.

El bloque se escribe como un `DO $$ ... $$` autocontenido con una variable local (`v_test_item_id`), en lugar de una variable de sustitución de cliente SQL (tipo `:test_item_id`), para que sea ejecutable literalmente tal como está escrito, sin depender de que el cliente (psql, Supabase SQL Editor, etc.) soporte variables de sesión.

La simulación de sesión (`SET LOCAL role authenticated; SET LOCAL request.jwt.claims = ...`) requiere el UUID real del usuario de prueba Admin. El repositorio no documenta una columna `email` verificada en `public.profiles` (solo se confirmó `id`, `role`, `active` en la Fase 6A) ni una consulta ya validada que resuelva el UUID desde `reservas@ferranpropiedades.cl`, por lo que este documento no inventa esa resolución automática. El SQL de abajo usa el placeholder explícito `<ADMIN_TEST_USER_UUID>`, que Luis debe reemplazar manualmente por el UUID real antes de ejecutar, obtenido por sus propios medios (por ejemplo, desde el panel de Supabase Auth).

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- Método aprobado para este bloque exclusivamente: simulación controlada de claims JWT
-- en el SQL Editor (ver nota de autenticación arriba). No es comportamiento de producción.

BEGIN;

-- REEMPLAZO MANUAL OBLIGATORIO ANTES DE EJECUTAR:
-- sustituir <ADMIN_TEST_USER_UUID> por el UUID real del usuario de prueba Admin
-- (reservas@ferranpropiedades.cl), obtenido por Luis fuera de este documento.
-- SET LOCAL queda acotado a esta transacción; desaparece automáticamente con el ROLLBACK final.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub": "<ADMIN_TEST_USER_UUID>", "role": "authenticated"}';

DO $$
DECLARE
  v_test_item_id uuid;
  v_result record;
  v_auth_uid uuid;
  v_role text;
BEGIN
  -- 4.0. Verificar que la simulación de sesión quedó activa como Admin.
  v_auth_uid := auth.uid();
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION '4.0: auth.uid() es NULL — la simulación de claims JWT no quedó activa; revisar <ADMIN_TEST_USER_UUID> y el SET LOCAL request.jwt.claims anterior';
  END IF;

  v_role := get_my_role();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION '4.0: get_my_role() esperado ''admin'', obtenido % para auth.uid() = %', v_role, v_auth_uid;
  END IF;

  -- 4.1. Crear un ítem de prueba temporal (dentro de la misma transacción).
  INSERT INTO public.inventory_items (item_name, category, unit, current_stock, min_stock, created_by)
  VALUES ('__PRUEBA_6G__ Ítem temporal', 'Otros', 'unidad', 10, 2, v_auth_uid)
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
  IF v_result.movement_type IS DISTINCT FROM 'entrada_regularizacion' THEN
    RAISE EXCEPTION '4.2: movement_type esperado ''entrada_regularizacion'', obtenido %', v_result.movement_type;
  END IF;
  IF v_result.quantity IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '4.2: quantity esperado 5, obtenido %', v_result.quantity;
  END IF;
  IF v_result.created_at IS NULL THEN
    RAISE EXCEPTION '4.2: created_at no debe ser NULL';
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
  IF v_result.movement_type IS DISTINCT FROM 'salida_consumo' THEN
    RAISE EXCEPTION '4.3: movement_type esperado ''salida_consumo'', obtenido %', v_result.movement_type;
  END IF;
  IF v_result.quantity IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '4.3: quantity esperado 3, obtenido %', v_result.quantity;
  END IF;
  IF v_result.created_at IS NULL THEN
    RAISE EXCEPTION '4.3: created_at no debe ser NULL';
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
-- Obligatorio: revertir todo lo hecho en este bloque de prueba, incluyendo el ítem,
-- los movimientos creados dentro del DO block, y la simulación de sesión (SET LOCAL
-- queda acotado a esta transacción y desaparece automáticamente con este ROLLBACK).
```

---

### Nota de recomendación (no vinculante) — Método de autenticación para BLOCK 5

Esta nota es una **recomendación**, no una decisión. La decisión de método para BLOCK 5 sigue perteneciendo exclusivamente a Luis, tal como lo establece la nota obligatoria antes de BLOCK 4 ("Esta aprobación no se extiende a BLOCK 5").

- **Vía PostgREST/RPC con un JWT real** es el método más cercano al comportamiento real de producción: ejercita también la capa de PostgREST (verificación del JWT, mapeo de errores HTTP 401/403), que la simulación en el SQL Editor no toca en absoluto.
- **Vía simulación controlada de claims JWT en el SQL Editor** es una prueba controlada exclusivamente a nivel de base de datos. Confirma el comportamiento de `auth.uid()`, `get_my_role()`, el cuerpo PL/pgSQL de la función y las ACL de PostgreSQL — pero **no** ejercita la capa PostgREST/Auth real, y por lo tanto no es equivalente a una solicitud JWT real de producción.
- La aprobación otorgada para BLOCK 4 fue **exclusiva de BLOCK 4** (ver nota obligatoria arriba). No se traslada automáticamente a BLOCK 5.

**Evaluación (recomendación, no decisión):** dado que (a) BLOCK 4 ya ejecutó exitosamente el mismo mecanismo de simulación (`SET LOCAL role`, `SET LOCAL request.jwt.claims`) sin dejar datos remanentes, (b) las 3 tablas de inventario están confirmadas en 0 filas, y (c) BLOCK 5A necesita un ítem temporal válido igual que BLOCK 4 lo necesitó, la simulación controlada en el SQL Editor parece, en principio, el método de menor riesgo operacional también para BLOCK 5 — con la limitación explícita de que no valida la capa PostgREST/Auth real. Si Luis desea validar también esa capa, eso requeriría una prueba separada y posterior vía PostgREST/RPC con JWT real, fuera del alcance de esta preparación documental. Esta evaluación no autoriza ningún método; queda pendiente de decisión explícita de Luis antes de ejecutar BLOCK 5.

---

### BLOCK 5.0 — Precheck de solo lectura

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Repite y amplía las verificaciones de BLOCK 3, porque el tiempo transcurrido entre BLOCK 4 y una futura ejecución de BLOCK 5 puede haber cambiado el estado de la función o de sus permisos.

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS

-- 5.0.1. Precheck de capacidad de cambio de rol (role-switch), antes de cualquier
-- otro precheck. Determina si el rol conectado del SQL Editor puede efectivamente
-- fijar role=authenticated (necesario para BLOCK 4 y BLOCK 5A) y role=anon
-- (necesario para BLOCK 5B) mediante SET LOCAL role.
--
-- pg_has_role(..., 'SET') solo existe desde PostgreSQL 16. En PostgreSQL 15,
-- pg_has_role() soporta 'MEMBER'/'USAGE', y 'MEMBER' es la verificación aplicable
-- a la capacidad de SET ROLE. La versión mayor de PostgreSQL de este proyecto no
-- ha sido establecida todavía por esta preparación de BLOCK 5 — no se asume.

-- 5.0.1.a. Confirmar la versión del servidor antes de elegir el privilege_type correcto.
SELECT current_setting('server_version') AS server_version,
       current_setting('server_version_num')::int AS server_version_num;
-- Esperado: 1 fila. server_version_num determina la rama aplicable en 5.0.1.b.

-- 5.0.1.b. Precheck de capacidad de cambio de rol, adaptado automáticamente a la
-- versión confirmada en 5.0.1.a mediante CASE: en tiempo de ejecución solo se
-- evalúa la rama (THEN/ELSE) correspondiente a la versión real del servidor, por
-- lo que esta única consulta es válida tanto en PostgreSQL >= 16 como en
-- PostgreSQL 15, sin que Luis deba elegir manualmente cuál ejecutar.
SELECT session_user,
       current_user,
       current_setting('server_version_num')::int AS server_version_num,
       CASE
         WHEN current_setting('server_version_num')::int >= 160000
           THEN pg_has_role(session_user, 'authenticated', 'SET')
         ELSE pg_has_role(session_user, 'authenticated', 'MEMBER')
       END AS can_set_authenticated,
       CASE
         WHEN current_setting('server_version_num')::int >= 160000
           THEN pg_has_role(session_user, 'anon', 'SET')
         ELSE pg_has_role(session_user, 'anon', 'MEMBER')
       END AS can_set_anon;
-- Interpretación:
--   - Si server_version_num >= 160000: el privilegio verificado es 'SET'
--     (pg_has_role(session_user, 'authenticated'/'anon', 'SET')), el chequeo
--     específico de PostgreSQL 16+ para la capacidad de SET ROLE.
--   - Si server_version_num < 160000: el privilegio verificado es 'MEMBER'
--     (pg_has_role(session_user, 'authenticated'/'anon', 'MEMBER')), la
--     verificación aplicable en PostgreSQL 15 para la capacidad de SET ROLE
--     (PostgreSQL 15 no expone 'SET' como privilege_type de pg_has_role).
--   - can_set_authenticated debe ser true para el método de simulación controlada
--     Admin/Staff en el SQL Editor (BLOCK 4 ya lo confirmó implícitamente al
--     ejecutarse con éxito; esta consulta lo deja explícito también para BLOCK 5A).
--   - can_set_anon debe ser true antes de que BLOCK 5B pueda usar SET LOCAL role anon.
--   - Si can_set_anon es false, BLOCK 5B NO ESTÁ LISTO bajo este método de SQL Editor
--     y no debe ejecutarse.
--   - No se debe intentar modificar membresías ni privilegios de rol para forzar que
--     la prueba funcione: eso quedaría fuera del alcance de una prueba negativa y del
--     límite de seguridad de este documento.
--   - No se asume la versión mayor de PostgreSQL en ningún otro bloque de este
--     documento: esta es la única verificación que depende de ella.

-- 5.0.2. Firma exacta y definición completa de la función.
SELECT p.proname AS function_name,
       pg_get_function_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS return_type,
       p.prosecdef AS is_security_definer,
       p.proconfig AS config_settings,
       pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'inventory_apply_stock_movement';
-- Esperado: 1 fila. is_security_definer = true. config_settings incluye search_path=public, pg_catalog.
-- full_definition debe coincidir con el BLOCK 1 vigente en main (commit b70b146). Si difiere,
-- detenerse: BLOCK 5A/5B asumen el mecanismo de rechazo exacto de esa versión (ver nota bajo BLOCK 5A).

-- 5.0.3. ACL cruda de la función, para inspección directa sin depender de has_function_privilege().
SELECT p.proname, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'inventory_apply_stock_movement';

-- 5.0.4. Privilegios vía information_schema (vista de alto nivel).
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'inventory_apply_stock_movement'
ORDER BY grantee;
-- Esperado: únicamente la fila authenticated / EXECUTE. Ninguna fila PUBLIC ni anon.

-- 5.0.5. Privilegio efectivo explícito por rol.
SELECT has_function_privilege(
         'anon',
         'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
         'EXECUTE'
       ) AS anon_can_execute,
       has_function_privilege(
         'authenticated',
         'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
         'EXECUTE'
       ) AS authenticated_can_execute;
-- Esperado: anon_can_execute = false, authenticated_can_execute = true.

-- 5.0.6. Privilegio efectivo de PUBLIC. has_function_privilege() no acepta "PUBLIC" como
-- pseudo-rol; PUBLIC se identifica en el ACL como una entrada con grantee vacío (oid 0).
-- Esta consulta hace explícita esa verificación en lugar de asumirla por ausencia en 5.0.4.
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee_role,
       a.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace,
     LATERAL aclexplode(p.proacl) AS a
WHERE n.nspname = 'public'
  AND p.proname = 'inventory_apply_stock_movement';
-- Esperado: ninguna fila con grantee_role = 'PUBLIC'.

-- 5.0.7. Usuarios Staff activos disponibles para BLOCK 5A.
-- Nota: auth.users.email es una columna del esquema estándar de Supabase Auth (no específica
-- de este proyecto), pero este JOIN exacto con public.profiles no está verificado en la
-- documentación previa del repositorio (la Fase 6A solo confirmó id/role/active en profiles).
-- Al ser una consulta de solo lectura, esta misma ejecución sirve como su propia verificación.
SELECT u.id AS user_id,
       u.email,
       pr.role,
       pr.active
FROM auth.users u
JOIN public.profiles pr ON pr.id = u.id
WHERE pr.role = 'staff'
  AND pr.active = true
ORDER BY u.email;
-- Esperado: al menos 1 fila, incluyendo francisca.cabanas@gmail.com (Cierre Fase 6E), activo.

-- 5.0.8. Confirmar 0 filas de datos de prueba remanentes antes de iniciar BLOCK 5.
SELECT 'inventory_items' AS tabla, count(*) FROM inventory_items
UNION ALL
SELECT 'inventory_requests', count(*) FROM inventory_requests
UNION ALL
SELECT 'inventory_movements', count(*) FROM inventory_movements;
-- Esperado: 0 en las 3 filas, según el estado confirmado tras BLOCK 4 CLEAN VERIFY.
```

---

### BLOCK 5A — Prueba negativa Staff

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Diseño únicamente. No ejecutar.

**Mecanismo de rechazo esperado (extraído del BLOCK 1 vigente, no inventado):** el cuerpo de la función, paso 1, ejecuta:

```
v_role := get_my_role();
IF v_role IS DISTINCT FROM 'admin' THEN
  RAISE EXCEPTION 'No autorizado: se requiere rol admin';
END IF;
```

`RAISE EXCEPTION` sin cláusula `USING ERRCODE` produce, por comportamiento estándar y documentado de PostgreSQL, el SQLSTATE genérico `P0001` (`raise_exception`). Este paso ocurre **antes** del `FOR UPDATE` (paso 4) y de cualquier `INSERT`/`UPDATE`, siempre que Staff esté correctamente autenticado (`auth.uid()` no nulo) — lo cual se cumple aquí porque `authenticated` tiene `EXECUTE` otorgado (BLOCK 2) y Staff es un usuario `authenticated` real.

**Criterio exacto de PASS (los tres deben cumplirse; "cualquier error SQL" NO constituye PASS por sí solo):**
1. Se captura una excepción con `SQLSTATE = 'P0001'`.
2. El texto del error es exactamente `No autorizado: se requiere rol admin` (no una coincidencia parcial).
3. `current_stock` del ítem de prueba no cambió, y no se insertó ningún `inventory_movements` para ese ítem.

**Criterio de TEST INVALID (no prueba nada sobre el rechazo de Staff; debe detenerse y reportarse, no interpretarse como PASS ni FAIL):**
- `auth.uid()` resulta NULL tras fijar los claims de Staff (la simulación no quedó activa).
- `get_my_role()` no devuelve exactamente `'staff'` tras fijar los claims de Staff (usuario de prueba incorrecto, inactivo, o UUID equivocado en `<STAFF_TEST_USER_UUID>`).

**Criterio de TEST FAILURE (indica una falla real, potencialmente de seguridad, no solo de la prueba):**
- El RPC no lanza ninguna excepción (Staff logró ejecutar la mutación) — falla crítica.
- Se captura una excepción, pero con `SQLSTATE` distinto de `P0001`, o con un mensaje distinto al esperado — indica que el rechazo ocurrió por una causa distinta a la verificación de rol (por ejemplo, el ítem de prueba no existe, o cambió el mensaje de la función respecto al BLOCK 1 vigente) y debe investigarse antes de asumir que la verificación de rol sigue funcionando.
- `current_stock` cambió, o se insertó algún `inventory_movements`, a pesar de que se capturó una excepción — indicaría una escritura parcial inconsistente con el diseño transaccional del RPC.

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS
-- Requiere reemplazo manual de <ADMIN_TEST_USER_UUID>, <STAFF_TEST_USER_UUID>
-- y <BLOCK5_TEST_ITEM_UUID> antes de ejecutar (ver BLOCK 5.0.7 para el UUID de Staff).
-- <BLOCK5_TEST_ITEM_UUID> es un UUID elegido por Luis para este fixture (por ejemplo,
-- generado por separado con gen_random_uuid(), o cualquier UUID v4 válido), reemplazado
-- de forma idéntica y literal en cada paso de este bloque. No se crea ninguna tabla
-- auxiliar ni objeto persistente: el mismo texto de placeholder, reemplazado
-- manualmente antes de ejecutar, es lo único que conecta la fase Admin y la fase
-- Staff — evita que permisos sobre un objeto auxiliar (ej.: una tabla temporal)
-- se conviertan en una fuente de error ajena a la prueba negativa del RPC.

BEGIN;

-- Fase Admin: verificar sesión y crear el ítem de prueba con id explícito.
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub": "<ADMIN_TEST_USER_UUID>", "role": "authenticated"}';

DO $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '5A.0-admin: auth.uid() es NULL — la simulación Admin no quedó activa';
  END IF;

  IF get_my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION '5A.0-admin: get_my_role() esperado ''admin'', obtenido %', get_my_role();
  END IF;

  -- 5A.pre. Confirmar que el UUID placeholder no colisiona con una fila existente.
  -- Es relevante aquí porque este bloque fuerza el id explícitamente en el INSERT,
  -- en lugar de dejar que la tabla genere uno por defecto.
  IF EXISTS (SELECT 1 FROM public.inventory_items WHERE id = '<BLOCK5_TEST_ITEM_UUID>'::uuid) THEN
    RAISE EXCEPTION '5A.pre: el UUID <BLOCK5_TEST_ITEM_UUID> ya existe en inventory_items — elegir otro valor antes de ejecutar';
  END IF;

  INSERT INTO public.inventory_items (id, item_name, category, unit, current_stock, min_stock, created_by)
  VALUES ('<BLOCK5_TEST_ITEM_UUID>'::uuid, '__PRUEBA_6G__ Ítem negativo Staff', 'Otros', 'unidad', 5, 1, auth.uid());
END;
$$;

-- Fase Staff: cambiar la sesión simulada al usuario de prueba Staff, dentro
-- de la misma transacción. SET LOCAL puede reemitirse: el último valor antes
-- de COMMIT/ROLLBACK es el vigente; el valor anterior (Admin) no se restaura
-- a mitad de transacción, solo desaparece junto con todo lo demás al ROLLBACK final.
SET LOCAL request.jwt.claims = '{"sub": "<STAFF_TEST_USER_UUID>", "role": "authenticated"}';

DO $$
DECLARE
  v_stock_before numeric;
  v_stock_after numeric;
  v_movement_count integer;
  v_error_caught boolean := false;
  v_sqlstate text;
  v_sqlerrm text;
BEGIN
  -- 5A.0-staff. Confirmar que la sesión simulada es Staff, con criterio estricto de invalidez.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '5A.0-staff: auth.uid() es NULL — la simulación Staff no quedó activa; PRUEBA INVÁLIDA';
  END IF;

  IF get_my_role() IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION '5A.0-staff: get_my_role() esperado ''staff'', obtenido % — PRUEBA INVÁLIDA, no procede como prueba de rechazo de Staff', get_my_role();
  END IF;

  SELECT current_stock INTO v_stock_before
    FROM public.inventory_items WHERE id = '<BLOCK5_TEST_ITEM_UUID>'::uuid;

  -- 5A.1. Intentar la mutación como Staff; debe ser rechazada.
  BEGIN
    PERFORM * FROM public.inventory_apply_stock_movement(
      '<BLOCK5_TEST_ITEM_UUID>'::uuid, 'entrada_regularizacion', 1,
      'Prueba Fase 6H BLOCK 5A — debe fallar', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_sqlerrm := SQLERRM;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION '5A: FALLA CRÍTICA — el RPC no lanzó ninguna excepción para Staff; se esperaba rechazo';
  END IF;

  IF v_sqlstate IS DISTINCT FROM 'P0001' THEN
    RAISE EXCEPTION '5A: SQLSTATE inesperado % (esperado P0001) — mensaje: % — investigar antes de asumir que la verificación de rol sigue vigente', v_sqlstate, v_sqlerrm;
  END IF;

  IF v_sqlerrm IS DISTINCT FROM 'No autorizado: se requiere rol admin' THEN
    RAISE EXCEPTION '5A: mensaje de error inesperado: % (SQLSTATE %) — no coincide con el rechazo de rol esperado', v_sqlerrm, v_sqlstate;
  END IF;

  -- 5A.2. Confirmar ausencia de efectos secundarios pese al rechazo.
  SELECT current_stock INTO v_stock_after
    FROM public.inventory_items WHERE id = '<BLOCK5_TEST_ITEM_UUID>'::uuid;
  IF v_stock_after IS DISTINCT FROM v_stock_before THEN
    RAISE EXCEPTION '5A: current_stock cambió de % a % — no debía cambiar tras el rechazo', v_stock_before, v_stock_after;
  END IF;

  SELECT count(*) INTO v_movement_count
    FROM public.inventory_movements WHERE item_id = '<BLOCK5_TEST_ITEM_UUID>'::uuid;
  IF v_movement_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '5A: se encontraron % movimientos para el ítem de prueba — esperado 0', v_movement_count;
  END IF;

  RAISE NOTICE '5A: PASS — Staff rechazado correctamente (SQLSTATE P0001, mensaje esperado), sin cambios de stock ni movimientos.';
END;
$$;

ROLLBACK;
-- Obligatorio: revierte el ítem de prueba y toda la simulación de sesión.
-- Ningún objeto auxiliar (tabla temporal u otro) fue creado en este bloque.
```

---

### BLOCK 5B — Prueba negativa no autenticado / anon

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

Diseño únicamente. No ejecutar. Transacción separada de BLOCK 5A: ningún estado de una prueba debe filtrarse a la otra.

**Mecanismo de rechazo esperado:** `anon` no tiene `EXECUTE` sobre la función (BLOCK 2: `REVOKE ALL ... FROM anon`, sin `GRANT` posterior). En PostgreSQL, la verificación de privilegio `EXECUTE` sobre una función ocurre **antes** de que el cuerpo de la función se ejecute — es decir, antes de que `auth.uid() IS NULL` (paso 0 del RPC) llegue siquiera a evaluarse. El error resultante es el mecanismo genérico y documentado de PostgreSQL para privilegio insuficiente: `SQLSTATE 42501` (`insufficient_privilege`), con un mensaje del tipo `permission denied for function inventory_apply_stock_movement`. Este es un mecanismo general de PostgreSQL (misma clase de error que un `SELECT` denegado sobre una tabla), no un valor específico de este proyecto — pero **no ha sido confirmado empíricamente todavía en este proyecto**; BLOCK 5.0/5B son, en sí mismos, esa confirmación.

No se requiere ningún ítem de inventario ni fixture persistente: si el privilegio `EXECUTE` bloquea la entrada antes de que el cuerpo se ejecute, el valor del argumento `p_item_id` es irrelevante para el resultado. Por esa misma razón, la consulta usa un UUID fijo en lugar de leer `inventory_items`, evitando así cualquier duda sobre si `anon` tiene o no privilegio `SELECT` sobre esa tabla (no verificado en este documento) — algo que contaminaría la interpretación del resultado si se usara una subconsulta contra esa tabla.

**Criterio exacto de PASS:**
1. Se captura una excepción con `SQLSTATE = '42501'`.
2. (Informativo, no bloqueante) El mensaje contiene `permission denied for function` — se registra pero no se exige coincidencia exacta, porque el texto exacto no está fijado por este proyecto sino por el motor de PostgreSQL, y puede variar levemente entre versiones.

**Criterio de TEST INVALID:**
- `current_user` no es `anon` tras `SET LOCAL role anon` (la simulación de rol no quedó activa) — indica que el rol conectado del SQL Editor podría no tener membresía sobre `anon`; debe detenerse y reportarse, no interpretarse como resultado de la prueba.

**Criterio de TEST FAILURE (indica una falla real, potencialmente crítica):**
- El RPC no lanza ninguna excepción (anon logró invocar la función) — falla crítica, indicaría que BLOCK 2 no se aplicó correctamente o fue revertido.
- Se captura una excepción, pero con `SQLSTATE` distinto de `42501` — indicaría que el rechazo NO ocurrió por falta de privilegio `EXECUTE` sino por otra causa (por ejemplo, que el cuerpo de la función sí llegó a ejecutarse y falló por otro motivo), lo cual sería en sí mismo una falla crítica: significaría que la capa de permisos de PostgreSQL no está bloqueando a `anon` como se espera.

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS

BEGIN;

SET LOCAL role anon;
-- Deliberadamente NO se fija request.jwt.claims: el objetivo es reproducir una
-- solicitud sin autenticación (rol anon puro), no una sesión "authenticated" con
-- claims artificiales. En producción, PostgREST asigna el rol `anon` cuando no
-- hay JWT válido en la solicitud entrante.

DO $$
DECLARE
  v_current_role text;
  v_error_caught boolean := false;
  v_sqlstate text;
  v_sqlerrm text;
BEGIN
  SELECT current_user INTO v_current_role;
  IF v_current_role IS DISTINCT FROM 'anon' THEN
    RAISE EXCEPTION '5B.0: current_user esperado ''anon'', obtenido % — PRUEBA INVÁLIDA, la simulación de rol anon no quedó activa', v_current_role;
  END IF;

  BEGIN
    PERFORM * FROM public.inventory_apply_stock_movement(
      '00000000-0000-0000-0000-000000000000'::uuid,
      'entrada_regularizacion', 1, 'Prueba Fase 6H BLOCK 5B — debe fallar', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_error_caught := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_sqlerrm := SQLERRM;
  END;

  IF NOT v_error_caught THEN
    RAISE EXCEPTION '5B: FALLA CRÍTICA — el RPC no lanzó ninguna excepción para el rol anon; se esperaba rechazo por falta de privilegio EXECUTE';
  END IF;

  IF v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION '5B: SQLSTATE inesperado % (esperado 42501, insufficient_privilege) — mensaje: % — esto podría indicar que el rechazo NO ocurrió por falta de privilegio EXECUTE (posible FALLA CRÍTICA de BLOCK 2)', v_sqlstate, v_sqlerrm;
  END IF;

  RAISE NOTICE '5B: PASS — anon rechazado por falta de privilegio EXECUTE (SQLSTATE 42501): %', v_sqlerrm;
END;
$$;

ROLLBACK;
-- Obligatorio: revierte la simulación de rol. No se creó ningún fixture en este bloque.
```

---

### BLOCK 5C — Clean verify

**BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS**

```sql
-- BORRADOR — NO EJECUTAR SIN GO EXPLÍCITO DE LUIS

-- Confirmar que ningún ítem de prueba de BLOCK 5A quedó persistido.
SELECT count(*) FROM public.inventory_items WHERE item_name LIKE '__PRUEBA_6G__%';
-- Esperado: 0.

-- Confirmar que ningún movimiento quedó vinculado a un ítem de prueba
-- (se compara por ítem, no por texto de "reason", para cubrir cualquier
-- variante de texto usada entre BLOCK 4 y BLOCK 5A).
SELECT count(*) FROM public.inventory_movements m
JOIN public.inventory_items i ON i.id = m.item_id
WHERE i.item_name LIKE '__PRUEBA_6G__%';
-- Esperado: 0.

-- Confirmar que los conteos generales de las 3 tablas volvieron al estado previo a BLOCK 5.
SELECT 'inventory_items' AS tabla, count(*) FROM inventory_items
UNION ALL
SELECT 'inventory_requests', count(*) FROM inventory_requests
UNION ALL
SELECT 'inventory_movements', count(*) FROM inventory_movements;
-- Esperado: 0 en las 3 filas.

-- Reconfirmar privilegios de ejecución del RPC tras BLOCK 5A/5B
-- (deben permanecer sin cambios: ninguno de los dos bloques modifica permisos).
SELECT has_function_privilege(
         'anon',
         'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
         'EXECUTE'
       ) AS anon_can_execute,
       has_function_privilege(
         'authenticated',
         'public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)',
         'EXECUTE'
       ) AS authenticated_can_execute;
-- Esperado: anon_can_execute = false, authenticated_can_execute = true.

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'inventory_apply_stock_movement'
ORDER BY grantee;
-- Esperado: únicamente authenticated / EXECUTE. Ninguna fila PUBLIC ni anon.
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
- [ ] Secuencia BLOCK 1 → BLOCK 2 reconocida: si BLOCK 1 se ejecuta con éxito, Luis debe decidir de inmediato el GO/NO-GO de BLOCK 2 (permisos) antes de realizar cualquier tarea no relacionada (ver nota operacional entre BLOCK 1 y BLOCK 2).
- [ ] Ningún trabajo de UI puede iniciarse hasta que BLOCK 2 y su verificación (BLOCK 3) estén completos.

Ningún ítem de este checklist está marcado como completado por este documento. Es responsabilidad de Luis marcarlos en el momento de decidir la ejecución.

---

## 10. Conclusión final

La Fase 6G únicamente prepara el paquete de ejecución controlada del RPC de integridad de stock diseñado en la Fase 6F. Ningún SQL de este documento fue ejecutado. Una futura Fase 6H, o posterior, podría ejecutar este paquete — bloque por bloque — solo con el GO explícito de Luis para cada bloque individual, siguiendo el mismo modelo de autorización usado en la Fase 6E para las tablas base.

---

*Documento generado: 2026-08-17*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
