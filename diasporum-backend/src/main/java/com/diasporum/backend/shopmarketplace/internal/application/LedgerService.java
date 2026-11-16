package com.diasporum.backend.shopmarketplace.internal.application;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Append-only double-entry marketplace ledger. Every transaction must balance to zero per
 * currency before it is POSTED; entries are never updated or deleted.
 */
@Service
public class LedgerService {
    private final JdbcTemplate jdbc;

    public LedgerService(ShopSupport support) {
        this.jdbc = support.jdbc();
    }

    public record Entry(String account, String entityType, UUID sellerId, String side, long amountMinor) {
        static Entry debit(String account, long amount) {
            return new Entry(account, "PLATFORM", null, "DEBIT", amount);
        }

        static Entry credit(String account, long amount) {
            return new Entry(account, "PLATFORM", null, "CREDIT", amount);
        }

        static Entry seller(String side, UUID sellerId, long amount) {
            return new Entry("SELLER.PAYABLE", "SELLER", sellerId, side, amount);
        }
    }

    /** Idempotent posting: an existing idempotency key returns the original transaction. */
    public UUID post(String eventType, String idempotencyKey, UUID orderId, UUID sellerOrderId, UUID paymentId,
            String currency, String description, List<Entry> entries) {
        UUID existing = jdbc.query("SELECT id FROM marketplace_ledger_transactions WHERE idempotency_key=?",
                rs -> rs.next() ? rs.getObject(1, UUID.class) : null, idempotencyKey);
        if (existing != null) {
            return existing;
        }
        long debits = entries.stream().filter(e -> "DEBIT".equals(e.side())).mapToLong(Entry::amountMinor).sum();
        long credits = entries.stream().filter(e -> "CREDIT".equals(e.side())).mapToLong(Entry::amountMinor).sum();
        if (debits != credits || debits == 0) {
            throw new IllegalStateException("Unbalanced marketplace ledger transaction " + idempotencyKey);
        }
        UUID txId = UUID.randomUUID();
        try {
            jdbc.update("INSERT INTO marketplace_ledger_transactions(id,order_id,seller_order_id,payment_id,event_type,"
                    + "currency_code,idempotency_key,status,description,posted_at) VALUES(?,?,?,?,?,?,?,'POSTED',?,now())",
                    txId, orderId, sellerOrderId, paymentId, eventType, currency, idempotencyKey, description);
        } catch (DuplicateKeyException e) {
            return jdbc.queryForObject("SELECT id FROM marketplace_ledger_transactions WHERE idempotency_key=?", UUID.class,
                    idempotencyKey);
        }
        List<Object[]> batch = new ArrayList<>();
        int[] line = {1};
        for (Entry e : entries) {
            batch.add(new Object[] {txId, line[0]++, e.account(), e.entityType(), e.sellerId(), e.side(), e.amountMinor(),
                    currency});
        }
        jdbc.batchUpdate("INSERT INTO marketplace_ledger_entries(ledger_transaction_id,line_number,ledger_account_code,"
                + "entity_type,seller_id,entry_side,amount_minor,currency_code) VALUES(?,?,?,?,?,?,?,?)", batch);
        return txId;
    }
}
