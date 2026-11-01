/**
 * Platform-wide reports, moderation workflows and audit records; feature-specific rules stay in owning modules.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.moderation;
