package com.diasporum.backend.events.internal.application.ticketing;

import com.diasporum.backend.events.internal.application.ticketing.TicketFeeCalculator.FeeConfig;
import com.diasporum.backend.events.internal.application.ticketing.TicketingAccess.TicketedEvent;
import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Organiser-side ticketing setup: per-event ticketing settings, ticket type CRUD
 * and promo code CRUD. Inventory columns (quantity_sold / quantity_reserved) are
 * never written here except through guarded conditional updates, so setup edits
 * cannot race checkout into an oversell.
 */
@Service
public class EventTicketingSetupService {

    private static final Set<String> FEE_MODELS = Set.of("BUYER_PAYS", "ORGANISER_ABSORBS", "SPLIT");
    private static final Set<String> REFUND_POLICIES = Set.of("NO_REFUNDS", "ORGANISER_DISCRETION",
            "REFUND_UNTIL_EVENT", "REFUND_UNTIL_CUTOFF");
    private static final Set<String> DISCOUNT_TYPES = Set.of("PERCENTAGE", "FIXED_AMOUNT");

    private static final String TYPE_COLS = "id,event_id,name,description,price_amount,currency_code,"
            + "quantity_total,quantity_sold,quantity_reserved,max_per_order,sales_start_at,"
            + "sales_end_at,sort_order,is_active";
    private static final String PROMO_COLS = "id,event_id,code,discount_type,discount_value,"
            + "currency_code,max_uses,used_count,max_uses_per_user,applicable_ticket_type_ids,"
            + "valid_from,valid_until,is_active";
    private static final String UPDATE_SETTINGS = "UPDATE events SET is_ticketed=?,"
            + "ticket_currency_code=?,ticket_fee_model=?,refund_policy=?,refund_cutoff_hours=?,"
            + "updated_at=now() WHERE id=?";
    private static final String INSERT_TYPE = "INSERT INTO event_ticket_types(event_id,name,"
            + "description,price_amount,currency_code,quantity_total,max_per_order,sales_start_at,"
            + "sales_end_at,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id";
    private static final String RESIZE_TYPE = "UPDATE event_ticket_types SET quantity_total=?,"
            + "updated_at=now() WHERE id=? AND quantity_sold+quantity_reserved<=?";
    private static final String INSERT_PROMO = "INSERT INTO event_ticket_promo_codes(event_id,code,"
            + "discount_type,discount_value,currency_code,max_uses,max_uses_per_user,"
            + "applicable_ticket_type_ids,valid_from,valid_until,created_by_user_id)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING id";

    private final JdbcTemplate jdbc;
    private final TicketingAccess access;
    private final TicketFeeConfigs feeConfigs;

    public EventTicketingSetupService(JdbcTemplate jdbc, TicketingAccess access,
            TicketFeeConfigs feeConfigs) {
        this.jdbc = jdbc;
        this.access = access;
        this.feeConfigs = feeConfigs;
    }

    // =================== records ===================

    public record TicketingSettings(UUID eventId, boolean ticketed, String currencyCode,
            String feeModel, String effectiveFeeModel, String refundPolicy,
            Integer refundCutoffHours) {
    }

    public record SettingsCommand(boolean ticketed, String currencyCode, String feeModel,
            String refundPolicy, Integer refundCutoffHours) {
    }

    public record TicketTypeView(UUID id, UUID eventId, String name, String description,
            BigDecimal priceAmount, String currencyCode, int quantityTotal, int quantitySold,
            int quantityReserved, int quantityAvailable, int maxPerOrder, Instant salesStartAt,
            Instant salesEndAt, int sortOrder, boolean active) {
    }

    public record TicketTypeCommand(String name, String description, BigDecimal priceAmount,
            String currencyCode, Integer quantityTotal, Integer maxPerOrder, Instant salesStartAt,
            Instant salesEndAt, Integer sortOrder, Boolean active) {
    }

