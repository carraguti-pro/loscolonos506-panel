# Plan de Pre-Ejecución Controlada — Inventario y Reposición Operacional — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Versión:** v0.1 — Plan de pre-ejecución\
**Fecha:** 2026-08-13\
**Estado:** Documento de control. No autoriza ejecución. Ningún SQL ha sido ejecutado.\
**Fases previas:** Diseño (`023fb73`) · Modelo de datos (`6478f96`) · Borrador SQL (`924bbdc`) · Revisión SQL (`b0aae21`)\
**Último commit con cambios de código operativo:** `9e89a47`

---

## 1. Propósito

Este documento es un checklist de control previo a cualquier ejecución futura de SQL en Supabase para el módulo "Inventario y Reposición Operacional".

No es una autorización de ejecución. Es el punto de referencia que debe revisarse y completarse — ítem por ítem, con decisión explícita de Luis en cada uno — antes de que una sola línea del borrador SQL (`docs/SQL_BORRADOR_INVENTARIO_REPOSICION_506A_v0.1.md`) se ejecute en Supabase.

Mientras este checklist no esté completo y aprobado, la ejecución permanece bloqueada.

---

## 2. Líneas rojas absolutas

Estas reglas no se negocian dentro de este ciclo de trabajo:

- **Ningún SQL se ejecuta sin aprobación explícita de Luis**, ítem por ítem, en el momento de la ejecución — no por aprobación general anticipada.
- **Ninguna interfaz de usuario se conecta** a las tablas nuevas inmediatamente después de crearlas. Crear tablas ≠ habilitar UI.
- **No se toca el bloque Insumos legacy** en `index.html` ni la tabla `supply_alerts`.
- **No se toca Staff Servicios** (`loadServicios()` ni ninguna función relacionada).
- **No se tocan** pagos, finanzas, `reservation_payments`, EmailJS, Vitrina pública, iCal/Radar, ni ningún flujo de producción existente.

---

## 3. Verificaciones requeridas antes de ejecutar

Cada ítem debe quedar marcado con una decisión explícita antes de proceder a la Fase 6 (ejecución real, si se autoriza):

| # | Verificación | Estado |
|---|---|---|
| 1 | Confirmar el valor exacto que retorna `get_my_role()` para un usuario Admin (`'admin'` literal, case-sensitive) | ☐ Pendiente |
| 2 | Confirmar el valor exacto que retorna `get_my_role()` para un usuario Staff (`'staff'` literal, ya confirmado en ciclo Staff/Checkout anterior, pero debe re-verificarse en este contexto) | ☐ Pendiente |
| 3 | Aprobar o rechazar el índice único de control de duplicados: `UNIQUE INDEX (category, lower(trim(item_name))) WHERE active = true` | ☐ Pendiente |
| 4 | Decidir mecanismo de integridad de stock: RPC/función `SECURITY DEFINER` vs. trigger `AFTER INSERT` en `inventory_movements` | ☐ Pendiente |
| 5 | Confirmar el orden de ejecución (ver sección 4) | ☐ Pendiente |
| 6 | Confirmar plan de rollback (ver nota abajo) | ☐ Pendiente |
| 7 | Confirmar que ninguna UI se conectará inmediatamente después de crear las tablas | ☐ Pendiente |
| 8 | Confirmar disponibilidad de usuarios de prueba RLS — uno Admin, uno Staff — para validar políticas antes de cualquier uso real | ☐ Pendiente |

**Nota — plan de rollback:** si una tabla o política falla a mitad de ejecución, el rollback consiste en `DROP TABLE` de las tablas nuevas creadas hasta ese punto, en orden inverso al de creación (`inventory_movements` → `inventory_requests` → `inventory_items`). Ninguna tabla existente del sistema (`supply_alerts`, `checkout_reports`, `reservation_payments`, etc.) se ve afectada, porque el módulo nuevo no modifica ni referencia esas tablas.

---

## 4. Borrador de orden de ejecución

Esto es un plan de pasos, no SQL ejecutable. Cada paso requiere verificación visual en el dashboard de Supabase antes de continuar al siguiente.

1. Crear tabla `inventory_items`.
2. **Verificar:** tabla creada, columnas correctas, constraints activos (probar un INSERT que viole un CHECK y confirmar que falla).
3. Crear tabla `inventory_requests`.
4. **Verificar:** tabla creada, FK a `inventory_items` funcional, constraints activos.
5. Crear tabla `inventory_movements`.
6. **Verificar:** tabla creada, FKs a `inventory_items` e `inventory_requests` funcionales, constraints activos.
7. Crear índices.
8. **Verificar:** índices presentes en el dashboard, sin errores de creación.
9. `ENABLE ROW LEVEL SECURITY` en las 3 tablas.
10. Crear políticas RLS (Admin y Staff, las 3 tablas).
11. **Pruebas RLS Admin/Staff** — ejecutar la matriz de pruebas de la sección 5 con los usuarios de prueba del ítem 8 de la sección 3.

