-- ============================================================================
-- P5.5-C1 — LIVE WELCOME LINK · reservation-backed opaque token
-- DRAFT MIGRATION — NOT YET APPLIED. For review before touching production DB.
-- Project: zltgwfkdqvdteanxjigq  (public schema)
--
-- Conventions matched from existing migrations / functions:
--   * SECURITY DEFINER + SET search_path TO 'public', 'pg_catalog'
--   * admin check via public.is_current_user_admin()
--   * REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO <role>
--   * ERRCODE 'P0001' for business-rule rejections, '42501' for authz
--
-- Existing RLS on public.reservations is NOT modified:
--   policy admin_full_access     (ALL,    authenticated, get_my_role() = 'admin')
--   policy anon_insert_solicitud (INSERT, anon,          constrained)
--   -> NO anon SELECT policy is added. The ONLY public reservation-derived
--      read path is the SECURITY DEFINER resolver below, which returns exactly
--      three fields for one exact token and cannot enumerate or list.
-- ============================================================================

BEGIN;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS welcome_token       uuid,
  ADD COLUMN IF NOT EXISTS welcome_first_name  text;

COMMENT ON COLUMN public.reservations.welcome_token IS
  'P5.5-C1: opaque bearer token for the live Welcome Oasis link (?stay=<token>). At most one per reservation. NULL = no link issued.';
COMMENT ON COLUMN public.reservations.welcome_first_name IS
  'P5.5-C1: admin-confirmed display first name for Welcome only. Never overwrites guest_name.';

-- ── 2. Uniqueness: at most one reservation per non-null token ────────────────
CREATE UNIQUE INDEX IF NOT EXISTS reservations_welcome_token_key
  ON public.reservations (welcome_token)
  WHERE welcome_token IS NOT NULL;

