# SQL Borrador — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Versión:** v0.1 — Borrador SQL\
**Fecha:** 2026-08-11\
**Estado:** BORRADOR. No ejecutado. No aplicar sin aprobación explícita de Luis.\
**Modelo conceptual:** `docs/MODELO_DATOS_INVENTARIO_REPOSICION_506A_v0.1.md`\
**Diseño previo:** `docs/DISENO_INVENTARIO_REPOSICION_OPERACIONAL_506A_v0.1.md`\
**Commit de producción al momento del borrador:** `9e89a47`

---

## ADVERTENCIA

> **Este documento contiene SQL de revisión únicamente.**
> No ha sido ejecutado en Supabase.
> No realizar ningún cambio en la base de datos sin revisión y aprobación explícita de Luis.
> El sistema en producción (`9e89a47`) permanece intacto.

---

## 1. Alcance

Este borrador incluye:
- Creación de las tablas `inventory_items`, `inventory_requests`, `inventory_movements`.
- Restricciones CHECK para valores controlados.
- Índices recomendados.
- Políticas RLS de primer draft.
- Notas sobre integridad de stock.

Este borrador **no incluye:**
- Tabla `inventory_purchases` (postergada a Phase 6).
- Vinculación con Gastos / Reembolsos (postergada).
- Manejo de efectivo, caja chica, pagos de huéspedes (fuera del alcance de inventario).
- Migración de `supply_alerts` (evaluación posterior).
- Datos de prueba ni regularización de agosto 2026.

---

## 2. Tabla `inventory_items`

Catálogo de ítems del inventario del departamento. Solo Admin puede crear y modificar ítems.

```sql
-- =============================================================
-- inventory_items
-- Catálogo de ítems del inventario. Admin only.
-- BORRADOR — no ejecutar sin aprobación de Luis.
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
```

> **Nota — control de duplicados en el catálogo:**
> El bloque legacy de Insumos ya mostraba ítems con nombres similares o redundantes. Antes de ejecutar este SQL, se debe decidir si se aplica un `UNIQUE (category, item_name)` para impedir duplicados exactos, o si se permiten variantes y marcas intencionalmente. No hay estrategia de duplicados aprobada aún. Esta decisión debe tomarse antes de la ejecución.

---

## 3. Tabla `inventory_requests`

Solicitudes de Staff sobre ítems faltantes, dañados, perdidos o con stock bajo. Staff inserta; Admin revisa y resuelve.

```sql
-- =============================================================
-- inventory_requests
-- Solicitudes de reposición del Staff. Staff INSERT, Admin UPDATE.
-- BORRADOR — no ejecutar sin aprobación de Luis.
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
```

---

## 4. Tabla `inventory_movements`

Historial completo e inmutable de cada variación de stock. Toda modificación de `current_stock` en `inventory_items` debe originarse en un movimiento registrado aquí.

```sql
-- =============================================================
-- inventory_movements
-- Historial de movimientos de stock. Admin INSERT/SELECT únicamente.
-- Inmutable: no se editan ni eliminan registros.
-- BORRADOR — no ejecutar sin aprobación de Luis.
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
```

---

## 5. Índices

Índices recomendados para los patrones de consulta esperados. No sobre-indexar en MVP.

```sql
-- =============================================================
-- Índices — inventory_items
-- BORRADOR — no ejecutar sin aprobación de Luis.
-- =============================================================

-- Filtrado habitual en la vista Admin: ítems activos por categoría
CREATE INDEX idx_inventory_items_active_category
  ON inventory_items (active, category);

-- Búsqueda por nombre de ítem
CREATE INDEX idx_inventory_items_item_name
  ON inventory_items (item_name);


-- =============================================================
-- Índices — inventory_requests
-- BORRADOR — no ejecutar sin aprobación de Luis.
-- =============================================================

-- Vista Admin: solicitudes por estado y fecha
CREATE INDEX idx_inventory_requests_status_requested_at
  ON inventory_requests (status, requested_at DESC);

-- Vista Staff: solicitudes propias
CREATE INDEX idx_inventory_requests_requested_by
  ON inventory_requests (requested_by, requested_at DESC);

-- Vínculo futuro al catálogo
CREATE INDEX idx_inventory_requests_linked_item_id
  ON inventory_requests (linked_item_id)
  WHERE linked_item_id IS NOT NULL;


-- =============================================================
-- Índices — inventory_movements
-- BORRADOR — no ejecutar sin aprobación de Luis.
-- =============================================================

-- Historial de movimientos de un ítem (más común)
CREATE INDEX idx_inventory_movements_item_id_created_at
  ON inventory_movements (item_id, created_at DESC);

-- Trazabilidad solicitud Staff → movimiento Admin
CREATE INDEX idx_inventory_movements_linked_request_id
  ON inventory_movements (linked_request_id)
  WHERE linked_request_id IS NOT NULL;
```

---

## 6. RLS — políticas draft

Las políticas usan la función `get_my_role()` que ya existe en el proyecto (confirmado en `docs/CIERRE_STAFF_CHECKOUT_PAGOS_506A_2026-08.md`, sección 3.3).

Admin corresponde a `get_my_role() = 'admin'`. Staff corresponde a `get_my_role() = 'staff'`.

No se incluyen políticas DELETE en el MVP.

