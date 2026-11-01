package com.diasporum.backend.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Spring Security principal for an authenticated Diasporum user.
 * userId = users.id (permanent account identity). sessionId = user_sessions.id.
 */
public record DiasporumUserPrincipal(UUID userId, UUID sessionId,
        String email, List<GrantedAuthority> authorities) implements UserDetails {

    @Override public Collection<? extends GrantedAuthority> getAuthorities() { return authorities; }
    @Override public String getPassword() { return null; }
    @Override public String getUsername() { return email; }
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return true; }
}
