ALTER TABLE claims ADD COLUMN signed_attempt jsonb;
CREATE TABLE IF NOT EXISTS chain_collections (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), kind text NOT NULL,
 status text NOT NULL DEFAULT 'prepared', signature text UNIQUE NOT NULL,
 transaction_base64 text NOT NULL, blockhash text NOT NULL, last_valid_block_height bigint NOT NULL,
 binding jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collection_active_project ON chain_collections(project_id) WHERE status IN ('prepared','submitted','review');
ALTER TABLE epochs ADD COLUMN snapshot_slot bigint;
