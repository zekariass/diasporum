-- Secondary-community viewing stays free until an admin configures a plan
-- entitlement or credit grant for VIEW_SAME_ORIGIN_COMMUNITY_CONTENT,
-- mirroring V24's EXTENDED_* unconfigured-free launch default.
INSERT INTO feature_access_rules(feature_key,access_type,is_enabled,config)
SELECT feature_key,'FREE',true,'{"unconfiguredFree":true}'::jsonb
FROM billing_features
WHERE feature_key='VIEW_SAME_ORIGIN_COMMUNITY_CONTENT';
