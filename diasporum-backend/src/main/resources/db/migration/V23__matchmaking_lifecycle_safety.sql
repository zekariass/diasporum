-- Restore the v10.13 lifecycle without changing historical migrations or relationships.
-- V15 synthesized confirmation from updated_at. Its historical records cannot be
-- distinguished reliably from explicit confirmations, so require reconfirmation
-- for that cohort. Preserve DOB and all relationships; post-V15 confirmations survive.
UPDATE profiles SET age_eligibility_confirmed_at=NULL
WHERE age_eligibility_confirmed_at <= (
    SELECT max(installed_on) AT TIME ZONE current_setting('TIMEZONE')
    FROM flyway_schema_history WHERE version='15' AND success
);

CREATE OR REPLACE FUNCTION matchmaking_user_is_eligible(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT matchmaking_account_is_adult(p_user_id)
       AND EXISTS (SELECT 1 FROM user_privacy_settings WHERE user_id=p_user_id AND allow_matchmaking_discovery)
       AND EXISTS (SELECT 1 FROM matchmaking_profiles WHERE user_id=p_user_id AND status='ACTIVE'
                   AND verification_status NOT IN ('REJECTED','REVOKED'))
       AND EXISTS (SELECT 1 FROM matchmaking_preferences WHERE user_id=p_user_id);
$$;

-- Shared guard for linked chat reads, media, presence and notification delivery.
-- Pausing discovery does not prevent existing adult matches from talking.
CREATE OR REPLACE FUNCTION matchmaking_chat_is_accessible(p_match_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT p_match_id IS NULL OR EXISTS (
        SELECT 1 FROM matchmaking_matches m
        JOIN matchmaking_profiles a ON a.user_id=m.user_a_id
        JOIN matchmaking_profiles b ON b.user_id=m.user_b_id
        WHERE m.id=p_match_id AND m.status IN ('MATCHED','UNMATCHED')
          AND matchmaking_account_is_adult(m.user_a_id)
          AND matchmaking_account_is_adult(m.user_b_id)
          AND a.status NOT IN ('SUSPENDED','DELETED') AND b.status NOT IN ('SUSPENDED','DELETED')
          AND a.verification_status NOT IN ('REJECTED','REVOKED')
          AND b.verification_status NOT IN ('REJECTED','REVOKED')
          AND NOT EXISTS (SELECT 1 FROM user_blocks ub WHERE
            (ub.blocker_user_id=m.user_a_id AND ub.blocked_user_id=m.user_b_id)
            OR (ub.blocker_user_id=m.user_b_id AND ub.blocked_user_id=m.user_a_id)));
$$;

-- Reversed decisions may be replaced; their immutable history remains the audit trail.
CREATE OR REPLACE FUNCTION validate_matchmaking_swipe_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.swiper_user_id IS DISTINCT FROM OLD.swiper_user_id
       OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id THEN
        RAISE EXCEPTION 'Swipe participants are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status IN ('REWOUND','WITHDRAWN') AND NEW.status='ACTIVE' THEN
        IF NOT matchmaking_users_compatible(NEW.swiper_user_id,NEW.target_user_id)
           OR EXISTS (SELECT 1 FROM matchmaking_matches WHERE
             user_a_id=least(NEW.swiper_user_id,NEW.target_user_id)
             AND user_b_id=greatest(NEW.swiper_user_id,NEW.target_user_id))
           OR EXISTS (SELECT 1 FROM user_blocks WHERE
             (blocker_user_id=NEW.swiper_user_id AND blocked_user_id=NEW.target_user_id)
             OR (blocker_user_id=NEW.target_user_id AND blocked_user_id=NEW.swiper_user_id)) THEN
            RAISE EXCEPTION 'Swipe is no longer eligible' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.action IS DISTINCT FROM OLD.action OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR OLD.status<>'ACTIVE' OR NOT (
         (OLD.action='LIKE' AND NEW.status='WITHDRAWN') OR NEW.status='REWOUND') THEN
        RAISE EXCEPTION 'Only active decisions can be reversed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

-- Closing a match closes its chat atomically, including block/account/profile closures.
CREATE OR REPLACE FUNCTION close_chat_for_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status<>'MATCHED' THEN
        UPDATE direct_conversations SET status='CLOSED',updated_at=now()
          WHERE matchmaking_match_id=NEW.id AND context_type='GENERAL' AND status<>'CLOSED';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_close_chat_for_match AFTER UPDATE OF status ON matchmaking_matches
FOR EACH ROW EXECUTE FUNCTION close_chat_for_match();

UPDATE direct_conversations c SET status='CLOSED',updated_at=now()
FROM matchmaking_matches m WHERE c.matchmaking_match_id=m.id
AND m.status<>'MATCHED' AND c.status<>'CLOSED';

-- No alternate conversation-creation endpoint can reopen a closed match's chat.
CREATE OR REPLACE FUNCTION guard_match_chat_reopen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.matchmaking_match_id IS NOT NULL AND NEW.status<>'CLOSED' AND NOT EXISTS (
        SELECT 1 FROM matchmaking_matches m WHERE m.id=NEW.matchmaking_match_id
          AND m.status='MATCHED' AND matchmaking_account_is_adult(m.user_a_id)
          AND matchmaking_account_is_adult(m.user_b_id)
          AND matchmaking_chat_is_accessible(m.id)) THEN
        RAISE EXCEPTION 'Match conversation is closed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_match_chat_reopen BEFORE INSERT OR UPDATE OF status,matchmaking_match_id
ON direct_conversations FOR EACH ROW EXECUTE FUNCTION guard_match_chat_reopen();

COMMENT ON TABLE friendships IS 'Independent social friendships. Dating does not create or delete these on match/unmatch.';
