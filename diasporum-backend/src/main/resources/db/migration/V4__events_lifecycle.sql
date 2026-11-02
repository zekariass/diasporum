-- Events module lifecycle support (forward-only, v10.12 baseline + events milestone).
-- The baseline events table already covers ownership, modes, capacity, RSVPs, saves,
-- media and visibility. This migration adds the publish timestamp and the explicit
-- cancellation lifecycle the design requires (cancellation is not deletion and not
-- expiry: a cancelled event stays visible to participants as cancelled).

ALTER TABLE events ADD COLUMN published_at timestamptz;
ALTER TABLE events ADD COLUMN cancelled_at timestamptz;
ALTER TABLE events ADD COLUMN cancel_reason text
    CHECK(cancel_reason IS NULL OR length(trim(cancel_reason)) <= 1000);

-- Discovery scans published, non-cancelled upcoming events.
CREATE INDEX ix_events_discovery ON events(starts_at, id)
    WHERE status = 'PUBLISHED' AND cancelled_at IS NULL;

-- Organizer workspace listings.
CREATE INDEX ix_events_owner_user ON events(owner_user_id, starts_at)
    WHERE status <> 'DELETED' AND owner_user_id IS NOT NULL;
