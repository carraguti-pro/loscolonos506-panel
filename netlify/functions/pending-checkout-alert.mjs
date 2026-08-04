// pending-checkout-alert.mjs — Netlify Scheduled Function (C3-1)
// Detects reservations with check_out = today CLT that have no checkout report submitted.
// Sends ONE summary email per run via Resend. Records every alert in operational_notifications.
// Idempotency via UNIQUE(event_type, source_row_id, alert_level, alert_date).
//
// Schedule: 0,30 15-19 * * * UTC
//   Fires every 30 min, 15:00–19:30 UTC. Internal Chile-time gate (late-only, +0 to +35 min):
//     Level 1 — active 12:00–12:35 CLT  → fires 16:00/16:30 UTC (CLT) or 15:00/15:30 UTC (CLST)
//     Level 2 — active 14:30–15:05 CLT  → fires 18:30/19:00 UTC (CLT) or 17:30/18:00 UTC (CLST)
//   19:00 UTC = 15:00 CLT (winter catch-up for L2, within +35 min window).
//   19:30 UTC = 15:30 CLT — outside the late-only window, returns outside-window.
//   Gate is asymmetric: never fires BEFORE approved time. 14:15 and 14:00 cannot trigger L2.
//   Runs outside windows return {ok:true, skipped:'outside-window'} immediately.
//
// Required env vars (Netlify dashboard — never committed):
//   SUPABASE_URL               project URL
//   SUPABASE_SERVICE_ROLE_KEY  service role key (bypasses RLS — keep secret)
//   RESEND_API_KEY             from resend.com dashboard
//   REPORT_FROM_EMAIL          verified sender domain in Resend
//   CHECKOUT_ALERT_RECIPIENTS  comma-separated recipient emails

export const config = {
  schedule: '0,30 15-19 * * *'
};

const EXCLUDED_STATUSES = ['cancelled', 'cancelada', 'expirada', 'bloqueada_admin'];
const CL_TZ = 'America/Santiago';
const LATE_TOLERANCE_MIN = 35;

const L1 = { h: 12, m: 0 };
const L2 = { h: 14, m: 30 };

// ── Chile time helpers ──

function getChileNow() {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: CL_TZ }).format(now);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CL_TZ,
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  const hour = parseInt(get('hour'), 10) % 24;
  const minute = parseInt(get('minute'), 10);
  return { date, hour, minute };
}

function totalMin(h, m) { return h * 60 + m; }

function inLateWindow(cur, target) {
  return cur >= target && cur <= target + LATE_TOLERANCE_MIN;
}

function getAlertLevel(hour, minute) {
  const cur = totalMin(hour, minute);
  if (inLateWindow(cur, totalMin(L1.h, L1.m))) return 1;
  if (inLateWindow(cur, totalMin(L2.h, L2.m))) return 2;
  return null;
}

// ── HTML helpers ──

function clTimestamp() {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: CL_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date());
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const _esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildSubject(alertLevel, alertDate, hasCritical) {
  const safe = String(alertDate || '').replace(/[\r\n\t]/g, ' ').trim();
  if (hasCritical) {
    return `🚨 [CRÍTICO] Reporte check-out pendiente con check-in mismo día · Depa 506-A · ${safe}`;
  }
  if (alertLevel === 2) {
    return `🚨 [URGENTE] Reporte check-out sin entregar · Depa 506-A · ${safe}`;
  }
  return `⏳ Reporte check-out pendiente · Depa 506-A · ${safe}`;
}