Ningún paso continúa al siguiente sin verificación exitosa del anterior.

---

## 5. Matriz de pruebas RLS

Estas pruebas deben ejecutarse con usuarios de prueba reales (uno Admin, uno Staff) antes de que el módulo se considere validado. Ninguna prueba se hace con datos de producción.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Admin hace SELECT en `inventory_items` | Permitido — ve todos los ítems |
| 2 | Admin hace INSERT en `inventory_items` | Permitido |
| 3 | Admin hace UPDATE en `inventory_items` | Permitido |
| 4 | Staff hace SELECT en `inventory_items` | Bloqueado — 0 filas o error RLS |
| 5 | Staff hace INSERT en `inventory_requests` con `requested_by = auth.uid()` propio | Permitido |
| 6 | Staff intenta INSERT en `inventory_requests` con `requested_by` de otro usuario | Bloqueado |
| 7 | Staff hace SELECT en `inventory_requests` | Solo ve sus propias solicitudes, ninguna ajena |
| 8 | Admin hace SELECT en `inventory_requests` | Permitido — ve todas las solicitudes |
| 9 | Admin hace UPDATE en `inventory_requests` (cambiar `status`) | Permitido |
| 10 | Admin hace INSERT en `inventory_movements` | Permitido |
| 11 | Admin hace SELECT en `inventory_movements` | Permitido |
| 12 | Staff hace SELECT en `inventory_movements` | Bloqueado |
| 13 | Staff intenta INSERT en `inventory_movements` | Bloqueado |
| 14 | Cualquier usuario intenta DELETE en cualquiera de las 3 tablas | Bloqueado — no existe política DELETE |

Toda fila con resultado distinto al esperado bloquea el avance a producción hasta corregir la política correspondiente.

---

## 6. Riesgos

| Riesgo | Descripción |
|---|---|
| Valor incorrecto de `get_my_role()` | Si el valor real difiere de `'admin'` (mayúsculas, espacios, u otro string), todas las políticas Admin fallan silenciosamente y Admin queda sin acceso a nada |
| UPDATE directo a `current_stock` | Mientras no se implemente RPC o trigger, un Admin autenticado puede alterar `current_stock` vía PostgREST sin pasar por `inventory_movements`, rompiendo la trazabilidad |
| Duplicados en el catálogo | Sin el índice único aprobado, ítems con el mismo nombre y categoría pueden insertarse repetidamente, generando confusión en el inventario |
| Conexión accidental de UI | Si una tabla se crea y alguien conecta una vista o botón antes de completar la Fase 5/6, se expone funcionalidad no probada en producción |
| Confusión con Insumos legacy | Si ambos sistemas (Insumos legacy y el módulo nuevo) coexisten sin comunicación clara al Staff, puede generarse doble registro o confusión operativa |
| RLS demasiado abierta o demasiado cerrada | Una política mal escrita puede exponer datos de inventario a Staff (riesgo de filtración) o bloquear a Admin de su propio módulo (riesgo operativo) |

---

## 7. Decisión Go / No-Go

Este checklist debe completarse y aprobarse manualmente por Luis antes de iniciar cualquier ejecución SQL real:

- [ ] Los 8 ítems de la sección 3 están resueltos con decisión explícita.
- [ ] El orden de ejecución de la sección 4 fue revisado y aceptado.
- [ ] La matriz de pruebas de la sección 5 fue leída y aceptada como criterio de éxito.
- [ ] Los riesgos de la sección 6 fueron leídos y no hay objeción.
- [ ] Luis autoriza explícitamente, por escrito, iniciar la Fase 6 (ejecución controlada).

**Sin las 5 casillas marcadas, no hay ejecución.**

---

## 8. Estado final

**Este documento NO autoriza ejecución.**

- Supabase permanece intacto.
- Ningún SQL ha sido ejecutado.
- Ninguna tabla, política ni índice existe en Supabase para este módulo.
- La producción permanece intacta en commit `9e89a47`.
- El siguiente paso, si Luis lo autoriza, es completar la sección 3 de este documento y luego iniciar la Fase 6 — ejecución controlada, paso a paso, con verificación en cada etapa.

---

*Documento generado: 2026-08-13*

*Producción al momento del plan: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
