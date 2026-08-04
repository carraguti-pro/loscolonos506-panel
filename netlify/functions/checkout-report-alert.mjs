// checkout-report-alert.mjs — Netlify HTTP Function (C2B-R2A)
// Validates JWT, resolves role from profiles, fetches checkout report + reservation
// from DB (source of truth), records outbox entry in operational_notifications, sends email via Resend.
// Browser-supplied operational fields are ignored — all email content comes from DB.
//
// Required env vars (Netlify dashboard — never committed):
//   SUPABASE_URL               project URL
//   SUPABASE_SERVICE_ROLE_KEY  service role key (bypasses RLS — keep secret)
//   RESEND_API_KEY             from resend.com dashboard
//   REPORT_FROM_EMAIL          verified sender domain in Resend
//   CHECKOUT_ALERT_RECIPIENTS  comma-separated recipient emails

const CORS_ORIGIN = 'https://loscolonos506.netlify.app';
const EXCLUDED_STATUSES = ['cancelled', 'cancelada', 'expirada', 'bloqueada_admin'];
const CL_TZ = 'America/Santiago';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResp(body, status = 200) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function clTimestamp() {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CL_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date());
}

const _esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildEmailHtml({ guest_name, check_in, check_out, platform, staff_name, checklist, sameDayRows }) {
  const hasSit = checklist?.situaciones && Object.values(checklist.situaciones).some(v => v?.si);
  const ts = clTimestamp();
  const estado_final = checklist?.estado_final;

  const sitLabel = hasSit
    ? `<span style="color:#d97706;font-weight:600">⚠ Sí — ver detalle en panel</span>`
    : `<span style="color:#6b7280">No</span>`;

  const sameDayBlock = sameDayRows?.length
    ? `<div style="background:#fff7ed;border-left:4px solid #f97316;padding:12px 16px;margin:20px 0;border-radius:4px;font-size:13px">
        <strong>⚡ Cruce de día — check-in mismo día</strong><br>
        <span style="color:#92400e">El check-out de <strong>${_esc(guest_name)}</strong> (${fmtDate(check_out)}) coincide con un nuevo ingreso programado para el mismo día:</span>
        <ul style="margin:8px 0 0;padding-left:18px;color:#78350f">
          ${sameDayRows.map(r => `<li>${_esc(r.guest_name) || '—'} — ingreso ${fmtDate(r.check_in)}</li>`).join('')}
        </ul>
        <span style="font-size:12px;color:#92400e">Coordinar aseo entre salida y entrada antes de recibir al próximo huésped.</span>
      </div>`
    : '';

  const efLabel = estado_final
    ? ({ listo: 'Listo', con_observaciones: 'Con observaciones', con_danos: 'Con daños', pendiente: 'Pendiente', en_proceso: 'En proceso' }[estado_final] || _esc(estado_final))
    : '—';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px 20px;color:#111827">

  <div style="border-bottom:3px solid #0ea5e9;padding-bottom:12px;margin-bottom:20px">
    <h1 style="margin:0;font-size:18px;color:#0ea5e9">📋 Reporte check-out registrado</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Depa 506-A Los Colonos · ${ts}</p>
  </div>

  ${sameDayBlock}

  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
    <tbody>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-weight:600;width:40%;border-bottom:1px solid #e5e7eb">Huésped</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${_esc(guest_name) || '—'}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Check-in</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${fmtDate(check_in)}</td>
      </tr>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Check-out</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${fmtDate(check_out)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Plataforma</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${_esc(platform) || '—'}</td>
      </tr>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Estado final</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${efLabel}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb">Situaciones</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${sitLabel}</td>
      </tr>
      <tr style="background:#f9fafb">
        <td style="padding:8px 12px;font-weight:600">Registrado por</td>
        <td style="padding:8px 12px">${_esc(staff_name) || '—'}</td>
      </tr>
    </tbody>
  </table>

  <div style="text-align:center;margin:24px 0">
    <a href="https://loscolonos506.netlify.app" style="display:inline-block;padding:10px 22px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600">
      Revisar Panel Los Colonos
    </a>
  </div>

  <p style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:12px">
    Panel Los Colonos · Depa 506-A · Notificación automática
  </p>
</body>
</html>`;
}

export default async function handler(request) {
  // ── OPTIONS preflight ──
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // ── Method guard ──
  if (request.method !== 'POST') {
    return jsonResp({ ok: false, error: 'Method not allowed' }, 405);
  }

  // ── Env vars ──
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY,
    REPORT_FROM_EMAIL,
    CHECKOUT_ALERT_RECIPIENTS
  } = process.env;

  const missing = Object.entries({
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REPORT_FROM_EMAIL, CHECKOUT_ALERT_RECIPIENTS
  }).filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    console.error('[checkout-report-alert] Missing env vars:', missing.join(', '));
    return jsonResp({ ok: false, error: 'Missing configuration' }, 500);
  }

  const recipients = CHECKOUT_ALERT_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    console.error('[checkout-report-alert] CHECKOUT_ALERT_RECIPIENTS resolved to empty list');
    return jsonResp({ ok: false, error: 'Missing configuration' }, 500);
  }

  // ── Auth: validate JWT via Supabase ──
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResp({ ok: false, error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);

  let uid;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY
      }
    });
    if (!userRes.ok) {
      console.warn('[checkout-report-alert] JWT validation failed:', userRes.status);
      return jsonResp({ ok: false, error: 'Invalid token' }, 401);
    }
    const user = await userRes.json();
    uid = user?.id;
    if (!uid) return jsonResp({ ok: false, error: 'Invalid token payload' }, 401);
  } catch (err) {
    console.error('[checkout-report-alert] Auth fetch error:', err.message);
    return jsonResp({ ok: false, error: 'Auth error' }, 401);
  }

  // ── Auth: resolve role from profiles table (NOT app_metadata) ──
  try {
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=role,active&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    if (!profRes.ok) {
      console.error('[checkout-report-alert] Profile lookup failed:', profRes.status);
      return jsonResp({ ok: false, error: 'Could not verify role' }, 500);
    }
    const profiles = await profRes.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile?.active || !['staff', 'admin'].includes(profile.role)) {
      console.warn('[checkout-report-alert] Forbidden: uid=%s role=%s active=%s', uid, profile?.role, profile?.active);
      return jsonResp({ ok: false, error: 'Forbidden' }, 403);
    }
  } catch (err) {
    console.error('[checkout-report-alert] Profile fetch error:', err.message);
    return jsonResp({ ok: false, error: 'Could not verify role' }, 500);
  }

  // ── Parse body: only row_id and reservation_id are trusted ──
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { row_id, reservation_id } = body;
  if (!row_id || !reservation_id) {
    return jsonResp({ ok: false, error: 'row_id and reservation_id are required' }, 400);
  }

  // ── Fetch checkout report from DB (source of truth) ──
  let reportRow;
  try {
    const rptRes = await fetch(
      `${SUPABASE_URL}/rest/v1/checkout_reports?id=eq.${row_id}&select=id,reservation_id,checklist,created_by,created_at&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    if (!rptRes.ok) {
      console.error('[checkout-report-alert] Report fetch failed:', rptRes.status);
      return jsonResp({ ok: false, error: 'Could not fetch report' }, 500);
    }
    const rptRows = await rptRes.json();
    reportRow = Array.isArray(rptRows) ? rptRows[0] : null;
    if (!reportRow) {
      return jsonResp({ ok: false, error: 'Report not found' }, 404);
    }
    if (reportRow.reservation_id !== reservation_id) {
      console.warn('[checkout-report-alert] reservation_id mismatch: payload=%s db=%s', reservation_id, reportRow.reservation_id);
      return jsonResp({ ok: false, error: 'Report mismatch' }, 400);
    }
    if (reportRow.checklist?.tipo !== 'checkout') {
      return jsonResp({ ok: true, skipped: 'not-checkout' });
    }
  } catch (err) {
    console.error('[checkout-report-alert] Report fetch error:', err.message);
    return jsonResp({ ok: false, error: 'Could not fetch report' }, 500);
  }

  // ── Fetch reservation from DB ──
  let reservation;
  try {
    const resRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?id=eq.${reportRow.reservation_id}&select=id,guest_name,check_in,check_out,platform&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    if (!resRes.ok) {
      console.error('[checkout-report-alert] Reservation fetch failed:', resRes.status);
      return jsonResp({ ok: false, error: 'Could not fetch reservation' }, 500);
    }
    const resRows = await resRes.json();
    reservation = Array.isArray(resRows) ? resRows[0] : null;
    if (!reservation) {
      return jsonResp({ ok: false, error: 'Reservation not found' }, 404);
    }
    if (!reservation.check_out) {
      console.warn('[checkout-report-alert] Reservation has no check_out, cannot set alert_date');
      return jsonResp({ ok: false, error: 'Reservation data incomplete' }, 422);
    }
  } catch (err) {
    console.error('[checkout-report-alert] Reservation fetch error:', err.message);
    return jsonResp({ ok: false, error: 'Could not fetch reservation' }, 500);
  }

  // ── Same-day check-in detection (uses DB check_out) ──
  let sameDayRows = [];
  try {
    const excl = EXCLUDED_STATUSES.join(',');
    const sdRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?check_in=eq.${reservation.check_out}&status=not.in.(${excl})&id=neq.${reservation.id}&select=id,guest_name,check_in&limit=5`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept': 'application/json'
        }
      }
    );
    if (sdRes.ok) {
      sameDayRows = (await sdRes.json()) || [];
    } else {
      console.warn('[checkout-report-alert] Same-day query failed:', sdRes.status);
    }
  } catch (err) {
    console.warn('[checkout-report-alert] Same-day fetch error:', err.message);
    // Non-fatal: proceed without same-day data
  }

  // ── Outbox insert — idempotency via UNIQUE(event_type, source_row_id, alert_level, alert_date) ──
  const svcHeaders = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  let notifId;
  try {
    const notifRes = await fetch(
      `${SUPABASE_URL}/rest/v1/operational_notifications`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation,resolution=ignore-duplicates'
        },
        body: JSON.stringify({
          event_type: 'checkout_report_alert',
          source_row_id: reportRow.id,
          reservation_id: reservation.id,
          alert_level: 1,
          alert_date: reservation.check_out,
          status: 'pending',
          recipient: CHECKOUT_ALERT_RECIPIENTS,
          attempts: 0,
          metadata: { same_day_count: sameDayRows.length }
        })
      }
    );
    if (!notifRes.ok) {
      const errText = await notifRes.text();
      console.error('[checkout-report-alert] Outbox insert failed:', notifRes.status, errText.slice(0, 200));
      return jsonResp({ ok: false, error: 'Notification record failed' }, 500);
    }
    const notifRows = await notifRes.json();
    if (!Array.isArray(notifRows) || notifRows.length === 0) {
      // UNIQUE conflict resolved silently — duplicate notification
      console.log('[checkout-report-alert] Duplicate outbox entry for source_row_id=%s, skipping.', reportRow.id);
      return jsonResp({ ok: true, skipped: 'duplicate' });
    }
    notifId = notifRows[0].id;
  } catch (err) {
    console.error('[checkout-report-alert] Outbox insert error:', err.message);
    return jsonResp({ ok: false, error: 'Notification record failed' }, 500);
  }

  // ── Build email from DB values only ──
  const hasSameDay = sameDayRows.length > 0;
  const safeGuestName = String(reservation.guest_name || 'Huésped').replace(/[\r\n\t]/g, ' ').trim() || 'Huésped';
  const subject = hasSameDay
    ? `⚡ Reporte check-out registrado + cruce mismo día · ${safeGuestName} · Depa 506-A`
    : `📋 Reporte check-out registrado · ${safeGuestName} · Depa 506-A`;

  const html = buildEmailHtml({
    guest_name: reservation.guest_name,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    platform: reservation.platform,
    staff_name: reportRow.created_by,
    checklist: reportRow.checklist,
    sameDayRows
  });

  // ── Send via Resend ──
  try {
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: REPORT_FROM_EMAIL, to: recipients, subject, html })
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error('[checkout-report-alert] Resend error:', sendRes.status, errText.slice(0, 200));

      await fetch(
        `${SUPABASE_URL}/rest/v1/operational_notifications?id=eq.${notifId}`,
        {
          method: 'PATCH',
          headers: svcHeaders,
          body: JSON.stringify({
            status: 'failed',
            attempts: 1,
            last_error: `${sendRes.status}: ${errText.slice(0, 480)}`
          })
        }
      ).catch(e => console.warn('[checkout-report-alert] PATCH failed (fail case):', e.message));

      return jsonResp({ ok: false, error: 'Email send failed' }, 502);
    }

    const { id: emailId } = await sendRes.json();
    console.log('[checkout-report-alert] Email sent ok, id:', emailId, 'same_day:', hasSameDay);

    await fetch(
      `${SUPABASE_URL}/rest/v1/operational_notifications?id=eq.${notifId}`,
      {
        method: 'PATCH',
        headers: svcHeaders,
        body: JSON.stringify({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: 1,
          metadata: { emailId, same_day_count: sameDayRows.length }
        })
      }
    ).catch(e => console.warn('[checkout-report-alert] PATCH failed (success case):', e.message));

    return jsonResp({ ok: true, emailId });

  } catch (err) {
    console.error('[checkout-report-alert] Resend fetch error:', err.message);

    await fetch(
      `${SUPABASE_URL}/rest/v1/operational_notifications?id=eq.${notifId}`,
      {
        method: 'PATCH',
        headers: svcHeaders,
        body: JSON.stringify({
          status: 'failed',
          attempts: 1,
          last_error: String(err.message || 'fetch error').slice(0, 500)
        })
      }
    ).catch(e => console.warn('[checkout-report-alert] PATCH failed (catch case):', e.message));

    return jsonResp({ ok: false, error: 'Email send failed' }, 502);
  }
}
