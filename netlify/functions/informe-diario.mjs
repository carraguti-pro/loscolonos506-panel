// Informe Operativo Diario — Netlify Scheduled Function
// Schedule: 0 13 * * * UTC
//   = 09:00 Chile Standard Time (CLT, UTC-4, May–Aug)
//   = 10:00 Chile Summer Time (CLST, UTC-3, Sep–Apr)
// To target exactly 09:00 year-round, switch to two schedules or adjust manually per season.
//
// Required env vars (set in Netlify dashboard — never committed):
//   SUPABASE_URL               project URL
//   SUPABASE_SERVICE_ROLE_KEY  service role key (bypasses RLS — keep secret)
//   RESEND_API_KEY             from resend.com dashboard
//   REPORT_FROM_EMAIL          verified sender domain in Resend
//   REPORT_RECIPIENTS          comma-separated list of recipient emails

export const config = {
  schedule: '0 13 * * *'
};

const EXCLUDED_STATUSES = ['cancelled', 'cancelada', 'expirada', 'bloqueada_admin'];
const TEST_GUEST_RE = /test|prueba|dummy/i;
const CL_TZ = 'America/Santiago';
const FIELDS = 'id,guest_name,check_in,check_out,nights,platform,status';

function getChileDates() {
  const now = new Date();
  const fmt = date => new Intl.DateTimeFormat('en-CA', { timeZone: CL_TZ }).format(date);
  return {
    today: fmt(now),
    tomorrow: fmt(new Date(now.getTime() + 24 * 60 * 60 * 1000))
  };
}

