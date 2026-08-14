# Paquete Fase 6C — Ejecución SQL Controlada — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Versión:** v0.1 — Paquete de ejecución controlada\
**Fecha:** 2026-08-14\
**Estado:** Documento de preparación. No autoriza ejecución. Ningún SQL fue ejecutado en esta fase.\
**Fases previas:** Diseño (`023fb73`) · Modelo de datos (`6478f96`) · Borrador SQL (`924bbdc`) · Revisión SQL (`b0aae21`) · Plan de pre-ejecución (`7e3171c`) · Regla de ítem base (`9471428`) · Reglas de seguridad (`0dcccf1`) · Verificación previa Fase 6A (`5db44e7`) · Decisiones Fase 6B (`af36aaa`)\
**SQL fuente:** `docs/SQL_BORRADOR_INVENTARIO_REPOSICION_506A_v0.1.md`

---

## 1. Propósito

Este documento prepara el futuro paquete de ejecución SQL controlada para el módulo "Inventario y Reposición Operacional".

**Este documento NO autoriza ejecución.** Organiza el SQL ya revisado (Fases 3 y 4) en bloques ejecutables uno por uno, cada uno con su verificación correspondiente, para que una futura ejecución real —si Luis la autoriza— se haga de forma controlada y reversible, nunca de una sola vez.

---

## 2. Límite de seguridad (Safety boundary)

- No se ejecutó ningún SQL.
- No hubo ninguna mutación en Supabase.
- No se creó ninguna tabla.
- No se creó ninguna política.
- No se creó ningún índice.
- No se creó ninguna función.
- No se conectó ninguna interfaz.
- La producción permanece sin cambios.

---

## 3. Precondiciones antes de ejecutar

- Luis debe autorizar explícitamente la ejecución en el momento mismo de ejecutar, bloque por bloque.
- El índice único de control de duplicados debe estar formalmente aprobado por Luis.
- El RPC/función como primer mecanismo de integridad de stock debe estar formalmente aprobado por Luis.
- Deben estar confirmados los usuarios de prueba Admin y Staff.
- La UI debe permanecer desconectada después de la creación de las tablas.
- El bloque Insumos legacy permanece sin tocar.
- Las tablas existentes `inventario_items` e `insumos` no se tocan.

---

## 4. Filosofía de ejecución

- Ejecutar un bloque a la vez.
- Verificar después de cada bloque.
- Detenerse inmediatamente ante cualquier error.
- Nunca continuar después de un resultado inesperado.
- Ninguna operación de `git` reemplaza la verificación real en Supabase — un commit documentando un bloque no es evidencia de que el bloque fue ejecutado correctamente.

---

## 5. Bloques de ejecución controlada

> **Cada bloque de esta sección está marcado individualmente: "NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE." Ninguno de estos bloques ha sido ejecutado.**

> **Corrección de seguridad — orden de RLS:** en la ejecución real, cada bloque `CREATE TABLE` debe ir seguido inmediatamente de `ENABLE ROW LEVEL SECURITY` para esa misma tabla, antes de continuar con la siguiente tabla. Esto minimiza cualquier ventana de exposición en el esquema `public`.

### BLOCK 0 — Pre-check de solo lectura

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- Confirmar que las tablas del módulo nuevo aún no existen
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'inventory_items',
    'inventory_requests',
    'inventory_movements',
    'inventory_purchases'
  )
ORDER BY table_name;
-- Esperado: cero filas.

-- Confirmar que get_my_role() existe
SELECT n.nspname AS schema_name,
       p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'get_my_role';
-- Esperado: 1 fila.

-- Confirmar que los roles admin/staff siguen existiendo en public.profiles
SELECT DISTINCT role FROM public.profiles ORDER BY role;
-- Esperado: admin, staff (minúsculas).
```

Este bloque repite, al momento de ejecutar, las verificaciones ya hechas en la Fase 6A — porque el tiempo transcurrido entre la documentación y la ejecución real puede haber cambiado el estado de la base de datos.

---

### BLOCK 1 — Crear `inventory_items`

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- =============================================================
-- inventory_items
-- Catálogo de ítems del inventario. Admin only.
-- =============================================================

CREATE TABLE inventory_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name    text        NOT NULL,
  category     text        NOT NULL,
  unit         text        NOT NULL,
  current_stock numeric    NOT NULL DEFAULT 0,
  min_stock    numeric     NOT NULL DEFAULT 0,
  notes        text,
  active       boolean     NOT NULL DEFAULT true,
  created_by   uuid        NOT NULL REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        REFERENCES auth.users(id),
  updated_at   timestamptz,

  CONSTRAINT chk_current_stock_non_negative
    CHECK (current_stock >= 0),

  CONSTRAINT chk_min_stock_non_negative
    CHECK (min_stock >= 0),

  CONSTRAINT chk_category_valid
    CHECK (category IN (
      'Limpieza',
      'Baño',
      'Cocina',
      'Ropa blanca',
      'Losa y menaje',
      'Equipamiento menor',
      'Mantención / repuestos',
      'Otros'
    ))
);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
```

