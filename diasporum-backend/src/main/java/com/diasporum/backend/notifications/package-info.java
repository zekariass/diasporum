/**
 * In-app notifications, notification preferences, device tokens and delivery orchestration via the transactional outbox (Expo Push initial provider).
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.notifications;
