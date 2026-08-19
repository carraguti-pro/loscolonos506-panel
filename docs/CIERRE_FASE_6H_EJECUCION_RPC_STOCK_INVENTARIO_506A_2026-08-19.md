# Cierre Fase 6H — Ejecución controlada RPC de stock Inventario 506-A

## 1. Metadata

- **Proyecto:** Oasis / Los Colonos 506-A Panel
- **Fecha:** 2026-08-19
- **Rama / base de origen:** `origin/main` — `baaf15a` (Document phase 6H block 5 pre-execution tests)
- **Alcance:** RPC de Supabase `public.inventory_apply_stock_movement`
- **Modo de ejecución:** ejecución manual controlada, bloque por bloque, vía Supabase SQL Editor, con GO explícito de Luis en cada bloque
- **Estado de UI / deploy:** no tocado. Ninguna interfaz de usuario fue conectada, `index.html` no cambió, y no hubo deploy en ningún momento de esta fase

---

## 2. Resumen ejecutivo

La Fase 6H ejecutó y verificó de forma controlada, directamente en Supabase, el RPC `public.inventory_apply_stock_movement` — el mecanismo de integridad de stock diseñado en la Fase 6F como reemplazo del UPDATE directo de Admin sobre `inventory_items.current_stock` (bloqueado desde el cierre de la Fase 6E).

Se ejecutaron y verificaron, bloque por bloque y con GO explícito de Luis en cada uno: la creación del RPC (`SECURITY DEFINER`, `search_path` fijado), la asignación de permisos (`EXECUTE` solo para `authenticated`, revocado para `PUBLIC` y `anon`), una prueba positiva de Admin en tiempo de ejecución, y dos pruebas negativas — Staff autenticado y anon/no autenticado — ambas con criterios exactos de PASS basados en `SQLSTATE` y mensaje de error, no en "cualquier error SQL".

Todos los bloques ejecutados (BLOCK 0 a BLOCK 7) resultaron en PASS. Ninguna prueba dejó datos permanentes: las tres tablas de inventario permanecen en `0` filas. BLOCK 8 (rollback/drop del RPC) permanece documentado únicamente como plan de contingencia y no fue ejecutado.

La Fase 6H se cierra exitosamente a nivel de base de datos / RPC. No se aprobó ni se realizó ninguna integración de UI en esta fase.

---

## 3. Alcance ejecutado

- Creación del RPC `public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)`.
- Asignación de permisos de ejecución (`REVOKE`/`GRANT`) sobre ese RPC.
- Verificación estructural y de permisos del RPC, repetida en múltiples puntos de control.
- Prueba positiva de ejecución real como Admin, dentro de una transacción revertida.
- Precheck de solo lectura previo a las pruebas negativas, incluyendo verificación de capacidad de cambio de rol (`SET ROLE`) adaptada a la versión de PostgreSQL del proyecto.
- Prueba negativa de ejecución real como Staff, dentro de una transacción revertida.
- Prueba negativa de ejecución real como `anon` (no autenticado), dentro de una transacción revertida.
- Verificaciones de limpieza (clean verify) y de verificación final consolidada tras cada fase de pruebas.

No incluyó: conexión de UI, cambios de código de aplicación, ni ningún cambio a `index.html`, Staff Servicios, Insumos legacy o `supply_alerts`.

---

## 4. Bloques ejecutados y resultados

| Bloque | Descripción | Resultado |
|---|---|---|
| BLOCK 0 | Precheck de solo lectura | PASS 7/7 |
| BLOCK 1 | Crear RPC `public.inventory_apply_stock_movement` | OK |
| BLOCK 2 | Permisos: `PUBLIC` revocado, `anon` revocado, `authenticated` con `EXECUTE` otorgado | OK |
| BLOCK 3 | Verificar existencia de la función y sus permisos | PASS 8/8 |
| BLOCK 4 | Prueba positiva Admin en tiempo de ejecución | OK |
| BLOCK 4 CLEAN VERIFY | Verificación de limpieza tras BLOCK 4 | PASS 5/5 |
| BLOCK 5.0 | Precheck de solo lectura previo a pruebas negativas | PASS 17/17 |
| BLOCK 5A | Prueba negativa Staff en tiempo de ejecución | OK |
| BLOCK 5A CLEAN VERIFY | Verificación de limpieza tras BLOCK 5A | PASS 5/5 |
| BLOCK 5B | Prueba negativa anon/no autenticado en tiempo de ejecución | OK |
| BLOCK 5C CLEAN VERIFY | Verificación de limpieza tras BLOCK 5A/5B | PASS 9/9 |
| BLOCK 6 CLEAN VERIFY | Verificar rollback / ausencia de datos de prueba remanentes | PASS 6/6 |
| BLOCK 7 CONSOLIDATED FINAL VERIFY | Verificación final consolidada | PASS 15/15 |
| BLOCK 8 | Plan de rollback del RPC | NO EJECUTADO — permanece como contingencia documentada |