function buildEmailHtml({ alertLevel, alertDate, pendingRows }) {
  const ts = clTimestamp();
  const isL2 = alertLevel === 2;
  const accent = isL2 ? '#c0392b' : '#d97706';
  const icon = isL2 ? '🚨' : '⏳';
  const levelLabel = isL2
    ? `<span style="color:#c0392b;font-weight:700">Nivel 2 — 14:30 / Escalación</span>`
    : `<span style="color:#d97706;font-weight:700">Nivel 1 — 12:00</span>`;

  const rowsHtml = pendingRows.map(r => {
    const sdBlock = r.sameDayRows?.length
      ? `<div style="background:#fff7ed;border-left:3px solid #f97316;padding:8px 12px;margin:6px 0 0;font-size:12px;border-radius:3px">
          <strong>⚡ Cruce mismo día — check-in programado:</strong>
          <ul style="margin:4px 0 0;padding-left:16px;color:#78350f">
            ${r.sameDayRows.map(sd => `<li>${_esc(sd.guest_name) || '—'} — ingreso ${fmtDate(sd.check_in)}</li>`).join('')}
          </ul>
        </div>`
      : '';

    const critTag = r.critical
      ? `<span style="background:#c0392b;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle">CRÍTICO</span>`
      : '';

    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">
        <strong>${_esc(r.guest_name) || '—'}</strong>${critTag}
        ${sdBlock}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap">${fmtDate(r.check_out)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top">${_esc(r.platform) || '—'}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px 20px;color:#111827">

  <div style="border-bottom:3px solid ${accent};padding-bottom:12px;margin-bottom:20px">
    <h1 style="margin:0;font-size:18px;color:${accent}">${icon} Reporte check-out pendiente</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Depa 506-A Los Colonos · ${ts}</p>
  </div>

  <div style="background:#f9fafb;border-radius:6px;padding:12px 16px;margin-bottom:20px;font-size:13px">
    <div><strong>Nivel de alerta:</strong> ${levelLabel}</div>
    <div style="margin-top:4px"><strong>Fecha:</strong> ${fmtDate(alertDate)}</div>
    <div style="margin-top:4px;color:#6b7280">Reporte esperado antes de las <strong>11:30 CLT</strong>.</div>
  </div>

  <p style="font-size:13px;margin-bottom:12px">
    Las siguientes reservas con check-out hoy <strong>no tienen reporte registrado</strong>:
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600">Huésped</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600">Check-out</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600">Plataforma</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;font-size:13px;margin-bottom:20px">
    <strong>Acción requerida:</strong> Revisar Panel Los Colonos y contactar Staff si corresponde.
  </div>

  <div style="text-align:center;margin:24px 0">
    <a href="https://loscolonos506.netlify.app" style="display:inline-block;padding:10px 22px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600">
      Revisar Panel Los Colonos
    </a>
  </div>

  <p style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:12px">
    Panel Los Colonos · Depa 506-A · Alerta automática C3
  </p>
</body>
</html>`;
}

// ── PATCH helper ──

async function patchRow(supabaseUrl, headers, id, patch) {
  return fetch(`${supabaseUrl}/rest/v1/operational_notifications?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch)
  }).catch(e => console.warn('[pending-checkout-alert] PATCH failed for %s:', id, e.message));
}

// ── Handler ──

