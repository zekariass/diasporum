/**
 * Matchmaking profiles, preferences, swipes, matches, unmatch behaviour and match lifecycle. A mutual like creates the match AND a friendships record via the social public API, and ensures an accepted GENERAL conversation via the messaging public API; unmatch removes only the match-created friendship, never pre-existing friendships or the conversation.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.matchmaking;
