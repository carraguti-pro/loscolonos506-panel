# Cierre operativo Staff / Check-out / Pagos — 506-A Los Colonos

**Proyecto:** Oasis 506-A · Panel Los Colonos · https://loscolonos506.netlify.app\
**Fecha de cierre:** 2026-08-11\
**Commit de producción al cierre:** `9e89a47`

---

## 1. Contexto

Este documento registra el cierre del ciclo de mejoras al flujo operativo Staff para el departamento 506-A Los Colonos. El ciclo abarcó el flujo completo: reporte de check-out → solicitud de pago → revisión Admin → pago → comprobante → recibo WA.

El objetivo fue hacer el flujo simple, seguro y trazable para el equipo de servicios, sin requerir conocimientos técnicos de su parte, y sin exponer datos financieros de huéspedes al Staff.

---

## 2. Problemas abordados

### 2.1 Duplicación de reportes de check-out
Staff podía enviar más de un reporte de check-out para la misma reserva, contaminando el historial operacional y confundiendo al Admin.

### 2.2 Flujo de solicitud de pago confuso
El botón "SOLICITAR PAGO OPERACIÓN" aparecía visualmente activo en todo momento, incluso sin ninguna reserva seleccionada y sin reporte previo enviado. Staff no tenía una secuencia clara de pasos a seguir.

### 2.3 WhatsApp automático con URL larga de Supabase
El flujo de "Recibo WA" abría WhatsApp automáticamente (`window.open / wa.me`) y, en versiones intermedias, incluía la URL firmada de Supabase Storage en el mensaje (del tipo `https://zltgwfkdqvdteanxjigq.supabase.co/storage/v1/object/sign/...?token=eyJ...`). Esta URL es ilegible, expira, y no es apta para un mensaje formal a Staff.

### 2.4 Admin no veía reporte y pago juntos
La vista de Admin mostraba el reporte de check-out y la solicitud de pago en secciones separadas, sin correlación visual. Esto dificultaba la revisión y aprobación operacional.

### 2.5 Botón de pago habilitado sin contexto válido
Al cargar la página, o después de un refresco, `REPORTE_CTX` podía quedar con un valor residual de sesión anterior, mientras el label mostraba "Seleccione un reporte...". El botón negro estaba visualmente activo, lo que generaba riesgo de confusión y eventual solicitud de pago para la reserva incorrecta.

### 2.6 Email Staff pausado
El envío de email de comprobante al Staff quedó pausado. La causa: el plan gratuito de EmailJS tiene dos templates activos — `template_1mrao2b` (ciclo de vida del huésped) y `template_eue07jk` (notificación Admin desde vitrina pública) — y no hay slot libre. No se reutilizaron templates existentes para no interrumpir los flujos en producción.

---

## 3. Cambios implementados

### 3.1 Admin "Revisión Operacional" — checkout + pago juntos
**Commit:** `84122b6` — "Unify admin operational review"

`loadOpsReports()` expandido para mostrar en cada card de reporte el `payment_request` relacionado por `reservation_id` (join en memoria, sin query adicional). `reviewActionsHTML()` integrado en cada card. Nav renombrado a "Revisión Operacional".

### 3.2 Corrección de detección de checkout en Staff
**Commit:** `3e3849b` — "Fix staff checkout detection and payment selection"

- Eliminado `,estado` del select de `checkout_reports` que causaba HTTP 400 en PostgREST.
- Rama `en_revision` en `_svRenderRow` dividida: sin payment_request muestra "Solicitar pago →", con payment_request muestra "⏳ EN REVISIÓN".
- Nueva función `svSelectRes(idx)` establece `REPORTE_CTX` sin abrir modal ni tocar DB.
- Guard duplicado en `saveReporte()`: bloquea si ya existe `tipo=checkout` para la misma `reservation_id`.

### 3.3 RLS — política Staff para lectura de reportes operacionales
**Aplicada en Supabase (sin commit de código):**

```sql
CREATE POLICY "staff_select_operational_reports"
ON checkout_reports FOR SELECT TO authenticated
USING (
  get_my_role() = 'staff'
  AND (checklist->>'tipo') IN ('checkout', 'payment_request')
  AND reservation_id IS NOT NULL
);
```

**Causa raíz:** Staff podía INSERT pero no SELECT sus propias filas de `tipo=checkout/payment_request`. Todos los queries de `loadServicios()` devolvían `[]` por filtrado RLS. `_crSet` siempre vacío → tabla siempre mostraba "PENDIENTE REPORTE". Políticas existentes de Admin intactas. Staff sigue sin poder SELECT `maintenance_observation` ni `gasto_reembolso_operativo`.

### 3.4 Acciones post-pago en vista Admin
**Commit:** `609e2d9` — "Show post-payment actions in operational review"

Botones de comprobante y recibo aparecen en la card Admin después de que el pago es marcado como pagado.