---

## 5. Estado final del RPC

- **Existe:** `public.inventory_apply_stock_movement(uuid,text,numeric,text,text,uuid)`
- **`SECURITY DEFINER`:** `true`
- **`search_path`:** `public, pg_catalog`

## 6. Estado final de permisos

- **`anon_can_execute`:** `false`
- **`authenticated_can_execute`:** `true`
- **Política `admin_update_inventory_items`:** ausente (confirmado — el UPDATE directo de Admin sobre `inventory_items` sigue bloqueado; el RPC es la única vía de mutación de stock)

## 7. Estado final de RLS

- `inventory_items`: RLS habilitado (`true`)
- `inventory_requests`: RLS habilitado (`true`)
- `inventory_movements`: RLS habilitado (`true`)

## 8. Estado final de datos

- `inventory_items`: `0` filas
- `inventory_requests`: `0` filas
- `inventory_movements`: `0` filas
- No queda ningún dato de prueba

---

## 9. Resultado de la prueba positiva

**Admin puede aplicar un movimiento de stock a través del RPC.** La prueba de ejecución real, dentro de una transacción revertida (`ROLLBACK`), confirmó que Admin — autenticado y con `get_my_role() = 'admin'` — puede invocar `public.inventory_apply_stock_movement` y obtener los valores esperados de `previous_stock`/`new_stock`, sin dejar datos permanentes.

## 10. Resultados de las pruebas negativas

- **Staff rechazado por validación interna admin-only:** Staff tiene permiso `EXECUTE` a nivel de PostgreSQL (otorgado a `authenticated`, y Staff es un usuario `authenticated` real), pero es rechazado dentro del cuerpo de la función por la verificación `get_my_role() = 'admin'`. El rechazo se confirmó con `SQLSTATE P0001` y el mensaje exacto de la función, sin cambios de stock ni movimientos insertados.
- **anon rechazado por falta de privilegio `EXECUTE`:** `anon` no tiene `EXECUTE` otorgado sobre el RPC (revocado en BLOCK 2). El rechazo ocurre a nivel de PostgreSQL, antes de que el cuerpo de la función se ejecute, confirmado con `SQLSTATE 42501` (`insufficient_privilege`).

Ambas pruebas negativas cumplieron el criterio exacto de PASS documentado (SQLSTATE y comportamiento esperado, no "cualquier error SQL").

---

## 11. Evidencia de rollback / limpieza

Cada bloque de prueba en tiempo de ejecución (BLOCK 4, BLOCK 5A, BLOCK 5B) se ejecutó dentro de una transacción que terminó en `ROLLBACK`, sin ningún `COMMIT`. Las verificaciones de limpieza posteriores (BLOCK 4 CLEAN VERIFY, BLOCK 5A CLEAN VERIFY, BLOCK 5C CLEAN VERIFY, BLOCK 6 CLEAN VERIFY, BLOCK 7 CONSOLIDATED FINAL VERIFY) confirmaron en múltiples puntos de control que las tres tablas de inventario permanecen en `0` filas y que no queda ningún dato de prueba.

---

## 12. Lo que intencionalmente no se hizo

- No se conectó ninguna interfaz de usuario (UI).
- No se modificó código de aplicación.
- No se tocó `index.html`.
- No se conectó Staff Servicios.
- No se tocó Insumos legacy.
- No se tocó `supply_alerts`.
- No hubo deploy.
- BLOCK 8 (rollback/drop del RPC) no fue ejecutado; permanece documentado únicamente como plan de contingencia.

---

## 13. Conclusión operacional

La Fase 6H se cierra exitosamente a nivel de base de datos / RPC. El RPC `public.inventory_apply_stock_movement` queda disponible para una futura integración con la UI de Admin, pero **ninguna integración de UI está aprobada todavía**.

---

## 14. Siguiente fase recomendada

Preparar el diseño de integración UI/Admin, o un cierre de handoff, **únicamente tras aprobación explícita de Luis**. Ningún trabajo de esa siguiente fase queda autorizado por este documento de cierre.

---

## 15. Nota de seguridad

"No basta con que funcione. Tiene que funcionar sin dejar puertas abiertas."

---

*Documento generado: 2026-08-19*

*Producción al momento de este documento: https://loscolonos506.netlify.app*

*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
