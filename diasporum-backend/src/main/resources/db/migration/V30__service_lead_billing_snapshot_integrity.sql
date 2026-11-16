-- Upgrade databases that applied the initial V29 before lead price snapshots
-- and provider actor validation were added to its lead-access trigger.

CREATE OR REPLACE FUNCTION validate_service_lead_access()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_customer uuid; v_provider_status text; v_onboarding_status text; v_owner_user uuid;
BEGIN
    SELECT status,customer_user_id INTO v_status,v_customer FROM service_requests WHERE id=NEW.service_request_id;
    SELECT status,onboarding_status,owner_user_id INTO v_provider_status,v_onboarding_status,v_owner_user FROM service_providers WHERE id=NEW.service_provider_id;
    IF v_status IS NULL OR v_provider_status IS NULL THEN RAISE EXCEPTION 'Service request and provider must exist' USING ERRCODE='23503'; END IF;
    IF TG_OP='UPDATE' AND (NEW.billing_usage_record_id IS DISTINCT FROM OLD.billing_usage_record_id
       OR NEW.lead_price IS DISTINCT FROM OLD.lead_price OR NEW.lead_currency IS DISTINCT FROM OLD.lead_currency) THEN
       RAISE EXCEPTION 'Lead billing record and price snapshot are immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND (v_status NOT IN ('OPEN','PAUSED') OR v_provider_status<>'ACTIVE' OR v_onboarding_status<>'APPROVED') THEN
       RAISE EXCEPTION 'Granting lead access requires an approved active provider and an open or paused request' USING ERRCODE='23514';
    END IF;
    IF v_owner_user=v_customer OR EXISTS (SELECT 1 FROM service_providers p JOIN business_account_members m ON m.business_account_id=p.business_account_id WHERE p.id=NEW.service_provider_id AND m.user_id=v_customer AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL) THEN
       RAISE EXCEPTION 'A customer or member of their business cannot access their own lead' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NEW.granted_by_user_id IS NOT NULL AND ((v_owner_user IS NOT NULL AND NEW.granted_by_user_id<>v_owner_user) OR
       (EXISTS (SELECT 1 FROM service_providers p WHERE p.id=NEW.service_provider_id AND p.business_account_id IS NOT NULL) AND
        NOT EXISTS (SELECT 1 FROM service_providers p JOIN business_account_members m ON m.business_account_id=p.business_account_id WHERE p.id=NEW.service_provider_id AND m.user_id=NEW.granted_by_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL))) THEN
       RAISE EXCEPTION 'Lead access actor must be the provider owner or an active business member' USING ERRCODE='23514';
    END IF;
    IF NEW.status='ACTIVE' AND NOT (NEW.chat_enabled OR NEW.contact_details_unlocked) THEN
       RAISE EXCEPTION 'Active lead access must grant chat or contact details' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_service_lead_access ON service_lead_access;
CREATE TRIGGER trg_validate_service_lead_access BEFORE INSERT OR UPDATE OF service_request_id,service_provider_id,chat_enabled,contact_details_unlocked,status,billing_usage_record_id,lead_price,lead_currency,granted_by_user_id
ON service_lead_access FOR EACH ROW EXECUTE FUNCTION validate_service_lead_access();
