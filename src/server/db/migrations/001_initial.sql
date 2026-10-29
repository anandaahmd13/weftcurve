CREATE TABLE IF NOT EXISTS wallets (
 address text PRIMARY KEY, label text NOT NULL,
 balance numeric(30,0) NOT NULL DEFAULT 10000000000 CHECK(balance>=0)
);
CREATE TABLE IF NOT EXISTS projects (
 id text PRIMARY KEY, mint text UNIQUE NOT NULL, network text NOT NULL CHECK(network IN ('simulator','devnet')),
 name text NOT NULL, symbol text NOT NULL, description text NOT NULL, image text,
 mode text NOT NULL CHECK(mode IN ('creator','holders','split')), holder_share_bps integer NOT NULL CHECK(holder_share_bps BETWEEN 0 AND 10000),
 creator text NOT NULL, policy_hash text NOT NULL, status text NOT NULL DEFAULT 'bonding' CHECK(status IN ('bonding','migration_pending','graduated')),
 supply numeric(30,0) NOT NULL DEFAULT 1000000000000000,
 token_reserve numeric(30,0) NOT NULL DEFAULT 1000000000000000 CHECK(token_reserve>=0),
 reserve numeric(30,0) NOT NULL DEFAULT 0 CHECK(reserve>=0),
 volume numeric(30,0) NOT NULL DEFAULT 0, creator_fees numeric(30,0) NOT NULL DEFAULT 0,
 undistributed numeric(30,0) NOT NULL DEFAULT 0 CHECK(undistributed>=0),
 custody numeric(30,0) NOT NULL DEFAULT 0 CHECK(custody>=0),
 distributed numeric(30,0) NOT NULL DEFAULT 0,
 last_epoch timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holdings (
 project_id text NOT NULL REFERENCES projects(id), wallet text NOT NULL,
 amount numeric(30,0) NOT NULL CHECK(amount>=0), PRIMARY KEY(project_id,wallet)
);
CREATE TABLE IF NOT EXISTS rewards (
 project_id text NOT NULL REFERENCES projects(id), wallet text NOT NULL,
 available numeric(30,0) NOT NULL DEFAULT 0 CHECK(available>=0),
 reserved numeric(30,0) NOT NULL DEFAULT 0 CHECK(reserved>=0),
 paid numeric(30,0) NOT NULL DEFAULT 0 CHECK(paid>=0), PRIMARY KEY(project_id,wallet)
);
CREATE TABLE IF NOT EXISTS receipts (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), source text NOT NULL,
 amount numeric(30,0) NOT NULL CHECK(amount>0), epoch_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS epochs (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), policy_hash text NOT NULL,
 snapshot jsonb NOT NULL, amount numeric(30,0) NOT NULL, distributed numeric(30,0) NOT NULL, dust numeric(30,0) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journal (
 id bigserial PRIMARY KEY, event_id text UNIQUE NOT NULL, project_id text NOT NULL REFERENCES projects(id),
 entries jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Journal is append-only'; END $$;
CREATE TRIGGER journal_append_only BEFORE UPDATE OR DELETE ON journal FOR EACH ROW EXECUTE FUNCTION protect_journal();
CREATE TABLE IF NOT EXISTS claims (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), wallet text NOT NULL,
 amount numeric(30,0) NOT NULL CHECK(amount>0), status text NOT NULL CHECK(status IN ('reserved','submitted','finalized','review')),
 signature text UNIQUE, raw_transaction text, blockhash text, last_valid_block_height bigint,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, claim_id text UNIQUE NOT NULL REFERENCES claims(id), status text NOT NULL DEFAULT 'ready',
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations (
 wallet text NOT NULL, key text NOT NULL, kind text NOT NULL, payload_hash text NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(wallet,key)
);
CREATE TABLE IF NOT EXISTS activity (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), wallet text NOT NULL,
 type text NOT NULL, amount numeric(30,0) NOT NULL DEFAULT 0, signature text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 id_hash text PRIMARY KEY, wallet text NOT NULL, csrf text NOT NULL,
 network text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
 nonce text PRIMARY KEY, wallet text NOT NULL, message text NOT NULL, expires_at timestamptz NOT NULL, consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text NOT NULL, window_id bigint NOT NULL, hits integer NOT NULL, PRIMARY KEY(key,window_id)
);
CREATE TABLE IF NOT EXISTS worker_health (id integer PRIMARY KEY, last_run timestamptz NOT NULL);
CREATE INDEX rewards_wallet_idx ON rewards(wallet);
CREATE INDEX activity_project_idx ON activity(project_id,created_at DESC);
CREATE INDEX jobs_pending_idx ON jobs(status,created_at);
