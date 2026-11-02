-- Durable friendships are separate from matches and directional follows.
CREATE TABLE friendships (
    user_a_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(user_a_id,user_b_id),
    CHECK(user_a_id < user_b_id)
);
CREATE INDEX ix_friendships_user_b ON friendships(user_b_id,user_a_id);

INSERT INTO friendships(user_a_id,user_b_id,created_at)
SELECT user_a_id,user_b_id,mutual_since FROM user_mutual_connections
ON CONFLICT(user_a_id,user_b_id) DO NOTHING;

COMMENT ON TABLE friendships IS
    'Canonical durable friendship pair. Matchmaking creates it through SocialApi; unmatching never deletes it.';

CREATE OR REPLACE FUNCTION cleanup_relationships_on_block()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_a uuid; v_b uuid; v_lock_key bigint;
BEGIN
    v_lock_key := hashtextextended(least(NEW.blocker_user_id::text,NEW.blocked_user_id::text)||':'||greatest(NEW.blocker_user_id::text,NEW.blocked_user_id::text),0);
    PERFORM pg_advisory_xact_lock(v_lock_key);
    DELETE FROM user_follows WHERE (follower_user_id=NEW.blocker_user_id AND followed_user_id=NEW.blocked_user_id)
       OR (follower_user_id=NEW.blocked_user_id AND followed_user_id=NEW.blocker_user_id);
    DELETE FROM friendships WHERE user_a_id=LEAST(NEW.blocker_user_id,NEW.blocked_user_id)
      AND user_b_id=GREATEST(NEW.blocker_user_id,NEW.blocked_user_id);
    UPDATE message_requests SET status='CLOSED'
      WHERE status='REQUESTED' AND ((sender_id=NEW.blocker_user_id AND recipient_id=NEW.blocked_user_id)
        OR (sender_id=NEW.blocked_user_id AND recipient_id=NEW.blocker_user_id));
    UPDATE direct_conversations SET status='CLOSED',updated_at=now()
      WHERE participant_a_business_account_id IS NULL AND participant_b_business_account_id IS NULL
        AND participant_a_id=LEAST(NEW.blocker_user_id,NEW.blocked_user_id)
        AND participant_b_id=GREATEST(NEW.blocker_user_id,NEW.blocked_user_id)
        AND status <> 'CLOSED';
    UPDATE matchmaking_matches SET status='BLOCKED',closed_at=COALESCE(closed_at,now()),closed_by=NEW.blocker_user_id,
        close_reason='User block',updated_at=now()
      WHERE (user_a_id=LEAST(NEW.blocker_user_id,NEW.blocked_user_id) AND user_b_id=GREATEST(NEW.blocker_user_id,NEW.blocked_user_id))
        AND status<>'BLOCKED';
    DELETE FROM matchmaking_swipes WHERE (swiper_user_id=NEW.blocker_user_id AND target_user_id=NEW.blocked_user_id)
        OR (swiper_user_id=NEW.blocked_user_id AND target_user_id=NEW.blocker_user_id);
    RETURN NEW;
END;
$$;

-- Mutual-match orchestration belongs to the transactional application service,
-- which calls Social and Messaging public APIs. Avoid duplicate database side effects.
DROP TRIGGER IF EXISTS trg_matchmaking_mutual_like ON matchmaking_swipes;
DROP TRIGGER IF EXISTS trg_create_conversation_for_match ON matchmaking_matches;
DROP FUNCTION IF EXISTS create_match_after_mutual_like();
DROP FUNCTION IF EXISTS create_conversation_for_match();

DROP TRIGGER IF EXISTS trg_matchmaking_swipe_immutable ON matchmaking_swipes;
DROP FUNCTION IF EXISTS prevent_matchmaking_swipe_update();
CREATE OR REPLACE FUNCTION validate_matchmaking_swipe_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.swiper_user_id IS DISTINCT FROM OLD.swiper_user_id
       OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
       OR NEW.action IS DISTINCT FROM OLD.action
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Swipe actor, target, action and creation timestamp are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD.status<>'ACTIVE' OR NOT (
        (OLD.action='LIKE' AND NEW.status='WITHDRAWN')
        OR (OLD.action IN ('LIKE','PASS') AND NEW.status='REWOUND')
    ) THEN
        RAISE EXCEPTION 'Only an active LIKE can be withdrawn or an active swipe rewound' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_matchmaking_swipe_immutable BEFORE UPDATE ON matchmaking_swipes
FOR EACH ROW EXECUTE FUNCTION validate_matchmaking_swipe_update();

CREATE OR REPLACE FUNCTION validate_matchmaking_match()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM matchmaking_swipes a JOIN matchmaking_swipes b
        ON a.swiper_user_id=b.target_user_id AND a.target_user_id=b.swiper_user_id
        WHERE a.swiper_user_id=NEW.user_a_id AND a.target_user_id=NEW.user_b_id
          AND a.action='LIKE' AND b.action='LIKE'
          AND a.status='ACTIVE' AND b.status='ACTIVE') THEN
        RAISE EXCEPTION 'A match requires reciprocal active LIKE decisions' USING ERRCODE='23514';
    END IF;
    IF NOT matchmaking_users_compatible(NEW.user_a_id,NEW.user_b_id) THEN
        RAISE EXCEPTION 'A match requires reciprocal preference compatibility and adult eligibility' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM user_blocks b WHERE
        (b.blocker_user_id=NEW.user_a_id AND b.blocked_user_id=NEW.user_b_id) OR
        (b.blocker_user_id=NEW.user_b_id AND b.blocked_user_id=NEW.user_a_id)) THEN
        RAISE EXCEPTION 'Blocked users cannot be matched' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE INDEX ix_matchmaking_swipe_history_actor_swipe_recent
    ON matchmaking_swipe_history(swiper_user_id,created_at DESC,id DESC)
    WHERE event_type='SWIPE';
