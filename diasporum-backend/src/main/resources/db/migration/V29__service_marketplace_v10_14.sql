-- Service Marketplace v10.14: provider approval, structured quotes, engagements,
-- immutable repost rounds and free/paid lead price snapshots.

ALTER TABLE service_providers
    ADD COLUMN onboarding_status text NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN onboarding_submitted_at timestamptz,
    ADD COLUMN onboarding_reviewed_at timestamptz,
    ADD COLUMN onboarding_reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN onboarding_rejection_reason text;
-- Existing operational providers are grandfathered; newly created providers default to DRAFT.
UPDATE service_providers SET onboarding_status='APPROVED',onboarding_reviewed_at=now();
ALTER TABLE service_providers
    ADD CONSTRAINT ck_service_providers_onboarding_status
        CHECK(onboarding_status IN ('DRAFT','IN_PROGRESS','SUBMITTED','APPROVED','REJECTED')),
    ADD CONSTRAINT ck_service_providers_onboarding_review
        CHECK((onboarding_status <> 'SUBMITTED' OR onboarding_submitted_at IS NOT NULL)
          AND (onboarding_status <> 'APPROVED' OR onboarding_reviewed_at IS NOT NULL)
          AND (onboarding_status <> 'REJECTED' OR (onboarding_reviewed_at IS NOT NULL
            AND onboarding_rejection_reason IS NOT NULL
            AND length(trim(onboarding_rejection_reason)) > 0)));
CREATE INDEX ix_service_providers_onboarding
    ON service_providers(onboarding_status,status,created_at DESC);

ALTER TABLE service_requests ADD COLUMN reposted_from_request_id uuid
    REFERENCES service_requests(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ux_service_request_repost_source
    ON service_requests(reposted_from_request_id) WHERE reposted_from_request_id IS NOT NULL;
CREATE INDEX ix_service_request_repost_history
    ON service_requests(customer_user_id,reposted_from_request_id,created_at DESC)
    WHERE reposted_from_request_id IS NOT NULL;

ALTER TABLE service_lead_access ALTER COLUMN billing_usage_record_id DROP NOT NULL;
ALTER TABLE service_lead_access
    ADD COLUMN lead_price numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN lead_currency char(3) NOT NULL DEFAULT 'USD';
UPDATE service_lead_access SET lead_price=1 WHERE billing_usage_record_id IS NOT NULL;
ALTER TABLE service_lead_access
    ADD CONSTRAINT ck_service_lead_access_price
        CHECK(lead_price>=0 AND lead_currency ~ '^[A-Z]{3}$'
          AND ((lead_price=0 AND billing_usage_record_id IS NULL)
            OR (lead_price>0 AND billing_usage_record_id IS NOT NULL)));

CREATE TABLE service_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE RESTRICT,
    response_id uuid REFERENCES service_request_responses(id) ON DELETE SET NULL,
    revision_no integer NOT NULL CHECK(revision_no>0),
    supersedes_quote_id uuid REFERENCES service_quotes(id) ON DELETE RESTRICT,
    submitted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 180),
    scope_of_work text NOT NULL CHECK(length(trim(scope_of_work)) BETWEEN 1 AND 8000),
    amount numeric(14,2) NOT NULL CHECK(amount>=0),
    currency_code char(3) NOT NULL CHECK(currency_code ~ '^[A-Z]{3}$'),
    estimated_duration_value integer CHECK(estimated_duration_value IS NULL OR estimated_duration_value>0),
    estimated_duration_unit text CHECK(estimated_duration_unit IS NULL
        OR estimated_duration_unit IN ('HOUR','DAY','WEEK','MONTH')),
    valid_until timestamptz,
    inclusions text,
    exclusions text,
    terms_and_conditions text,
    status text NOT NULL DEFAULT 'SENT'
        CHECK(status IN ('SENT','ACCEPTED','DECLINED','WITHDRAWN','EXPIRED','SUPERSEDED')),
    sent_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(service_request_id,service_provider_id,revision_no),
    CHECK((estimated_duration_value IS NULL)=(estimated_duration_unit IS NULL)),
    CHECK(valid_until IS NULL OR valid_until>sent_at),
    CHECK(supersedes_quote_id IS NULL OR supersedes_quote_id<>id)
);
CREATE INDEX ix_service_quotes_request_status ON service_quotes(service_request_id,status,sent_at DESC);
CREATE INDEX ix_service_quotes_provider_status ON service_quotes(service_provider_id,status,sent_at DESC);
CREATE UNIQUE INDEX ux_service_quotes_one_accepted_per_request
    ON service_quotes(service_request_id) WHERE status='ACCEPTED';
