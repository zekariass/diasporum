Diasporum is a community-based social platform monorepo.

See `AGENTS.md` at the repository root for project-wide instructions.
See `diasporum-backend/AGENTS.md`, `diasporum-mobile/AGENTS.md`, and
`diasporum-web/AGENTS.md` for app-specific instructions.

Key rules: no JPA entities (use JdbcTemplate), no cross-module internal.* imports,
no committed secrets, Flyway owns the schema.