    public record PromoCodeView(UUID id, UUID eventId, String code, String discountType,
            BigDecimal discountValue, String currencyCode, Integer maxUses, int usedCount,
            Integer maxUsesPerUser, List<UUID> applicableTicketTypeIds, Instant validFrom,
            Instant validUntil, boolean active) {
    }

    public record PromoCodeCommand(String code, String discountType, BigDecimal discountValue,
            Integer maxUses, Integer maxUsesPerUser, List<UUID> applicableTicketTypeIds,
            Instant validFrom, Instant validUntil, Boolean active) {
    }

    // =================== settings ===================

    @Transactional
    public TicketingSettings updateSettings(UUID actor, UUID eventId, SettingsCommand cmd) {
        TicketedEvent current = access.requireManager(actor, eventId);
        TicketedEvent e = access.lockEvent(current.id());
        if ("DELETED".equals(e.status()) || e.cancelled()) {
            throw conflict("EVENT_NOT_EDITABLE");
        }
        // Omitted currency keeps the current one (never cleared once set).
        String currency = cmd.currencyCode() == null ? e.currencyCode()
                : cmd.currencyCode().trim().toUpperCase();
        if (cmd.ticketed() && currency == null) {
            throw bad("TICKET_CURRENCY_REQUIRED");
        }
        if (currency != null) {
            TicketMoney.digits(currency);
        }
        if (cmd.feeModel() != null && !FEE_MODELS.contains(cmd.feeModel())) {
            throw bad("TICKET_FEE_MODEL_INVALID");
        }
        String policy = cmd.refundPolicy() == null ? e.refundPolicy() : cmd.refundPolicy();
        if (!REFUND_POLICIES.contains(policy)) {
            throw bad("REFUND_POLICY_INVALID");
        }
        Integer cutoff = cmd.refundCutoffHours();
        if ("REFUND_UNTIL_CUTOFF".equals(policy) && (cutoff == null || cutoff <= 0)) {
            throw bad("REFUND_CUTOFF_REQUIRED");
        }
        if (!"REFUND_UNTIL_CUTOFF".equals(policy)) {
            cutoff = null;
        }
        if (currency != null && e.currencyCode() != null && !currency.equals(e.currencyCode())) {
            Integer types = jdbc.queryForObject("SELECT count(*) FROM event_ticket_types"
                    + " WHERE event_id=?", Integer.class, eventId);
            if (types != null && types > 0) {
                throw conflict("TICKET_CURRENCY_LOCKED");
            }
        }
        FeeConfig config = feeConfigs.forEvent(e);
        String effective = cmd.feeModel() != null ? cmd.feeModel() : config.feeModel();
        if ("SPLIT".equals(effective) && config.organiserSplitBps() == null) {
            throw conflict("TICKET_FEE_SPLIT_UNCONFIGURED");
        }
        jdbc.update(UPDATE_SETTINGS, cmd.ticketed(), currency, cmd.feeModel(), policy, cutoff,
                eventId);
        return settings(actor, eventId);
    }

    @Transactional(readOnly = true)
    public TicketingSettings settings(UUID actor, UUID eventId) {
        TicketedEvent e = access.requireManager(actor, eventId);
        String effective = e.feeModel() != null ? e.feeModel() : feeConfigs.forEvent(e).feeModel();
        return new TicketingSettings(e.id(), e.ticketed(), e.currencyCode(), e.feeModel(),
                effective, e.refundPolicy(), e.refundCutoffHours());
    }

    // =================== ticket types ===================

    @Transactional(readOnly = true)
    public List<TicketTypeView> ticketTypes(UUID actor, UUID eventId) {
        access.requireManager(actor, eventId);
        return jdbc.query("SELECT " + TYPE_COLS + " FROM event_ticket_types WHERE event_id=?"
                + " ORDER BY sort_order,created_at", (rs, i) -> mapType(rs), eventId);
    }

