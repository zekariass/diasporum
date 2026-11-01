package com.diasporum.backend.messaging;

/**
 * Public API of the messaging module: create/reuse direct conversations (incl. context types) and send messages. Other modules call this interface only - never messaging internals or tables.
 *
 * <p>Methods are added as use cases land; consumers depend on this
 * interface so implementations stay swappable and internals encapsulated.
 */
public interface MessagingApi {
}
