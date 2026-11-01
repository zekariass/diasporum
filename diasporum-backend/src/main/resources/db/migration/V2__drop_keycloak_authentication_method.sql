-- V2: drop the obsolete 'KEYCLOAK' value from the session authentication_method
-- check. Keycloak was removed from runtime authentication in Phase 1; the value
-- was kept in the V1 baseline for migration reference only and is never set.
-- Follow-up migration (baseline not rewritten) so it applies cleanly to both
-- the baselined development database and fresh installs.

ALTER TABLE user_sessions
    DROP CONSTRAINT user_sessions_authentication_method_check;

ALTER TABLE user_sessions
    ADD CONSTRAINT user_sessions_authentication_method_check
    CHECK (authentication_method IN ('PASSWORD','GOOGLE','APPLE'));
