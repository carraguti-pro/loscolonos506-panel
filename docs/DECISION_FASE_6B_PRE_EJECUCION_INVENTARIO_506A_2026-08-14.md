# Decisión Fase 6B — Pre-Ejecución Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Versión:** v0.1 — Registro de decisiones de pre-ejecución\
**Fecha:** 2026-08-14\
**Estado:** Documento de decisión. No autoriza ejecución de SQL. Ningún SQL fue ejecutado en esta fase.\
**Fases previas:** Diseño (`023fb73`) · Modelo de datos (`6478f96`) · Borrador SQL (`924bbdc`) · Revisión SQL (`b0aae21`) · Plan de pre-ejecución (`7e3171c`) · Regla de ítem base (`9471428`) · Reglas de seguridad (`0dcccf1`) · Verificación previa Fase 6A (`5db44e7`)

---

## 1. Propósito

Este documento registra las decisiones de pre-ejecución tomadas a partir de los hallazgos de la Fase 6A (`docs/RESULTADO_FASE_6A_VERIFICACION_PREVIA_INVENTARIO_506A_2026-08-14.md`).

**Este documento NO autoriza la ejecución de SQL.** Es un registro de decisiones — algunas ya resueltas, otras propuestas pendientes de confirmación final de Luis, otras aún pendientes por completo. Ninguna decisión aquí registrada habilita por sí sola la ejecución en Supabase.

---

## 2. Límite de seguridad (Safety boundary)

- No se ejecutó ningún SQL.
- No hubo ninguna mutación en Supabase.
- No se creó ninguna tabla.
- No se creó ninguna política.
- No se conectó ninguna interfaz.
- La producción permanece sin cambios.

---

## 3. Hallazgos de la Fase 6A aceptados para esta decisión

- Las tablas `inventory_items`, `inventory_requests`, `inventory_movements`, `inventory_purchases` no existen todavía en `public`.
- `get_my_role()` existe, es `SECURITY DEFINER`, y lee el valor desde `public.profiles.role`.
- Los roles reales confirmados son exactamente `admin` y `staff`, en minúsculas.
- El patrón RLS existente (`checkout_reports`, `reservation_payments`, `supply_alerts`) es consistente con el uso de `get_my_role()` propuesto en el borrador SQL del módulo.
- Existen tablas preexistentes `inventario_items` (español) e `insumos`, que no forman parte del módulo nuevo y no deben tocarse.

---

## 4. Matriz de decisiones

| # | Tema | Decisión | Justificación |
|---|---|---|---|
| A | `get_my_role()` | **APROBADO para uso** | La Fase 6A confirmó los valores exactos `admin`/`staff`, en minúsculas, mediante verificación de solo lectura. |
| B | Nomenclatura | **APROBADO** | Usar nombres en inglés `inventory_items`, `inventory_requests`, `inventory_movements`. No tocar `inventario_items` ni `insumos`. |
| C | Índice de control de duplicados | **APROBACIÓN PROPUESTA, pendiente confirmación final de Luis** | Ver detalle abajo. |
| D | Mecanismo de integridad de stock | **APROBACIÓN PROPUESTA para RPC/función primero, trigger después solo si es necesario** | Ver detalle abajo. |
| E | Conexión de UI | **NO-GO** | Ninguna UI Admin o Staff se conecta inmediatamente después de crear las tablas. Solo después de que pasen las pruebas RLS y de flujo de stock. |
| F | Insumos legacy | **NO-GO** | No se toca `supply_alerts`, `inventario_items`, `insumos`, ni la UI actual de Insumos en Staff. |
| G | Usuarios de prueba RLS | **PENDIENTE** | Se necesita confirmación de usuarios de prueba Admin y Staff disponibles antes de validar RLS. |

### Detalle C — Índice de control de duplicados

```sql
CREATE UNIQUE INDEX idx_inventory_items_unique_active_category_name
  ON inventory_items (category, lower(trim(item_name)))
  WHERE active = true;
```

- `item_name` debe representar el ítem operacional base, no la marca ni la presentación comercial.
- Marca y presentación son detalle de compra o nota de movimiento, no ítems de catálogo distintos.
- Ejemplo: `"Papel higiénico"` como ítem base; `"Elite doble hoja 12 rollos"` o `"Nova 12 rollos"` como detalle de compra, no como filas de catálogo separadas.

### Detalle D — Mecanismo de integridad de stock

- `current_stock` no debe actualizarse directamente desde la UI.
- Todo cambio de stock debe generar un registro correspondiente en `inventory_movements`.
- Se propone un RPC/función (`SECURITY DEFINER`) como primer mecanismo, en lugar de un trigger, porque es más fácil de auditar paso a paso en esta etapa. Un trigger podría evaluarse más adelante solo si resulta necesario.

---

## 5. Resultado Go / No-Go

- **GO** para continuar documentación y preparar el checklist de ejecución.
- **NO-GO** para ejecutar SQL hasta que Luis dé aprobación explícita de ejecución.
- **NO-GO** para conexión de UI.

---

## 6. Confirmaciones requeridas de Luis antes de ejecución futura

- [ ] Luis aprueba formalmente el índice único de control de duplicados.
- [ ] Luis aprueba formalmente el RPC/función como primer mecanismo de integridad de stock.
- [ ] Luis confirma que no habrá conexión de UI inmediatamente después de crear las tablas.
- [ ] Luis confirma usuario de prueba Admin.
- [ ] Luis confirma usuario de prueba Staff.
- [ ] Luis autoriza explícitamente el inicio de la ejecución SQL controlada en una fase posterior.

---

## 7. Propuesta de siguiente fase

**Fase 6C — Paquete de script de ejecución SQL controlada / checklist de ejecución.**

La Fase 6C seguiría siendo preparación — no ejecución. La ejecución real en Supabase requeriría aprobación explícita de Luis, paso a paso, en el momento de cada acción.

---

## 8. Estado final

- Este documento no autoriza ejecución de SQL.
- Supabase permanece sin cambios.
- `index.html` permanece intacto.
- La producción permanece sin cambios.

---

*Documento generado: 2026-08-14*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