### 3.5 Desacoplamiento WhatsApp del flujo Staff
**Commit:** `650b6ea` — "Decouple staff payment request from WhatsApp"

`solicitarPago()` ya no abre WhatsApp automáticamente al enviar una solicitud de pago. El WA es acción explícita del Admin.

### 3.6 "Recibo WA" — solo clipboard, sin window.open
**Commit:** `7a89d0c` — "Copy staff WhatsApp receipt instead of opening WhatsApp"

`waStaffRecibo()` cambiado a clipboard-only. Eliminados `window.open()` y `wa.me`. Copia el mensaje al portapapeles y muestra toast "Recibo copiado · Péguelo en WhatsApp". Si el clipboard falla, imprime el mensaje en `console.warn` para copia manual desde DevTools.

### 3.7 "Recibo WA" — texto limpio sin URL de Supabase
**Commit:** `4920b22` — "Use clean staff receipt text without signed URL"

Eliminado completamente el bloque de generación de URL firmada de Supabase. El mensaje ya no incluye ninguna URL. En su lugar, línea estática: `"Comprobante bancario: adjunto."`. El PDF se gestiona independientemente con el botón "Comprobante Pago" (`openComprobanteAdmin`).

### 3.8 Refresco de tabla Staff post-acción
**Commit:** `2df908b` — "Refresh staff services after report and payment request"

`await loadServicios()` añadido al bloque de éxito de `saveReporte()` y de `solicitarPago()`. Antes de este fix, la tabla no se actualizaba tras guardar un reporte o solicitar pago — Staff tenía que recargar la página manualmente.

### 3.9 Seguridad botón "SOLICITAR PAGO OPERACIÓN"
**Commit:** `9e89a47` — "Disable staff payment button until reservation selected"

Tres cambios coordinados:

- **`svSetPagoMantMode(isMaint)`:** `isMaint=false` ya no re-habilita el botón. Solo `isMaint=true` lo deshabilita. Antes, cualquier llamada con `false` habilitaba el botón, incluyendo las de `openReporte()` (al abrir el modal de reporte) y `loadServicios()`.
- **`loadServicios()`:** al finalizar, `REPORTE_CTX=null` y `sv-pago-btn.disabled=true`. Elimina el contexto residual de sesión anterior.
- **`svSelectRes(idx)`:** única ruta que habilita el botón. Solo si `REPORTE_CTX?.id` es válido (Staff hizo clic explícito en "Solicitar pago →").

**Flujo resultante:**

```
Carga de página / loadServicios()  →  botón DESHABILITADO, REPORTE_CTX=null
Staff clica "REPORTE CHECK-OUT"    →  openReporte() → svSetPagoMantMode(false) = no-op para botón
Staff cancela modal sin guardar    →  botón sigue DESHABILITADO
Staff clica "Solicitar pago →"     →  svSelectRes() → REPORTE_CTX asignado → botón HABILITADO
Staff solicita pago con éxito      →  solicitarPago() → loadServicios() → botón DESHABILITADO, REPORTE_CTX=null
```

### 3.10 Flujo operacional definitivo "Recibo WA"

| Acción | Quién | Cómo |
|---|---|---|
| Abre / descarga PDF comprobante | Admin | Botón "Comprobante Pago" → URL firmada → ventana |
| Copia texto recibo Staff | Admin | Botón "Recibo WA" → clipboard → pega en WhatsApp |
| Adjunta PDF al WhatsApp | Admin | Manualmente, adjuntando el PDF descargado |

Staff recibe mensaje formal sin URLs técnicas, sin tokens JWT, sin código de sistema.

---

## 4. Validación real

### 4.1 Caso Olalla Sanchez
Utilizado como validación operacional real de la vista Admin: revisión de solicitud de pago, aprobación, marcado como pagado, adjuntar comprobante PDF. Datos reales en producción.

- Reporte checkout: `3b5b5518` (tipo=checkout, estado_final=listo, Staff: Francisca Cabañas)
- Payment request: `2a98f072` — honorario $40.000 + 4 fichas lavandería = $46.000
- Fecha de pago: 2026-08-04
- Observación: "Transferencia Mercado de Pago"
- Comprobante en Storage: `pagos_staff/2a98f072-…/comprobante_pago_1785891231734.pdf` (108 KB)

### 4.2 Validación checkout Staff — Francisca Cabañas

El caso Olalla sirvió además para validar el flujo Staff completo en operación real:
- Ningún reporte duplicado generado.
- Operatoria correcta de inicio a fin.
- Comprobantes archivados correctamente en Storage.
- WhatsApp recibido correctamente (texto limpio, sin URL larga).
- Comprobante PDF adjuntado de forma independiente por Admin.

---

## 5. Commits relevantes