---

### BLOCK 2 — Verificar `inventory_items`

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- Confirmar que la tabla existe con las columnas esperadas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'inventory_items'
ORDER BY ordinal_position;

-- Confirmar que los constraints CHECK están activos
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.inventory_items'::regclass;

-- Confirmar que la tabla está vacía (recién creada)
SELECT count(*) FROM inventory_items;
-- Esperado: 0.
```

**Prueba de violación de CHECK — futura / manual únicamente, no forma parte de la ejecución automática de este bloque:**

```sql
-- SOLO COMO PRUEBA MANUAL FUTURA, NO EJECUTAR COMO PARTE DE ESTE BLOQUE.
-- Debe fallar por chk_category_valid.
-- INSERT INTO inventory_items (item_name, category, unit, created_by)
-- VALUES ('Prueba', 'Categoría inválida', 'unidad', auth.uid());
```

No se incluyen datos de prueba (`INSERT`) como parte de la ejecución automática de este bloque.

---

### BLOCK 3 — Crear `inventory_requests`

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- =============================================================
-- inventory_requests
-- Solicitudes de reposición del Staff. Staff INSERT, Admin UPDATE.
-- =============================================================

CREATE TABLE inventory_requests (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_free_text   text        NOT NULL,
  reason           text        NOT NULL,
  comment          text,
  photo_url        text,
  requested_by     uuid        NOT NULL REFERENCES auth.users(id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  status           text        NOT NULL DEFAULT 'pendiente',
  resolved_by      uuid        REFERENCES auth.users(id),
  resolved_at      timestamptz,
  resolution_notes text,
  linked_item_id   uuid        REFERENCES inventory_items(id),

  CONSTRAINT chk_reason_valid
    CHECK (reason IN (
      'stock_bajo',
      'faltante',
      'dañado',
      'perdido',
      'reposicion_necesaria',
      'otro'
    )),

  CONSTRAINT chk_status_valid
    CHECK (status IN (
      'pendiente',
      'en_revision',
      'comprada',
      'resuelta',
      'descartada'
    ))
);

ALTER TABLE inventory_requests ENABLE ROW LEVEL SECURITY;
```

---

### BLOCK 4 — Verificar `inventory_requests`

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- Confirmar que la tabla existe con las columnas esperadas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'inventory_requests'
ORDER BY ordinal_position;

-- Confirmar que la FK a inventory_items está activa
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.inventory_requests'::regclass
  AND contype = 'f';

-- Confirmar que la tabla está vacía
SELECT count(*) FROM inventory_requests;
-- Esperado: 0.
```

---

### BLOCK 5 — Crear `inventory_movements`

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- =============================================================
-- inventory_movements
-- Historial de movimientos de stock. Admin INSERT/SELECT únicamente.
-- Inmutable: no se editan ni eliminan registros.
-- =============================================================

CREATE TABLE inventory_movements (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          uuid        NOT NULL REFERENCES inventory_items(id),
  movement_type    text        NOT NULL,
  quantity         numeric     NOT NULL,
  previous_stock   numeric     NOT NULL,
  new_stock        numeric     NOT NULL,
  reason           text,
  notes            text,
  created_by       uuid        NOT NULL REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  linked_request_id uuid       REFERENCES inventory_requests(id),

  CONSTRAINT chk_quantity_positive
    CHECK (quantity > 0),

  CONSTRAINT chk_previous_stock_non_negative
    CHECK (previous_stock >= 0),

  CONSTRAINT chk_new_stock_non_negative
    CHECK (new_stock >= 0),

  CONSTRAINT chk_movement_type_valid
    CHECK (movement_type IN (
      'entrada_compra',
      'entrada_regularizacion',
      'salida_consumo',
      'baja_daño',
      'baja_perdida',
      'ajuste_admin',
      'correccion_admin'
    ))
);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
```

---