CREATE UNIQUE INDEX ux_service_quotes_revision_chain
    ON service_quotes(supersedes_quote_id) WHERE supersedes_quote_id IS NOT NULL;

CREATE TABLE service_quote_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id uuid NOT NULL REFERENCES service_quotes(id) ON DELETE RESTRICT,
    line_no integer NOT NULL CHECK(line_no>0),
    description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
    quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK(quantity>0),
    unit_label text CHECK(unit_label IS NULL OR length(trim(unit_label)) BETWEEN 1 AND 40),
    unit_amount numeric(14,2) NOT NULL CHECK(unit_amount>=0),
    line_amount numeric(14,2) NOT NULL CHECK(line_amount>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(quote_id,line_no)
);
CREATE INDEX ix_service_quote_items_quote ON service_quote_items(quote_id,line_no);

CREATE TABLE service_engagements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE RESTRICT,
    accepted_quote_id uuid NOT NULL UNIQUE REFERENCES service_quotes(id) ON DELETE RESTRICT,
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE RESTRICT,
    customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'ACCEPTED'
        CHECK(status IN ('ACCEPTED','IN_PROGRESS','COMPLETION_SUBMITTED','COMPLETED','CANCELLED','ISSUE_RAISED')),
    accepted_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completion_submitted_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    issue_raised_at timestamptz,
    issue_reason text,
    customer_completion_note text,
    provider_completion_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(service_request_id),
    CHECK(completed_at IS NULL OR completion_submitted_at IS NOT NULL),
    CHECK(cancelled_at IS NULL OR status='CANCELLED'),
    CHECK(issue_raised_at IS NULL OR status='ISSUE_RAISED'),
    CHECK(status<>'ISSUE_RAISED' OR (issue_raised_at IS NOT NULL AND issue_reason IS NOT NULL))
);
CREATE INDEX ix_service_engagements_provider ON service_engagements(service_provider_id,status,accepted_at DESC);
CREATE INDEX ix_service_engagements_customer ON service_engagements(customer_user_id,status,accepted_at DESC);

CREATE TABLE service_engagement_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id uuid NOT NULL REFERENCES service_engagements(id) ON DELETE RESTRICT,
    from_status text,
    to_status text NOT NULL CHECK(to_status IN ('ACCEPTED','IN_PROGRESS','COMPLETION_SUBMITTED','COMPLETED','CANCELLED','ISSUE_RAISED')),
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_service_engagement_history ON service_engagement_status_history(engagement_id,created_at);