    /** Buyer-facing list: active types of a ticketed, published event. */
    @Transactional(readOnly = true)
    public List<TicketTypeView> publicTicketTypes(UUID eventId) {
        TicketedEvent e = access.requireEvent(eventId);
        if (!e.ticketed() || !"PUBLISHED".equals(e.status()) || e.cancelled()) {
            return List.of();
        }
        return jdbc.query("SELECT " + TYPE_COLS + " FROM event_ticket_types WHERE event_id=?"
                + " AND is_active ORDER BY sort_order,created_at", (rs, i) -> mapType(rs), eventId);
    }

    @Transactional
    public TicketTypeView createTicketType(UUID actor, UUID eventId, TicketTypeCommand cmd) {
        TicketedEvent e = access.requireManager(actor, eventId);
        if (!e.ticketed() || e.currencyCode() == null) {
            throw conflict("EVENT_NOT_TICKETED");
        }
        if (e.cancelled() || "DELETED".equals(e.status())) {
            throw conflict("EVENT_NOT_EDITABLE");
        }
        if (cmd.currencyCode() != null && !cmd.currencyCode().trim().equalsIgnoreCase(e.currencyCode())) {
            throw bad("TICKET_CURRENCY_MISMATCH");
        }
        String name = requireName(cmd.name());
        BigDecimal price = requirePrice(cmd.priceAmount(), e.currencyCode());
        if (cmd.quantityTotal() == null || cmd.quantityTotal() <= 0) {
            throw bad("TICKET_QUANTITY_INVALID");
        }
        int maxPerOrder = cmd.maxPerOrder() == null ? 10 : cmd.maxPerOrder();
        if (maxPerOrder < 1) {
            throw bad("MAX_PER_ORDER_INVALID");
        }
        Instant start = cmd.salesStartAt() == null ? Instant.now() : cmd.salesStartAt();
        Instant end = cmd.salesEndAt() == null ? e.startsAt() : cmd.salesEndAt();
        if (end == null || !end.isAfter(start)) {
            throw bad("SALES_WINDOW_INVALID");
        }
        try {
            UUID id = jdbc.queryForObject(INSERT_TYPE, UUID.class, eventId, name, cmd.description(),
                    price, e.currencyCode(), cmd.quantityTotal(), maxPerOrder, ts(start), ts(end),
                    cmd.sortOrder() == null ? 0 : cmd.sortOrder());
            return requireType(eventId, id);
        } catch (DataIntegrityViolationException ex) {
            throw translate(ex, "TICKET_CURRENCY_MISMATCH");
        }
    }

    @Transactional
    public TicketTypeView updateTicketType(UUID actor, UUID eventId, UUID typeId,
            TicketTypeCommand cmd) {
        TicketedEvent e = access.requireManager(actor, eventId);
        TicketTypeView current = jdbc.query("SELECT " + TYPE_COLS + " FROM event_ticket_types"
                + " WHERE id=? AND event_id=? FOR UPDATE", rs -> rs.next() ? mapType(rs) : null,
                typeId, eventId);
        if (current == null) {
            throw notFound("TICKET_TYPE_NOT_FOUND");
        }
        if (cmd.currencyCode() != null && !cmd.currencyCode().trim().equalsIgnoreCase(e.currencyCode())) {
            throw bad("TICKET_CURRENCY_MISMATCH");
        }
        String name = cmd.name() == null ? current.name() : requireName(cmd.name());
        BigDecimal price = cmd.priceAmount() == null ? current.priceAmount()
                : requirePrice(cmd.priceAmount(), current.currencyCode());
        int maxPerOrder = cmd.maxPerOrder() == null ? current.maxPerOrder() : cmd.maxPerOrder();
        if (maxPerOrder < 1) {
            throw bad("MAX_PER_ORDER_INVALID");
        }
        Instant start = cmd.salesStartAt() == null ? current.salesStartAt() : cmd.salesStartAt();
        Instant end = cmd.salesEndAt() == null ? current.salesEndAt() : cmd.salesEndAt();
        if (!end.isAfter(start)) {
            throw bad("SALES_WINDOW_INVALID");
        }
        if (cmd.quantityTotal() != null && cmd.quantityTotal() != current.quantityTotal()) {
            if (cmd.quantityTotal() <= 0) {
                throw bad("TICKET_QUANTITY_INVALID");
            }
            if (jdbc.update(RESIZE_TYPE, cmd.quantityTotal(), typeId, cmd.quantityTotal()) == 0) {
                throw conflict("TICKET_QUANTITY_BELOW_SOLD");
            }
        }
        jdbc.update("UPDATE event_ticket_types SET name=?,description=?,price_amount=?,"
                + "max_per_order=?,sales_start_at=?,sales_end_at=?,sort_order=?,is_active=?,"
                + "updated_at=now() WHERE id=?", name,
                cmd.description() == null ? current.description() : cmd.description(), price,
                maxPerOrder, ts(start), ts(end),
                cmd.sortOrder() == null ? current.sortOrder() : cmd.sortOrder(),
                cmd.active() == null ? current.active() : cmd.active(), typeId);
        return requireType(eventId, typeId);
    }

