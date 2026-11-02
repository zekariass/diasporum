-- V6: Messaging M4 — extend media_objects purpose CHECK to allow
-- MESSAGE_IMAGE and MESSAGE_DOCUMENT for direct-message attachments.
-- The existing direct_message_media join table already exists; only the
-- purpose constraint needs to accept the two new values.

ALTER TABLE media_objects
    DROP CONSTRAINT media_objects_purpose_check;

ALTER TABLE media_objects
    ADD CONSTRAINT media_objects_purpose_check
    CHECK (purpose IN (
        'AVATAR', 'FEED_IMAGE', 'FEED_VIDEO', 'BUSINESS', 'EVENT', 'JOB',
        'MATCHMAKING_PROFILE_PHOTO', 'MATCHMAKING_PROFILE_BLURRED',
        'CHAT_ATTACHMENT', 'SPARE_BAG_LISTING', 'DOCUMENT', 'OTHER',
        'MESSAGE_AUDIO',
        -- M4: direct-message attachment types
        'MESSAGE_IMAGE', 'MESSAGE_DOCUMENT'
    ));
