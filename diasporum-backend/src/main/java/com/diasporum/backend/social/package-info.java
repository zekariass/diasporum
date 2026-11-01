/**
 * Follow relationships, friend requests, friendships, blocks and mutes. Mutual follow-based connections are derived from reciprocal user_follows; follow is never an implicit DM grant.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.social;
