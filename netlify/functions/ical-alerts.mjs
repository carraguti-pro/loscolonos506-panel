// iCal Radar — Netlify Scheduled Function (read-only)
// Schedule: 0 14 * * * UTC
//   = 10:00 Chile Standard Time (CLT, UTC-4, May–Aug)
//   = 11:00 Chile Summer Time (CLST, UTC-3, Sep–Apr)
//
// Reads active iCal feed URLs from ical_feeds (read-only, service role),
// fetches each .ics directly, parses upcoming events, and sends a
// read-only email alert via Resend. Never writes to any Supabase table.
//
// Required env vars (set in Netlify dashboard — never committed):
//   SUPABASE_URL               project URL
//   SUPABASE_SERVICE_ROLE_KEY  service role key (read-only use here)
//   RESEND_API_KEY             from resend.com dashboard
//   REPORT_FROM_EMAIL          verified sender domain in Resend
//   ICAL_ALERT_RECIPIENTS      comma-separated recipient list
// Optional:
//   ICAL_ALERT_DAYS_AHEAD      days ahead to scan (default: 14)

export const config = { schedule: '0 14 * * *' };

const CL_TZ = 'America/Santiago';

function getChileDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: CL_TZ }).format(d);
}

// ── ICS PARSER ────────────────────────────────────────────────────────────────

function parseICalDate(raw) {
  const val = raw.includes(':') ? raw.split(':').pop() : raw;
  if (/^\d{8}$/.test(val))
    return `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`;
  if (/^\d{8}T\d{6}Z?$/i.test(val))
    return `${val.slice(0,4)}-${val.slice(4,6)}-${val.slice(6,8)}`;
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch { /* ignore */ }
  throw new Error(`Formato de fecha no reconocido: ${val}`);
}

function parseICS(icsText) {
  const events = [];
  const unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\r|\n/);
  let inEvent = false;
  let current = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.toUpperCase() === 'BEGIN:VEVENT') { inEvent = true; current = {}; continue; }
    if (trimmed.toUpperCase() === 'END:VEVENT') {
      inEvent = false;
      if (current.uid && current.dateStart && current.dateEnd) events.push(current);
      current = {};
      continue;
    }
    if (!inEvent) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const propName = trimmed.slice(0, colonIdx).toUpperCase().split(';')[0];
    const value = trimmed.slice(colonIdx + 1).trim();
    switch (propName) {
      case 'UID':     current.uid = value; break;
      case 'SUMMARY': current.summary = value; break;
      case 'DTSTART': try { current.dateStart = parseICalDate(value); } catch { /* skip */ } break;
      case 'DTEND':   try { current.dateEnd   = parseICalDate(value); } catch { /* skip */ } break;
    }
  }
  return events;
}

// ── FORMATTING ────────────────────────────────────────────────────────────────

function fmtFull(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function nightsBetween(start, end) {
  const n = Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000);
  return n > 0 ? `${n} noche${n === 1 ? '' : 's'}` : '—';
}

// ── HTML EMAIL ────────────────────────────────────────────────────────────────

const PLATFORM_META = {
  airbnb:  { label: 'Airbnb',  color: '#e8452c', dot: '🟠' },
  booking: { label: 'Booking', color: '#003580', dot: '🔵' },
  vrbo:    { label: 'Vrbo',    color: '#1c5fb0', dot: '🟣' },
};

function platformMeta(p) {
  return PLATFORM_META[p?.toLowerCase()] ?? { label: p, color: '#6b7280', dot: '⚪' };
}

