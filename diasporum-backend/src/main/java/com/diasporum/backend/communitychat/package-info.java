/**
 * Community chat rooms, room messages, mentions and per-user room state; one persistent GENERAL room per community.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.communitychat;