CREATE TABLE service_engagement_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id uuid NOT NULL REFERENCES service_engagements(id) ON DELETE RESTRICT,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    media_purpose text NOT NULL CHECK(media_purpose IN ('COMPLETION_EVIDENCE','ISSUE_EVIDENCE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(engagement_id,media_id)
);
CREATE INDEX ix_service_engagement_media ON service_engagement_media(engagement_id,media_purpose);

CREATE TABLE service_provider_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_provider_id uuid NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    media_role text NOT NULL CHECK(media_role IN ('PROFILE_IMAGE','COVER_IMAGE','PORTFOLIO_IMAGE')),
    display_order integer NOT NULL DEFAULT 0 CHECK(display_order>=0),
    caption text CHECK(caption IS NULL OR length(caption)<=500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(service_provider_id,media_id)
);
CREATE INDEX ix_service_provider_media_order ON service_provider_media(service_provider_id,media_role,display_order);
CREATE UNIQUE INDEX ux_service_provider_single_profile_image ON service_provider_media(service_provider_id)
    WHERE media_role='PROFILE_IMAGE';
CREATE UNIQUE INDEX ux_service_provider_single_cover_image ON service_provider_media(service_provider_id)
    WHERE media_role='COVER_IMAGE';

CREATE TABLE service_category_media (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_category_id uuid NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    media_role text NOT NULL CHECK(media_role IN ('ICON','THUMBNAIL','COVER')),
    display_order integer NOT NULL DEFAULT 0 CHECK(display_order>=0),
    alt_text text CHECK(alt_text IS NULL OR length(alt_text)<=500),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(service_category_id,media_id)
);
CREATE INDEX ix_service_category_media_order ON service_category_media(service_category_id,media_role,display_order);
CREATE UNIQUE INDEX ux_service_category_single_icon ON service_category_media(service_category_id)
    WHERE media_role='ICON';
CREATE UNIQUE INDEX ux_service_category_single_cover ON service_category_media(service_category_id)
    WHERE media_role='COVER';

CREATE OR REPLACE FUNCTION validate_service_quote()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_request_status text; v_customer uuid; v_provider_status text;
    v_onboarding text; v_owner uuid; v_business uuid; v_previous service_quotes%ROWTYPE;
BEGIN
    SELECT status,customer_user_id INTO v_request_status,v_customer FROM service_requests WHERE id=NEW.service_request_id;
    IF v_request_status<>'OPEN' THEN RAISE EXCEPTION 'Quotes require an OPEN request' USING ERRCODE='23514'; END IF;
    SELECT status,onboarding_status,owner_user_id,business_account_id INTO v_provider_status,v_onboarding,v_owner,v_business
      FROM service_providers WHERE id=NEW.service_provider_id;
    IF v_provider_status<>'ACTIVE' OR v_onboarding<>'APPROVED' THEN
        RAISE EXCEPTION 'Only approved active providers may quote' USING ERRCODE='23514';
    END IF;
    IF NEW.submitted_by_user_id=v_customer THEN RAISE EXCEPTION 'A customer cannot quote on their own request' USING ERRCODE='23514'; END IF;
    IF v_owner IS NOT NULL AND NEW.submitted_by_user_id<>v_owner THEN RAISE EXCEPTION 'Quote author must own provider' USING ERRCODE='23514'; END IF;
    IF v_business IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_account_members m
       WHERE m.business_account_id=v_business AND m.user_id=NEW.submitted_by_user_id
       AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'Quote author must be an active business member' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_quote_id IS NULL THEN
        IF NEW.revision_no<>1 THEN RAISE EXCEPTION 'First quote revision must be 1' USING ERRCODE='23514'; END IF;
    ELSE
        SELECT * INTO v_previous FROM service_quotes WHERE id=NEW.supersedes_quote_id;
        IF v_previous.id IS NULL OR v_previous.service_request_id<>NEW.service_request_id
           OR v_previous.service_provider_id<>NEW.service_provider_id
           OR NEW.revision_no<>v_previous.revision_no+1 THEN
            RAISE EXCEPTION 'Invalid quote revision chain' USING ERRCODE='23514';
        END IF;
        IF v_previous.status NOT IN ('SENT','DECLINED','EXPIRED') THEN RAISE EXCEPTION 'Quote cannot be revised' USING ERRCODE='23514'; END IF;
        UPDATE service_quotes SET status='SUPERSEDED',responded_at=now()
          WHERE id=NEW.supersedes_quote_id AND status IN ('SENT','DECLINED','EXPIRED');
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_quote BEFORE INSERT ON service_quotes
FOR EACH ROW EXECUTE FUNCTION validate_service_quote();

CREATE OR REPLACE FUNCTION validate_service_quote_acceptance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_request_status text;
BEGIN
    IF NEW.status='ACCEPTED' AND OLD.status IS DISTINCT FROM 'ACCEPTED' THEN
        SELECT status INTO v_request_status FROM service_requests WHERE id=NEW.service_request_id FOR UPDATE;
        IF v_request_status<>'OPEN' OR OLD.status<>'SENT' OR (NEW.valid_until IS NOT NULL AND NEW.valid_until<=now()) THEN
            RAISE EXCEPTION 'Only a current unexpired quote for an OPEN request can be accepted' USING ERRCODE='23514';
        END IF;
        NEW.responded_at:=COALESCE(NEW.responded_at,now());
    END IF;
    IF OLD.status='ACCEPTED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Accepted quotes are immutable' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_quote_acceptance BEFORE UPDATE ON service_quotes
FOR EACH ROW EXECUTE FUNCTION validate_service_quote_acceptance();

CREATE OR REPLACE FUNCTION prevent_service_quote_term_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.service_request_id,NEW.service_provider_id,NEW.response_id,NEW.revision_no,
       NEW.supersedes_quote_id,NEW.submitted_by_user_id,NEW.title,NEW.scope_of_work,
       NEW.amount,NEW.currency_code,NEW.estimated_duration_value,NEW.estimated_duration_unit,
       NEW.valid_until,NEW.inclusions,NEW.exclusions,NEW.terms_and_conditions,NEW.sent_at,NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.service_request_id,OLD.service_provider_id,OLD.response_id,OLD.revision_no,
       OLD.supersedes_quote_id,OLD.submitted_by_user_id,OLD.title,OLD.scope_of_work,
       OLD.amount,OLD.currency_code,OLD.estimated_duration_value,OLD.estimated_duration_unit,
       OLD.valid_until,OLD.inclusions,OLD.exclusions,OLD.terms_and_conditions,OLD.sent_at,OLD.created_at) THEN
        RAISE EXCEPTION 'Submitted quote terms are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_prevent_service_quote_term_mutation BEFORE UPDATE ON service_quotes
