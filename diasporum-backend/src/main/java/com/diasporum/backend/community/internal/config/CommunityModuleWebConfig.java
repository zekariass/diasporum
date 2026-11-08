package com.diasporum.backend.community.internal.config;

import com.diasporum.backend.community.internal.application.CommunityAccessPolicyService;
import com.diasporum.backend.community.internal.application.CommunityService;
import com.diasporum.backend.security.DiasporumUserPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Broad REST boundary for restricted modules; account-level routes are not intercepted. */
@Configuration
public class CommunityModuleWebConfig implements WebMvcConfigurer {

    private final ObjectProvider<CommunityService> communities;
    private final ObjectProvider<CommunityAccessPolicyService> accessPolicy;

    public CommunityModuleWebConfig(ObjectProvider<CommunityService> communities,
            ObjectProvider<CommunityAccessPolicyService> accessPolicy) {
        this.communities = communities;
        this.accessPolicy = accessPolicy;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        CommunityService communityService = communities.getIfAvailable();
        CommunityAccessPolicyService policy = accessPolicy.getIfAvailable();
        if (communityService == null || policy == null) {
            return; // MVC-only test slices do not contain database-backed module services.
        }
        registry.addInterceptor(new RestrictedModuleInterceptor(communityService, policy))
                .addPathPatterns(
                        "/api/v1/events/**", "/api/v1/communities/*/events/**",
                        "/api/v1/me/events/**", "/api/v1/jobs/**", "/api/v1/me/jobs/**",
                        "/api/v1/properties/**", "/api/v1/me/properties/**",
                        "/api/v1/vehicles/**", "/api/v1/me/vehicles/**",
                        "/api/v1/businesses/**", "/api/v1/me/businesses/**",
                        "/api/v1/service/**", "/api/v1/me/service/**",
                        "/api/v1/spare-bag/**", "/api/v1/me/spare-bag/**",
                        "/api/v1/shops/**", "/api/v1/me/shops/**",
                        "/api/v1/community-chat/**", "/api/v1/voice/**",
                        "/api/v1/rooms/**");
    }

    private record RestrictedModuleInterceptor(CommunityService communities,
            CommunityAccessPolicyService accessPolicy) implements HandlerInterceptor {

        private static final List<PathModule> PATHS = List.of(
                new PathModule("/api/v1/events", "EVENTS"),
                new PathModule("/api/v1/communities/", "EVENTS"),
                new PathModule("/api/v1/me/events", "EVENTS"),
                new PathModule("/api/v1/jobs", "JOBS"),
                new PathModule("/api/v1/me/jobs", "JOBS"),
                new PathModule("/api/v1/properties", "PROPERTY"),
                new PathModule("/api/v1/me/properties", "PROPERTY"),
                new PathModule("/api/v1/vehicles", "VEHICLE"),
                new PathModule("/api/v1/me/vehicles", "VEHICLE"),
                new PathModule("/api/v1/businesses", "BUSINESS_DIRECTORY"),
                new PathModule("/api/v1/me/businesses", "BUSINESS_DIRECTORY"),
                new PathModule("/api/v1/service", "SERVICE_MARKETPLACE"),
                new PathModule("/api/v1/me/service", "SERVICE_MARKETPLACE"),
                new PathModule("/api/v1/spare-bag", "SPARE_BAG"),
                new PathModule("/api/v1/me/spare-bag", "SPARE_BAG"),
                new PathModule("/api/v1/shops", "SHOP_MARKETPLACE"),
                new PathModule("/api/v1/me/shops", "SHOP_MARKETPLACE"),
                new PathModule("/api/v1/community-chat", "GENERAL_CHAT"),
                new PathModule("/api/v1/voice", "VOICE_ROOMS"),
                new PathModule("/api/v1/rooms", "VOICE_ROOMS"));

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                Object handler) {
            var authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication == null
                    || !(authentication.getPrincipal() instanceof DiasporumUserPrincipal principal)) {
                return true;
            }
            var active = communities.activeCommunityId(principal.userId());
            if (active.isEmpty()) {
                return true; // Legacy account-level flows retain their existing authorization.
            }
            String path = request.getRequestURI();
            PATHS.stream().filter(p -> p.matches(path)).findFirst()
                    .ifPresent(p -> accessPolicy.requireActiveModule(principal.userId(), p.module()));
            return true;
        }

        private record PathModule(String prefix, String module) {
            boolean matches(String path) {
                if (!path.startsWith(prefix)) {
                    return false;
                }
                return !prefix.equals("/api/v1/communities/") || path.contains("/events");
            }
        }
    }
}
