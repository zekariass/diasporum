# Flyway migrations

Versioned Flyway migrations (`V{n}__{description}.sql`). Flyway owns the schema —
there is no `ddl-auto` entity management and no JPA entities in the codebase.

**Status:** populated and active. V1 is the v10.12 baseline; subsequent versions
carry incremental feature/schema work (currently through V39).

## Rules

1. **Never modify an applied migration.** Always create a new `V{n}` file — the
   next number is the highest existing version + 1.
2. **One concern per migration** where practical — schema vs. seed data vs.
   enum-dependent seeds may be split (e.g. V31/V32/V33): a newly added enum
   value cannot be used inside the same migration's transaction.
3. **Do not enable `spring.flyway.group`** — grouping pending migrations into one
   transaction breaks the enum split above.
4. `flyway.out-of-order: true` is enabled for local dev — feature branches may
   merge migrations out of order; never reuse a version number.
5. Keep statements idempotent where the original schema delta uses them
   (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), and preserve design comments.
6. Verify against a disposable `postgis/postgis:17-3.5` container before
   declaring a migration done — module integration tests replay seeds against
   fully-migrated databases, so rename nothing that seed scripts reference
   by name (e.g. `media_objects_purpose_check`).

`db/migration-archive/` holds superseded drafts — do not add files there.
