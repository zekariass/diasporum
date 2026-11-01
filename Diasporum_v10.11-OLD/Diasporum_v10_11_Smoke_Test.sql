-- DIASPORUM v10.11 smoke-test assertions (run after strict clean install in an isolated database).
-- Catalog assertions are executable SQL. The scenarios after ROLLBACK are a test plan, not self-executing tests.
-- This file has not been run against a live PostgreSQL/PostGIS instance in this package.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis') THEN RAISE EXCEPTION 'PostGIS extension is missing'; END IF;
  IF to_regclass('public.user_follows') IS NULL OR to_regclass('public.user_mutual_connections') IS NULL THEN RAISE EXCEPTION 'Follow-only social model is incomplete'; END IF;
  IF to_regclass('public.friend_requests') IS NOT NULL OR to_regclass('public.friendships') IS NOT NULL THEN RAISE EXCEPTION 'Deprecated friend request/friendship tables must not exist in v10.11'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_user_follow_policy' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_cleanup_relationships_on_block' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Follow/block integrity triggers are missing'; END IF;
  IF pg_get_functiondef('create_match_after_mutual_like()'::regprocedure) ILIKE '%friendship%' THEN RAISE EXCEPTION 'Matchmaking must not create generic friendship records'; END IF;
  IF to_regclass('public.voice_rooms') IS NULL OR to_regclass('public.voice_room_sessions') IS NULL THEN RAISE EXCEPTION 'Persistent room/session split is missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='voice_rooms' AND column_name IN ('expires_at','ended_at','inactive_since')) THEN RAISE EXCEPTION 'Persistent voice_rooms must not hold live-session expiry/end fields'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='voice_rooms' AND column_name='owner_user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='voice_room_sessions' AND column_name='grace_expires_at') THEN RAISE EXCEPTION 'Persistent owner or session recovery metadata is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_purge_voice_room_comments_on_session_end' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_end_voice_session_when_room_archived_or_suspended' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Session comments/lifecycle triggers are missing'; END IF;
  IF pg_get_functiondef('purge_voice_room_comments_on_session_end()'::regprocedure) NOT ILIKE '%VOICE_ROOM_COMMENTS_CLEARED%' THEN RAISE EXCEPTION 'Voice comment clear event is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enforce_chat_message_restriction' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_audit_user_mute_action' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Chat moderation guard/audit is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_mutes' AND column_name='room_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_mutes' AND column_name='revoked_at') THEN RAISE EXCEPTION 'Scoped/revocable moderation fields are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='feed_polls' AND column_name='allow_vote_change')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='feed_polls' AND column_name='results_visibility')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='feed_polls' AND column_name='anonymous_voting') THEN RAISE EXCEPTION 'Poll policy fields are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_feed_poll_option_integrity' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_feed_poll_vote_integrity' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_published_poll_has_options' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_feed_poll_configuration_integrity' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Poll lifecycle validation triggers are missing'; END IF;
  IF to_regclass('public.featured_placement_rules') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_featured_item_placement_integrity' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Backend-controlled featured placement allow-list is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='spare_bag_listings' AND column_name='origin_airport_id')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='spare_bag_listings' AND column_name='listing_country_id') THEN RAISE EXCEPTION 'Spare Bag origin-country normalization is incorrect'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vehicle_listings' AND column_name='insurance_group')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.vehicle_listings'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%FOUR_WD%') THEN RAISE EXCEPTION 'Vehicle field contract is incorrect'; END IF;
  IF to_regclass('public.business_account_audit_events') IS NULL OR to_regclass('public.business_role_permissions') IS NULL
     OR to_regprocedure('business_account_has_permission(uuid,uuid,text)') IS NULL THEN RAISE EXCEPTION 'Business Account role permissions/audit are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_business_account_owner_member_check' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_revoke_business_members_on_close' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Business Account ownership/closure integrity is missing'; END IF;
  IF to_regclass('public.device_tokens') IS NULL OR to_regclass('public.notification_deliveries') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_enqueue_notification_push_work' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Push notification delivery workflow is incomplete'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='addresses' AND column_name='discovery_location')
     OR to_regclass('public.ix_addresses_discovery_location_gist') IS NULL OR to_regclass('public.ix_user_discovery_locations_gist') IS NULL THEN RAISE EXCEPTION 'PostGIS discovery points/indexes are missing'; END IF;
  IF to_regclass('public.service_providers') IS NULL OR to_regclass('public.service_requests') IS NULL OR to_regclass('public.service_lead_access') IS NULL THEN RAISE EXCEPTION 'Service marketplace foundation is missing'; END IF;
  IF EXISTS (SELECT 1 FROM billing_features WHERE feature_key='SERVICE_PROVIDER_REGISTER') THEN RAISE EXCEPTION 'Provider registration must not be a separate billable feature'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('service_provider_locations','service_provider_coverage_areas')) THEN RAISE EXCEPTION 'Do not add separate provider locations/coverage areas in current scope'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_direct_conversations_pair_context') THEN RAISE EXCEPTION 'Context-specific conversation uniqueness is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='current_address_id')
     OR to_regclass('public.ix_profiles_current_address') IS NULL
     OR to_regclass('public.ix_addresses_location_gist') IS NULL THEN RAISE EXCEPTION 'Current-address Nearby Reels support/indexes are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='feed_posts' AND column_name='published_at')
     OR to_regclass('public.ix_feed_posts_reel_community_published') IS NULL
     OR to_regclass('public.ix_feed_posts_reel_author_published') IS NULL THEN RAISE EXCEPTION 'Reels publication timestamp/feed indexes are missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.feed_posts'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%post_type%' AND pg_get_constraintdef(c.oid) ILIKE '%REEL%')
     THEN RAISE EXCEPTION 'feed_posts does not support REEL post_type'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_profile_current_address' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_address_current_profile_link' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_feed_post_publication_timestamp' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_published_reel_integrity' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_reel_media_attachment' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_prevent_published_reel_media_detach' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_reel_media_object_updates' AND NOT tgisinternal)
     THEN RAISE EXCEPTION 'Reels/current-address integrity triggers are missing'; END IF;
  IF to_regclass('public.reel_details') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_privacy_settings' AND column_name IN ('include_in_nearby','allow_my_reels_in_nearby','use_current_address_for_nearby_reels'))
     THEN RAISE EXCEPTION 'Unnecessary Reels detail table or Nearby toggle was introduced'; END IF;

  -- v10.11 Community Help & Offers catalog assertions.
  IF to_regclass('public.community_help_posts') IS NULL THEN RAISE EXCEPTION 'community_help_posts table is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='category_module' AND e.enumlabel='COMMUNITY_HELP') THEN RAISE EXCEPTION 'COMMUNITY_HELP category module is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.feed_posts'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%COMMUNITY_HELP%') THEN RAISE EXCEPTION 'feed_posts does not support COMMUNITY_HELP post_type'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.direct_conversations'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%COMMUNITY_HELP_POST%') THEN RAISE EXCEPTION 'COMMUNITY_HELP_POST direct conversation context is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_guard_community_help_parent_post' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_validate_community_help_post' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_prevent_published_community_help_metadata_delete' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Community Help integrity/lifecycle triggers are missing'; END IF;
  IF pg_get_functiondef('validate_feed_post_country_category()'::regprocedure) NOT ILIKE '%COMMUNITY_HELP%' THEN RAISE EXCEPTION 'Community Help country-category validation is missing'; END IF;
  IF pg_get_functiondef('normalize_and_validate_direct_conversation()'::regprocedure) NOT ILIKE '%COMMUNITY_HELP_POST%' THEN RAISE EXCEPTION 'Community Help contextual messaging validation is missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.community_help_posts'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%REQUEST%' AND pg_get_constraintdef(c.oid) ILIKE '%OFFER%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.community_help_posts'::regclass AND c.contype='c' AND pg_get_constraintdef(c.oid) ILIKE '%RESOLVED%' AND pg_get_constraintdef(c.oid) ILIKE '%EXPIRED%')
     THEN RAISE EXCEPTION 'Community Help kind/lifecycle constraints are missing'; END IF;
  IF to_regclass('public.ix_community_help_open_kind_expiry') IS NULL OR to_regclass('public.ix_community_help_status_expiry') IS NULL THEN RAISE EXCEPTION 'Community Help discovery indexes are missing'; END IF;
  IF to_regclass('public.community_help_responses') IS NOT NULL THEN RAISE EXCEPTION 'Do not create a duplicate Community Help responses table'; END IF;
