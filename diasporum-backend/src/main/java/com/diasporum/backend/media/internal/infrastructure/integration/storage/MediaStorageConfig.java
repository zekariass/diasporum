package com.diasporum.backend.media.internal.infrastructure.integration.storage;

import java.net.URI;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.Assert;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/**
 * Always-loaded media storage wiring. {@link MediaProperties} binds in every
 * context; the R2-backed {@link StorageClient} bean is created ONLY when
 * {@code diasporum.media.r2.enabled=true} — and fails fast if credentials are
 * blank. Empty placeholders therefore never activate storage.
 */
@Configuration
@EnableConfigurationProperties(MediaProperties.class)
public class MediaStorageConfig {

    @Bean
    @ConditionalOnProperty(prefix = "diasporum.media.r2", name = "enabled",
            havingValue = "true")
    StorageClient storageClient(MediaProperties props) {
        Assert.isTrue(props.configured(),
                "diasporum.media.r2.enabled=true but endpoint/access-key-id/"
                        + "secret-access-key/bucket are missing or blank");
        var region = Region.of(props.region());
        var creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(props.accessKeyId(),
                        props.secretAccessKey()));
        var endpoint = URI.create(props.endpoint());
        var presigner = S3Presigner.builder().region(region)
                .endpointOverride(endpoint).credentialsProvider(creds).build();
        var s3 = S3Client.builder().region(region).endpointOverride(endpoint)
                .credentialsProvider(creds)
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(true).build())
                .build();
        return new R2StorageAdapter(props, presigner, s3);
    }
}
