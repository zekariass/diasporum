/**
 * Posts, Reels (post_type='REEL' on feed_posts), comments, reactions, polls, featured placement and the Community Help subdomain (structured REQUEST/OFFER posts reusing feed_posts/community_help_posts and direct conversations with context COMMUNITY_HELP_POST).
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.feed;
