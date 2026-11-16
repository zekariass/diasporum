package com.diasporum.backend.matchmaking.internal.infrastructure.persistence;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.HistorySwipe;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchPageRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfilePhotoRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PrivateAddressOption;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceDataView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ReferenceOption;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.SwipeRow;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** PostgreSQL/PostGIS persistence for the existing matchmaking schema. */
@Repository
public class MatchmakingRepository {

    private static final UUID ZERO_UUID = new UUID(0, 0);
    private final JdbcTemplate jdbc;

    public MatchmakingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<ProfileView> profile(UUID userId) {
        return jdbc.query("SELECT * FROM matchmaking_profiles WHERE user_id=?",
                (rs, row) -> profile(rs, row), userId).stream().findFirst();
    }

    public void upsertProfile(UUID userId, ProfileCommand c) {
        jdbc.update("INSERT INTO matchmaking_profiles(user_id,gender_key,address_id,"
                + "nationality_country_id,religion_id,education_level,occupation,"
                + "relationship_intention,marital_status,has_children,wants_children,"
                + "smoking,drinking,activity_level,height_cm,marriage_timeline,"
                + "long_distance_relationship,religion_importance,willing_to_relocate,"
                + "blur_photos_until_match,hide_name_until_match,"
                + "anonymous_alias,status,activated_at,last_active_at) VALUES(?,?,?,?,?,?,?,"
                + "?,?,?,?,?,?,?,"
                + "?,?,?,?,?,?,?,"
                + "?,?::matchmaking_profile_status,"
                + "CASE WHEN ?='ACTIVE' THEN now() ELSE NULL END,"
                + "CASE WHEN ?='ACTIVE' THEN now() ELSE NULL END) "
                + "ON CONFLICT(user_id) DO UPDATE SET gender_key=EXCLUDED.gender_key,"
                + "address_id=EXCLUDED.address_id,nationality_country_id=EXCLUDED.nationality_country_id,"
                + "religion_id=EXCLUDED.religion_id,education_level=EXCLUDED.education_level,"
                + "occupation=EXCLUDED.occupation,relationship_intention=EXCLUDED.relationship_intention,"
                + "marital_status=EXCLUDED.marital_status,has_children=EXCLUDED.has_children,"
                + "wants_children=EXCLUDED.wants_children,smoking=EXCLUDED.smoking,"
                + "drinking=EXCLUDED.drinking,activity_level=EXCLUDED.activity_level,"
                + "height_cm=EXCLUDED.height_cm,marriage_timeline=EXCLUDED.marriage_timeline,"
                + "long_distance_relationship=EXCLUDED.long_distance_relationship,"
                + "religion_importance=EXCLUDED.religion_importance,"
                + "willing_to_relocate=EXCLUDED.willing_to_relocate,"
                + "blur_photos_until_match=EXCLUDED.blur_photos_until_match,"
                + "hide_name_until_match=EXCLUDED.hide_name_until_match,"
                + "anonymous_alias=EXCLUDED.anonymous_alias,status=EXCLUDED.status,"
                + "activated_at=CASE WHEN EXCLUDED.status='ACTIVE'"
                + " THEN COALESCE(matchmaking_profiles.activated_at,now())"
                + " ELSE matchmaking_profiles.activated_at END,"
                + "last_active_at=CASE WHEN EXCLUDED.status='ACTIVE' THEN now()"
                + " ELSE matchmaking_profiles.last_active_at END,updated_at=now()",
                userId, c.genderKey(), c.addressId(), c.nationalityCountryId(), c.religionId(),
                c.educationLevel(), c.occupation(), c.relationshipIntention(), c.maritalStatus(),
                c.hasChildren(), c.wantsChildren(), c.smoking(), c.drinking(), c.activityLevel(),
                c.heightCm(), c.marriageTimeline(), c.longDistanceRelationship(),
                c.religionImportance(), c.willingToRelocate(), c.blurPhotosUntilMatch(),
                c.hideNameUntilMatch(),
                c.anonymousAlias(), c.status(), c.status(), c.status());
    }

    public void markProfileDeleted(UUID userId) {
        jdbc.update("UPDATE matchmaking_profiles SET status='DELETED',updated_at=now()"
                + " WHERE user_id=? AND status<>'DELETED'", userId);
    }

