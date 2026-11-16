-- =====================================================================
-- 14. UPDATE featured_placement_rules FOR NEW CONTENT TYPES
-- =====================================================================
-- NOTE: This INSERT uses the 'SERVICE' enum value added at the top of this
-- file. PostgreSQL does not allow using a newly added enum value within the
-- same transaction. This insert MUST run in a separate migration/commit:
--
-- If this file is executed as a single Flyway migration (transactional),
-- remove the BEGIN/COMMIT wrapper and run this insert separately.
--
-- FLYWAY: this is that separate migration. 'SERVICE' is added to
-- content_reference_type by V31__v10_15_schema_changes.sql ("the top of this
-- file" above, in the original delta), which Flyway commits in its own
-- transaction before this migration starts. The INSERT below was commented out
-- in the original delta and is now live SQL. Do not enable spring.flyway.group
-- (one transaction for all pending migrations) or this insert will fail.

INSERT INTO featured_placement_rules(content_type, placement_key) VALUES
 ('SERVICE','MAIN_FEED'),('SERVICE','SERVICE_MARKETPLACE')
ON CONFLICT(content_type, placement_key) DO NOTHING;