END $$;
ROLLBACK;

-- Required API/integration scenarios (must be run by the application test suite):
-- 1. A follows B without a reverse edge; only when B follows A too does user_mutual_connections show the canonical pair.
-- 2. When either user blocks the other, both follow edges are removed, a matching pair is blocked/closed, and future follow/discovery/DM calls are denied.
-- 3. Matchmaking mutual LIKE creates one MATCHED row and a normal accepted GENERAL conversation, but never creates/removes user_follows; unmatch preserves chat history and independent follows.
-- 4. A room with no live session remains in All Rooms and keeps its room ID after a session ends/expires; the next live session has a new ID and empty comments.
-- 5. Session comments survive INACTIVE/recovery grace. Terminal ENDED/EXPIRED purges comments, removes queued not-yet-published comment-created events, and emits VOICE_ROOM_COMMENTS_CLEARED; late events must be ignored by session ID.
-- 6. Race concurrent session joins/promotions and host transfer. Confirm total participants/speakers never exceed limits, a participant cannot have duplicate active rows, and only one active HOST exists.
-- 7. A community moderator can issue scoped chat mute/ban; unrelated community moderators cannot, global restrictions require platform authorization, expired/revoked restrictions cease enforcement, and `notifications_muted_until` does not ban sending.
-- 8. A muted/banned user cannot insert new chat messages through any normal write path; read/join/history access follows the distinct MUTE-versus-BAN policy in the API.
-- 9. Build a poll as DRAFT -> poll metadata -> at least two options -> PUBLISHED. Published poll without two options fails. Option set is fixed after the first vote; single choice, vote-change/withdraw, explicit close and elapsed-deadline rules behave correctly under concurrent ballots.
-- 10. `anonymous_voting=true` hides voter IDs from creator/viewer result DTOs while the platform still retains user-linked ballot integrity. AFTER_VOTING and AFTER_CLOSE visibility are enforced by API policy.
-- 11. Unsupported content/placement pairs are rejected; client-provided placement is not trusted. Every eligible promotion is checked against entitlement/payment, publication, audience and moderation at creation and display.
-- 12. Business Account creation assigns its creator as first accepted OWNER. Test invite/accept/expiry/revocation, each role permission, concurrent owner transfer, no ownerless active account, closure auto-revocation/audit and explicit authorized recovery.
-- 13. Revoke a business member and verify conversation participants, list/detail/update APIs, attachments and realtime channels all deny that member without deleting history.
-- 14. Expo push delivery creates idempotent per-notification/device attempts, honors preferences, retries transient errors, reconciles receipts and deactivates invalid tokens; duplicate outbox processing does not duplicate notification delivery rows.
-- 15. Derive Spare Bag market country through origin_airport_id -> airports.country_id. Validate selected community destination country and audience behavior for country-wide/null community listings.
-- 16. Address/airport coordinates synchronize to exact geography; public discovery uses approved approximate `discovery_location`. Verify ST_DWithin radius matching and ST_Distance sorting with EXPLAIN (ANALYZE, BUFFERS) on realistic data.
-- 17. Preserve the service marketplace scope: personal/business provider, one base location plus radius_km, no booking, escrow, in-app service payments, extra provider-location tables or provider-registration fee.
-- 18. Verify direct message quotas are scoped to sender-recipient pair and simultaneous team/location caps are not resettable usage quotas. SAVE_CONTENT remains deferred.