async function sbFetch(baseUrl, key, resource) {
  const res = await fetch(`${baseUrl}/rest/v1/${resource}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

function fmtShort(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function fmtFull(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function nightsStr(n) {
  const v = n != null ? Number(n) : null;
  if (v == null || isNaN(v)) return '—';
  return `${v} noche${v === 1 ? '' : 's'}`;
}

function rowHtml(r) {
  return `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${r.guest_name || '—'}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${fmtShort(r.check_in)} → ${fmtShort(r.check_out)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${nightsStr(r.nights)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${r.platform || '—'}</td>
        </tr>`;
}

function sectionHtml(label, rows, color, emptyLabel) {
  if (!rows.length) {
    return `<p style="color:#6b7280;font-size:13px;margin:0 0 4px">Sin ${emptyLabel} programados.</p>`;
  }
  return `
      <h3 style="margin:0 0 8px;font-size:14px;color:${color}">${label}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:4px">
        <thead>
          <tr style="background:#f3f4f6;text-align:left">
            <th style="padding:6px 10px">Huésped</th>
            <th style="padding:6px 10px">Fechas</th>
            <th style="padding:6px 10px">Duración</th>
            <th style="padding:6px 10px">Plataforma</th>
          </tr>
        </thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>
      </table>`;
}

function buildHtml({ today, tomorrow, checkins, checkouts, nextRow }) {
  const hora = new Intl.DateTimeFormat('es-CL', {
    timeZone: CL_TZ, hour: '2-digit', minute: '2-digit'
  }).format(new Date());

  const hoyCI = checkins.filter(r => r.check_in === today);
  const manCI = checkins.filter(r => r.check_in === tomorrow);
  const hoyCO = checkouts.filter(r => r.check_out === today);
  const manCO = checkouts.filter(r => r.check_out === tomorrow);

  const cruce = hoyCO.length > 0 && hoyCI.length > 0;

  const cruceBlock = cruce
    ? `<div style="background:#fff7ed;border-left:4px solid #f97316;padding:10px 14px;margin-bottom:18px;border-radius:4px;font-size:13px">
        ⚠️ <strong>Cruce de día — ${fmtFull(today)}:</strong> Hay check-out y check-in el mismo día. Coordinar aseo entre salida y entrada.
      </div>`
    : '';

  const nextBlock = nextRow
    ? `<div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:10px 14px;margin-top:18px;border-radius:4px;font-size:13px">
        📅 <strong>Próximo ingreso:</strong> ${nextRow.guest_name || '—'} · ${fmtFull(nextRow.check_in)}
      </div>`
    : '';

  const checklist = `
    <div style="margin-top:20px;padding:14px 16px;background:#f9fafb;border-radius:6px;font-size:13px">
      <strong>✅ Checklist operativo</strong>
      <ul style="margin:8px 0 0;padding-left:18px;color:#374151;line-height:1.7">
        <li>☐ ¿Departamento operativo?</li>
        <li>☐ ¿Llaves disponibles en conserjería?</li>
        <li>☐ ¿Limpieza previa confirmada para próximos ingresos?</li>
        <li>☐ ¿Limpieza post check-out coordinada?</li>
        <li>☐ ¿Reporte check-out pendiente?</li>
        <li>☐ ¿Staff informado en grupo Depa?</li>
        <li>☐ ¿Fichas de lavandería registradas si corresponde?</li>
      </ul>
    </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;max-width:640px;margin:0 auto;padding:24px 20px;color:#111827">

  <div style="border-bottom:3px solid #0ea5e9;padding-bottom:12px;margin-bottom:20px">
    <h1 style="margin:0;font-size:20px;color:#0ea5e9">📋 Informe Operativo Diario</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280">Depa 506-A Los Colonos · Generado ${fmtFull(today)} ${hora}</p>
  </div>

  ${cruceBlock}

  <h2 style="font-size:15px;margin:0 0 12px;color:#111827">Hoy — ${fmtFull(today)}</h2>
  ${sectionHtml('🚪 Check-outs hoy', hoyCO, '#ef4444', 'check-outs')}
  <div style="margin-top:14px"></div>
  ${sectionHtml('🏠 Check-ins hoy', hoyCI, '#22c55e', 'check-ins')}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0">

  <h2 style="font-size:15px;margin:0 0 12px;color:#111827">Mañana — ${fmtFull(tomorrow)}</h2>
  ${sectionHtml('🚪 Check-outs mañana', manCO, '#f97316', 'check-outs')}
  <div style="margin-top:14px"></div>
  ${sectionHtml('🏠 Check-ins mañana', manCI, '#3b82f6', 'check-ins')}

  ${nextBlock}
  ${checklist}

  <p style="font-size:11px;color:#9ca3af;margin-top:28px;border-top:1px solid #f3f4f6;padding-top:12px">
    Panel Los Colonos · Depa 506-A · Informe automático · ${fmtFull(today)}
  </p>
</body>
</html>`;
}

export default async function handler() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    RESEND_API_KEY,
    REPORT_FROM_EMAIL,
    REPORT_RECIPIENTS
  } = process.env;

  const missing = Object.entries({
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, REPORT_FROM_EMAIL, REPORT_RECIPIENTS
  }).filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    console.error('[informe-diario] Missing env vars:', missing.join(', '));
    return new Response(`Missing env vars: ${missing.join(', ')}`, { status: 500 });
  }

  const recipients = REPORT_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    console.error('[informe-diario] REPORT_RECIPIENTS resolved to empty list');
    return new Response('No valid recipients', { status: 500 });
  }

  const { today, tomorrow } = getChileDates();
  console.log(`[informe-diario] Running for today=${today} tomorrow=${tomorrow}`);

  try {
    const excl = `status=not.in.(${EXCLUDED_STATUSES.join(',')})`;

    const [ciRows, coRows, nextRows] = await Promise.all([
      sbFetch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
        `reservations?check_in=gte.${today}&check_in=lte.${tomorrow}&${excl}&select=${FIELDS}&order=check_in.asc&limit=20`),
      sbFetch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
        `reservations?check_out=gte.${today}&check_out=lte.${tomorrow}&${excl}&select=${FIELDS}&order=check_out.asc&limit=20`),
      sbFetch(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
        `reservations?check_in=gt.${tomorrow}&${excl}&select=${FIELDS}&order=check_in.asc&limit=1`)
    ]);

    const clean = rows => (rows || []).filter(r => !TEST_GUEST_RE.test(r.guest_name || ''));
    const checkins = clean(ciRows);
    const checkouts = clean(coRows);
    const nextRow = clean(nextRows)[0] ?? null;

    console.log(`[informe-diario] check-ins:${checkins.length} check-outs:${checkouts.length} next:${nextRow?.guest_name ?? 'none'}`);

    const html = buildHtml({ today, tomorrow, checkins, checkouts, nextRow });

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: REPORT_FROM_EMAIL,
        to: recipients,
        subject: `📋 Informe Operativo ${today} — Depa 506-A`,
        html
      })
    });

    if (!sendRes.ok) {
      const body = await sendRes.text();
      console.error('[informe-diario] Resend error:', sendRes.status, body);
      return new Response(`Resend error ${sendRes.status}: ${body}`, { status: 502 });
    }

    const { id: emailId } = await sendRes.json();
    console.log('[informe-diario] Email sent ok, id:', emailId);
    return Response.json({ ok: true, date: today, emailId, recipients: recipients.length });

  } catch (err) {
    console.error('[informe-diario] Unhandled error:', err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }
}
