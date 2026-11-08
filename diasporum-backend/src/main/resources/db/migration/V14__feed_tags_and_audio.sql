-- V14: Post hashtags and audio attachments for the feed.
-- feed_tags/feed_post_tags implement the normalized hashtag folksonomy;
-- FEED_AUDIO extends the media purpose CHECK for voice/audio post attachments.

ALTER TABLE media_objects
    DROP CONSTRAINT IF EXISTS media_objects_purpose_check;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'media_objects_purpose_check') THEN
        ALTER TABLE media_objects
            ADD CONSTRAINT media_objects_purpose_check
            CHECK (purpose IN (
                'AVATAR', 'FEED_IMAGE', 'FEED_VIDEO', 'FEED_AUDIO', 'BUSINESS',
                'EVENT', 'JOB', 'PROPERTY', 'MATCHMAKING_PROFILE_PHOTO',
                'MATCHMAKING_PROFILE_BLURRED', 'CHAT_ATTACHMENT',
                'SPARE_BAG_LISTING', 'DOCUMENT', 'OTHER', 'MESSAGE_AUDIO',
                'MESSAGE_IMAGE', 'MESSAGE_DOCUMENT', 'VEHICLE', 'SERVICE_REQUEST'
            ));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS feed_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_key text NOT NULL UNIQUE CHECK(tag_key=lower(trim(tag_key))
        AND length(tag_key) BETWEEN 2 AND 50
        AND tag_key ~ '^[[:alnum:]_]+$'),
    display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 2 AND 50),
    post_count integer NOT NULL DEFAULT 0 CHECK(post_count >= 0),
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_feed_tags_suggest ON feed_tags(tag_key text_pattern_ops)
    WHERE post_count > 0;
CREATE INDEX IF NOT EXISTS ix_feed_tags_usage ON feed_tags(post_count DESC,tag_key);

CREATE TABLE IF NOT EXISTS feed_post_tags (
    post_id uuid NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES feed_tags(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(post_id,tag_id),
    UNIQUE(post_id,sort_order)
);
CREATE INDEX IF NOT EXISTS ix_feed_post_tags_tag ON feed_post_tags(tag_id,post_id);
