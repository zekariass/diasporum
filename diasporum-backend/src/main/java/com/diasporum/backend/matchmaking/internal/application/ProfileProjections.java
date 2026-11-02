package com.diasporum.backend.matchmaking.internal.application;

import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileRow;
import com.diasporum.backend.matchmaking.internal.domain.MatchmakingModels.PublicProfileView;
import com.diasporum.backend.media.MediaApi;
import org.springframework.stereotype.Component;

/** Converts the already visibility-filtered persistence row to safe public DTO data. */
@Component
public class ProfileProjections {

    private final MediaApi media;

    public ProfileProjections(MediaApi media) {
        this.media = media;
    }

    public PublicProfileView publicProfile(PublicProfileRow row) {
        String photoUrl = row.photoMediaId() == null ? null
                : media.authorizedDownloadUrl(row.photoMediaId());
        return new PublicProfileView(row.userId(), row.displayName(), photoUrl,
                row.genderKey(), row.age(), row.nationalityCountryId(), row.religionId(),
                row.educationLevel(), row.occupation(), row.relationshipIntention(),
                row.maritalStatus(), row.hasChildren(), row.wantsChildren(), row.smoking(),
                row.drinking(), row.activityLevel(), row.heightCm(), row.marriageTimeline(),
                row.longDistanceRelationship(), row.religionImportance(),
                row.willingToRelocate(), row.verificationStatus());
    }
}
