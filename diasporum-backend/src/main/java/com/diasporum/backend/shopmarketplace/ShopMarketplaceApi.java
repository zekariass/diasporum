package com.diasporum.backend.shopmarketplace;

import java.util.Optional;
import java.util.UUID;

/**
 * Public cross-module contract used by Messaging for the SHOP, SHOP_PRODUCT and
 * SHOP_ORDER conversation contexts. No marketplace internals leak through it.
 */
public interface ShopMarketplaceApi {

    /** True for the marketplace-owned conversation context types. */
    static boolean isShopContext(String contextType) {
        return "SHOP".equals(contextType) || "SHOP_PRODUCT".equals(contextType)
                || "SHOP_ORDER".equals(contextType);
    }

    /**
     * Resolves the server-side counterparty for a marketplace conversation. Buyers reach the
     * shop's seller (individual owner or Business Account); for SHOP_ORDER an authorised
     * seller-side actor reaches the order customer. Empty when the target is not eligible
     * or the actor is not entitled to open the conversation.
     */
    Optional<ConversationEndpoint> conversationCounterparty(UUID actorUserId,
            UUID actingBusinessAccountId, String contextType, UUID contextId);

    /**
     * Revalidates access to an existing marketplace conversation: for SHOP_ORDER the actor
     * must be the order customer or a currently authorised seller-side member.
     */
    boolean canAccessShopConversation(UUID actorUserId, String contextType, UUID contextId);

    /** A personal user, or a Business Account (businessAccountId non-null). */
    record ConversationEndpoint(UUID userId, UUID businessAccountId) {
    }
}
