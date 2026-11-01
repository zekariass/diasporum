# Flyway migrations

This directory holds versioned Flyway migrations (`V{n}__{description}.sql`).

**Status:** intentionally empty. The v10.11 schema
(`Diasporum_v10.11/Diasporum_PostgreSQL_Schema_v10_11.sql`) has not yet been
executed against a live PostgreSQL/PostGIS instance, and the initial baseline
strategy (e.g. `V1__baseline.sql` vs `flyway.baseline` on a provisioned database)
has not been agreed.

Do **not** add migration files here until:

1. The strict clean-install SQL and smoke tests have run successfully on a
   disposable PostgreSQL/PostGIS database.
2. The baseline migration strategy has been explicitly approved.
