-- Feed post category becomes optional. Reels and other feed post types may be
-- published without a country category; a supplied category is still validated
-- against the country and module at both the service and trigger layers.
-- The community/country consistency guard is unchanged.
ALTER TABLE feed_posts ALTER COLUMN category_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION validate_feed_post_country_category()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_destination uuid;
BEGIN
    SELECT destination_country_id INTO v_destination FROM communities WHERE id=NEW.community_id AND is_active=true;
    IF v_destination IS NULL THEN
        RAISE EXCEPTION 'community missing or inactive';
    END IF;
    IF v_destination <> NEW.country_id THEN
        RAISE EXCEPTION 'feed post country must equal community destination country';
    END IF;
    IF NEW.category_id IS NOT NULL THEN
        IF NEW.post_type='COMMUNITY_HELP' THEN
            PERFORM assert_country_category(NEW.category_id,NEW.country_id,'COMMUNITY_HELP');
        ELSE
            PERFORM assert_country_category(NEW.category_id,NEW.country_id,'FEED');
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