    public Optional<PreferenceView> preferences(UUID userId) {
        return jdbc.query("SELECT * FROM matchmaking_preferences WHERE user_id=?",
                (rs, i) -> new PreferenceView(userId, rs.getInt("min_age"),
                        rs.getInt("max_age"), rs.getObject("max_distance_km", Integer.class),
                        rs.getBoolean("show_verified_only"), rs.getString("has_children_preference"),
                        rs.getString("wants_children_preference"),
                        religionIds(userId), languageIds(userId)), userId).stream().findFirst();
    }

    public void replacePreferences(UUID userId, PreferenceCommand c) {
        jdbc.update("INSERT INTO matchmaking_preferences(user_id,min_age,max_age,max_distance_km,"
                + "show_verified_only,has_children_preference,wants_children_preference)"
                + " VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET"
                + " min_age=EXCLUDED.min_age,max_age=EXCLUDED.max_age,"
                + " max_distance_km=EXCLUDED.max_distance_km,show_verified_only=EXCLUDED.show_verified_only,"
                + " has_children_preference=EXCLUDED.has_children_preference,"
                + " wants_children_preference=EXCLUDED.wants_children_preference,updated_at=now()",
                userId, c.minAge(), c.maxAge(), c.maxDistanceKm(), c.showVerifiedOnly(),
                c.hasChildrenPreference(), c.wantsChildrenPreference());
        jdbc.update("DELETE FROM matchmaking_preference_religions WHERE user_id=?", userId);
        jdbc.update("DELETE FROM matchmaking_preference_languages WHERE user_id=?", userId);
        for (UUID religion : c.religionIds()) {
            jdbc.update("INSERT INTO matchmaking_preference_religions(user_id,religion_id) VALUES(?,?)",
                    userId, religion);
        }
        for (UUID language : c.languageIds()) {
            jdbc.update("INSERT INTO matchmaking_preference_languages(user_id,language_id) VALUES(?,?)",
                    userId, language);
        }
    }

    private List<UUID> religionIds(UUID userId) {
        return jdbc.queryForList("SELECT religion_id FROM matchmaking_preference_religions"
                + " WHERE user_id=? ORDER BY religion_id", UUID.class, userId);
    }

    private List<UUID> languageIds(UUID userId) {
        return jdbc.queryForList("SELECT language_id FROM matchmaking_preference_languages"
                + " WHERE user_id=? ORDER BY language_id", UUID.class, userId);
    }

    public boolean activeCountry(UUID countryId) {
        return bool("SELECT EXISTS(SELECT 1 FROM countries WHERE id=? AND is_active=true)",
                countryId);
    }

    public boolean privateAddressOwned(UUID userId, UUID addressId) {
        return bool("SELECT EXISTS(SELECT 1 FROM addresses WHERE id=? AND owner_user_id=?"
                + " AND visibility='PRIVATE')", addressId, userId);
    }

    public boolean activeAccount(UUID userId) {
        return exists("SELECT 1 FROM users WHERE id=? AND account_status='ACTIVE' AND deleted_at IS NULL", userId);
    }

    public boolean needsAgeConfirmation(UUID userId) {
        return exists("SELECT 1 FROM profiles WHERE id=? AND age_eligibility_confirmed_at IS NULL"
                + " AND date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date", userId);
    }

    public boolean adult(UUID userId) {
        return bool("SELECT matchmaking_account_is_adult(?)", userId);
    }

    public boolean hasDateOfBirth(UUID userId) {
        return bool("SELECT COALESCE((SELECT date_of_birth IS NOT NULL"
                + " FROM profiles WHERE id=?),false)", userId);
    }

    public boolean eligible(UUID userId) {
        return bool("SELECT matchmaking_user_is_eligible(?)", userId);
    }

    public boolean hasDiscoveryLocation(UUID userId) {
        return exists("SELECT 1 FROM user_discovery_locations WHERE user_id=?", userId);
    }

    public Optional<MatchRow> matchForPair(UUID a, UUID b) {
        return jdbc.query("SELECT id,user_a_id,user_b_id,status::text,matched_at,closed_at,"
                + "closed_by,close_reason FROM matchmaking_matches WHERE user_a_id=least(?::uuid,?::uuid)"
                + " AND user_b_id=greatest(?::uuid,?::uuid)",
                (rs, row) -> match(rs, row), a, b, a, b).stream().findFirst();
    }

