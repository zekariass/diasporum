package com.diasporum.backend.events.internal.application.ticketing;

import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.bad;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.conflict;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.forbidden;
import static com.diasporum.backend.events.internal.application.ticketing.EventTicketingSetupService.notFound;

import com.diasporum.backend.events.internal.infrastructure.crypto.PayoutDataCipher;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Organiser payout destinations for manual transfers. Inputs are validated
 * against {@code payout_account_field_requirements} for (country, method):
 * every required field present, no unknown fields, every value matching its
 * pattern. Sensitive values (iban, account_number, mobile_money_phone and the
 * bank_details / other_details maps) are AES-GCM encrypted before they touch
 * the database and are masked in every organiser response; only platform admins
 * (who perform the transfer) see clear values. Any edit resets verification.
 */
@Service
public class PayoutAccountService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> METHODS = Set.of("BANK_ACCOUNT", "MOBILE_MONEY", "OTHER");
    private static final String COLS = "id,organiser_user_id,business_account_id,payout_method,"
            + "country_id,currency_code,account_holder_name,bank_name,iban,account_number,"
            + "bank_details::text AS bank_details,mobile_money_provider,mobile_money_phone,"
            + "other_details::text AS other_details,verification_status,verified_at,"
            + "verification_notes,is_default,created_at";
    private static final String INSERT = "INSERT INTO event_organiser_payout_accounts("
            + "organiser_user_id,business_account_id,payout_method,country_id,currency_code,"
            + "account_holder_name,bank_name,iban,account_number,bank_details,mobile_money_provider,"
            + "mobile_money_phone,other_details,is_default) VALUES(?,?,?,?,?,?,?,?,?,?::jsonb,?,?,"
            + "?::jsonb,?) RETURNING id";
    private static final String UPDATE = "UPDATE event_organiser_payout_accounts SET payout_method=?,"
            + "country_id=?,currency_code=?,account_holder_name=?,bank_name=?,iban=?,account_number=?,"
            + "bank_details=?::jsonb,mobile_money_provider=?,mobile_money_phone=?,"
            + "other_details=?::jsonb,is_default=?,verification_status='PENDING',verified_at=NULL,"
            + "verified_by_user_id=NULL,verification_notes=NULL,updated_at=now() WHERE id=?";

    private final JdbcTemplate jdbc;
    private final TicketingAccess access;
    private final PayoutDataCipher cipher;

    public PayoutAccountService(JdbcTemplate jdbc, TicketingAccess access, PayoutDataCipher cipher) {
        this.jdbc = jdbc;
        this.access = access;
        this.cipher = cipher;
    }

    public record AccountCommand(UUID businessAccountId, String payoutMethod, UUID countryId,
            String currencyCode, String accountHolderName, String bankName, String iban,
            String accountNumber, Map<String, String> bankDetails, String mobileMoneyProvider,
            String mobileMoneyPhone, Map<String, String> otherDetails, Boolean isDefault) {
    }

    /** Organiser-facing (masked) or admin-facing (clear) representation. */
    public record AccountView(UUID id, UUID organiserUserId, UUID businessAccountId,
            String payoutMethod, UUID countryId, String currencyCode, String accountHolderName,
            String bankName, String iban, String accountNumber, Map<String, String> bankDetails,
            String mobileMoneyProvider, String mobileMoneyPhone, Map<String, String> otherDetails,
            String verificationStatus, Instant verifiedAt, String verificationNotes,
            boolean isDefault, Instant createdAt, boolean masked) {
    }

    public record FieldRequirement(String payoutMethod, List<String> requiredFields,
            List<String> optionalFields, Map<String, Object> fieldLabels,
            Map<String, Object> fieldPatterns) {
    }

    private record Stored(UUID id, UUID userId, UUID businessId, String method, UUID countryId,
            String currency, String holder, String bankName, String iban, String accountNumber,
            String bankDetails, String mmProvider, String mmPhone, String otherDetails,
            String status, Instant verifiedAt, String notes, boolean isDefault, Instant createdAt) {
    }

    // =================== requirements ===================

    @Transactional(readOnly = true)
    public List<FieldRequirement> requirements(UUID countryId) {
        return jdbc.query("SELECT payout_method,required_fields,optional_fields,field_labels::text,"
                + "field_patterns::text FROM payout_account_field_requirements WHERE country_id=?"
                + " AND is_active ORDER BY payout_method", (rs, i) -> new FieldRequirement(
                        rs.getString(1), strings(rs.getArray(2)), strings(rs.getArray(3)),
                        json(rs.getString(4)), json(rs.getString(5))), countryId);
    }

    // =================== organiser CRUD ===================

    @Transactional(readOnly = true)
    public List<AccountView> list(UUID actor, UUID businessAccountId) {
        List<Stored> rows;
        if (businessAccountId != null) {
            requireBusinessFinance(actor, businessAccountId);
            rows = jdbc.query("SELECT " + COLS + " FROM event_organiser_payout_accounts"
                    + " WHERE business_account_id=? ORDER BY created_at", (rs, i) -> map(rs),
                    businessAccountId);
        } else {
            rows = jdbc.query("SELECT " + COLS + " FROM event_organiser_payout_accounts"
                    + " WHERE organiser_user_id=? ORDER BY created_at", (rs, i) -> map(rs), actor);
        }
        return rows.stream().map(s -> view(s, true)).toList();
    }

    @Transactional
    public AccountView create(UUID actor, AccountCommand cmd) {
        UUID userOwner = null;
        if (cmd.businessAccountId() != null) {
            requireBusinessFinance(actor, cmd.businessAccountId());
        } else {
            userOwner = actor;
        }
        Validated v = validate(cmd);
        boolean makeDefault = Boolean.TRUE.equals(cmd.isDefault());
        if (makeDefault) {
            clearDefault(userOwner, cmd.businessAccountId(), null);
        }
        try {
            UUID id = jdbc.queryForObject(INSERT, UUID.class, userOwner, cmd.businessAccountId(),
                    v.method, cmd.countryId(), v.currency, v.holder, v.bankName, v.iban,
                    v.accountNumber, v.bankDetails, v.mmProvider, v.mmPhone, v.otherDetails,
                    makeDefault);
            return view(load(id), true);
        } catch (DataIntegrityViolationException ex) {
            throw bad("PAYOUT_ACCOUNT_FIELDS_INVALID");
        }
    }

    @Transactional
    public AccountView update(UUID actor, UUID accountId, AccountCommand cmd) {
        Stored s = requireOwned(actor, accountId, true);
        Validated v = validate(new AccountCommand(s.businessId(), cmd.payoutMethod(),
                cmd.countryId(), cmd.currencyCode(), cmd.accountHolderName(), cmd.bankName(),
                cmd.iban(), cmd.accountNumber(), cmd.bankDetails(), cmd.mobileMoneyProvider(),
                cmd.mobileMoneyPhone(), cmd.otherDetails(), cmd.isDefault()));
        boolean makeDefault = cmd.isDefault() == null ? s.isDefault() : cmd.isDefault();
        if (makeDefault) {
            clearDefault(s.userId(), s.businessId(), accountId);
        }
        try {
            jdbc.update(UPDATE, v.method, cmd.countryId(), v.currency, v.holder, v.bankName, v.iban,
                    v.accountNumber, v.bankDetails, v.mmProvider, v.mmPhone, v.otherDetails,
                    makeDefault, accountId);
        } catch (DataIntegrityViolationException ex) {
            throw bad("PAYOUT_ACCOUNT_FIELDS_INVALID");
        }
        return view(load(accountId), true);
    }

    @Transactional
    public void delete(UUID actor, UUID accountId) {
        requireOwned(actor, accountId, true);
        Integer used = jdbc.queryForObject("SELECT count(*) FROM ticket_organiser_payouts"
                + " WHERE payout_account_id=?", Integer.class, accountId);
        if (used != null && used > 0) {
            throw conflict("PAYOUT_ACCOUNT_IN_USE");
        }
        jdbc.update("DELETE FROM event_organiser_payout_accounts WHERE id=?", accountId);
    }

    // =================== admin ===================

    @Transactional(readOnly = true)
    public List<AccountView> adminList(UUID actor, String status) {
        access.requirePlatformAdmin(actor);
        String filter = status == null || status.isBlank() ? "" : " WHERE verification_status=?";
        Object[] args = filter.isEmpty() ? new Object[0] : new Object[]{status.trim().toUpperCase()};
        return jdbc.query("SELECT " + COLS + " FROM event_organiser_payout_accounts" + filter
                + " ORDER BY created_at LIMIT 500", (rs, i) -> view(map(rs), false), args);
    }

    @Transactional
    public AccountView adminVerify(UUID actor, UUID accountId, boolean verified, String notes) {
        access.requirePlatformAdmin(actor);
        load(accountId);
        jdbc.update("UPDATE event_organiser_payout_accounts SET verification_status=?,"
                + "verified_at=CASE WHEN ? THEN now() END,verified_by_user_id=?,"
                + "verification_notes=?,updated_at=now() WHERE id=?",
                verified ? "VERIFIED" : "REJECTED", verified, actor, notes, accountId);
        return view(load(accountId), false);
    }

    /** Clear view for the transfer step (admin only). */
    @Transactional(readOnly = true)
    public AccountView adminView(UUID actor, UUID accountId) {
        access.requirePlatformAdmin(actor);
        return view(load(accountId), false);
    }

    // =================== internals ===================

    Stored load(UUID id) {
        Stored s = jdbc.query("SELECT " + COLS + " FROM event_organiser_payout_accounts WHERE id=?",
                rs -> rs.next() ? map(rs) : null, id);
        if (s == null) {
            throw notFound("PAYOUT_ACCOUNT_NOT_FOUND");
        }
        return s;
    }

    /** Ownership + verification facts used by payout requests/approval. */
    record AccountFacts(UUID organiserUserId, UUID businessAccountId, String verificationStatus) {
    }

    AccountFacts facts(UUID accountId) {
        Stored s = load(accountId);
        return new AccountFacts(s.userId(), s.businessId(), s.status());
    }

    private Stored requireOwned(UUID actor, UUID accountId, boolean lock) {
        Stored s = jdbc.query("SELECT " + COLS + " FROM event_organiser_payout_accounts WHERE id=?"
                + (lock ? " FOR UPDATE" : ""), rs -> rs.next() ? map(rs) : null, accountId);
        if (s == null) {
            throw notFound("PAYOUT_ACCOUNT_NOT_FOUND");
        }
        if (s.businessId() != null) {
            requireBusinessFinance(actor, s.businessId());
        } else if (!actor.equals(s.userId())) {
            throw notFound("PAYOUT_ACCOUNT_NOT_FOUND");
        }
        return s;
    }

    private void requireBusinessFinance(UUID actor, UUID businessAccountId) {
        if (!access.canManageBusinessFinances(actor, businessAccountId)) {
            throw forbidden("BUSINESS_FINANCE_ROLE_REQUIRED");
        }
    }

    private void clearDefault(UUID userId, UUID businessId, UUID except) {
        if (businessId != null) {
            jdbc.update("UPDATE event_organiser_payout_accounts SET is_default=false,updated_at=now()"
                    + " WHERE business_account_id=? AND is_default AND id IS DISTINCT FROM ?",
                    businessId, except);
        } else {
            jdbc.update("UPDATE event_organiser_payout_accounts SET is_default=false,updated_at=now()"
                    + " WHERE organiser_user_id=? AND is_default AND id IS DISTINCT FROM ?",
                    userId, except);
        }
    }

    private record Validated(String method, String currency, String holder, String bankName,
            String iban, String accountNumber, String bankDetails, String mmProvider,
            String mmPhone, String otherDetails) {
    }

    private Validated validate(AccountCommand cmd) {
        if (!METHODS.contains(cmd.payoutMethod())) {
            throw bad("PAYOUT_METHOD_INVALID");
        }
        if (cmd.countryId() == null) {
            throw bad("PAYOUT_COUNTRY_REQUIRED");
        }
        String currency = cmd.currencyCode() == null ? "" : cmd.currencyCode().trim().toUpperCase();
        if (!currency.matches("^[A-Z]{3}$")) {
            throw bad("CURRENCY_INVALID");
        }
        String holder = blankToNull(cmd.accountHolderName());
        if (holder == null || holder.length() > 200) {
            throw bad("ACCOUNT_HOLDER_REQUIRED");
        }
        String method = cmd.payoutMethod();
        Map<String, String> fields = new LinkedHashMap<>();
        if (cmd.bankDetails() != null) {
            cmd.bankDetails().forEach((k, val) -> {
                if (blankToNull(val) != null) {
                    fields.put(k, val.trim());
                }
            });
        }
        putIfPresent(fields, "iban", cmd.iban());
        putIfPresent(fields, "account_number", cmd.accountNumber());
        putIfPresent(fields, "bank_name", cmd.bankName());
        putIfPresent(fields, "mobile_money_provider", cmd.mobileMoneyProvider());
        putIfPresent(fields, "mobile_money_phone", cmd.mobileMoneyPhone());

        if ("OTHER".equals(method)) {
            if (cmd.otherDetails() == null || cmd.otherDetails().isEmpty()) {
                throw bad("PAYOUT_ACCOUNT_FIELDS_INVALID");
            }
            return new Validated(method, currency, holder, null, null, null, "{}", null, null,
                    envelope(cmd.otherDetails()));
        }
        FieldRequirement req = requirements(cmd.countryId()).stream()
                .filter(r -> r.payoutMethod().equals(method)).findFirst()
                .orElseThrow(() -> bad("PAYOUT_METHOD_NOT_SUPPORTED_IN_COUNTRY"));
        Set<String> allowed = new HashSet<>(req.requiredFields());
        allowed.addAll(req.optionalFields());
        for (String required : req.requiredFields()) {
            if (!fields.containsKey(required)) {
                throw bad("PAYOUT_ACCOUNT_FIELDS_INVALID");
            }
        }
        for (Map.Entry<String, String> f : fields.entrySet()) {
            if (!allowed.contains(f.getKey())) {
                throw bad("PAYOUT_ACCOUNT_FIELDS_INVALID");
            }
            Object pattern = req.fieldPatterns().get(f.getKey());
            if (pattern != null && !matches(String.valueOf(pattern), f.getValue())) {
                throw bad("PAYOUT_ACCOUNT_FIELDS_INVALID");
            }
        }
        Map<String, String> extra = new LinkedHashMap<>(fields);
        for (String column : List.of("iban", "account_number", "bank_name",
                "mobile_money_provider", "mobile_money_phone")) {
            extra.remove(column);
        }
        return new Validated(method, currency, holder, fields.get("bank_name"),
                cipher.encrypt(fields.get("iban")), cipher.encrypt(fields.get("account_number")),
                extra.isEmpty() ? "{}" : envelope(extra), fields.get("mobile_money_provider"),
                cipher.encrypt(fields.get("mobile_money_phone")), null);
    }

    private static boolean matches(String regex, String value) {
        try {
            return Pattern.compile(regex).matcher(value).matches();
        } catch (PatternSyntaxException e) {
            return true; // a broken admin-configured pattern must not block every organiser
        }
    }

    private String envelope(Map<String, String> clear) {
        return JSON.writeValueAsString(Map.of("enc", cipher.encrypt(JSON.writeValueAsString(clear))));
    }

    private Map<String, String> openEnvelope(String json) {
        if (json == null) {
            return null;
        }
        Map<String, Object> outer = json(json);
        Object enc = outer.get("enc");
        if (enc == null) {
            return Map.of();
        }
        Map<String, String> out = new LinkedHashMap<>();
        json(cipher.decrypt(String.valueOf(enc))).forEach((k, v) -> out.put(k, String.valueOf(v)));
        return out;
    }

    private AccountView view(Stored s, boolean mask) {
        String iban;
        String accountNumber;
        String phone;
        Map<String, String> bank;
        Map<String, String> other;
        if (!cipher.available()) {
            iban = s.iban() == null ? null : "****";
            accountNumber = s.accountNumber() == null ? null : "****";
            phone = s.mmPhone() == null ? null : "****";
            bank = Map.of();
            other = s.otherDetails() == null ? null : Map.of();
        } else {
            iban = cipher.decrypt(s.iban());
            accountNumber = cipher.decrypt(s.accountNumber());
            phone = cipher.decrypt(s.mmPhone());
            bank = openEnvelope(s.bankDetails());
            other = openEnvelope(s.otherDetails());
            if (mask) {
                iban = PayoutDataCipher.mask(iban);
                accountNumber = PayoutDataCipher.mask(accountNumber);
                phone = PayoutDataCipher.mask(phone);
                bank = maskAll(bank);
                other = maskAll(other);
            }
        }
        return new AccountView(s.id(), s.userId(), s.businessId(), s.method(), s.countryId(),
                s.currency(), s.holder(), s.bankName(), iban, accountNumber, bank, s.mmProvider(),
                phone, other, s.status(), s.verifiedAt(), s.notes(), s.isDefault(), s.createdAt(),
                mask || !cipher.available());
    }

    private static Map<String, String> maskAll(Map<String, String> m) {
        if (m == null) {
            return null;
        }
        Map<String, String> out = new LinkedHashMap<>();
        m.forEach((k, v) -> out.put(k, PayoutDataCipher.mask(v)));
        return out;
    }

    private static Stored map(ResultSet rs) throws SQLException {
        var verified = rs.getTimestamp("verified_at");
        return new Stored(rs.getObject("id", UUID.class), rs.getObject("organiser_user_id", UUID.class),
                rs.getObject("business_account_id", UUID.class), rs.getString("payout_method"),
                rs.getObject("country_id", UUID.class), rs.getString("currency_code").trim(),
                rs.getString("account_holder_name"), rs.getString("bank_name"), rs.getString("iban"),
                rs.getString("account_number"), rs.getString("bank_details"),
                rs.getString("mobile_money_provider"), rs.getString("mobile_money_phone"),
                rs.getString("other_details"), rs.getString("verification_status"),
                verified == null ? null : verified.toInstant(), rs.getString("verification_notes"),
                rs.getBoolean("is_default"), rs.getTimestamp("created_at").toInstant());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> json(String raw) {
        if (raw == null || raw.isBlank()) {
            return Map.of();
        }
        return JSON.readValue(raw, Map.class);
    }

    private static List<String> strings(Array arr) throws SQLException {
        return arr == null ? List.of() : Arrays.stream((Object[]) arr.getArray())
                .map(String::valueOf).toList();
    }

    private static void putIfPresent(Map<String, String> fields, String key, String value) {
        String v = blankToNull(value);
        if (v != null) {
            fields.put(key, v);
        }
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
