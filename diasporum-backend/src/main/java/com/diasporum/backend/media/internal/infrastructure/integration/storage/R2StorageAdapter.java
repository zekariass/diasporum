package com.diasporum.backend.media.internal.infrastructure.integration.storage;

import java.util.Optional;

import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

/**
 * Cloudflare R2 adapter over the S3-compatible API. All SDK types stay inside
 * this package. Presigned URLs are bearer credentials — never logged or
 * returned in error details.
 */
public class R2StorageAdapter implements StorageClient {

    private final MediaProperties props;
    private final S3Presigner presigner;
    private final S3Client s3;

    public R2StorageAdapter(MediaProperties props, S3Presigner presigner, S3Client s3) {
        this.props = props;
        this.presigner = presigner;
        this.s3 = s3;
    }

    @Override
    public String presignPut(String key, String contentType,
            java.time.Duration ttl) {
        var req = PutObjectRequest.builder().bucket(props.bucket()).key(key)
                .contentType(contentType).build();
        return presigner.presignPutObject(
                software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest
                        .builder().putObjectRequest(req)
                        .signatureDuration(ttl).build())
                .url().toString();
    }

    @Override
    public String presignGet(String key, java.time.Duration ttl) {
        var req = GetObjectRequest.builder().bucket(props.bucket()).key(key).build();
        return presigner.presignGetObject(
                software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest
                        .builder().getObjectRequest(req)
                        .signatureDuration(ttl).build())
                .url().toString();
    }

    @Override
    public Optional<ObjectMeta> head(String key) {
        try {
            var r = s3.headObject(HeadObjectRequest.builder()
                    .bucket(props.bucket()).key(key).build());
            return Optional.of(new ObjectMeta(r.contentLength(),
                    r.contentType()));
        } catch (software.amazon.awssdk.services.s3.model.S3Exception e) {
            if (e.statusCode() == 404 || e.awsErrorDetails() == null) {
                return Optional.empty();
            }
            throw e;
        }
    }

    @Override
    public Optional<byte[]> get(String key) {
        try {
            return Optional.of(s3.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(props.bucket()).key(key).build()).asByteArray());
        } catch (NoSuchKeyException e) {
            return Optional.empty();
        }
    }

    @Override
    public void put(String key, byte[] data, String contentType) {
        s3.putObject(PutObjectRequest.builder().bucket(props.bucket()).key(key)
                        .contentType(contentType).build(),
                software.amazon.awssdk.core.sync.RequestBody.fromBytes(data));
    }

    @Override
    public void delete(String key) {
        s3.deleteObject(DeleteObjectRequest.builder()
                .bucket(props.bucket()).key(key).build());
    }

}