```sql
-- =============================================================
-- RLS — inventory_items
-- BORRADOR — no ejecutar sin aprobación de Luis.
-- =============================================================

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

-- Admin: lectura completa
CREATE POLICY "admin_select_inventory_items"
  ON inventory_items FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

-- Admin: crear ítems
CREATE POLICY "admin_insert_inventory_items"
  ON inventory_items FOR INSERT TO authenticated
  WITH CHECK (get_my_role() = 'admin');

-- Admin: modificar ítems (nombre, categoría, unidad, mínimos, notas, activo)
CREATE POLICY "admin_update_inventory_items"
  ON inventory_items FOR UPDATE TO authenticated
  USING  (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Staff: sin acceso a inventory_items en Fase 2.
-- El formulario de solicitud usa texto libre (item_free_text),
-- no requiere SELECT al catálogo.
-- Si en fases futuras se expone catálogo limitado a Staff,
-- agregar aquí un SELECT restringido (solo id, item_name, category, active = true).


-- =============================================================
-- RLS — inventory_requests
-- BORRADOR — no ejecutar sin aprobación de Luis.
-- =============================================================

ALTER TABLE inventory_requests ENABLE ROW LEVEL SECURITY;

-- Staff: insertar solicitud propia
CREATE POLICY "staff_insert_inventory_requests"
  ON inventory_requests FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'staff'
    AND requested_by = auth.uid()
  );

-- Staff: ver sus propias solicitudes (solo si UI de historial Staff lo requiere)
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

-- Admin: actualizar solicitudes (cambiar status, resolved_by, resolved_at, resolution_notes)
CREATE POLICY "admin_update_inventory_requests"
  ON inventory_requests FOR UPDATE TO authenticated
  USING  (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');


-- =============================================================
-- RLS — inventory_movements
-- BORRADOR — no ejecutar sin aprobación de Luis.
-- =============================================================

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Admin: insertar movimientos (única forma válida de modificar stock)
CREATE POLICY "admin_insert_inventory_movements"
  ON inventory_movements FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'admin'
    AND created_by = auth.uid()
  );

-- Admin: ver historial completo de movimientos
CREATE POLICY "admin_select_inventory_movements"
  ON inventory_movements FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

-- Staff: sin acceso a inventory_movements.
-- El historial de movimientos es información interna de Admin.
```

---

## 7. Nota de integridad de stock

> **Este borrador SQL no incluye función de base de datos para actualización automática de stock.**
>
> La aplicación (o una función de base de datos en una fase posterior) debe garantizar la siguiente secuencia atómica:
>
> 1. Insertar un registro en `inventory_movements` con `previous_stock`, `new_stock`, `quantity`, `movement_type`, `created_by`.
> 2. Actualizar `inventory_items.current_stock` al valor `new_stock` del movimiento.
> 3. Actualizar `inventory_items.updated_by` y `inventory_items.updated_at`.
>
> Estas tres operaciones deben ocurrir en la misma transacción. Si cualquiera falla, ninguna debe persistir.
>
> No exponer en la UI ningún campo que permita actualizar `current_stock` directamente sin pasar por este flujo.
>
> Una alternativa más robusta para fases posteriores: implementar un trigger o función PostgreSQL que actualice `current_stock` automáticamente al insertar en `inventory_movements`. Esta opción no está incluida en el MVP.
>
> **Advertencia RLS:** RLS por sí solo no impide que un Admin actualice `inventory_items.current_stock` directamente si existe una política UPDATE activa. Antes de ejecutar este SQL en Supabase, se debe decidir si la integridad de stock se garantiza por disciplina de UI, por un flujo RPC / función de base de datos, o por un trigger. La regla de negocio se mantiene: ningún cambio de stock sin registro en `inventory_movements`.

---

## 8. Nota sobre caja chica y efectivo de huéspedes

> Este borrador SQL no incluye ningún objeto relacionado con:
> caja chica, alcancía, pagos en efectivo de huéspedes, conciliación de pagos, reembolsos de Staff, ni liquidación financiera.
>
> Esos casos corresponden a flujos de Finanzas / Pagos Huésped, que son independientes del módulo de inventario y requieren diseño y aprobación separados.
>
> **Principio: Con platas no se juega; y si son ajenas, menos.**

---

## 9. Nota sobre migración de `supply_alerts`

> La tabla `supply_alerts` existente no se toca en este borrador.
> No se incluye ningún script de migración de datos.
> Los registros actuales en `supply_alerts` permanecen en su estado original.
> Una eventual migración manual de ítems al nuevo catálogo `inventory_items` se evaluará cuando el módulo nuevo esté validado en producción.

---

## 10. Estado final

**BORRADOR. No ejecutado. No aplicar sin aprobación explícita de Luis.**

Este documento está listo para revisión. El paso siguiente, si Luis aprueba el SQL, es:

1. Revisar cada tabla, campo, constraint e índice línea a línea.
2. Confirmar la función `get_my_role()` acepta los valores `'admin'` y `'staff'` exactamente como están escritos en las políticas.
3. Autorizar explícitamente la ejecución en Supabase.
4. Ejecutar en Supabase — una tabla a la vez, en orden: `inventory_items` → `inventory_requests` → `inventory_movements` → índices → RLS.
5. Verificar que RLS funciona correctamente antes de conectar cualquier interfaz de usuario.

Ninguna tabla existe en Supabase al momento de este documento. El sistema en producción (`9e89a47`) permanece intacto.

---

*Documento generado: 2026-08-11*

*Producción al momento del borrador: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