FOR EACH ROW EXECUTE FUNCTION prevent_service_quote_term_mutation();

CREATE OR REPLACE FUNCTION validate_service_engagement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_quote service_quotes%ROWTYPE; v_customer uuid;
BEGIN
    SELECT * INTO v_quote FROM service_quotes WHERE id=NEW.accepted_quote_id;
    SELECT customer_user_id INTO v_customer FROM service_requests WHERE id=NEW.service_request_id;
    IF v_quote.id IS NULL OR v_quote.status<>'ACCEPTED' OR NEW.service_request_id<>v_quote.service_request_id
       OR NEW.service_provider_id<>v_quote.service_provider_id OR NEW.customer_user_id<>v_customer THEN
        RAISE EXCEPTION 'Engagement must match an accepted quote' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_engagement BEFORE INSERT OR UPDATE OF service_request_id,accepted_quote_id,service_provider_id,customer_user_id
ON service_engagements FOR EACH ROW EXECUTE FUNCTION validate_service_engagement();

CREATE OR REPLACE FUNCTION validate_service_engagement_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status='ACCEPTED' AND NEW.status NOT IN ('IN_PROGRESS','CANCELLED') THEN RAISE EXCEPTION 'Invalid engagement transition' USING ERRCODE='23514';
        ELSIF OLD.status='IN_PROGRESS' AND NEW.status NOT IN ('COMPLETION_SUBMITTED','CANCELLED','ISSUE_RAISED') THEN RAISE EXCEPTION 'Invalid engagement transition' USING ERRCODE='23514';
        ELSIF OLD.status='COMPLETION_SUBMITTED' AND NEW.status NOT IN ('COMPLETED','IN_PROGRESS','ISSUE_RAISED') THEN RAISE EXCEPTION 'Invalid engagement transition' USING ERRCODE='23514';
        ELSIF OLD.status='ISSUE_RAISED' AND NEW.status NOT IN ('IN_PROGRESS','COMPLETION_SUBMITTED','CANCELLED','COMPLETED') THEN RAISE EXCEPTION 'Invalid engagement transition' USING ERRCODE='23514';
        ELSIF OLD.status IN ('COMPLETED','CANCELLED') THEN RAISE EXCEPTION 'Terminal engagement' USING ERRCODE='23514';
        END IF;
        IF NEW.status='IN_PROGRESS' AND NEW.started_at IS NULL THEN NEW.started_at:=now(); END IF;
        IF NEW.status='COMPLETION_SUBMITTED' AND NEW.completion_submitted_at IS NULL THEN NEW.completion_submitted_at:=now(); END IF;
        IF NEW.status='COMPLETED' THEN
            IF OLD.status NOT IN ('COMPLETION_SUBMITTED','ISSUE_RAISED') THEN RAISE EXCEPTION 'Completion requires provider submission' USING ERRCODE='23514'; END IF;
            NEW.completed_at:=COALESCE(NEW.completed_at,now());
        END IF;
        IF NEW.status='CANCELLED' THEN NEW.cancelled_at:=COALESCE(NEW.cancelled_at,now()); END IF;
        IF NEW.status='ISSUE_RAISED' THEN NEW.issue_raised_at:=COALESCE(NEW.issue_raised_at,now()); END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_service_engagement_transition BEFORE UPDATE OF status ON service_engagements
FOR EACH ROW EXECUTE FUNCTION validate_service_engagement_transition();

CREATE OR REPLACE FUNCTION record_service_engagement_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        INSERT INTO service_engagement_status_history(engagement_id,from_status,to_status,created_at)
        VALUES(NEW.id,NULL,NEW.status,NEW.created_at);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO service_engagement_status_history(engagement_id,from_status,to_status,created_at)
        VALUES(NEW.id,OLD.status,NEW.status,now());
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_record_service_engagement_status AFTER INSERT OR UPDATE OF status ON service_engagements
FOR EACH ROW EXECUTE FUNCTION record_service_engagement_status();