-- 19. Create a Reel as DRAFT with no media; attach exactly one creator-owned FEED_VIDEO; publication must fail until media is READY; then publication succeeds and sets published_at.
-- 20. A REEL may have an empty caption, but must have exactly one READY FEED_VIDEO owned by the same author. Reject image attachment, second media item, foreign-owned media and media replacement/removal while published.
-- 21. A profile current_address_id must reference an owned, coordinate-bearing address in the profile's current_country_id. Reject another user's address, missing coordinates, country mismatch and changing/de-owning an address still referenced as current.
-- 22. Nearby orders eligible published Reels by ST_Distance(viewer current address location, creator current address location), then published_at and ID. It must not use a Reel/filming location or return address fields, coordinates or numeric distance in response DTOs.
-- 23. Community shows eligible current-community/country-audience Reels by published_at; Following shows eligible Reels by user_follows; both enforce blocks, moderation, active account, visibility and cursor pagination.
-- 24. Confirm there is no reel_details table, include_in_nearby field, or extra Nearby opt-in setting. Existing address privacy is enforced at the API boundary; exact points are used internally for ranking only.


-- v10.11 Community Help & Offers API integration scenarios (must be implemented by the app test suite):
-- 25. Create a COMMUNITY_HELP feed_posts row as DRAFT, insert community_help_posts, then publish in a valid transaction; publication without lifecycle metadata fails.
-- 26. Reject community_help_posts rows whose parent post_type is not COMMUNITY_HELP; reject changing help_kind/post_id or deleting metadata from a published parent.
-- 27. A REQUEST and an OFFER both use the same category/feed infrastructure but require a country category mapped to category_module COMMUNITY_HELP.
-- 28. Verify OPEN -> PAUSED -> OPEN and OPEN/PAUSED -> RESOLVED/CLOSED/EXPIRED transitions; terminal states cannot reopen; state timestamps are database-managed.
-- 29. Quartz expiry marks due OPEN/PAUSED help rows EXPIRED; rows with no expiry do not expire automatically. OPEN discovery excludes PAUSED/terminal/expired-by-time items.
-- 30. Community Help responses reuse a direct conversation with context_type COMMUNITY_HELP_POST and context_id=feed_posts.id; unique pair/context reuses a thread, only the post author is required as owner participant, and only published OPEN help posts permit new context threads.
-- 31. A resolved/closed/expired post stops accepting new contextual conversations, but existing conversation history remains accessible subject to blocks, messaging privacy and standard authorization.
-- 32. Test category module validation, community/country visibility, block/moderation filtering, notifications, author-only status transitions and expired-post handling through the REST API.