function buildHtml({ today, windowEnd, daysAhead, byPlatform, feedErrors }) {
  const hora = new Intl.DateTimeFormat('es-CL', {
    timeZone: CL_TZ, hour: '2-digit', minute: '2-digit'
  }).format(new Date());

  const totalEvents = Object.values(byPlatform).reduce((s, evs) => s + evs.length, 0);

  const feedErrorBlock = feedErrors.length > 0
    ? `<div style="background:#fff7ed;border-left:4px solid #f97316;padding:10px 14px;margin-bottom:18px;border-radius:4px;font-size:13px">
        ⚠️ <strong>Error al leer ${feedErrors.length} feed(s) — datos no disponibles para:</strong>
        <ul style="margin:6px 0 0;padding-left:16px">
          ${feedErrors.map(e => `<li>${e.platform}: ${e.error}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const platformSections = Object.entries(byPlatform).map(([platform, events]) => {
    const meta = platformMeta(platform);
    const tableBody = events.length === 0
      ? `<p style="color:#6b7280;font-size:13px;margin:4px 0 0">Sin eventos próximos en este período.</p>`
      : `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#f3f4f6;text-align:left">
              <th style="padding:6px 10px">Entrada</th>
              <th style="padding:6px 10px">Salida</th>
              <th style="padding:6px 10px">Duración</th>
              <th style="padding:6px 10px">Descripción plataforma</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(ev => `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb"><strong>${fmtFull(ev.dateStart)}</strong></td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${fmtFull(ev.dateEnd)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${nightsBetween(ev.dateStart, ev.dateEnd)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px">${ev.summary || '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`;

    return `
      <div style="margin-bottom:24px">
        <h2 style="margin:0 0 10px;font-size:15px;color:${meta.color}">${meta.dot} ${meta.label} iCal</h2>
        ${tableBody}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:24px 20px;color:#111827">

  <div style="border-bottom:3px solid #6366f1;padding-bottom:12px;margin-bottom:20px">
    <h1 style="margin:0;font-size:20px;color:#6366f1">📡 Radar iCal — Depa 506-A</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Generado ${fmtFull(today)} ${hora} · Próximos ${daysAhead} días (hasta ${fmtFull(windowEnd)})</p>
  </div>

  <div style="background:#fefce8;border-left:4px solid #eab308;padding:12px 16px;margin-bottom:22px;border-radius:4px;font-size:13px;line-height:1.6">
    ⚠️ <strong>Solo aviso iCal — revisar e ingresar manualmente en el Panel Los Colonos si corresponde.</strong><br>
    <span style="color:#6b7280">Este informe es de solo lectura. Los eventos iCal no se registran automáticamente. Cada evento debe evaluarse y crearse a mano en el panel si representa una reserva real.</span>
  </div>

  ${feedErrorBlock}

  <p style="font-size:13px;color:#374151;margin:0 0 20px">
    <strong>${totalEvents} evento${totalEvents === 1 ? '' : 's'}</strong> iCal encontrado${totalEvents === 1 ? '' : 's'} en los próximos ${daysAhead} días
    (${Object.keys(byPlatform).length} feed${Object.keys(byPlatform).length === 1 ? '' : 's'} consultado${Object.keys(byPlatform).length === 1 ? '' : 's'}).
  </p>

  ${platformSections}

  <p style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:12px">
    Panel Los Colonos · Depa 506-A · Radar iCal automático · ${fmtFull(today)}<br>
    Este correo NO modifica reservas, bloqueos, calendario ni datos financieros.
  </p>
</body>
</html>`;
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export default async function handler() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY,
    REPORT_FROM_EMAIL,
    ICAL_ALERT_RECIPIENTS,
    ICAL_ALERT_DAYS_AHEAD,
  } = process.env;

  const missing = Object.entries({
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
    REPORT_FROM_EMAIL, ICAL_ALERT_RECIPIENTS,
  }).filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    console.error('[ical-alerts] Missing env vars:', missing.join(', '));
    return new Response(`Missing env vars: ${missing.join(', ')}`, { status: 500 });
  }

  const rawRecipients = process.env.ICAL_ALERT_RECIPIENTS || '';
  const recipients = rawRecipients
    .split(',')
    .map(email => email.trim())
    .map(email => email.replace(/^["']|["']$/g, ''))
    .map(email => email.replace(/\s+/g, ''))
    .filter(Boolean);

  const invalidRecipients = recipients.filter(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

  if (!recipients.length || invalidRecipients.length) {
    console.error('[ical-alerts] invalid recipients:', JSON.stringify({ recipients, invalidRecipients }));
    return new Response(JSON.stringify({
      ok: false,
      error: 'Invalid ICAL_ALERT_RECIPIENTS',
      recipients,
      invalidRecipients,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  console.log('[ical-alerts] recipients:', JSON.stringify(recipients));

  const daysAhead = Math.max(1, parseInt(ICAL_ALERT_DAYS_AHEAD || '14', 10) || 14);
  const today     = getChileDate(0);
  const windowEnd = getChileDate(daysAhead);
  console.log(`[ical-alerts] today=${today} windowEnd=${windowEnd} daysAhead=${daysAhead}`);

  // 1. Read active feeds — read-only, service role bypasses RLS
  const feedsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ical_feeds?active=eq.true&select=id,platform,url`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Accept': 'application/json',
      },
    }
  );

  if (!feedsRes.ok) {
    const body = await feedsRes.text();
    console.error('[ical-alerts] Failed to read ical_feeds:', feedsRes.status, body);
    return new Response(`Failed to read ical_feeds: ${feedsRes.status}: ${body}`, { status: 500 });
  }

  const feeds = await feedsRes.json();
  if (!Array.isArray(feeds) || feeds.length === 0) {
    console.log('[ical-alerts] No active feeds found in ical_feeds');
    return Response.json({ ok: true, message: 'No active feeds', total_events: 0 });
  }

  console.log(`[ical-alerts] ${feeds.length} active feed(s) found`);

  // 2. Fetch and parse each feed independently — errors per feed do not abort others
  const byPlatform = {};
  const feedErrors = [];

  for (const feed of feeds) {
    const { platform, url } = feed;
    try {
      const icsRes = await fetch(url, {
        headers: { 'User-Agent': 'FerranPropiedades-iCalRadar/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!icsRes.ok) throw new Error(`HTTP ${icsRes.status}`);
      const icsText = await icsRes.text();
      if (!icsText.includes('BEGIN:VCALENDAR'))
        throw new Error('La respuesta no es un archivo iCal válido');

      const all = parseICS(icsText);
      const upcoming = all
        .filter(ev => ev.dateStart >= today && ev.dateStart <= windowEnd)
        .sort((a, b) => a.dateStart.localeCompare(b.dateStart));

      byPlatform[platform] = upcoming;
      console.log(`[ical-alerts] ${platform}: ${all.length} total → ${upcoming.length} in window`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : (err?.message ?? JSON.stringify(err));
      console.error(`[ical-alerts] ${platform} error:`, errMsg);
      feedErrors.push({ platform, error: errMsg });
    }
  }

  // 3. Build HTML and send via Resend
  const html = buildHtml({ today, windowEnd, daysAhead, byPlatform, feedErrors });
  const totalEvents = Object.values(byPlatform).reduce((s, evs) => s + evs.length, 0);

  console.log('[ical-alerts] resend to:', JSON.stringify(recipients));
  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: REPORT_FROM_EMAIL,
      to: recipients,
      subject: `📡 Radar iCal — Depa 506-A · ${fmtFull(today)}`,
      html,
    }),
  });

  if (!sendRes.ok) {
    const body = await sendRes.text();
    console.error('[ical-alerts] Resend error:', sendRes.status, body);
    return new Response(`Resend error ${sendRes.status}: ${body}`, { status: 502 });
  }

  const { id: emailId } = await sendRes.json();
  console.log('[ical-alerts] Email sent ok, id:', emailId);
  return Response.json({
    ok: true,
    date: today,
    emailId,
    recipients: recipients.length,
    feeds_ok: feeds.length - feedErrors.length,
    feeds_error: feedErrors.length,
    total_events: totalEvents,
  });
}
