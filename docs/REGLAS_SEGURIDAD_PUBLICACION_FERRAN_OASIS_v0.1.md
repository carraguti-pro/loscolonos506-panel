# Reglas de Seguridad de Publicación — Ferran / Oasis / Los Colonos

**Proyecto:** Ferran / Oasis Puerto Varas / Panel Los Colonos 506-A\
**Versión:** v0.1 — Checklist permanente de seguridad\
**Fecha:** 2026-08-13\
**Estado:** Documento de referencia permanente. Aplica a Luis, ChatGPT y Claude antes de publicar, conectar UI, desplegar o tocar Supabase en cualquiera de los proyectos Ferran/Oasis/Los Colonos.

---

## 1. Principio

> **"No basta con que funcione. Tiene que funcionar sin dejar puertas abiertas."**

Una función que funciona visualmente pero expone datos, claves o accesos no autorizados no está terminada. Está a medio hacer y es peligrosa.

---

## 2. Reglas absolutas

- **Nunca exponer el `service_role` de Supabase en el frontend.** Ni en HTML, ni en JS, ni en ningún archivo público.
- **Nunca exponer claves privadas** en `index.html`, JavaScript, assets públicos, ni en GitHub.
- **La anon key de Supabase solo es aceptable con RLS probado.** Sin RLS verificado, la anon key expone toda la tabla.
- **Ningún SQL se ejecuta sin aprobación explícita de Luis.**
- **Ninguna UI se conecta antes de que las pruebas RLS pasen.**
- **Ningún formulario público sin control de abuso** (validación, límites razonables, sin exponer datos internos).
- **Ningún bucket de Storage público** salvo aprobación intencional y explícita.
- **Ningún deploy manual como atajo** para saltarse revisión, salvo aprobación explícita.

---

## 3. Seguridad de frontend

- El código frontend es público. Cualquiera que abra el sitio puede ver el HTML, el JavaScript y los assets.
- Todo lo que esté dentro de `index.html` o de un bundle JS puede ser leído por cualquier visitante — incluyendo comentarios, nombres de funciones, y strings.
- **Ninguna clave secreta va en el frontend.** Solo la anon key de Supabase, que está diseñada para ser pública y depende de RLS para su seguridad real.
- **Ninguna operación privilegiada se ejecuta desde el navegador.** Operaciones que requieren permisos elevados (usar `service_role`, bypass de RLS, acceso a datos sensibles sin filtro) deben vivir en el servidor (Netlify Functions), nunca en el cliente.

---

## 4. Seguridad de Supabase

- **RLS debe estar habilitado antes de conectar cualquier UI.** Crear una tabla sin RLS y conectarla a una interfaz, aunque sea "por un momento", expone los datos.
- **Admin y Staff deben probarse por separado.** No basta con probar como Admin y asumir que Staff funciona igual — las políticas RLS pueden fallar de forma asimétrica.
- **`service_role` solo se usa server-side** (Netlify Functions, scripts administrativos locales). Nunca en código que corre en el navegador del usuario.
- **Ninguna tabla debe depender solo de que el frontend "no muestre" el dato.** Ocultar un campo en la UI no protege el dato — cualquiera puede hacer la consulta directa a la API de Supabase. La protección real está en RLS.
- **Verificar los valores exactos que retorna `get_my_role()`** antes de escribir políticas que dependan de ellos (`'admin'`, `'staff'`, case-sensitive). Un valor mal asumido puede bloquear a Admin o abrir acceso a Staff sin darse cuenta.

---

## 5. Seguridad de Storage

- **Validar tipo de archivo** antes de aceptar una subida (extensión y MIME type, no confiar solo en el nombre).
- **Validar tamaño de archivo** — límites explícitos, no ilimitados.
- **Usar URLs firmadas (signed URLs)** cuando el contenido no debe ser público, con expiración corta.
- **Evitar buckets públicos** salvo que la publicidad del contenido sea una decisión intencional y aprobada (ej: fotos de la vitrina).
- **Nunca confiar en el nombre de archivo provisto por el usuario.** Puede contener rutas maliciosas, caracteres especiales, o intentos de sobrescribir otros archivos. Generar nombres/paths controlados por el sistema.