    public void actorLock(UUID actor) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended('matchmaking-actor:'||?::text,0))",
                rs -> null, actor);
    }

    public boolean discoveryOptedIn(UUID userId) {
        return bool("SELECT COALESCE((SELECT allow_matchmaking_discovery"
                + " FROM user_privacy_settings WHERE user_id=?),false)", userId);
    }

    public boolean compatible(UUID a, UUID b) {
        return bool("SELECT matchmaking_users_compatible(?,?)", a, b);
    }

    public void pairLock(UUID a, UUID b) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended("
                + "least(?::text,?::text)||':'||greatest(?::text,?::text),0))", rs -> null,
                a.toString(), b.toString(), a.toString(), b.toString());
    }

    public List<PublicProfileRow> discover(UUID actor, UUID communityId,
            UUID after, int limit) {
        String sql = PUBLIC_SELECT + " WHERE mp.user_id>? AND mp.user_id<>?"
                + " AND EXISTS(SELECT 1 FROM community_memberships cm"
                + " WHERE cm.community_id=? AND cm.user_id=mp.user_id AND cm.status='ACTIVE')"
                + " AND matchmaking_user_is_eligible(mp.user_id)"
                + " AND matchmaking_users_compatible(?,mp.user_id)"
                + " AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE"
                + " (b.blocker_user_id=? AND b.blocked_user_id=mp.user_id)"
                + " OR (b.blocker_user_id=mp.user_id AND b.blocked_user_id=?))"
                + " AND NOT EXISTS(SELECT 1 FROM matchmaking_swipes s"
                + " WHERE s.swiper_user_id=? AND s.target_user_id=mp.user_id AND s.status='ACTIVE')"
                + " AND NOT EXISTS(SELECT 1 FROM matchmaking_matches m"
                + " WHERE m.user_a_id=least(?::uuid,mp.user_id)"
                + " AND m.user_b_id=greatest(?::uuid,mp.user_id))"
                + " ORDER BY mp.user_id LIMIT ?";
        return jdbc.query(sql, (rs, row) -> publicProfile(rs, row),
                after == null ? ZERO_UUID : after, actor, communityId, actor,
                actor, actor, actor, actor, actor, limit);
    }

    public Optional<PublicProfileRow> publicProfile(UUID userId) {
        return jdbc.query(PUBLIC_SELECT + " WHERE mp.user_id=?",
                (rs, row) -> publicProfile(rs, row), userId).stream().findFirst();
    }

    public List<PublicProfileRow> receivedLikes(UUID actor, UUID after, int limit) {
        String sql = PUBLIC_SELECT + " JOIN matchmaking_swipes s ON s.swiper_user_id=mp.user_id"
                + " AND s.target_user_id=? AND s.action='LIKE' AND s.status='ACTIVE'"
                + " WHERE mp.user_id>? AND matchmaking_user_is_eligible(mp.user_id)"
                + " AND matchmaking_users_compatible(?,mp.user_id)"
                + " AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE"
                + " (b.blocker_user_id=? AND b.blocked_user_id=mp.user_id)"
                + " OR (b.blocker_user_id=mp.user_id AND b.blocked_user_id=?))"
                + " AND NOT EXISTS(SELECT 1 FROM matchmaking_matches m"
                + " WHERE m.user_a_id=least(?::uuid,mp.user_id)"
                + " AND m.user_b_id=greatest(?::uuid,mp.user_id))"
                + " ORDER BY mp.user_id LIMIT ?";
        return jdbc.query(sql, (rs, row) -> publicProfile(rs, row), actor,
                after == null ? ZERO_UUID : after,
                actor, actor, actor, actor, actor, limit);
    }

    public Optional<SwipeRow> swipe(UUID actor, UUID target) {
        return jdbc.query("SELECT * FROM matchmaking_swipes WHERE swiper_user_id=?"
                        + " AND target_user_id=?", (rs, row) -> swipe(rs, row), actor, target)
                .stream().findFirst();
    }

    public UUID insertSwipe(UUID actor, UUID target, String action, UUID communityId) {
        jdbc.update("INSERT INTO matchmaking_swipes(swiper_user_id,target_user_id,action,status,community_id)"
                + " VALUES(?,?,?::matchmaking_swipe_action,'ACTIVE',?)"
                                + " ON CONFLICT(swiper_user_id,target_user_id) DO UPDATE SET action=EXCLUDED.action,"
                                + "status='ACTIVE',community_id=EXCLUDED.community_id,"
                                + "created_at=now(),updated_at=now()"
                                + " WHERE matchmaking_swipes.status IN ('WITHDRAWN','REWOUND')",
                actor, target, action, communityId);
        return jdbc.queryForObject("INSERT INTO matchmaking_swipe_history(swiper_user_id,"
                + "target_user_id,event_type,action,community_id)"
                + " VALUES(?,?,'SWIPE',?::matchmaking_swipe_action,?) RETURNING id",
                UUID.class, actor, target, action, communityId);
    }

    public boolean reciprocalActiveLike(UUID actor, UUID target) {
        return exists("SELECT 1 FROM matchmaking_swipes WHERE swiper_user_id=?"
                + " AND target_user_id=? AND action='LIKE' AND status='ACTIVE'", target, actor);
    }

    public UUID insertMatch(UUID actor, UUID target) {
        return jdbc.queryForObject("INSERT INTO matchmaking_matches(user_a_id,user_b_id,status)"
                + " VALUES(least(?::uuid,?::uuid),greatest(?::uuid,?::uuid),'MATCHED') RETURNING id",
                UUID.class, actor, target, actor, target);
    }

    public boolean matchExistsForPair(UUID a, UUID b) {
        return exists("SELECT 1 FROM matchmaking_matches WHERE user_a_id=least(?::uuid,?::uuid)"
                + " AND user_b_id=greatest(?::uuid,?::uuid)", a, b, a, b);
    }

    public boolean activeMatchForPair(UUID a, UUID b) {
        return exists("SELECT 1 FROM matchmaking_matches WHERE user_a_id=least(?::uuid,?::uuid)"
                + " AND user_b_id=greatest(?::uuid,?::uuid) AND status='MATCHED'", a, b, a, b);
    }

    public Optional<MatchRow> match(UUID matchId) {
        return jdbc.query("SELECT id,user_a_id,user_b_id,status::text,matched_at,closed_at,"
                + "closed_by,close_reason FROM matchmaking_matches WHERE id=?",
                (rs, row) -> match(rs, row), matchId).stream().findFirst();
    }

    public Optional<MatchRow> matchForUpdate(UUID matchId) {
        return jdbc.query("SELECT id,user_a_id,user_b_id,status::text,matched_at,closed_at,"
                + "closed_by,close_reason FROM matchmaking_matches WHERE id=? FOR UPDATE",
                (rs, row) -> match(rs, row), matchId).stream().findFirst();
    }

    public List<MatchPageRow> matches(UUID actor, Instant matchedAt, UUID matchId, int limit) {
        String cursor = matchedAt == null ? "" : " AND (m.matched_at,m.id)<(?,?)";
        String sql = "SELECT " + PUBLIC_COLUMNS
                + ",m.id,m.user_a_id,m.user_b_id,m.status::text AS status,"
                + "m.matched_at,m.closed_at,m.closed_by,m.close_reason" + PUBLIC_FROM
                + " JOIN matchmaking_matches m ON m.status='MATCHED'"
                + " AND ((m.user_a_id=? AND m.user_b_id=mp.user_id)"
                + " OR (m.user_b_id=? AND m.user_a_id=mp.user_id))"
                                + " WHERE matchmaking_account_is_adult(mp.user_id)"
                                + " AND mp.status NOT IN ('SUSPENDED','DELETED')"
                                + " AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE"
                                + " (b.blocker_user_id=m.user_a_id AND b.blocked_user_id=m.user_b_id)"
                                + " OR (b.blocker_user_id=m.user_b_id AND b.blocked_user_id=m.user_a_id))" + cursor
                + " ORDER BY m.matched_at DESC,m.id DESC LIMIT ?";
        return jdbc.query(sql,
                (rs, row) -> new MatchPageRow(match(rs, row), publicProfile(rs, row)),
                matchedAt == null ? new Object[]{actor, actor, limit}
                        : new Object[]{actor, actor, Timestamp.from(matchedAt), matchId, limit});
    }

    public Optional<HistorySwipe> latestSwipeForPair(UUID actor, UUID target) {
        return jdbc.query("SELECT h.id,h.swiper_user_id,h.target_user_id,h.action::text"
                        + " FROM matchmaking_swipe_history h WHERE h.swiper_user_id=?"
                        + " AND h.target_user_id=? AND h.event_type='SWIPE'"
                        + " ORDER BY h.created_at DESC,h.id DESC LIMIT 1 FOR UPDATE",
                (rs, row) -> historySwipe(rs, row), actor, target).stream().findFirst();
    }

    public Optional<HistorySwipe> latestUnreversedSwipe(UUID actor) {
        return jdbc.query("SELECT h.id,h.swiper_user_id,h.target_user_id,h.action::text"
                        + " FROM matchmaking_swipe_history h JOIN matchmaking_swipes s"
                        + " ON s.swiper_user_id=h.swiper_user_id AND s.target_user_id=h.target_user_id"
                        + " AND s.action=h.action AND s.status='ACTIVE'"
                        + " WHERE h.swiper_user_id=? AND h.event_type='SWIPE'"
                        + " AND NOT EXISTS(SELECT 1 FROM matchmaking_swipe_history r"
                        + " WHERE r.reverses_event_id=h.id)"
                        + " ORDER BY h.created_at DESC,h.id DESC LIMIT 1",
                (rs, row) -> historySwipe(rs, row), actor).stream().findFirst();
    }

    public List<PublicProfileRow> sentLikes(UUID actor, UUID after, int limit) {
        return jdbc.query(PUBLIC_SELECT
                + " JOIN matchmaking_swipes s ON s.target_user_id=mp.user_id AND s.swiper_user_id=?"
                + " AND s.action='LIKE' AND s.status='ACTIVE'"
                + " WHERE mp.user_id>? AND matchmaking_users_compatible(?,mp.user_id)"
                + " AND NOT EXISTS(SELECT 1 FROM matchmaking_matches m WHERE"
                + " m.user_a_id=least(?::uuid,mp.user_id) AND m.user_b_id=greatest(?::uuid,mp.user_id))"
                + " AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE"
                + " (b.blocker_user_id=? AND b.blocked_user_id=mp.user_id)"
                + " OR (b.blocker_user_id=mp.user_id AND b.blocked_user_id=?))"
                + " ORDER BY mp.user_id LIMIT ?", (rs, row) -> publicProfile(rs, row),
                actor, after == null ? ZERO_UUID : after, actor, actor, actor, actor, actor, limit);
    }

    public void reverseSwipe(HistorySwipe event, String eventType, String status) {
        int updated = jdbc.update("UPDATE matchmaking_swipes SET status=?::matchmaking_swipe_status,"
                + "updated_at=now() WHERE swiper_user_id=? AND target_user_id=? AND status='ACTIVE'",
                status, event.swiperUserId(), event.targetUserId());
        if (updated != 1) {
            throw new IllegalStateException("SWIPE_STATE_CONFLICT");
        }
        jdbc.update("INSERT INTO matchmaking_swipe_history(swiper_user_id,target_user_id,"
                + "event_type,reverses_event_id) VALUES(?,?,?::matchmaking_swipe_history_event_type,?)",
                event.swiperUserId(), event.targetUserId(), eventType, event.eventId());
    }

    public void closeActiveMatchesForUser(UUID userId) {
        jdbc.update("UPDATE matchmaking_matches SET status='CLOSED',closed_at=now(),"
                + "closed_by=?,close_reason='Matchmaking profile deleted',updated_at=now()"
                + " WHERE status='MATCHED' AND (user_a_id=? OR user_b_id=?)", userId, userId, userId);
    }

    public boolean unmatch(UUID matchId, UUID actor, String reason) {
        return jdbc.update("UPDATE matchmaking_matches SET status='UNMATCHED',closed_at=now(),"
                + "closed_by=?,close_reason=?,updated_at=now() WHERE id=? AND status='MATCHED'",
                actor, reason, matchId) == 1;
    }

    public void outbox(UUID recipient, String eventType, UUID matchId, String dedupeKey) {
        jdbc.update("INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,destination,"
                + "destination_key,payload,event_dedupe_key) VALUES('USER',?,?,'ABLY',?,"
                + "jsonb_build_object('matchId',?::uuid),?) ON CONFLICT(event_dedupe_key) DO NOTHING",
                recipient, eventType, "user:" + recipient, matchId, dedupeKey);
    }

    public ReferenceDataView referenceData(UUID actor) {
        return new ReferenceDataView(
                jdbc.query("SELECT gender_key,display_name FROM matchmaking_genders"
                        + " WHERE is_active=true ORDER BY sort_order,gender_key",
                        (rs, row) -> new ReferenceOption(rs.getString("gender_key"),
                                rs.getString("display_name"))),
                jdbc.query("SELECT id,display_name FROM matchmaking_religions"
                        + " WHERE is_active=true ORDER BY sort_order,display_name,id",
                        (rs, row) -> new ReferenceOption(rs.getObject("id", UUID.class).toString(),
                                rs.getString("display_name"))),
                jdbc.query("SELECT id,name FROM countries WHERE is_active=true"
                        + " ORDER BY name,id",
                        (rs, row) -> new ReferenceOption(rs.getObject("id", UUID.class).toString(),
                                rs.getString("name"))),
                jdbc.query("SELECT id,display_name FROM languages WHERE is_active=true"
                        + " ORDER BY sort_order,display_name,id",
                        (rs, row) -> new ReferenceOption(rs.getObject("id", UUID.class).toString(),
                                rs.getString("display_name"))),
                jdbc.query("SELECT id,country_id,COALESCE(NULLIF(city,''),NULLIF(region,''),"
                        + "'Private address') AS label FROM addresses WHERE owner_user_id=?"
                        + " AND visibility='PRIVATE' ORDER BY label,id",
                        (rs, row) -> new PrivateAddressOption(
                                rs.getObject("id", UUID.class).toString(), rs.getString("label"),
                                rs.getObject("country_id", UUID.class).toString()), actor));
    }

    public Optional<UUID> createMatchReport(UUID reporter, UUID matchId,
            String reason, String details) {
        UUID id = UUID.randomUUID();
        return jdbc.query("INSERT INTO reports(id,reporter_id,target_type,target_id,reason,details)"
                        + " SELECT ?,?,'MATCHMAKING_MATCH',?,?,? WHERE NOT EXISTS("
                        + " SELECT 1 FROM reports WHERE reporter_id=?"
                        + " AND target_type='MATCHMAKING_MATCH' AND target_id=? AND status='OPEN')"
                        + " RETURNING id",
                (rs, row) -> rs.getObject("id", UUID.class), id, reporter, matchId, reason,
                details, reporter, matchId).stream().findFirst();
    }

    // ---- profile photos ----

    public List<ProfilePhotoRow> photos(UUID userId) {
        return jdbc.query("SELECT id,media_id,sort_order,is_primary"
                        + " FROM matchmaking_profile_photos WHERE user_id=?"
                        + " ORDER BY sort_order,id",
                (rs, row) -> new ProfilePhotoRow(rs.getObject("id", UUID.class),
                        rs.getObject("media_id", UUID.class), rs.getInt("sort_order"),
                        rs.getBoolean("is_primary"), userId), userId);
    }

    /** Batch photo load keyed by profile owner for page projections. */
    public java.util.Map<UUID, List<ProfilePhotoRow>> photosForUsers(
            Collection<UUID> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return java.util.Map.of();
        }
        String ph = placeholders(userIds.size());
        var byUser = new java.util.LinkedHashMap<UUID, List<ProfilePhotoRow>>();
        List<ProfilePhotoRow> rows = jdbc.query(
                "SELECT id,user_id,media_id,sort_order,is_primary"
                        + " FROM matchmaking_profile_photos WHERE user_id IN (" + ph + ")"
                        + " ORDER BY user_id,sort_order,id",
                (rs, row) -> new ProfilePhotoRow(rs.getObject("id", UUID.class),
                        rs.getObject("media_id", UUID.class), rs.getInt("sort_order"),
                        rs.getBoolean("is_primary"),
                        rs.getObject("user_id", UUID.class)),
                userIds.toArray());
        for (ProfilePhotoRow row : rows) {
            byUser.computeIfAbsent(row.userId(), k -> new java.util.ArrayList<>())
                    .add(row);
        }
        return byUser;
    }

    public Optional<ProfilePhotoRow> photo(UUID userId, UUID photoId) {
        return jdbc.query("SELECT id,media_id,sort_order,is_primary"
                        + " FROM matchmaking_profile_photos WHERE user_id=? AND id=?",
                (rs, row) -> new ProfilePhotoRow(rs.getObject("id", UUID.class),
                        rs.getObject("media_id", UUID.class), rs.getInt("sort_order"),
                        rs.getBoolean("is_primary"), userId), userId, photoId)
                .stream().findFirst();
    }

    public int photoCount(UUID userId) {
        return count("SELECT count(*) FROM matchmaking_profile_photos WHERE user_id=?", userId);
    }

    public boolean hasReadyPrimaryPhoto(UUID userId) {
        return exists("SELECT 1 FROM matchmaking_profile_photos pp"
                + " JOIN media_objects m ON m.id=pp.media_id AND m.status='READY'"
                + " WHERE pp.user_id=? AND pp.is_primary", userId);
    }

    public ProfilePhotoRow insertPhoto(UUID userId, UUID mediaId, boolean primary) {
        if (primary) {
            jdbc.update("UPDATE matchmaking_profile_photos SET is_primary=false"
                    + " WHERE user_id=? AND is_primary", userId);
        }
        UUID id = jdbc.queryForObject(
                "INSERT INTO matchmaking_profile_photos(user_id,media_id,sort_order,is_primary)"
                        + " VALUES(?,?,(SELECT COALESCE(max(sort_order),-1)+1"
                        + " FROM matchmaking_profile_photos WHERE user_id=?),?)"
                        + " RETURNING id",
                UUID.class, userId, mediaId, userId, primary);
        return photo(userId, id).orElseThrow();
    }

    public void deletePhoto(UUID userId, UUID photoId) {
        // AFTER DELETE trigger promotes the next photo when the primary is removed.
        jdbc.update("DELETE FROM matchmaking_profile_photos WHERE user_id=? AND id=?",
                userId, photoId);
    }

    public void setPrimaryPhoto(UUID userId, UUID photoId) {
        jdbc.update("UPDATE matchmaking_profile_photos SET is_primary=false"
                + " WHERE user_id=? AND is_primary", userId);
        jdbc.update("UPDATE matchmaking_profile_photos SET is_primary=true"
                + " WHERE user_id=? AND id=?", userId, photoId);
    }

    /**
     * Atomic reorder: two phases so the (user_id, sort_order) unique index is
     * never violated mid-swap. Caller supplies the complete desired id order.
     */
    public void reorderPhotos(UUID userId, List<UUID> photoIds) {
        for (int i = 0; i < photoIds.size(); i++) {
            jdbc.update("UPDATE matchmaking_profile_photos SET sort_order=?"
                    + " WHERE user_id=? AND id=?", -(i + 1), userId, photoIds.get(i));
        }
        for (int i = 0; i < photoIds.size(); i++) {
            jdbc.update("UPDATE matchmaking_profile_photos SET sort_order=?"
                    + " WHERE user_id=? AND id=?", i, userId, photoIds.get(i));
        }
    }

    public int invalidReligions(Collection<UUID> values) {
        if (values.isEmpty()) return 0;
        String ph = placeholders(values.size());
        return count("SELECT count(*) FROM (SELECT DISTINCT value FROM unnest(ARRAY[" + ph + "]::uuid[])"
                + " AS value) v LEFT JOIN matchmaking_religions r ON r.id=v.value"
                + " AND r.is_active=true WHERE r.id IS NULL", values.toArray());
    }

    public int invalidLanguages(Collection<UUID> values) {
        if (values.isEmpty()) return 0;
        String ph = placeholders(values.size());
        return count("SELECT count(*) FROM (SELECT DISTINCT value FROM unnest(ARRAY[" + ph + "]::uuid[])"
                + " AS value) v LEFT JOIN languages l ON l.id=v.value"
                + " AND l.is_active=true WHERE l.id IS NULL", values.toArray());
    }

    private static String placeholders(int size) {
        return String.join(",", Collections.nCopies(size, "?"));
    }

    private int count(String sql, Object... args) {
        Integer value = jdbc.queryForObject(sql, Integer.class, args);
        return value == null ? 0 : value;
    }

    private boolean exists(String sql, Object... args) {
        return bool("SELECT EXISTS(" + sql + ")", args);
    }

    private boolean bool(String sql, Object... args) {
        return Boolean.TRUE.equals(jdbc.queryForObject(sql, Boolean.class, args));
    }

    private ProfileView profile(ResultSet rs, int row) throws SQLException {
        return new ProfileView(rs.getObject("user_id", UUID.class), rs.getString("gender_key"),
                rs.getObject("address_id", UUID.class), rs.getObject("nationality_country_id", UUID.class),
                rs.getObject("religion_id", UUID.class), rs.getString("education_level"),
                rs.getString("occupation"), rs.getString("relationship_intention"),
                rs.getString("marital_status"), rs.getObject("has_children", Boolean.class),
                rs.getString("wants_children"), rs.getString("smoking"), rs.getString("drinking"),
                rs.getString("activity_level"), rs.getObject("height_cm", Integer.class),
                rs.getString("marriage_timeline"), rs.getObject("long_distance_relationship", Boolean.class),
                rs.getString("religion_importance"), rs.getObject("willing_to_relocate", Boolean.class),
                rs.getBoolean("blur_photos_until_match"), rs.getBoolean("hide_name_until_match"),
                rs.getString("anonymous_alias"), rs.getString("verification_status"),
                rs.getString("status"), instant(rs, "activated_at"), instant(rs, "last_active_at"),
                instant(rs, "created_at"), instant(rs, "updated_at"), List.of(), 0);
    }

    private SwipeRow swipe(ResultSet rs, int row) throws SQLException {
        return new SwipeRow(rs.getObject("swiper_user_id", UUID.class),
                rs.getObject("target_user_id", UUID.class), rs.getString("action"),
                rs.getString("status"), instant(rs, "created_at"));
    }

    private MatchRow match(ResultSet rs, int row) throws SQLException {
        return new MatchRow(rs.getObject("id", UUID.class), rs.getObject("user_a_id", UUID.class),
                rs.getObject("user_b_id", UUID.class), rs.getString("status"),
                instant(rs, "matched_at"), instant(rs, "closed_at"),
                rs.getObject("closed_by", UUID.class), rs.getString("close_reason"));
    }

    private HistorySwipe historySwipe(ResultSet rs, int row) throws SQLException {
        return new HistorySwipe(rs.getObject("id", UUID.class),
                rs.getObject("swiper_user_id", UUID.class), rs.getObject("target_user_id", UUID.class),
                rs.getString("action"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp value = rs.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    private PublicProfileRow publicProfile(ResultSet rs, int row) throws SQLException {
        return new PublicProfileRow(rs.getObject("user_id", UUID.class), rs.getString("display_name"),
                rs.getString("anonymous_alias"), rs.getBoolean("hide_name_until_match"),
                rs.getBoolean("blur_photos_until_match"), rs.getString("gender_key"),
                rs.getObject("age", Integer.class), rs.getObject("nationality_country_id", UUID.class),
                rs.getObject("religion_id", UUID.class), rs.getString("education_level"),
                rs.getString("occupation"), rs.getString("relationship_intention"),
                rs.getString("marital_status"), rs.getObject("has_children", Boolean.class),
                rs.getString("wants_children"), rs.getString("smoking"), rs.getString("drinking"),
                rs.getString("activity_level"), rs.getObject("height_cm", Integer.class),
                rs.getString("marriage_timeline"), rs.getObject("long_distance_relationship", Boolean.class),
                rs.getString("religion_importance"), rs.getObject("willing_to_relocate", Boolean.class),
                rs.getString("verification_status"), rs.getString("bio"), rs.getString("public_location"),
                List.of((String[]) rs.getArray("interests").getArray()),
                List.of((String[]) rs.getArray("languages").getArray()));
    }

    /**
     * Raw fields only — the real display name, alias and privacy switches are
     * selected unchanged so the visibility service can resolve the authorised
     * representation per viewer. Photos are joined separately in batches.
     */
    private static final String PUBLIC_COLUMNS = "mp.user_id,"
            + " p.display_name,mp.anonymous_alias,mp.hide_name_until_match,"
            + "mp.blur_photos_until_match,"
            + " mp.gender_key,extract(year FROM age(current_date,p.date_of_birth))::integer AS age,"
            + " mp.nationality_country_id,mp.religion_id,mp.education_level,mp.occupation,"
            + " mp.relationship_intention,mp.marital_status,mp.has_children,mp.wants_children,"
            + " mp.smoking,mp.drinking,mp.activity_level,mp.height_cm,mp.marriage_timeline,"
            + " mp.long_distance_relationship,mp.religion_importance,mp.willing_to_relocate,"
            + " mp.verification_status,p.bio,"
            + " concat_ws(', ',CASE WHEN ups.show_city THEN NULLIF(p.city,'') END,country.name) AS public_location,"
            + " ARRAY(SELECT i.display_name FROM user_interests ui JOIN interests i ON i.id=ui.interest_id"
            + " WHERE ui.user_id=mp.user_id AND i.is_active ORDER BY i.display_name) AS interests,"
            + " ARRAY(SELECT l.display_name FROM user_languages ul JOIN languages l ON l.id=ul.language_id"
            + " WHERE ul.user_id=mp.user_id AND l.is_active ORDER BY l.display_name) AS languages";
    private static final String PUBLIC_FROM = " FROM matchmaking_profiles mp"
            + " JOIN profiles p ON p.id=mp.user_id"
            + " JOIN user_privacy_settings ups ON ups.user_id=mp.user_id"
            + " LEFT JOIN countries country ON country.id=p.current_country_id";
    private static final String PUBLIC_SELECT = "SELECT " + PUBLIC_COLUMNS + PUBLIC_FROM;
}
