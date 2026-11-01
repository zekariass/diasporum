/**
 * Admin-only use cases orchestrating multiple modules through their public APIs; owns no business domain data.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.administration;
