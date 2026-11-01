/**
 * Spring Security configuration, JWT validation (Keycloak OIDC), role/authority mapping and request-level security. Modules still enforce resource-level authorization.
 * <p><b>Boundary:</b> other modules may depend only on this module's root
 * public API/events. Access to {@code internal.*} packages is forbidden;
 * architecture tests enforce it.

 */
package com.diasporum.backend.security;