    /** Hard-deletes an unused type; a type with any reservation or sale is deactivated. */
    @Transactional
    public boolean deleteTicketType(UUID actor, UUID eventId, UUID typeId) {
        access.requireManager(actor, eventId);
        requireType(eventId, typeId);
        Integer used = jdbc.queryForObject("SELECT (SELECT count(*) FROM ticket_reservations"
                + " WHERE ticket_type_id=?)+(SELECT count(*) FROM ticket_order_items"
                + " WHERE ticket_type_id=?)", Integer.class, typeId, typeId);
        if (used != null && used > 0) {
            jdbc.update("UPDATE event_ticket_types SET is_active=false,updated_at=now()"
                    + " WHERE id=?", typeId);
            return false;
        }
        jdbc.update("DELETE FROM event_ticket_types WHERE id=?", typeId);
        return true;
    }

    TicketTypeView requireType(UUID eventId, UUID typeId) {
        TicketTypeView v = jdbc.query("SELECT " + TYPE_COLS + " FROM event_ticket_types"
                + " WHERE id=? AND event_id=?", rs -> rs.next() ? mapType(rs) : null, typeId, eventId);
        if (v == null) {
            throw notFound("TICKET_TYPE_NOT_FOUND");
        }
        return v;
    }

    // =================== promo codes ===================

    @Transactional(readOnly = true)
    public List<PromoCodeView> promoCodes(UUID actor, UUID eventId) {
        access.requireManager(actor, eventId);
        return jdbc.query("SELECT " + PROMO_COLS + " FROM event_ticket_promo_codes WHERE event_id=?"
                + " ORDER BY created_at", (rs, i) -> mapPromo(rs), eventId);
    }

    @Transactional
    public PromoCodeView createPromoCode(UUID actor, UUID eventId, PromoCodeCommand cmd) {
        TicketedEvent e = access.requireManager(actor, eventId);
        if (!e.ticketed() || e.currencyCode() == null) {
            throw conflict("EVENT_NOT_TICKETED");
        }
        String code = cmd.code() == null ? "" : cmd.code().trim().toUpperCase();
        if (code.length() < 2 || code.length() > 50) {
            throw bad("PROMO_CODE_FORMAT_INVALID");
        }
        if (!DISCOUNT_TYPES.contains(cmd.discountType())) {
            throw bad("PROMO_DISCOUNT_TYPE_INVALID");
        }
        validateDiscount(cmd.discountType(), cmd.discountValue(), e.currencyCode());
        validateLimits(cmd.maxUses(), cmd.maxUsesPerUser());
        Instant from = cmd.validFrom() == null ? Instant.now() : cmd.validFrom();
        if (cmd.validUntil() != null && !cmd.validUntil().isAfter(from)) {
            throw bad("PROMO_WINDOW_INVALID");
        }
        String currency = "FIXED_AMOUNT".equals(cmd.discountType()) ? e.currencyCode() : null;
        try {
            UUID id = jdbc.queryForObject(INSERT_PROMO, UUID.class, eventId, code,
                    cmd.discountType(), cmd.discountValue(), currency, cmd.maxUses(),
                    cmd.maxUsesPerUser(), uuidArray(cmd.applicableTicketTypeIds()), ts(from),
                    ts(cmd.validUntil()), actor);
            return requirePromo(eventId, id);
        } catch (DuplicateKeyException ex) {
            throw conflict("PROMO_CODE_EXISTS");
        } catch (DataIntegrityViolationException ex) {
            throw translate(ex, "PROMO_TICKET_TYPE_INVALID");
        }
    }

