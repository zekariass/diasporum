-- Launch default: FREE personal-plan members may publish up to 10 Spare Bag
-- listings per calendar month. Users without a billing subscription resolve
-- against the FREE plan via the consumePersonalQuota fallback, so no
-- subscription rows need to be seeded. Adjust per-plan limits in
-- billing_plan_entitlements as allowance policy evolves.
UPDATE billing_plan_entitlements e
SET enabled = true,
    quantity_limit = 10,
    reset_period = 'MONTH',
    config = e.config - 'requires_admin_configuration'
        || jsonb_build_object('note','FREE plan launch default: 10 Spare Bag publications per calendar month.')
FROM billing_plans p, billing_features f
WHERE e.plan_id = p.id
  AND e.feature_id = f.id
  AND p.plan_key = 'FREE'
  AND p.account_type = 'PERSONAL'
  AND f.feature_key = 'SPARE_BAG_LISTING_PUBLISH';
