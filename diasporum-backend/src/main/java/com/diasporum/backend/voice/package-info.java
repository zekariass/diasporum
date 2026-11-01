/**
 * Voice rooms (persistent), sessions (disposable live records), participants, seats, speaker requests, invites, moderation and session-temporary comments cleared on terminal session end.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.voice;
