package com.diasporum.backend.taxonomy.internal.application;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Minimal platform-admin management for destination-country practical
 * categories (feed/event/help post categories). Mirrors the
 * business-directory category-admin precedent: PLATFORM_ADMIN only, audited.
 */
@Service
public class TaxonomyAdminService {

    private static final Pattern SLUG = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");
    private static final Set<String> COLOR_TOKENS = Set.of("slate", "blue",
            "green", "amber", "rose", "violet", "teal", "orange", "indigo",
            "pink", "cyan", "lime", "red", "purple");

    private final JdbcTemplate jdbc;

    public TaxonomyAdminService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record CategoryAdminView(UUID id, UUID countryId, String name,
            String slug, String description, String colorToken, String iconKey,
            int sortOrder, boolean active, List<String> modules) {
    }

    private Set<String> validModules() {
        return new LinkedHashSet<>(jdbc.queryForList(
                "SELECT unnest(enum_range(NULL::category_module))::text",
                String.class));
    }

    private List<String> normalizeModules(List<String> modules) {
        var valid = validModules();
        if (modules == null || modules.isEmpty()) {
            throw bad("MODULES_REQUIRED");
        }
        var out = new LinkedHashSet<String>();
        for (String m : modules) {
            String key = m == null ? "" : m.trim().toUpperCase();
            if (!valid.contains(key)) {
                throw bad("INVALID_MODULE");
            }
            out.add(key);
        }
        return List.copyOf(out);
    }

