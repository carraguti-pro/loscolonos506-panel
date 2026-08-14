# Acta Fase 6D — GO Final Controlado — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Versión:** v0.1 — Acta de GO final controlado\
**Fecha:** 2026-08-14\
**Estado:** Documento de decisión. No ejecuta SQL. No autoriza ejecución automática.\
**HEAD actual del repositorio:** `4440141`\
**Fases previas:** Diseño (`023fb73`) · Modelo de datos (`6478f96`) · Borrador SQL (`924bbdc`) · Revisión SQL (`b0aae21`) · Plan de pre-ejecución (`7e3171c`) · Regla de ítem base (`9471428`) · Reglas de seguridad (`0dcccf1`) · Verificación previa Fase 6A (`5db44e7`) · Decisiones Fase 6B (`af36aaa`) · Paquete de ejecución Fase 6C (`4440141`)

---

## 1. Propósito

Este documento registra el GO final controlado de Luis para la siguiente etapa de ejecución controlada del módulo "Inventario y Reposición Operacional".

**Este documento NO ejecuta SQL y NO autoriza ejecución automática.** Es un acta de cierre del ciclo de decisiones de pre-ejecución (Fases 5, 6A, 6B y 6C), que deja constancia formal de qué quedó aprobado, bajo qué condiciones, y qué sigue requiriendo aprobación explícita bloque por bloque en el momento de ejecutar.

---

## 2. Límite de seguridad (Safety boundary)

- No se ejecutó ningún SQL en esta fase.
- No hubo ninguna mutación en Supabase.
- No se creó ninguna tabla.
- No se creó ninguna política.
- No se creó ningún índice.
- No se creó ninguna función.
- No se conectó ninguna interfaz.
- La producción permanece sin cambios.

---

## 3. Decisiones formales confirmadas por Luis

### A. Índice de control de duplicados

**Aprobado para ejecución controlada cuando se llegue al bloque del índice:**

```sql
CREATE UNIQUE INDEX idx_inventory_items_unique_active_category_name
  ON inventory_items (category, lower(trim(item_name)))
  WHERE active = true;
```

**Condición:** `item_name` debe representar el ítem operacional base. Marcas y presentaciones siguen siendo detalle de compra/movimiento, no ítems de catálogo.

### B. Mecanismo de integridad de stock

**Dirección aprobada:** RPC/función primero. Trigger postergado, solo si resulta necesario más adelante.

Ninguna UI de Admin puede conectarse hasta que el flujo RPC/función de movimiento de stock esté diseñado y aprobado.

### C. Conexión de UI

**NO-GO** después de la creación de tablas. Crear tablas no autoriza conectar UI Admin ni Staff.

### D. Sistemas legacy

**NO-GO** para tocar `supply_alerts`, `inventario_items`, `insumos`, Staff Servicios, ni la UI legacy de Insumos.

### E. Reglas de seguridad

`docs/REGLAS_SEGURIDAD_PUBLICACION_FERRAN_OASIS_v0.1.md` es un portón obligatorio, no una referencia opcional.

---

## 4. Modelo de autorización de ejecución

- Luis no autoriza "ejecutar todo".
- Toda ejecución futura debe ser bloque por bloque.
- Cada bloque requiere aprobación explícita de Luis en el momento mismo de la ejecución.
- Ejemplo de redacción aprobada:
  - "Ejecutar BLOCK 0"
  - "Ejecutar BLOCK 1"
- Nunca se infiere aprobación a partir de un GO general.

---

## 5. Requisitos antes del primer bloque mutante

Antes de cualquier bloque `CREATE TABLE`:

- Ejecutar de nuevo el pre-check de solo lectura del BLOCK 0.
- Confirmar que las tablas `inventory_*` siguen sin existir.
- Confirmar que `get_my_role()` sigue existiendo.
- Confirmar que los roles `admin`/`staff` siguen existiendo.
- Confirmar el HEAD / estado del repositorio local.
- Confirmar que `index.html` sigue intacto.

---

## 6. Requisitos antes de las pruebas de RLS en tiempo de ejecución

Los usuarios de prueba Admin y Staff deben ser confirmados por Luis antes de validar RLS.

- No se inventan usuarios.
- No se solicitan contraseñas ni tokens.
- Se registra solo **"PENDIENTE"** si Luis aún no los ha nombrado.

**Estado actual: PENDIENTE.** Luis no ha nombrado usuarios de prueba Admin ni Staff en esta fase.

---

## 7. Siguiente fase operativa

**Fase 6E — Ejecución Controlada en Supabase, solo BLOCK 0.**

La Fase 6E debe iniciar únicamente con el pre-check de solo lectura del BLOCK 0. Ningún bloque mutante debe ejecutarse hasta que los resultados del BLOCK 0 sean revisados y Luis apruebe explícitamente el siguiente bloque.

---

## 8. Estado final

- Este documento cierra el ciclo de decisiones de pre-ejecución.
- Supabase permanece sin cambios.
- `index.html` permanece intacto.
- La producción permanece sin cambios.
- La ejecución de SQL sigue pendiente de aprobación explícita, bloque por bloque.

---

*Documento generado: 2026-08-14*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