### BLOCK 6 — Verificar `inventory_movements`

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- Confirmar que la tabla existe con las columnas esperadas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'inventory_movements'
ORDER BY ordinal_position;

-- Confirmar las FKs a inventory_items e inventory_requests
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.inventory_movements'::regclass
  AND contype = 'f';

-- Confirmar que la tabla está vacía
SELECT count(*) FROM inventory_movements;
-- Esperado: 0.
```

---

### BLOCK 7 — Crear índices

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- =============================================================
-- Índices — inventory_items
-- =============================================================

CREATE INDEX idx_inventory_items_active_category
  ON inventory_items (active, category);

CREATE INDEX idx_inventory_items_item_name
  ON inventory_items (item_name);


-- =============================================================
-- Índices — inventory_requests
-- =============================================================

CREATE INDEX idx_inventory_requests_status_requested_at
  ON inventory_requests (status, requested_at DESC);

CREATE INDEX idx_inventory_requests_requested_by
  ON inventory_requests (requested_by, requested_at DESC);

CREATE INDEX idx_inventory_requests_linked_item_id
  ON inventory_requests (linked_item_id)
  WHERE linked_item_id IS NOT NULL;


-- =============================================================
-- Índices — inventory_movements
-- =============================================================

CREATE INDEX idx_inventory_movements_item_id_created_at
  ON inventory_movements (item_id, created_at DESC);

CREATE INDEX idx_inventory_movements_linked_request_id
  ON inventory_movements (linked_request_id)
  WHERE linked_request_id IS NOT NULL;
```

**Índice de control de duplicados — PENDIENTE DE APROBACIÓN FINAL DE LUIS antes de ejecutar, independientemente de la aprobación general de este bloque:**

```sql
-- PENDIENTE DE APROBACIÓN FINAL DE LUIS — no ejecutar como parte automática del bloque.
CREATE UNIQUE INDEX idx_inventory_items_unique_active_category_name
  ON inventory_items (category, lower(trim(item_name)))
  WHERE active = true;
```

---

### BLOCK 8 — Verificar RLS habilitado

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

Con la corrección de seguridad aplicada, RLS ya quedó habilitado en cada tabla dentro de los Blocks 1, 3 y 5, inmediatamente después de su `CREATE TABLE`. Este bloque es solo de verificación de solo lectura, no de habilitación.

```sql
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('inventory_items', 'inventory_requests', 'inventory_movements')
ORDER BY c.relname;
-- Esperado: rls_enabled = true en las 3 filas.
```

---

### BLOCK 9 — Crear políticas RLS

**NO EJECUTAR HASTA QUE LUIS APRUEBE ESTE BLOQUE.**

```sql
-- =============================================================
-- RLS — inventory_items
-- =============================================================

-- Admin: lectura completa
CREATE POLICY "admin_select_inventory_items"
  ON inventory_items FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

-- Admin: crear ítems
CREATE POLICY "admin_insert_inventory_items"
  ON inventory_items FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'admin'
    AND created_by = auth.uid()
  );

-- Staff: sin acceso a inventory_items en esta fase.
-- No se crea ninguna política SELECT/INSERT/UPDATE para Staff en esta tabla.


-- =============================================================
-- RLS — inventory_requests
-- =============================================================

-- Staff: insertar solicitud propia
CREATE POLICY "staff_insert_inventory_requests"
  ON inventory_requests FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'staff'
    AND requested_by = auth.uid()
  );

-- Staff: ver sus propias solicitudes
CREATE POLICY "staff_select_own_inventory_requests"
  ON inventory_requests FOR SELECT TO authenticated
  USING (
    get_my_role() = 'staff'
    AND requested_by = auth.uid()
  );

-- Admin: ver todas las solicitudes
CREATE POLICY "admin_select_inventory_requests"
  ON inventory_requests FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

-- Admin: actualizar solicitudes
CREATE POLICY "admin_update_inventory_requests"
  ON inventory_requests FOR UPDATE TO authenticated
  USING  (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');


-- =============================================================
-- RLS — inventory_movements
-- =============================================================

-- Admin: insertar movimientos
CREATE POLICY "admin_insert_inventory_movements"
  ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'admin'
    AND created_by = auth.uid()
  );

-- Admin: ver historial completo
CREATE POLICY "admin_select_inventory_movements"
  ON inventory_movements FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

-- Staff: sin acceso a inventory_movements. No se crea ninguna política para Staff.
```

**Nota:** no se incluye ninguna política `DELETE` en ninguna de las 3 tablas, para ninguno de los dos roles, consistente con el MVP.