    @Transactional
    public PromoCodeView updatePromoCode(UUID actor, UUID eventId, UUID promoId,
            PromoCodeCommand cmd) {
        TicketedEvent e = access.requireManager(actor, eventId);
        PromoCodeView current = jdbc.query("SELECT " + PROMO_COLS + " FROM event_ticket_promo_codes"
                + " WHERE id=? AND event_id=? FOR UPDATE", rs -> rs.next() ? mapPromo(rs) : null,
                promoId, eventId);
        if (current == null) {
            throw notFound("PROMO_CODE_NOT_FOUND");
        }
        BigDecimal value = cmd.discountValue() == null ? current.discountValue() : cmd.discountValue();
        validateDiscount(current.discountType(), value, e.currencyCode());
        Integer maxUses = cmd.maxUses() == null ? current.maxUses() : cmd.maxUses();
        Integer perUser = cmd.maxUsesPerUser() == null ? current.maxUsesPerUser() : cmd.maxUsesPerUser();
        validateLimits(maxUses, perUser);
        if (maxUses != null && maxUses < current.usedCount()) {
            throw conflict("PROMO_MAX_USES_BELOW_USED");
        }
        Instant from = cmd.validFrom() == null ? current.validFrom() : cmd.validFrom();
        Instant until = cmd.validUntil() == null ? current.validUntil() : cmd.validUntil();
        if (until != null && !until.isAfter(from)) {
            throw bad("PROMO_WINDOW_INVALID");
        }
        List<UUID> types = cmd.applicableTicketTypeIds() == null
                ? current.applicableTicketTypeIds() : cmd.applicableTicketTypeIds();
        try {
            jdbc.update("UPDATE event_ticket_promo_codes SET discount_value=?,max_uses=?,"
                    + "max_uses_per_user=?,applicable_ticket_type_ids=?,valid_from=?,valid_until=?,"
                    + "is_active=?,updated_at=now() WHERE id=?", value, maxUses, perUser,
                    uuidArray(types), ts(from), ts(until),
                    cmd.active() == null ? current.active() : cmd.active(), promoId);
        } catch (DataIntegrityViolationException ex) {
            throw translate(ex, "PROMO_TICKET_TYPE_INVALID");
        }
        return requirePromo(eventId, promoId);
    }

    /** Hard-deletes an unused code; a used code is deactivated (orders keep the reference). */
    @Transactional
    public boolean deletePromoCode(UUID actor, UUID eventId, UUID promoId) {
        access.requireManager(actor, eventId);
        PromoCodeView p = requirePromo(eventId, promoId);
        Integer orders = jdbc.queryForObject("SELECT count(*) FROM ticket_orders"
                + " WHERE promo_code_id=?", Integer.class, promoId);
        if (p.usedCount() > 0 || (orders != null && orders > 0)) {
            jdbc.update("UPDATE event_ticket_promo_codes SET is_active=false,updated_at=now()"
                    + " WHERE id=?", promoId);
            return false;
        }
        jdbc.update("DELETE FROM event_ticket_promo_codes WHERE id=?", promoId);
        return true;
    }

    private PromoCodeView requirePromo(UUID eventId, UUID promoId) {
        PromoCodeView v = jdbc.query("SELECT " + PROMO_COLS + " FROM event_ticket_promo_codes"
                + " WHERE id=? AND event_id=?", rs -> rs.next() ? mapPromo(rs) : null, promoId, eventId);
        if (v == null) {
            throw notFound("PROMO_CODE_NOT_FOUND");
        }
        return v;
    }

    // =================== helpers ===================

