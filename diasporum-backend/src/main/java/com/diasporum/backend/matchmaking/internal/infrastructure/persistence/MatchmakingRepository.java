package com.diasporum.backend.matchmaking.internal.infrastructure.persistence;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.HistorySwipe;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchPageRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.MatchRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceCommand;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PreferenceView;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.ProfileCommand;
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
                + "photo_media_id,blurred_photo_media_id,name_visibility,photo_visibility,"
                + "anonymous_alias,status,activated_at,last_active_at) VALUES(?,?,?,?,?,?,?,"
                + "?,?,?,?,?,?,?,"
                + "?,?,?,?,?,?,?,"
                + "?::matchmaking_field_visibility,?::matchmaking_field_visibility,"
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
                + "photo_media_id=EXCLUDED.photo_media_id,blurred_photo_media_id=EXCLUDED.blurred_photo_media_id,"
                + "name_visibility=EXCLUDED.name_visibility,photo_visibility=EXCLUDED.photo_visibility,"
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
                c.religionImportance(), c.willingToRelocate(), c.photoMediaId(),
                c.blurredPhotoMediaId(), c.nameVisibility(), c.photoVisibility(),
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
                        rs.getString("wants_children_preference"), genderKeys(userId),
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
        jdbc.update("DELETE FROM matchmaking_preference_genders WHERE user_id=?", userId);
        jdbc.update("DELETE FROM matchmaking_preference_religions WHERE user_id=?", userId);
        jdbc.update("DELETE FROM matchmaking_preference_languages WHERE user_id=?", userId);
        for (String gender : c.genderKeys()) {
            jdbc.update("INSERT INTO matchmaking_preference_genders(user_id,gender_key) VALUES(?,?)",
                    userId, gender);
        }
        for (UUID religion : c.religionIds()) {
            jdbc.update("INSERT INTO matchmaking_preference_religions(user_id,religion_id) VALUES(?,?)",
                    userId, religion);
        }
        for (UUID language : c.languageIds()) {
            jdbc.update("INSERT INTO matchmaking_preference_languages(user_id,language_id) VALUES(?,?)",
                    userId, language);
        }
    }

    private List<String> genderKeys(UUID userId) {
        return jdbc.queryForList("SELECT gender_key FROM matchmaking_preference_genders"
                + " WHERE user_id=? ORDER BY gender_key", String.class, userId);
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

    public boolean adult(UUID userId) {
        return bool("SELECT matchmaking_account_is_adult(?)", userId);
    }

    public boolean eligible(UUID userId) {
        return bool("SELECT matchmaking_user_is_eligible(?)", userId);
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

    public List<PublicProfileRow> discover(UUID actor, UUID after, int limit) {
        String sql = PUBLIC_SELECT + " WHERE mp.user_id>? AND mp.user_id<>?"
                + " AND matchmaking_user_is_eligible(?)"
                + " AND matchmaking_users_compatible(?,mp.user_id)"
                + " AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE"
                + " (b.blocker_user_id=? AND b.blocked_user_id=mp.user_id)"
                + " OR (b.blocker_user_id=mp.user_id AND b.blocked_user_id=?))"
                + " AND NOT EXISTS(SELECT 1 FROM matchmaking_swipes s"
                + " WHERE s.swiper_user_id=? AND s.target_user_id=mp.user_id)"
                + " AND NOT EXISTS(SELECT 1 FROM matchmaking_matches m"
                + " WHERE m.user_a_id=least(?::uuid,mp.user_id)"
                + " AND m.user_b_id=greatest(?::uuid,mp.user_id))"
                + " ORDER BY mp.user_id LIMIT ?";
        return jdbc.query(sql, (rs, row) -> publicProfile(rs, row),
                after == null ? ZERO_UUID : after, actor, actor, actor, actor, actor, actor,
                actor, actor, limit);
    }

    public Optional<PublicProfileRow> publicProfile(UUID userId) {
        return jdbc.query(PUBLIC_SELECT + " WHERE mp.user_id=?",
                (rs, row) -> publicProfile(rs, row), userId).stream().findFirst();
    }

    public List<PublicProfileRow> receivedLikes(UUID actor, UUID after, int limit) {
        String sql = PUBLIC_SELECT + " JOIN matchmaking_swipes s ON s.swiper_user_id=mp.user_id"
                + " AND s.target_user_id=? AND s.action='LIKE' AND s.status='ACTIVE'"
                + " WHERE mp.user_id>? AND matchmaking_user_is_eligible(?)"
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
                actor, actor, actor, actor, actor, actor, limit);
    }

    public Optional<SwipeRow> swipe(UUID actor, UUID target) {
        return jdbc.query("SELECT * FROM matchmaking_swipes WHERE swiper_user_id=?"
                        + " AND target_user_id=?", (rs, row) -> swipe(rs, row), actor, target)
                .stream().findFirst();
    }

    public UUID insertSwipe(UUID actor, UUID target, String action) {
        jdbc.update("INSERT INTO matchmaking_swipes(swiper_user_id,target_user_id,action,status)"
                + " VALUES(?,?,?::matchmaking_swipe_action,'ACTIVE')", actor, target, action);
        return jdbc.queryForObject("INSERT INTO matchmaking_swipe_history(swiper_user_id,"
                + "target_user_id,event_type,action) VALUES(?,?,'SWIPE',?::matchmaking_swipe_action)"
                + " RETURNING id", UUID.class, actor, target, action);
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
                + " OR (m.user_b_id=? AND m.user_a_id=mp.user_id)) WHERE true" + cursor
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
                        + " ORDER BY h.created_at DESC,h.id DESC LIMIT 1 FOR UPDATE OF h,s",
                (rs, row) -> historySwipe(rs, row), actor).stream().findFirst();
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

    public int invalidGenders(Collection<String> values) {
        if (values.isEmpty()) return 0;
        String ph = placeholders(values.size());
        return count("SELECT count(*) FROM (SELECT DISTINCT value FROM unnest(ARRAY[" + ph + "]::text[])"
                + " AS value) v LEFT JOIN matchmaking_genders g ON g.gender_key=v.value"
                + " AND g.is_active=true WHERE g.gender_key IS NULL", values.toArray());
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
                rs.getObject("photo_media_id", UUID.class), rs.getObject("blurred_photo_media_id", UUID.class),
                rs.getString("name_visibility"), rs.getString("photo_visibility"),
                rs.getString("anonymous_alias"), rs.getString("verification_status"),
                rs.getString("status"), instant(rs, "activated_at"), instant(rs, "last_active_at"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
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
                rs.getObject("public_photo_media_id", UUID.class), rs.getString("gender_key"),
                rs.getObject("age", Integer.class), rs.getObject("nationality_country_id", UUID.class),
                rs.getObject("religion_id", UUID.class), rs.getString("education_level"),
                rs.getString("occupation"), rs.getString("relationship_intention"),
                rs.getString("marital_status"), rs.getObject("has_children", Boolean.class),
                rs.getString("wants_children"), rs.getString("smoking"), rs.getString("drinking"),
                rs.getString("activity_level"), rs.getObject("height_cm", Integer.class),
                rs.getString("marriage_timeline"), rs.getObject("long_distance_relationship", Boolean.class),
                rs.getString("religion_importance"), rs.getObject("willing_to_relocate", Boolean.class),
                rs.getString("verification_status"));
    }

    private static final String PUBLIC_COLUMNS = "mp.user_id,"
            + " CASE WHEN mp.name_visibility='VISIBLE' THEN p.display_name"
            + " ELSE mp.anonymous_alias END AS display_name,"
            + " CASE WHEN mp.photo_visibility='VISIBLE' THEN op.id"
            + " WHEN mp.photo_visibility='BLURRED' THEN bp.id ELSE NULL END AS public_photo_media_id,"
            + " mp.gender_key,extract(year FROM age(current_date,p.date_of_birth))::integer AS age,"
            + " mp.nationality_country_id,mp.religion_id,mp.education_level,mp.occupation,"
            + " mp.relationship_intention,mp.marital_status,mp.has_children,mp.wants_children,"
            + " mp.smoking,mp.drinking,mp.activity_level,mp.height_cm,mp.marriage_timeline,"
            + " mp.long_distance_relationship,mp.religion_importance,mp.willing_to_relocate,"
            + " mp.verification_status";
    private static final String PUBLIC_FROM = " FROM matchmaking_profiles mp"
            + " JOIN profiles p ON p.id=mp.user_id"
            + " LEFT JOIN media_objects op ON op.id=mp.photo_media_id AND op.status='READY'"
            + " LEFT JOIN media_objects bp ON bp.id=mp.blurred_photo_media_id AND bp.status='READY'";
    private static final String PUBLIC_SELECT = "SELECT " + PUBLIC_COLUMNS + PUBLIC_FROM;
}