#### Política pendiente — NO ejecutable todavía

```sql
-- BLOQUEADO / PENDIENTE DE DECISIÓN PARA EJECUCIÓN.
-- No ejecutar esta política UPDATE hasta que el mecanismo de integridad de stock esté aprobado.
-- Esta política puede permitir que un Admin actualice current_stock directamente vía PostgREST
-- si llama a la API sin pasar por el flujo de movimientos.
-- La ruta preferida es diseñar el flujo RPC/función de movimiento de stock
-- antes de habilitar cualquier ruta de UPDATE de Admin que pueda afectar el stock.
--
-- -- Admin: modificar ítems
-- CREATE POLICY "admin_update_inventory_items"
--   ON inventory_items FOR UPDATE TO authenticated
--   USING  (get_my_role() = 'admin')
--   WITH CHECK (get_my_role() = 'admin');
```

Esta política se excluye intencionalmente del bloque ejecutable hasta que el mecanismo RPC/función de movimiento de stock esté diseñado y aprobado. Es posible que más adelante se necesite actualizar metadatos de ítems por parte de Admin, pero ninguna ruta de UPDATE debe permitir la modificación directa de `current_stock` antes de resolver la integridad de stock.

---

### BLOCK 10 — Matriz de verificación RLS

**No se ejecutan pruebas ahora.** Esta matriz es la referencia para cuando se ejecuten las pruebas reales con usuarios Admin/Staff, según `docs/PLAN_PRE_EJECUCION_INVENTARIO_REPOSICION_506A_v0.1.md`, sección 5.

| # | Acción | Rol | Tabla | Resultado esperado |
|---|---|---|---|---|
| 1 | SELECT | Admin | `inventory_items` | Permitido — ve todos los ítems |
| 2 | INSERT | Admin | `inventory_items` | Permitido |
| 3 | UPDATE | Admin | `inventory_items` | Permitido |
| 4 | SELECT | Staff | `inventory_items` | Bloqueado |
| 5 | INSERT | Staff | `inventory_requests` (propia) | Permitido |
| 6 | INSERT | Staff | `inventory_requests` (ajena) | Bloqueado |
| 7 | SELECT | Staff | `inventory_requests` (propias) | Permitido, solo las suyas |
| 8 | SELECT | Admin | `inventory_requests` | Permitido — todas |
| 9 | UPDATE | Admin | `inventory_requests` | Permitido |
| 10 | INSERT | Admin | `inventory_movements` | Permitido |
| 11 | SELECT | Admin | `inventory_movements` | Permitido |
| 12 | SELECT | Staff | `inventory_movements` | Bloqueado |
| 13 | INSERT | Staff | `inventory_movements` | Bloqueado |
| 14 | DELETE | Admin o Staff | cualquiera de las 3 tablas | Bloqueado — no existe política DELETE |

---

### BLOCK 11 — Script de rollback

**PELIGROSO. NO EJECUTAR SIN APROBACIÓN EXPLÍCITA DE LUIS.**

```sql
-- =============================================================
-- ROLLBACK — módulo Inventario y Reposición Operacional únicamente
-- PELIGROSO — NO EJECUTAR SIN APROBACIÓN EXPLÍCITA DE LUIS.
-- Orden inverso al de creación.
-- =============================================================

DROP TABLE IF EXISTS inventory_movements;
DROP TABLE IF EXISTS inventory_requests;
DROP TABLE IF EXISTS inventory_items;
```

Este rollback **nunca debe tocar** tablas existentes: `supply_alerts`, `inventario_items`, `insumos`, `checkout_reports`, `reservation_payments`. El script está limitado exclusivamente a las 3 tablas nuevas del módulo.

---

## 6. Advertencia de integridad de stock

- Este paquete podría crear únicamente las tablas base, en una futura ejecución.
- Este paquete no autoriza conexión de UI.
- `current_stock` no debe cambiarse directamente desde la UI.
- El RPC/función para movimiento de stock debe diseñarse antes de conectar la UI Admin.
- Todo cambio de stock debe generar historial en `inventory_movements`.

---

## 7. Go / No-Go

- **GO** para revisar el paquete de ejecución.
- **NO-GO** para ejecutar SQL hasta que Luis apruebe cada bloque.
- **NO-GO** para conexión de UI.

---

## 8. Estado final

- Documentación únicamente.
- Supabase permanece sin cambios.
- `index.html` permanece intacto.
- La producción permanece sin cambios.

---

*Documento generado: 2026-08-14*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