    private static void validateDiscount(String type, BigDecimal value, String currency) {
        if (value == null || value.signum() <= 0) {
            throw bad("PROMO_DISCOUNT_INVALID");
        }
        if ("PERCENTAGE".equals(type) && value.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw bad("PROMO_DISCOUNT_INVALID");
        }
        if ("FIXED_AMOUNT".equals(type) && !TicketMoney.representable(value, currency)) {
            throw bad("PROMO_DISCOUNT_INVALID");
        }
    }

    private static void validateLimits(Integer maxUses, Integer perUser) {
        if (maxUses != null && maxUses <= 0 || perUser != null && perUser <= 0) {
            throw bad("PROMO_LIMIT_INVALID");
        }
    }

    private static String requireName(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty() || n.length() > 150) {
            throw bad("TICKET_TYPE_NAME_INVALID");
        }
        return n;
    }

    private static BigDecimal requirePrice(BigDecimal price, String currency) {
        if (price == null || price.signum() < 0 || !TicketMoney.representable(price, currency)
                || price.compareTo(new BigDecimal("9999999999.99")) > 0) {
            throw bad("TICKET_PRICE_INVALID");
        }
        return price.setScale(2);
    }

    private Array uuidArray(List<UUID> ids) {
        if (ids == null) {
            return null;
        }
        return jdbc.execute((ConnectionCallback<Array>) c -> c.createArrayOf("uuid", ids.toArray()));
    }

    static ResponseStatusException translate(DataIntegrityViolationException ex, String checkCode) {
        Throwable root = ex.getMostSpecificCause();
        if (root instanceof SQLException sql && "23514".equals(sql.getSQLState())) {
            return conflict(checkCode);
        }
        return conflict("TICKETING_CONSTRAINT_VIOLATION");
    }

    private static TicketTypeView mapType(ResultSet rs) throws SQLException {
        int total = rs.getInt("quantity_total");
        int sold = rs.getInt("quantity_sold");
        int reserved = rs.getInt("quantity_reserved");
        return new TicketTypeView(rs.getObject("id", UUID.class), rs.getObject("event_id", UUID.class),
                rs.getString("name"), rs.getString("description"), rs.getBigDecimal("price_amount"),
                rs.getString("currency_code").trim(), total, sold, reserved,
                Math.max(0, total - sold - reserved), rs.getInt("max_per_order"),
                rs.getTimestamp("sales_start_at").toInstant(),
                rs.getTimestamp("sales_end_at").toInstant(), rs.getInt("sort_order"),
                rs.getBoolean("is_active"));
    }

    private static PromoCodeView mapPromo(ResultSet rs) throws SQLException {
        int max = rs.getInt("max_uses");
        Integer maxUses = rs.wasNull() ? null : max;
        int per = rs.getInt("max_uses_per_user");
        Integer perUser = rs.wasNull() ? null : per;
        Array arr = rs.getArray("applicable_ticket_type_ids");
        List<UUID> ids = null;
        if (arr != null) {
            ids = new ArrayList<>();
            for (Object o : (Object[]) arr.getArray()) {
                ids.add((UUID) o);
            }
        }
        String currency = rs.getString("currency_code");
        Timestamp until = rs.getTimestamp("valid_until");
        return new PromoCodeView(rs.getObject("id", UUID.class), rs.getObject("event_id", UUID.class),
                rs.getString("code"), rs.getString("discount_type"), rs.getBigDecimal("discount_value"),
                currency == null ? null : currency.trim(), maxUses, rs.getInt("used_count"), perUser,
                ids, rs.getTimestamp("valid_from").toInstant(),
                until == null ? null : until.toInstant(), rs.getBoolean("is_active"));
    }

    static Timestamp ts(Instant i) {
        return i == null ? null : Timestamp.from(i);
    }

    static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    static ResponseStatusException conflict(String code) {
        return new ResponseStatusException(HttpStatus.CONFLICT, code);
    }

    static ResponseStatusException notFound(String code) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, code);
    }

    static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }
}
