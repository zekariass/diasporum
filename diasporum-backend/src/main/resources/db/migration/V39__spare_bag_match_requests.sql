-- V39: Spare Bag v10.15 contact/matching between a sender request and a
-- traveller journey.
--
-- The v10.15 redesign (V31 section 7) defines no contact table. The legacy
-- spare_bag_contact_requests table is NOT reused: its listing FKs are NOT NULL
-- and its validate_spare_bag_contact_request trigger plus the SPARE_BAG_CONTACT
-- direct-conversation branch enforce legacy-listing semantics (airports,
-- SENDER_REQUEST/PASSENGER_OFFER pair, overlapping dates) on a path the mobile
-- app still uses. This table is additive; no legacy table or row is touched.
--
-- Status vocabulary mirrors the existing spare_bag_contact_status enum values.

CREATE TABLE IF NOT EXISTS spare_bag_match_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_request_id uuid NOT NULL REFERENCES spare_bag_sender_requests(id) ON DELETE CASCADE,
    journey_id uuid NOT NULL REFERENCES spare_bag_traveller_journeys(id) ON DELETE CASCADE,
    requested_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    responded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    direct_conversation_id uuid REFERENCES direct_conversations(id) ON DELETE SET NULL,
    status varchar(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED','CLOSED')),
    message text CHECK (message IS NULL OR length(message) <= 3000),
    response_note text CHECK (response_note IS NULL OR length(response_note) <= 3000),
    responded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- responded_by_user_id is deliberately not part of this CHECK: its
    -- ON DELETE SET NULL would otherwise make user deletion fail.
    CHECK (status NOT IN ('ACCEPTED','DECLINED') OR responded_at IS NOT NULL)
);

-- At most one open (PENDING/ACCEPTED) match per request/journey pair.
CREATE UNIQUE INDEX IF NOT EXISTS ux_spare_bag_match_open_pair
    ON spare_bag_match_requests(sender_request_id, journey_id)
    WHERE status IN ('PENDING','ACCEPTED');

-- A sender request is MATCHED with exactly one traveller at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_spare_bag_match_accepted_request
    ON spare_bag_match_requests(sender_request_id)
    WHERE status = 'ACCEPTED';

CREATE INDEX IF NOT EXISTS ix_spare_bag_match_journey
    ON spare_bag_match_requests(journey_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_spare_bag_match_requester
    ON spare_bag_match_requests(requested_by_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_spare_bag_match_conversation
    ON spare_bag_match_requests(direct_conversation_id)
    WHERE direct_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_spare_bag_match_responded_by
    ON spare_bag_match_requests(responded_by_user_id)
    WHERE responded_by_user_id IS NOT NULL;

COMMENT ON TABLE spare_bag_match_requests IS
    'v10.15 sender-request <-> traveller-journey contact/match. Replaces spare_bag_contact_requests for the new model; the legacy table is retained for backward compatibility.';
