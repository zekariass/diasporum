package com.diasporum.backend.media;

import static org.assertj.core.api.Assertions.assertThat;

import com.diasporum.backend.media.internal.infrastructure.integration.storage.MediaProperties;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.MediaStorageConfig;
import com.diasporum.backend.media.internal.infrastructure.integration.storage.StorageClient;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

/** R2 configuration: binding, activation guard, bean creation. */
class MediaConfigTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(Props.class, MediaStorageConfig.class);

    @Configuration
    @EnableConfigurationProperties(MediaProperties.class)
    static class Props {
    }

    @Test
    void defaultsDisabledNoStorageBean() {
        runner.run(ctx -> assertThat(ctx)
                .doesNotHaveBean(StorageClient.class)
                .getBean(MediaProperties.class)
                .satisfies(p -> {
                    assertThat(p.enabled()).isFalse();
                    assertThat(p.region()).isEqualTo("auto");
                    assertThat(p.uploadUrlTtl()).isEqualTo(Duration.ofMinutes(15));
                    assertThat(p.downloadUrlTtl()).isEqualTo(Duration.ofMinutes(2));
                    assertThat(p.sessionTtl()).isEqualTo(Duration.ofMinutes(15));
                    assertThat(p.maxUploadBytes()).isEqualTo(25L * 1024 * 1024);
                    assertThat(p.configured()).isFalse();
                }));
    }

    @Test
    void emptyPlaceholdersDoNotActivate() {
        // enabled=true but every credential blank — configured() must reject,
        // so context FAILS rather than silently activating a broken client.
        runner.withPropertyValues(
                        "diasporum.media.r2.enabled=true",
                        "diasporum.media.r2.endpoint=",
                        "diasporum.media.r2.bucket=",
                        "diasporum.media.r2.access-key-id=",
                        "diasporum.media.r2.secret-access-key=")
                .run(ctx -> assertThat(ctx).hasFailed());
    }

    @Test
    void enabledWithValidConfigCreatesAdapter() {
        runner.withPropertyValues(
                        "diasporum.media.r2.enabled=true",
                        "diasporum.media.r2.endpoint=https://abc.r2.cloudflarestorage.com",
                        "diasporum.media.r2.bucket=diasporum-media",
                        "diasporum.media.r2.access-key-id=testkey",
                        "diasporum.media.r2.secret-access-key=testsecret")
                .run(ctx -> assertThat(ctx)
                        .hasSingleBean(StorageClient.class)
                        .getBean(MediaProperties.class)
                        .satisfies(p -> assertThat(p.configured()).isTrue()));
    }

    @Test
    void disabledWithValidConfigStillNoBean() {
        runner.withPropertyValues(
                        "diasporum.media.r2.enabled=false",
                        "diasporum.media.r2.endpoint=https://abc.r2.cloudflarestorage.com",
                        "diasporum.media.r2.bucket=diasporum-media",
                        "diasporum.media.r2.access-key-id=testkey",
                        "diasporum.media.r2.secret-access-key=testsecret")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(StorageClient.class));
    }

    @Test
    void bindsCustomValues() {
        runner.withPropertyValues(
                        "diasporum.media.r2.enabled=true",
                        "diasporum.media.r2.endpoint=https://abc.r2.cloudflarestorage.com",
                        "diasporum.media.r2.bucket=diasporum-media",
                        "diasporum.media.r2.access-key-id=k",
                        "diasporum.media.r2.secret-access-key=s",
                        "diasporum.media.r2.upload-url-ttl=PT30M",
                        "diasporum.media.r2.download-url-ttl=PT5M",
                        "diasporum.media.r2.session-ttl=PT10M",
                        "diasporum.media.r2.max-upload-bytes=52428800")
                .run(ctx -> assertThat(ctx.getBean(MediaProperties.class))
                        .satisfies(p -> {
                            assertThat(p.uploadUrlTtl()).isEqualTo(Duration.ofMinutes(30));
                            assertThat(p.sessionTtl()).isEqualTo(Duration.ofMinutes(10));
                            assertThat(p.maxUploadBytes()).isEqualTo(52428800L);
                        }));
    }
}