    private static ResponseStatusException bad(String code) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, code);
    }

    private static ResponseStatusException forbidden(String code) {
        return new ResponseStatusException(HttpStatus.FORBIDDEN, code);
    }

    public void requireGlobalAdmin(UUID actor) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM global_user_roles"
                        + " WHERE user_id=? AND role_key='PLATFORM_ADMIN'"
                        + " AND scope_type='GLOBAL' AND revoked_at IS NULL",
                Integer.class, actor);
        if (count == null || count == 0) {
            throw forbidden("PLATFORM_ADMIN_REQUIRED");
        }
    }

    private void audit(UUID actor, String action, UUID targetId) {
        jdbc.update("INSERT INTO audit_logs(actor_user_id,actor_type,action_key,"
                        + "target_type,target_id) VALUES(?,'USER',?,?,?)",
                actor, action, "COUNTRY_CATEGORY", targetId);
    }

    /** All categories for a country — including inactive, for admin UIs. */
    public List<CategoryAdminView> list(UUID countryId) {
        return jdbc.query("SELECT id,country_id,name,slug,description,"
                        + "color_token,icon_key,sort_order,is_active"
                        + " FROM country_categories WHERE country_id=?"
                        + " ORDER BY sort_order,name",
                (rs, i) -> new CategoryAdminView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class),
                        rs.getString("name"), rs.getString("slug"),
                        rs.getString("description"), rs.getString("color_token"),
                        rs.getString("icon_key"), rs.getInt("sort_order"),
                        rs.getBoolean("is_active"), List.of()), countryId)
                .stream().map(v -> new CategoryAdminView(v.id(), v.countryId(),
                        v.name(), v.slug(), v.description(), v.colorToken(),
                        v.iconKey(), v.sortOrder(), v.active(),
                        modulesOf(v.id()))).toList();
    }

    private List<String> modulesOf(UUID categoryId) {
        return jdbc.queryForList("SELECT module_key::text"
                + " FROM country_category_modules WHERE category_id=?"
                + " ORDER BY module_key", String.class, categoryId);
    }

    @Transactional
    public CategoryAdminView create(UUID actor, UUID countryId, String name,
            String slug, String description, String colorToken, String iconKey,
            Integer sortOrder, List<String> modules) {
        requireGlobalAdmin(actor);
        var mods = normalizeModules(modules);
        if (name == null || name.isBlank() || name.trim().length() > 100) {
            throw bad("INVALID_NAME");
        }
        if (slug == null || !SLUG.matcher(slug).matches()) {
            throw bad("INVALID_SLUG");
        }
        String color = colorToken == null || colorToken.isBlank()
                ? "slate" : colorToken.trim();
        if (!COLOR_TOKENS.contains(color)) {
            throw bad("INVALID_COLOR_TOKEN");
        }
        Integer exists = jdbc.queryForObject(
                "SELECT count(*) FROM countries WHERE id=?", Integer.class,
                countryId);
        if (exists == null || exists == 0) {
            throw bad("COUNTRY_NOT_FOUND");
        }
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO country_categories(id,country_id,name,slug,"
                        + "description,color_token,icon_key,sort_order,created_by)"
                        + " VALUES(?,?,?,?,?,?,?,?,?)",
                id, countryId, name.trim(), slug, description, color, iconKey,
                sortOrder == null ? 0 : sortOrder, actor);
        for (String m : mods) {
            jdbc.update("INSERT INTO country_category_modules(category_id,"
                            + "module_key) VALUES(?,?::category_module)", id, m);
        }
        audit(actor, "COUNTRY_CATEGORY_CREATED", id);
        return new CategoryAdminView(id, countryId, name.trim(), slug,
                description, color, iconKey, sortOrder == null ? 0 : sortOrder,
                true, mods);
    }

    @Transactional
    public CategoryAdminView update(UUID actor, UUID categoryId, String name,
            String slug, String description, String colorToken, String iconKey,
            Integer sortOrder, Boolean active, List<String> modules) {
        requireGlobalAdmin(actor);
        var cur = jdbc.query("SELECT id,country_id,name,slug,description,"
                        + "color_token,icon_key,sort_order,is_active"
                        + " FROM country_categories WHERE id=? FOR UPDATE",
                (rs, i) -> new CategoryAdminView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("country_id", UUID.class),
                        rs.getString("name"), rs.getString("slug"),
                        rs.getString("description"), rs.getString("color_token"),
                        rs.getString("icon_key"), rs.getInt("sort_order"),
                        rs.getBoolean("is_active"), List.of()), categoryId)
                .stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "CATEGORY_NOT_FOUND"));
        if (name != null && (name.isBlank() || name.trim().length() > 100)) {
            throw bad("INVALID_NAME");
        }
        if (slug != null && !SLUG.matcher(slug).matches()) {
            throw bad("INVALID_SLUG");
        }
        if (colorToken != null && !COLOR_TOKENS.contains(colorToken.trim())) {
            throw bad("INVALID_COLOR_TOKEN");
        }
        jdbc.update("UPDATE country_categories SET"
                        + " name=COALESCE(?,name), slug=COALESCE(?,slug),"
                        + " description=COALESCE(?,description),"
                        + " color_token=COALESCE(?,color_token),"
                        + " icon_key=COALESCE(?,icon_key),"
                        + " sort_order=COALESCE(?,sort_order),"
                        + " is_active=COALESCE(?,is_active), updated_at=now()"
                        + " WHERE id=?",
                name == null ? null : name.trim(), slug, description,
                colorToken == null ? null : colorToken.trim(), iconKey,
                sortOrder, active, categoryId);
        if (modules != null) {
            var mods = normalizeModules(modules);
            jdbc.update("DELETE FROM country_category_modules"
                    + " WHERE category_id=?", categoryId);
            for (String m : mods) {
                jdbc.update("INSERT INTO country_category_modules(category_id,"
                                + "module_key) VALUES(?,?::category_module)",
                        categoryId, m);
            }
        }
        if (active != null && active != cur.active()) {
            audit(actor, active ? "COUNTRY_CATEGORY_ACTIVATED"
                    : "COUNTRY_CATEGORY_DEACTIVATED", categoryId);
        } else {
            audit(actor, "COUNTRY_CATEGORY_UPDATED", categoryId);
        }
        var refreshed = jdbc.queryForList(
                "SELECT country_id FROM country_categories WHERE id=?",
                UUID.class, categoryId).get(0);
        var now = cur;
        return new CategoryAdminView(categoryId, refreshed,
                name == null ? now.name() : name.trim(),
                slug == null ? now.slug() : slug,
                description == null ? now.description() : description,
                colorToken == null ? now.colorToken() : colorToken.trim(),
                iconKey == null ? now.iconKey() : iconKey,
                sortOrder == null ? now.sortOrder() : sortOrder,
                active == null ? now.active() : active,
                modules == null ? modulesOf(categoryId)
                        : normalizeModules(modules));
    }

    /** Activate/deactivate convenience for admin UIs. */
    @Transactional
    public CategoryAdminView setActive(UUID actor, UUID categoryId,
            boolean active) {
        return update(actor, categoryId, null, null, null, null, null, null,
                active, null);
    }
}
