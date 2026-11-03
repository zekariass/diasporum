package com.diasporum.backend.servicemarketplace.internal.application;

import com.diasporum.backend.businessaccounts.BusinessAccountsApi;
import com.diasporum.backend.servicemarketplace.ServiceMarketplaceApi;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.Provider;
import com.diasporum.backend.servicemarketplace.internal.domain.ServiceMarketplaceModels.ServiceRequest;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceEngagementRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceProviderRepository;
import com.diasporum.backend.servicemarketplace.internal.infrastructure.persistence.ServiceRequestRepository;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Messaging-facing live authorization for SERVICE_REQUEST conversations. */
@Service
public class ServiceMarketplaceApiImpl implements ServiceMarketplaceApi {
    private final ServiceRequestRepository requests;
    private final ServiceProviderRepository providers;
    private final ServiceEngagementRepository engagement;
    private final BusinessAccountsApi businesses;

    public ServiceMarketplaceApiImpl(ServiceRequestRepository requests,
            ServiceProviderRepository providers, ServiceEngagementRepository engagement,
            BusinessAccountsApi businesses) {
        this.requests = requests;
        this.providers = providers;
        this.engagement = engagement;
        this.businesses = businesses;
    }

    @Override
    public boolean canAccessServiceConversation(UUID actorUserId,
            ServiceConversationContext conversation) {
        if (actorUserId == null || conversation == null || conversation.serviceRequestId() == null) {
            return false;
        }
        ServiceRequest request = requests.find(conversation.serviceRequestId()).orElse(null);
        if (request == null) {
            return false;
        }
        boolean customerA = personal(conversation.participantAUserId(),
                conversation.participantABusinessAccountId(), request.customerUserId());
        boolean customerB = personal(conversation.participantBUserId(),
                conversation.participantBBusinessAccountId(), request.customerUserId());
        if (customerA == customerB) {
            return false;
        }
        UUID providerUser = customerA ? conversation.participantBUserId() : conversation.participantAUserId();
        UUID providerBusiness = customerA ? conversation.participantBBusinessAccountId()
                : conversation.participantABusinessAccountId();
        Provider provider = providers.findAllByRequestAndEndpoint(request.id(), providerUser, providerBusiness)
                .orElse(null);
        if (provider == null || engagement.activeLead(request.id(), provider.id()).isEmpty()) {
            return false;
        }
        boolean actorCustomer = customerA
                ? Objects.equals(actorUserId, conversation.participantAUserId())
                : Objects.equals(actorUserId, conversation.participantBUserId());
        boolean actorProvider = providerBusiness == null
                ? Objects.equals(actorUserId, providerUser)
                : businesses.isActiveMember(actorUserId, providerBusiness);
        return actorCustomer || actorProvider;
    }

    private static boolean personal(UUID userId, UUID businessId, UUID expectedUserId) {
        return businessId == null && Objects.equals(userId, expectedUserId);
    }
}
