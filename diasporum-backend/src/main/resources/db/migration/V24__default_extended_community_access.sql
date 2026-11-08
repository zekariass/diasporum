-- Source community is audit metadata only. Profiles, matches and conversations
-- remain canonical at the user/user-pair level.
ALTER TABLE matchmaking_swipes
    ADD COLUMN community_id uuid REFERENCES communities(id) ON DELETE SET NULL;
ALTER TABLE matchmaking_swipe_history
    ADD COLUMN community_id uuid REFERENCES communities(id) ON DELETE SET NULL;

CREATE INDEX ix_matchmaking_swipes_community
    ON matchmaking_swipes(community_id,swiper_user_id,created_at DESC)
    WHERE community_id IS NOT NULL;
CREATE INDEX ix_matchmaking_swipe_history_community
    ON matchmaking_swipe_history(community_id,swiper_user_id,created_at DESC)
    WHERE community_id IS NOT NULL;

-- Reversals preserve the append-only financial audit trail. Reversed usage no
-- longer counts against quota; grants are restored by the Billing service.
ALTER TABLE billing_usage_records
    ADD COLUMN reversed_at timestamptz,
    ADD COLUMN reversal_reason text,
    ADD COLUMN reversed_by uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN grant_id uuid REFERENCES billing_entitlement_grants(id) ON DELETE SET NULL;

CREATE INDEX ix_billing_usage_community_quota
    ON billing_usage_records(user_id,feature_id,target_id,occurred_at DESC)
    WHERE target_type='COMMUNITY' AND target_id IS NOT NULL AND reversed_at IS NULL;
CREATE INDEX ix_billing_usage_reversal ON billing_usage_records(reversed_at)
    WHERE reversed_at IS NOT NULL;

INSERT INTO billing_features(feature_key,display_name,description,feature_kind,
        reset_period,quota_scope) VALUES
 ('EXTENDED_FEED_POST_PUBLISH','Extended feed publication',
  'Successful GENERAL feed publication in an Extended Community. Quantity and reset period are configured per plan entitlement.',
  'QUOTA','MONTH','PER_TARGET'),
 ('EXTENDED_REEL_PUBLISH','Extended reel publication',
  'Successful REEL publication in an Extended Community after media validation.',
  'QUOTA','MONTH','PER_TARGET'),
 ('EXTENDED_MATCHMAKING_LIKE','Extended dating LIKE',
  'Successful outgoing LIKE in an Extended Community. PASS, received LIKEs and match creation are not charged by this feature.',
  'QUOTA','MONTH','PER_TARGET'),
 ('EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH','Extended help request publication',
  'Successful Community Help REQUEST publication in an Extended Community.',
  'QUOTA','MONTH','PER_TARGET')
ON CONFLICT(feature_key) DO NOTHING;

-- Explicit launch default: when neither a plan entitlement nor a credit grant
-- is configured, these actions are free. Administrators replace this policy by
-- configuring plan entitlements/grants; no price is inferred by application code.
INSERT INTO feature_access_rules(feature_key,access_type,is_enabled,config)
SELECT feature_key,'FREE',true,'{"unconfiguredFree":true}'::jsonb
FROM billing_features
WHERE feature_key IN (
 'EXTENDED_FEED_POST_PUBLISH','EXTENDED_REEL_PUBLISH',
 'EXTENDED_MATCHMAKING_LIKE','EXTENDED_COMMUNITY_HELP_REQUEST_PUBLISH')
ON CONFLICT DO NOTHING;

COMMENT ON COLUMN matchmaking_swipes.community_id IS
 'Community in which the current swipe originated; does not partition the canonical user pair.';
COMMENT ON COLUMN matchmaking_swipe_history.community_id IS
 'Historical source community for billing and audit; retained independently of active community switches.';
COMMENT ON COLUMN billing_usage_records.reversed_at IS
 'When set, this usage is excluded from quota accounting and its associated grant consumption has been restored.';