---

## 6. Formularios públicos / landing

- **Un formulario público está expuesto a cualquiera en internet**, no solo a huéspedes reales. Debe tratarse como entrada no confiable.
- **Validar los campos obligatorios** tanto en frontend (UX) como en backend/RLS (seguridad real).
- **Evitar enviar emails sin considerar abuso o límite de tasa.** Un formulario sin control puede usarse para spam o para agotar cuotas de servicios como EmailJS/Resend.
- **Evitar exponer datos internos** en las respuestas del formulario (mensajes de error que revelen estructura de tablas, IDs internos, u otra información operativa).
- **Nunca conectar un formulario público directamente a una tabla privilegiada.** Debe pasar por una política RLS restrictiva (solo INSERT, con constraints) o por una función server-side que valide antes de escribir.

---

## 7. Netlify Functions / lógica server-side

- **Los secretos viven solo en variables de entorno** (Netlify dashboard), nunca en el código fuente ni en el repositorio.
- **Las acciones privilegiadas se ejecutan en funciones server-side**, no en el cliente.
- **Nunca devolver secretos al cliente** en la respuesta de una función — ni siquiera por error de debugging.
- **Registrar logs con cuidado**, sin exponer datos personales de huéspedes o Staff (nombres completos, emails, teléfonos, montos) en logs que puedan ser accedidos ampliamente.

---

## 8. Higiene de GitHub / repositorio

- **Ningún token en el código.** Ni en commits actuales ni en el historial.
- **Ningún `.env` commiteado.**
- **`.claude/` nunca se commitea** salvo aprobación explícita y puntual de Luis.
- **Revisar `git diff` antes de cada commit** — confirmar exactamente qué cambia.
- **Commitear solo los archivos intencionados** — nunca `git add -A` o `git add .` sin revisar antes.

---

## 9. Checklist de despliegue

Antes de cualquier commit, push o deploy que toque funcionalidad nueva o sensible:

- [ ] `git diff` revisado línea por línea
- [ ] Sin secretos expuestos (claves, tokens, service_role)
- [ ] RLS verificado en las tablas involucradas
- [ ] Admin probado explícitamente
- [ ] Staff probado explícitamente
- [ ] Storage revisado (tipos, tamaños, buckets, signed URLs)
- [ ] Formularios públicos revisados (validación, abuso, datos expuestos)
- [ ] Sin `service_role` en frontend
- [ ] Ruta de rollback conocida antes de ejecutar
- [ ] Aprobación explícita de Luis confirmada

Sin las 10 casillas marcadas, no se procede.

---

## 10. Aplicación a la fase actual de Inventario

- **La Fase 6A de Inventario debe incluir verificación de seguridad antes de ejecutar cualquier SQL.**
- **Ninguna UI se conecta inmediatamente después de crear las tablas** `inventory_items`, `inventory_requests`, `inventory_movements`.
- **Staff no accede a las tablas de inventario** a menos que las pruebas RLS de la matriz (ver `docs/PLAN_PRE_EJECUCION_INVENTARIO_REPOSICION_506A_v0.1.md`, sección 5) pasen completamente.
- **Ninguna actualización de `current_stock` ocurre sin un registro correspondiente en `inventory_movements`.**
- **No se toca el bloque Insumos legacy** (`supply_alerts` y su UI en Staff Servicios) hasta que el módulo nuevo esté validado en producción.

---

## 11. Regla final

> **"Paso a pasito con cuidadito. No abrir ventanas vulnerables."**

---

*Documento generado: 2026-08-13*

*Aplica a:* https://oasispuertovaras.netlify.app *·* https://loscolonos506.netlify.app

*Repositorios:* github.com/carraguti-pro/oasispuertovaras *·* github.com/carraguti-pro/loscolonos506-panel
