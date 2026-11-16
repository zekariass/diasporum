package com.diasporum.backend.servicemarketplace;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.diasporum.backend.identity.IdentityTestSupport;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceProviderService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceRequestService;
import com.diasporum.backend.servicemarketplace.internal.application.ServiceResponseService;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.LeadInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ProviderInput;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.RequestInput;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Positive-price lead billing is isolated from the default free-lead context. */
@SpringBootTest(properties = {
        "diasporum.service-marketplace.lead-price=12.50",
        "diasporum.service-marketplace.lead-currency=EUR"
})
@Testcontainers
class ServiceMarketplacePaidLeadIntegrationTest {
    private static final String ISSUER = "http://localhost:8081/realms/diasporum";

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

    @Autowired ServiceProviderService providers;
    @Autowired ServiceRequestService requests;
    @Autowired ServiceResponseService responses;
    @Autowired ApplicationContext ctx;
    @Autowired JdbcTemplate jdbc;

    private UUID country;
    private UUID category;
    private UUID customer;
    private UUID providerOwner;

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE service_moderation_actions,service_reports,service_reviews,"
                + "service_lead_access,service_request_responses,service_request_media,service_requests,"
                + "service_provider_services,service_providers,service_category_translations,"
                + "service_categories,notifications,outbox_events,media_processing_jobs,media_objects,"
                + "billing_usage_records,billing_subscriptions,business_account_audit_events,"
                + "business_account_members,business_accounts,global_user_roles,external_identities,"
                + "profiles,users,addresses,countries CASCADE");
        jdbc.update("UPDATE billing_plan_entitlements SET enabled=false,quantity_limit=NULL,"
                + "reset_period=NULL WHERE feature_id IN (SELECT id FROM billing_features "
                + "WHERE feature_key IN ('SERVICE_JOB_POST','SERVICE_LEAD_ACCESS'))");
        jdbc.update("INSERT INTO countries(name,iso2,iso3) VALUES('Germany','DE','DEU')");
        country = jdbc.queryForObject("SELECT id FROM countries WHERE iso2='DE'", UUID.class);
        jdbc.update("INSERT INTO service_categories(category_key,sort_order) VALUES('PAID_CATEGORY',1)");
        UUID parent = jdbc.queryForObject("SELECT id FROM service_categories WHERE category_key='PAID_CATEGORY'",
                UUID.class);
        jdbc.update("INSERT INTO service_categories(parent_id,category_key,sort_order) VALUES(?,'PAID_SERVICE',1)",
                parent);
        category = jdbc.queryForObject("SELECT id FROM service_categories WHERE category_key='PAID_SERVICE'",
                UUID.class);
        jdbc.update("INSERT INTO service_category_translations(service_category_id,language_id,display_name) "
                + "SELECT ?,id,'Paid test service' FROM languages WHERE language_code='en'", category);
        customer = user("paid-lead-customer");
        providerOwner = user("paid-lead-provider");
    }

    @Test
    void positiveLeadPriceRequiresAndConsumesOneEntitlementPerProviderRequest() {
        var provider = providers.create(providerOwner, new ProviderInput(null, "Paid lead provider",
                "Paid lead integration provider", 52.52, 13.405, new BigDecimal("50"), List.of(category)));
        jdbc.update("UPDATE service_providers SET onboarding_status='APPROVED',onboarding_reviewed_at=now() "
                + "WHERE id=?", provider.id());
        var request = requests.create(customer, new RequestInput(category, country, null,
                52.521, 13.41, "Paid lead request", "Request requiring paid lead access", null, null,
                null, null, Instant.now().plus(7, ChronoUnit.DAYS), List.of()));
        entitlement(customer, "SERVICE_JOB_POST", 5);
        requests.publish(customer, request.id());

        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> responses.accessLead(providerOwner, request.id(),
                        new LeadInput(provider.id(), true, false))).getStatusCode());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM service_lead_access", Integer.class));

        entitlement(providerOwner, "SERVICE_LEAD_ACCESS", 1);
        var lead = responses.accessLead(providerOwner, request.id(), new LeadInput(provider.id(), true, false));
        assertNotNull(lead.billingUsageRecordId());
        assertEquals(0, new BigDecimal("12.50").compareTo(lead.leadPrice()));
        assertEquals("EUR", lead.leadCurrency());
        var upgraded = responses.accessLead(providerOwner, request.id(),
                new LeadInput(provider.id(), true, true));
        assertEquals(lead.id(), upgraded.id());
        assertEquals(lead.billingUsageRecordId(), upgraded.billingUsageRecordId());
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM billing_usage_records "
                + "WHERE user_id=? AND idempotency_key=?", Integer.class, providerOwner,
                "service-lead-access:" + request.id() + ":" + provider.id()));
        assertThrows(DataIntegrityViolationException.class, () -> jdbc.update(
                "UPDATE service_lead_access SET lead_price=0 WHERE id=?", lead.id()));
    }

    private UUID user(String subject) {
        UUID id = IdentityTestSupport.provision(ctx, ISSUER, subject);
        jdbc.update("UPDATE profiles SET username=?,origin_country_id=?,current_country_id=?,"
                + "profile_completed_at=now() WHERE id=?", subject, country, country, id);
        return id;
    }

    private void entitlement(UUID userId, String featureKey, long limit) {
        jdbc.update("UPDATE billing_plan_entitlements SET enabled=true,quantity_limit=?,reset_period='MONTH' "
                + "WHERE plan_id=(SELECT id FROM billing_plans WHERE plan_key='FREE') "
                + "AND feature_id=(SELECT id FROM billing_features WHERE feature_key=?)", limit, featureKey);
        jdbc.update("DELETE FROM billing_subscriptions WHERE user_id=?", userId);
        jdbc.update("INSERT INTO billing_subscriptions(user_id,plan_id,status,current_period_start) "
                + "SELECT ?,id,'ACTIVE',now() FROM billing_plans WHERE plan_key='FREE'", userId);
    }
}
