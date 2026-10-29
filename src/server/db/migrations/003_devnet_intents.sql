CREATE TABLE IF NOT EXISTS launch_intents (
 id text PRIMARY KEY, wallet text NOT NULL, intent jsonb NOT NULL, metadata jsonb NOT NULL,
 status text NOT NULL DEFAULT 'authorized', prepared jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chain_projects (
 project_id text PRIMARY KEY REFERENCES projects(id), intent_id text UNIQUE NOT NULL REFERENCES launch_intents(id),
 pool text NOT NULL, config text NOT NULL, collector text NOT NULL, damm_pool text,
 creator_position jsonb, partner_position jsonb
);
CREATE TABLE IF NOT EXISTS chain_requests (
 id text PRIMARY KEY, wallet text NOT NULL, project_id text NOT NULL REFERENCES projects(id),
 kind text NOT NULL, prepared jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
