package com.acttub.actingapi.feature.community.app;

import java.math.BigInteger;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.community.app.CommunityImageRepository.PendingImage;
import com.acttub.actingapi.integration.storage.PhotoUploadType;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 게시판 글 사진(SOMA-873). 포트폴리오 사진({@code PortfolioService.beginPhotoUpload}·{@code completePhotoUpload})과 같은
 * 길이다 — 서버가 행과 서명한 올리기 주소를 내주고, 앱이 그 주소로 PUT 한 뒤 글에 붙인다.
 *
 * <p>형식·크기 규칙도 같다(JPEG·PNG·WebP·HEIC, 10MB, {@link PhotoUploadType}). 이미지가 아니면 415 가 크기 검사(413)보다
 * 먼저다. 확인 단계({@link #complete})는 포트폴리오처럼 있지만 <b>붙일 때 아직 확인하지 않은 사진은 그 자리에서 확인한다</b>
 * — 앱이 확인을 건너뛰어도 올라오지 않은 사진은 붙지 않는다.
 */
@Service
public class CommunityImageService {
    /** 글 하나에 붙는 사진 수. */
    public static final int MAX_IMAGES_PER_POST = 5;
    /** 글에 붙지 않은 올리기를 이만큼까지만 들고 있다. 글 넷을 동시에 쓰는 정도는 넉넉하다. */
    static final int PENDING_LIMIT = 20;
    static final Duration UPLOAD_TTL = Duration.ofMinutes(30);
    /** 글에 붙지 않은 올리기는 이만큼 지나면 매시 일이 지운다. */
    static final Duration UNATTACHED_TTL = Duration.ofHours(24);
    public static final int VIEW_SECONDS = 60 * 60;

    private final CommunityImageRepository images;
    private final CommunityImageStorage storage;
    private final CommunityImageCleanup cleanup;
    private final Clock clock;

    public CommunityImageService(
            CommunityImageRepository images, CommunityImageStorage storage, CommunityImageCleanup cleanup, Clock clock) {
        this.images = images;
        this.storage = storage;
        this.cleanup = cleanup;
        this.clock = clock;
    }

    public NewImageUpload begin(UUID userId, String rawMimeType, BigInteger sizeBytes) {
        String mimeType = PhotoUploadType.accepted(rawMimeType);
        if (mimeType == null) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (sizeBytes.compareTo(BigInteger.valueOf(PhotoUploadType.MAX_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        storage.requireConfigured();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(UPLOAD_TTL);
        UUID imageId = UUID.randomUUID();
        String objectKey = "community/" + userId + "/" + imageId.toString().replace("-", "")
                + PhotoUploadType.objectSuffix(mimeType);
        long size = sizeBytes.longValueExact();
        if (!images.begin(new PendingImage(imageId, userId, null, objectKey, mimeType, size, expiresAt, false),
                PENDING_LIMIT, now)) {
            throw new ApiException(429, "too_many_pending_images");
        }
        String uploadUrl = storage.presignUpload(objectKey, mimeType, size, Math.toIntExact(UPLOAD_TTL.toSeconds()));
        return new NewImageUpload(imageId, uploadUrl, mimeType, expiresAt);
    }

    /** 올라온 것을 확인한다. 이미 확인한 사진이면 같은 결과다(응답을 못 받은 앱의 재시도). */
    public ImageView complete(UUID userId, UUID imageId) {
        storage.requireConfigured();
        PendingImage pending = images.find(userId, imageId);
        if (pending == null) {
            throw new ApiException(404, "community_image_not_found");
        }
        if (!pending.uploaded()) {
            Instant now = clock.instant();
            if (!now.isBefore(pending.expiresAt())) {
                throw new ApiException(409, "upload_intent_expired");
            }
            Long stored = storage.sizeOf(pending.objectKey());
            if (stored == null) {
                throw new ApiException(409, "upload_not_found");
            }
            if (stored != pending.sizeBytes()) {
                throw new ApiException(409, "upload_size_mismatch");
            }
            images.markUploaded(imageId, now);
        }
        return new ImageView(imageId, storage.viewUrl(pending.objectKey(), VIEW_SECONDS));
    }

    /**
     * 글에 붙일 사진 목록을 본다. 6장 이상이면 400 {@code too_many_images}, 중복·남의 것·없는 것·올라오지 않은 것은
     * 400 {@code invalid_image}. 아직 확인하지 않은 사진은 여기서 객체를 확인한다. 다른 글에 붙었는지는 붙이는
     * 트랜잭션이 행을 잠그고 다시 본다.
     */
    public void requireAttachable(UUID userId, List<UUID> imageIds) {
        if (imageIds.size() > MAX_IMAGES_PER_POST) {
            throw new ApiException(400, "too_many_images");
        }
        // List.of() 의 contains(null) 은 NPE 라 스트림으로 본다.
        if (imageIds.stream().anyMatch(Objects::isNull) || new HashSet<>(imageIds).size() != imageIds.size()) {
            throw invalidImage();
        }
        for (UUID imageId : imageIds) {
            PendingImage pending = images.find(userId, imageId);
            if (pending == null) {
                throw invalidImage();
            }
            if (!pending.uploaded()) {
                storage.requireConfigured();
                Long stored = storage.sizeOf(pending.objectKey());
                if (stored == null || stored != pending.sizeBytes()) {
                    throw invalidImage();
                }
                images.markUploaded(imageId, clock.instant());
            }
        }
    }

    /** 사진을 볼 주소. 스토리지가 없으면 {@code null}. */
    public String viewUrl(String objectKey) {
        return storage.viewUrl(objectKey, VIEW_SECONDS);
    }

    /** 커밋 뒤에 객체 삭제를 한 번 시도한다. 실패는 장부가 다시 한다. */
    public void attemptCleanup(List<UUID> operationIds) {
        if (!operationIds.isEmpty()) {
            cleanup.attempt(operationIds);
        }
    }

    /** 글에 붙지 않은 채 24시간 지난 올리기를 지운다. 매시간 도는 일이 부른다. */
    public int sweepUnattached() {
        Instant now = clock.instant();
        List<UUID> scheduled = images.sweepUnattached(now.minus(UNATTACHED_TTL), now);
        attemptCleanup(scheduled);
        return scheduled.size();
    }

    static ApiException invalidImage() {
        return new ApiException(400, "invalid_image");
    }

    public record NewImageUpload(UUID imageId, String uploadUrl, String mimeType, Instant expiresAt) {
    }

    public record ImageView(UUID id, String url) {
    }
}
