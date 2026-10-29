CREATE OR REPLACE FUNCTION protect_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('weftcurve.allow_simulator_reset', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Journal is append-only';
END $$;