CREATE OR REPLACE FUNCTION validate_service_request_response()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_customer uuid; v_provider_status text; v_onboarding text; v_owner_user uuid; v_owner_business uuid;
BEGIN
    SELECT status,customer_user_id INTO v_status,v_customer FROM service_requests WHERE id=NEW.service_request_id;
    SELECT status,onboarding_status,owner_user_id,business_account_id INTO v_provider_status,v_onboarding,v_owner_user,v_owner_business
      FROM service_providers WHERE id=NEW.service_provider_id;
    IF v_status<>'OPEN' AND NOT (TG_OP='UPDATE' AND OLD.service_request_id=NEW.service_request_id AND OLD.service_provider_id=NEW.service_provider_id) THEN
        RAISE EXCEPTION 'A new response requires an OPEN request' USING ERRCODE='23514';
    END IF;
    IF v_provider_status<>'ACTIVE' OR v_onboarding<>'APPROVED' THEN RAISE EXCEPTION 'Only approved active providers may respond' USING ERRCODE='23514'; END IF;
    IF v_owner_user=v_customer OR (v_owner_business IS NOT NULL AND EXISTS(SELECT 1 FROM business_account_members m
       WHERE m.business_account_id=v_owner_business AND m.user_id=v_customer AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)) THEN
        RAISE EXCEPTION 'A customer cannot respond to their own request' USING ERRCODE='23514';
    END IF;
    IF (v_owner_user IS NOT NULL AND NEW.responded_by_user_id<>v_owner_user)
       OR (v_owner_business IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_account_members m
       WHERE m.business_account_id=v_owner_business AND m.user_id=NEW.responded_by_user_id
       AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)) THEN
        RAISE EXCEPTION 'Response actor cannot manage provider' USING ERRCODE='23514';
    END IF;
    IF NEW.response_type='QUOTE' AND NEW.quoted_amount IS NULL THEN RAISE EXCEPTION 'Quote response requires amount and currency' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_service_request_response ON service_request_responses;
CREATE TRIGGER trg_validate_service_request_response BEFORE INSERT OR UPDATE OF service_request_id,service_provider_id,responded_by_user_id,response_type,quoted_amount,currency_code,status
ON service_request_responses FOR EACH ROW EXECUTE FUNCTION validate_service_request_response();

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

CREATE OR REPLACE FUNCTION validate_service_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_customer uuid;
BEGIN
    SELECT customer_user_id INTO v_customer FROM service_requests WHERE id=NEW.service_request_id;
    IF NEW.reviewer_user_id<>v_customer THEN RAISE EXCEPTION 'Only the request customer may review' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM service_engagements e WHERE e.service_request_id=NEW.service_request_id
       AND e.service_provider_id=NEW.service_provider_id AND e.customer_user_id=NEW.reviewer_user_id AND e.status='COMPLETED') THEN
        RAISE EXCEPTION 'A review requires a completed engagement' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM service_providers p WHERE p.id=NEW.service_provider_id AND (p.owner_user_id=NEW.reviewer_user_id OR (p.business_account_id IS NOT NULL AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=p.business_account_id AND m.user_id=NEW.reviewer_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)))) THEN
       RAISE EXCEPTION 'A provider owner or active business member cannot review their own provider profile' USING ERRCODE='23514';
    END IF;
    IF NEW.provider_response IS NOT NULL AND NEW.provider_response_by_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM service_providers p WHERE p.id=NEW.service_provider_id AND
         ((p.owner_user_id=NEW.provider_response_by_user_id) OR
          (p.business_account_id IS NOT NULL AND EXISTS (SELECT 1 FROM business_account_members m WHERE m.business_account_id=p.business_account_id AND m.user_id=NEW.provider_response_by_user_id AND m.accepted_at IS NOT NULL AND m.revoked_at IS NULL)))) THEN
       RAISE EXCEPTION 'Provider response must be authored by the provider owner or an active business member' USING ERRCODE='23514';
    END IF;
    IF NEW.provider_response IS NOT NULL AND NEW.provider_response_by_user_id IS NULL THEN RAISE EXCEPTION 'Provider response requires an author' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_service_review ON service_reviews;
CREATE TRIGGER trg_validate_service_review BEFORE INSERT OR UPDATE ON service_reviews
FOR EACH ROW EXECUTE FUNCTION validate_service_review();
