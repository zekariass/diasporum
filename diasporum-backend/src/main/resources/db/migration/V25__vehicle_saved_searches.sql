CREATE TABLE vehicle_saved_searches (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name varchar(160) NOT NULL,
    filters jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_vehicle_saved_searches_user
    ON vehicle_saved_searches(user_id,created_at);