export default async function handler() {
  // ── Chile-time gate ──
  const { date: todayCLT, hour, minute } = getChileNow();
  const alertLevel = getAlertLevel(hour, minute);
  const chileTimeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (!alertLevel) {
    console.log('[pending-checkout-alert] Outside window. Chile time: %s', chileTimeStr);
    return new Response(
      JSON.stringify({ ok: true, skipped: 'outside-window', chile_time: chileTimeStr }),
      { status: 200 }
    );
  }

  console.log('[pending-checkout-alert] Activated. level=%d date=%s chile_time=%s', alertLevel, todayCLT, chileTimeStr);

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
    console.error('[pending-checkout-alert] Missing env vars:', missing.join(', '));
    return new Response(JSON.stringify({ ok: false, error: 'Missing configuration' }), { status: 500 });
  }

  const recipients = CHECKOUT_ALERT_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    console.error('[pending-checkout-alert] CHECKOUT_ALERT_RECIPIENTS resolved to empty list');
    return new Response(JSON.stringify({ ok: false, error: 'Missing configuration' }), { status: 500 });
  }

  const svcHdrs = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Accept': 'application/json'
  };

  const svcPatchHdrs = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  // ── Query reservations checking out today ──
  let reservations;
  try {
    const excl = EXCLUDED_STATUSES.join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reservations?check_out=eq.${todayCLT}&status=not.in.(${excl})&select=id,guest_name,check_in,check_out,platform`,
      { headers: svcHdrs }
    );
    if (!res.ok) {
      console.error('[pending-checkout-alert] Reservations query failed:', res.status);
      return new Response(JSON.stringify({ ok: false, error: 'Reservation query failed' }), { status: 500 });
    }
    reservations = await res.json();
  } catch (err) {
    console.error('[pending-checkout-alert] Reservations fetch error:', err.message);
    return new Response(JSON.stringify({ ok: false, error: 'Reservation query error' }), { status: 500 });
  }

  if (!reservations.length) {
    console.log('[pending-checkout-alert] No checkouts today (%s).', todayCLT);
    return new Response(
      JSON.stringify({ ok: true, skipped: 'no-checkouts-today', alert_level: alertLevel, alert_date: todayCLT }),
      { status: 200 }
    );
  }

  // ── For each reservation: check report existence + same-day detection ──
  const pendingCandidates = [];

  await Promise.all(reservations.map(async reservation => {
    try {
      // Check if checkout report exists
      const rptRes = await fetch(
        `${SUPABASE_URL}/rest/v1/checkout_reports?reservation_id=eq.${reservation.id}&checklist->>tipo=eq.checkout&select=id&limit=1`,
        { headers: svcHdrs }
      );
      if (!rptRes.ok) {
        console.warn('[pending-checkout-alert] Report check failed for reservation %s: %d', reservation.id, rptRes.status);
        return; // cannot confirm absence — skip to avoid false alert
      }
      const reports = await rptRes.json();
      if (Array.isArray(reports) && reports.length > 0) return; // report exists

      // Report missing — detect same-day check-in
      let sameDayRows = [];
      try {
        const excl = EXCLUDED_STATUSES.join(',');
        const sdRes = await fetch(
          `${SUPABASE_URL}/rest/v1/reservations?check_in=eq.${reservation.check_out}&status=not.in.(${excl})&id=neq.${reservation.id}&select=id,guest_name,check_in&limit=5`,
          { headers: svcHdrs }
        );
        if (sdRes.ok) {
          sameDayRows = (await sdRes.json()) || [];
        } else {
          console.warn('[pending-checkout-alert] Same-day query failed for reservation %s: %d', reservation.id, sdRes.status);
        }
      } catch (err) {
        console.warn('[pending-checkout-alert] Same-day fetch error for %s:', reservation.id, err.message);
        // Non-fatal
      }

      pendingCandidates.push({ reservation, sameDayRows, critical: sameDayRows.length > 0 });

    } catch (err) {
      console.warn('[pending-checkout-alert] Error checking reservation %s:', reservation.id, err.message);
    }
  }));

  if (!pendingCandidates.length) {
    console.log('[pending-checkout-alert] All %d checkouts have reports submitted.', reservations.length);
    return new Response(
      JSON.stringify({ ok: true, skipped: 'all-reports-submitted', alert_level: alertLevel, alert_date: todayCLT }),
      { status: 200 }
    );
  }

  // ── Insert into operational_notifications (idempotency via UNIQUE constraint) ──
  const insertedRows = [];
  let insertErrors = 0;

  await Promise.all(pendingCandidates.map(async ({ reservation, sameDayRows, critical }) => {
    const insertMeta = {
      guest_name: reservation.guest_name,
      check_in: reservation.check_in,
      check_out: reservation.check_out,
      platform: reservation.platform,
      same_day: sameDayRows,
      critical,
      escalation: alertLevel === 2
    };

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
            event_type: 'pending_checkout_alert',
            source_row_id: reservation.id,
            reservation_id: reservation.id,
            alert_level: alertLevel,
            alert_date: todayCLT,
            status: 'pending',
            recipient: CHECKOUT_ALERT_RECIPIENTS,
            attempts: 0,
            metadata: insertMeta
          })
        }
      );

      if (!notifRes.ok) {
        const errText = await notifRes.text();
        console.error('[pending-checkout-alert] Outbox insert failed for %s: %d %s', reservation.id, notifRes.status, errText.slice(0, 200));
        insertErrors++;
        return;
      }

      const rows = await notifRes.json();
      if (Array.isArray(rows) && rows.length > 0) {
        insertedRows.push({ notifId: rows[0].id, reservation, sameDayRows, critical, insertMeta });
      } else {
        console.log('[pending-checkout-alert] Duplicate outbox entry for reservation %s level %d — skipping.', reservation.id, alertLevel);
      }
    } catch (err) {
      console.error('[pending-checkout-alert] Outbox insert error for %s:', reservation.id, err.message);
      insertErrors++;
    }
  }));

  if (!insertedRows.length) {
    if (insertErrors > 0) {
      console.error('[pending-checkout-alert] All outbox inserts failed. insert_errors=%d', insertErrors);
      return new Response(
        JSON.stringify({ ok: false, error: 'Notification insert failed', alert_level: alertLevel, alert_date: todayCLT, insert_errors: insertErrors }),
        { status: 500 }
      );
    }
    console.log('[pending-checkout-alert] No new notifications (all duplicates).');
    return new Response(
      JSON.stringify({ ok: true, skipped: 'no-new-alerts', alert_level: alertLevel, alert_date: todayCLT }),
      { status: 200 }
    );
  }

  // ── Build ONE summary email from all newly inserted rows ──
  const hasCritical = insertedRows.some(r => r.critical);
  const criticalCount = insertedRows.filter(r => r.critical).length;
  const pendingCount = insertedRows.length;

  const subject = buildSubject(alertLevel, todayCLT, hasCritical);

  const pendingRows = insertedRows.map(r => ({
    guest_name: r.reservation.guest_name,
    check_in: r.reservation.check_in,
    check_out: r.reservation.check_out,
    platform: r.reservation.platform,
    sameDayRows: r.sameDayRows,
    critical: r.critical
  }));

  const html = buildEmailHtml({ alertLevel, alertDate: todayCLT, pendingRows });

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
      console.error('[pending-checkout-alert] Resend error:', sendRes.status, errText.slice(0, 200));

      // PATCH all inserted rows to failed
      await Promise.allSettled(insertedRows.map(({ notifId }) =>
        patchRow(SUPABASE_URL, svcPatchHdrs, notifId, {
          status: 'failed',
          attempts: 1,
          last_error: `${sendRes.status}: ${errText.slice(0, 480)}`
        })
      ));

      return new Response(
        JSON.stringify({ ok: false, error: 'Email send failed', alert_level: alertLevel, alert_date: todayCLT, pending_count: pendingCount, critical_count: criticalCount }),
        { status: 502 }
      );
    }

    const { id: emailId } = await sendRes.json();
    console.log('[pending-checkout-alert] Email sent ok, id:', emailId, 'level:', alertLevel, 'pending:', pendingCount, 'critical:', criticalCount);

    // PATCH all inserted rows to sent — metadata merged with emailId
    await Promise.allSettled(insertedRows.map(({ notifId, insertMeta }) =>
      patchRow(SUPABASE_URL, svcPatchHdrs, notifId, {
        status: 'sent',
        sent_at: new Date().toISOString(),
        attempts: 1,
        metadata: { ...insertMeta, emailId }
      })
    ));

    return new Response(
      JSON.stringify({ ok: true, emailId, alert_level: alertLevel, alert_date: todayCLT, pending_count: pendingCount, critical_count: criticalCount, sent_count: pendingCount, ...(insertErrors > 0 && { insert_errors: insertErrors }) }),
      { status: 200 }
    );

  } catch (err) {
    console.error('[pending-checkout-alert] Resend fetch error:', err.message);

    // PATCH all inserted rows to failed
    await Promise.allSettled(insertedRows.map(({ notifId }) =>
      patchRow(SUPABASE_URL, svcPatchHdrs, notifId, {
        status: 'failed',
        attempts: 1,
        last_error: String(err.message || 'fetch error').slice(0, 500)
      })
    ));

    return new Response(
      JSON.stringify({ ok: false, error: 'Email send failed', alert_level: alertLevel, alert_date: todayCLT }),
      { status: 502 }
    );
  }
}
