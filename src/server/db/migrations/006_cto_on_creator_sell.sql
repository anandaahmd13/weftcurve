ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_mode_check;
ALTER TABLE projects ADD CONSTRAINT projects_mode_check CHECK(mode IN ('creator','holders','king_of_hill','underwater','share','cto_on_creator_sell','legacy_split'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cto_active boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS cto_triggered_at timestamptz;
ALTER TABLE activity DROP CONSTRAINT IF EXISTS activity_type_check;
