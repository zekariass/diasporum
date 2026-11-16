-- Employers choose whether applicants can apply, make contact, or both.
-- Existing listings retain the previous behavior with both options enabled.
ALTER TABLE job_listings
    ADD COLUMN applications_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN contact_enabled boolean NOT NULL DEFAULT true,
    ADD CONSTRAINT job_listings_engagement_option_check
        CHECK (applications_enabled OR contact_enabled);

CREATE OR REPLACE FUNCTION validate_internal_job_application()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_method application_method; v_status job_status; v_employer uuid;
    v_business_owner uuid; v_applications_enabled boolean;
BEGIN
    SELECT j.application_method,j.status,j.employer_user_id,b.owner_user_id,
           j.applications_enabled
      INTO v_method,v_status,v_employer,v_business_owner,v_applications_enabled
      FROM job_listings j LEFT JOIN business_listings b ON b.id=j.business_id
      WHERE j.id=NEW.job_id;
    IF v_method IS DISTINCT FROM 'INTERNAL' OR v_status IS DISTINCT FROM 'PUBLISHED'
            OR v_applications_enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Applications are accepted only for published internal-application jobs with applications enabled'
            USING ERRCODE='23514';
    END IF;
    IF NEW.applicant_id=v_employer OR (v_business_owner IS NOT NULL AND NEW.applicant_id=v_business_owner) THEN
        RAISE EXCEPTION 'Employers cannot apply to their own job listing' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

-- New job-context conversations are permitted only while the poster allows contact.
CREATE OR REPLACE FUNCTION validate_job_conversation_contact()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.context_type='JOB_LISTING' AND NOT EXISTS (
        SELECT 1 FROM job_listings WHERE id=NEW.context_id AND contact_enabled
    ) THEN
        RAISE EXCEPTION 'Job listing does not accept employer contact' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_job_conversation_contact ON direct_conversations;
CREATE TRIGGER trg_job_conversation_contact BEFORE INSERT ON direct_conversations
FOR EACH ROW EXECUTE FUNCTION validate_job_conversation_contact();
