ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_mode_check;
UPDATE projects SET mode='legacy_split' WHERE mode='split';
ALTER TABLE projects ADD CONSTRAINT projects_mode_check CHECK(mode IN ('creator','holders','king_of_hill','underwater','share','legacy_split'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS recipients jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS trade_lots (
 id bigserial PRIMARY KEY,
 project_id text NOT NULL REFERENCES projects(id),
 wallet text NOT NULL,
 side text NOT NULL CHECK(side IN ('buy','sell')),
 token_amount numeric(30,0) NOT NULL CHECK(token_amount>0),
 sol_amount numeric(30,0) NOT NULL CHECK(sol_amount>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_lots_project_wallet_idx ON trade_lots(project_id,wallet,id);