-- ── 3. ADMIN RPC — issue / ensure the link (idempotent) ─────────────────────
CREATE OR REPLACE FUNCTION public.ensure_welcome_link(
  p_reservation_id uuid,
  p_first_name     text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row     public.reservations%ROWTYPE;
  v_name    text;
  v_stripped text;
  v_token   uuid;
BEGIN
  -- authenticated Admin only (server-side role check)
  IF NOT public.is_current_user_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  -- exactly one reservation
  SELECT * INTO v_row FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserva no encontrada' USING ERRCODE = 'P0001';
  END IF;

  -- B1 eligibility (positive allowlist for status, not merely a cancel blocklist)
  IF v_row.blocks_calendar IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'la reserva no bloquea el calendario' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status NOT IN ('confirmada','confirmed','paid','pagada','en_curso') THEN
    RAISE EXCEPTION 'estado no confirmado' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.check_in IS NULL OR v_row.check_out IS NULL
     OR v_row.check_out < v_row.check_in THEN
    RAISE EXCEPTION 'fechas de reserva inválidas' USING ERRCODE = 'P0001';
  END IF;

  -- conservative first-name validation (server-side backstop to the panel's
  -- \p{L} regex). 1..40 chars; only Unicode letters plus single spaces,
  -- hyphens and apostrophes; must start and end with a letter; no digits,
  -- symbols, angle brackets or URL schemes.
  v_name := btrim(p_first_name);
  IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'primer nombre inválido' USING ERRCODE = 'P0001';
  END IF;
  IF v_name ~ '[0-9<>]' OR v_name ~* 'https?://' THEN
    RAISE EXCEPTION 'primer nombre inválido' USING ERRCODE = 'P0001';
  END IF;
  IF left(v_name, 1) ~ '[^[:alpha:]]' OR right(v_name, 1) ~ '[^[:alpha:]]' THEN
    RAISE EXCEPTION 'primer nombre inválido' USING ERRCODE = 'P0001';
  END IF;
  -- remove the three allowed internal separators; the remainder must be
  -- entirely letters, and no separator may repeat back-to-back.
  v_stripped := translate(v_name, ' -' || chr(39) || chr(8217), '');
  IF v_stripped = '' OR v_stripped !~ '^[[:alpha:]]+$' THEN
    RAISE EXCEPTION 'primer nombre inválido' USING ERRCODE = 'P0001';
  END IF;
  -- no two separators back-to-back (hyphen first in the class = literal)
  IF v_name ~ ('[- ' || chr(39) || chr(8217) || ']{2}') THEN
    RAISE EXCEPTION 'primer nombre inválido' USING ERRCODE = 'P0001';
  END IF;

  -- reuse the existing token; generate one only when absent (keeps the
  -- guest's already-sent link stable across re-copies and first-name edits)
  v_token := v_row.welcome_token;

  -- No-op fast path: token already issued AND the approved name is unchanged
  -- -> touch nothing, just return. Re-copying a stable link writes no row.
  IF v_token IS NOT NULL AND v_row.welcome_first_name IS NOT DISTINCT FROM v_name THEN
    RETURN v_token;
  END IF;

  IF v_token IS NULL THEN
    -- First link for this reservation: set BOTH Welcome columns, nothing else.
    v_token := gen_random_uuid();
    UPDATE public.reservations
       SET welcome_token      = v_token,
           welcome_first_name = v_name
     WHERE id = p_reservation_id;
  ELSE
    -- Link already exists, only the approved Welcome name changed: update
    -- ONLY welcome_first_name. The token stays; nothing else is written.
    UPDATE public.reservations
       SET welcome_first_name = v_name
     WHERE id = p_reservation_id;
  END IF;

  -- NOTE: reservations.updated_at is deliberately NOT set here. Issuing or
  -- re-copying a Welcome link is not an operational edit of the reservation
  -- and must not make the row look modified. guest_name, check_in, check_out,
  -- status, blocks_calendar and all payment/financial fields are untouched.

  RETURN v_token;
END;
$function$;

-- Supabase sets a DB-level default privilege granting EXECUTE on every new
-- public function to anon/authenticated/service_role, so REVOKE FROM PUBLIC
-- alone is not enough — anon must be revoked explicitly.
REVOKE ALL     ON FUNCTION public.ensure_welcome_link(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.ensure_welcome_link(uuid, text) TO authenticated;

-- ── 4. PUBLIC RESOLVER RPC — the ONLY public reservation-derived read path ──
CREATE OR REPLACE FUNCTION public.resolve_welcome_stay(p_token text)
RETURNS TABLE(first_name text, checkin date, checkout date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_token        uuid;
  v_now_santiago timestamp;   -- wall-clock "now" in the property timezone
BEGIN
  -- malformed / random / non-uuid token -> zero rows (fail closed, no error)
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN;
  END;

  v_now_santiago := (now() AT TIME ZONE 'America/Santiago');

  RETURN QUERY
  SELECT
    r.welcome_first_name AS first_name,
    r.check_in           AS checkin,
    r.check_out          AS checkout
  FROM public.reservations r
  WHERE r.welcome_token       = v_token       -- exact token; column is UNIQUE
    AND r.welcome_first_name IS NOT NULL
    AND r.blocks_calendar     = true
    AND r.status IN ('confirmada','confirmed','paid','pagada','en_curso')  -- allowlist
    AND r.check_in  IS NOT NULL
    AND r.check_out IS NOT NULL
    AND r.check_out >= r.check_in
    -- checkout expiry: 11:00 America/Santiago on the check_out date
    AND v_now_santiago < (r.check_out::timestamp + interval '11 hours')
  LIMIT 1;
END;
$function$;

REVOKE ALL     ON FUNCTION public.resolve_welcome_stay(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_welcome_stay(text) TO anon, authenticated;

COMMIT;

-- ============================================================================
-- ROLLBACK  (run only to undo the above; NOT part of the forward migration)
-- ============================================================================
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.resolve_welcome_stay(text);
--   DROP FUNCTION IF EXISTS public.ensure_welcome_link(uuid, text);
--   DROP INDEX    IF EXISTS public.reservations_welcome_token_key;
--   ALTER TABLE public.reservations
--     DROP COLUMN IF EXISTS welcome_first_name,
--     DROP COLUMN IF EXISTS welcome_token;
-- COMMIT;
-- Data note: rollback permanently drops any issued welcome_token /
-- welcome_first_name values. guest_name and every other reservation field are
-- untouched by both the forward migration and this rollback.
-- ============================================================================
