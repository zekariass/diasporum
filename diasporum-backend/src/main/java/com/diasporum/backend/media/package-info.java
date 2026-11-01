/**
 * Media metadata, upload state, media access grants and processing lifecycle (R2/Stream behind module-owned ports).
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.media;