| Commit | Descripción |
|---|---|
| `84122b6` | Unify admin operational review |
| `3e3849b` | Fix staff checkout detection and payment selection |
| `609e2d9` | Show post-payment actions in operational review |
| `650b6ea` | Decouple staff payment request from WhatsApp |
| `7a89d0c` | Copy staff WhatsApp receipt instead of opening WhatsApp |
| `4920b22` | Use clean staff receipt text without signed URL |
| `2df908b` | Refresh staff services after report and payment request |
| `9e89a47` | Disable staff payment button until reservation selected |

Commits anteriores del ciclo también en producción:

| Commit | Descripción |
|---|---|
| `01ef37e` | Add operational checkout alerts |
| `350cf0e` | Update staff operations quick guide |
| `136de0f` | Separate additional staff records visually |
| `0753389` | Show owner instructions in staff report modal |
| `ef70e60` | Add staff operational status pills |
| `0e4e0d4` | Use softer warning for operation payment gate |
| `ed2382f` | Require checkout report before operation payment request |

---

## 6. Qué no se tocó

- Vitrina pública Oasis (`oasispuertovaras.netlify.app`)
- Templates EmailJS (`template_1mrao2b` ciclo huésped, `template_eue07jk` notificación Admin vitrina)
- Precios y tarifas
- iCal / Radar
- Liquidaciones
- Finanzas core
- Estructura de base de datos (solo se añadió la política RLS aprobada explícitamente)
- Datos de producción, excepto el caso Olalla Sanchez aprobado explícitamente
- `reservation_payments` (exclusivo Admin)
- Comprobantes de reserva en Storage (prefijo `comprobantes_reservas/`)

---

## 7. Mejoras pendientes

Las siguientes mejoras quedan documentadas pero **no iniciadas**. Requieren autorización explícita antes de cualquier implementación.

### 7.1 Corrección de reporte de checkout sin duplicación
Actualmente `saveReporte()` es siempre un INSERT. Si Staff necesita corregir un reporte ya enviado, no hay forma de hacerlo sin crear un duplicado (bloqueado por el guard). Se necesita un flujo de corrección que permita actualizar el reporte existente en lugar de insertar uno nuevo.

### 7.2 Múltiples fotos / evidencias en reporte Staff
El reporte actual admite un solo archivo adjunto. Staff debería poder adjuntar múltiples fotos o PDFs como evidencia del estado del departamento.

### 7.3 Módulo "Inventario y Reposición Operacional"
El área de Insumos actual es básica. Se necesita un módulo más completo que cubra:
- Insumos de limpieza / baño / cocina
- Ropa blanca (sábanas, toallas, bajada de cama)
- Losa, menaje
- Equipamiento menor
- Reposiciones por daño, desgaste, pérdida o stock bajo

**Flujo objetivo:**
Staff detecta necesidad → sistema registra solicitud → Admin revisa / compra → stock actualizado → historial trazable

**Motivación directa:** Staff envió solicitud por WhatsApp con lista de insumos (jabón líquido, Cif, detergente, paños de cocina, Confort, limpia pisos desechables, Quix lavalozas, bolsas basura baño). El módulo actual no permite registrar esto de forma estructurada.

### 7.4 Compras como ingreso de inventario
Cuando Luis o Admin compran insumos, debe ser posible registrar la compra como gasto operativo Y como entrada de stock simultáneamente, con comprobante y notas.

### 7.5 Email Staff — arquitectura pendiente
El envío de email de comprobante de pago al Staff está pausado. EmailJS en plan gratuito tiene ambos slots ocupados. Opciones futuras: upgrade de plan EmailJS, o implementar Resend (ya usado en Netlify Functions para alertas operacionales) como proveedor de email Staff.

---

## 8. Principios de trabajo reforzados en este ciclo

- **Paso a pasito con cuidadito.** Cada cambio revisado y aprobado antes de deployar.
- **Pantalla real manda.** Ninguna asunción sobre comportamiento en producción sin evidencia visual real.
- **Con platas no se juega; y si son ajenas, menos.** Cero tolerancia a errores en flujos de pago.
- **No arreglar una cosa rompiendo otra.** Alcance quirúrgico en cada modificación.
- **Sin datos ficticios en producción.** La validación real espera a casos reales.
- **Apartment first. System later.** El departamento y su operación son prioridad sobre el sistema.
- **No soy programador, pero pasito a pasito aprendo.** (Luis Figueroa)

---

## 9. Estado final

El flujo Staff de check-out y pagos ha sido validado en operación real y se considera **cerrado operacionalmente para este ciclo**.

El sistema está en producción en commit `9e89a47`. Las mejoras futuras quedan documentadas en la sección 7 de este documento y en la memoria del proyecto.

**No iniciar ninguna modificación al sistema sin autorización explícita de Luis.**

---

*Documento generado: 2026-08-11*\
*Producción: https://loscolonos506.netlify.app*\
*Repositorio: github.com/carraguti-pro/loscolonos506-panel*
