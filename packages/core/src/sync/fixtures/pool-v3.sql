-- Version-3 migration DDL from 711f5ab, retained to verify the coordinated upgrade.
CREATE SCHEMA IF NOT EXISTS chaching_sync;

		DROP TABLE IF EXISTS chaching_sync.usage_record CASCADE;
		DROP TABLE IF EXISTS chaching_sync.imported_day_model CASCADE;
		DROP TABLE IF EXISTS chaching_sync.imported_session CASCADE;
	;

		CREATE TABLE IF NOT EXISTS chaching_sync.pool (
			id text PRIMARY KEY,
			name text NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now()
		);
		CREATE TABLE IF NOT EXISTS chaching_sync.machine (
			pool_id text NOT NULL REFERENCES chaching_sync.pool(id) ON DELETE CASCADE,
			id text NOT NULL,
			name text NOT NULL,
			hostname text NOT NULL,
			last_seen_at timestamptz NOT NULL DEFAULT now(),
			last_published_at timestamptz,
			PRIMARY KEY (pool_id, id)
		);
		CREATE TABLE IF NOT EXISTS chaching_sync.subscription (
			pool_id text NOT NULL REFERENCES chaching_sync.pool(id) ON DELETE CASCADE,
			id text NOT NULL,
			provider text NOT NULL,
			name text NOT NULL,
			account text NOT NULL DEFAULT '',
			tier text NOT NULL,
			monthly_usd double precision NOT NULL CHECK (monthly_usd >= 0),
			PRIMARY KEY (pool_id, id)
		);
		CREATE TABLE IF NOT EXISTS chaching_sync.machine_subscription (
			pool_id text NOT NULL,
			machine_id text NOT NULL,
			provider text NOT NULL,
			subscription_id text,
			PRIMARY KEY (pool_id, machine_id, provider),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES chaching_sync.machine(pool_id, id) ON DELETE CASCADE,
			FOREIGN KEY (pool_id, subscription_id)
				REFERENCES chaching_sync.subscription(pool_id, id) ON DELETE SET NULL (subscription_id)
		);
		CREATE TABLE IF NOT EXISTS chaching_sync.machine_day_agg (
			pool_id text NOT NULL REFERENCES chaching_sync.pool(id) ON DELETE CASCADE,
			source_scope text NOT NULL,
			machine_id text,
			day text NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			input_tokens bigint NOT NULL,
			output_tokens bigint NOT NULL,
			cache_creation_tokens bigint NOT NULL,
			cache_read_tokens bigint NOT NULL,
			cache_creation_1h bigint NOT NULL,
			cache_creation_5m bigint NOT NULL,
			web_search_requests integer NOT NULL,
			web_fetch_requests integer NOT NULL,
			requests integer NOT NULL,
			cost double precision NOT NULL,
			cost_unknown_requests integer NOT NULL,
			partial boolean NOT NULL DEFAULT false,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, source_scope, day, provider, model),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES chaching_sync.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS machine_day_agg_pool_updated
			ON chaching_sync.machine_day_agg(pool_id, updated_at);
		CREATE TABLE IF NOT EXISTS chaching_sync.machine_hour_agg (
			pool_id text NOT NULL REFERENCES chaching_sync.pool(id) ON DELETE CASCADE,
			source_scope text NOT NULL,
			machine_id text,
			hour_ts bigint NOT NULL,
			provider text NOT NULL,
			model text NOT NULL,
			input_tokens bigint NOT NULL,
			output_tokens bigint NOT NULL,
			cache_creation_tokens bigint NOT NULL,
			cache_read_tokens bigint NOT NULL,
			requests integer NOT NULL,
			cost double precision NOT NULL,
			cost_unknown_requests integer NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, source_scope, hour_ts, provider, model),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES chaching_sync.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS machine_hour_agg_pool_updated
			ON chaching_sync.machine_hour_agg(pool_id, updated_at);
		CREATE INDEX IF NOT EXISTS machine_hour_agg_pool_hour
			ON chaching_sync.machine_hour_agg(pool_id, hour_ts);
		CREATE TABLE IF NOT EXISTS chaching_sync.machine_session_agg (
			pool_id text NOT NULL REFERENCES chaching_sync.pool(id) ON DELETE CASCADE,
			source_scope text NOT NULL,
			machine_id text,
			provider text NOT NULL,
			session_id text NOT NULL,
			payload jsonb NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, source_scope, provider, session_id),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES chaching_sync.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE INDEX IF NOT EXISTS machine_session_agg_pool_updated
			ON chaching_sync.machine_session_agg(pool_id, updated_at);
		CREATE TABLE IF NOT EXISTS chaching_sync.machine_provider_status (
			pool_id text NOT NULL,
			machine_id text NOT NULL,
			source text NOT NULL,
			observed_at timestamptz NOT NULL,
			payload jsonb NOT NULL,
			updated_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (pool_id, machine_id, source),
			FOREIGN KEY (pool_id, machine_id)
				REFERENCES chaching_sync.machine(pool_id, id) ON DELETE CASCADE
		);
		CREATE TABLE IF NOT EXISTS chaching_sync.schema_version (
			id integer PRIMARY KEY,
			version integer NOT NULL
		);
	;
INSERT INTO chaching_sync.schema_version (id, version) VALUES (1, 3) ON CONFLICT (id) DO UPDATE SET version=3;
