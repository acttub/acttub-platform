package com.acttub.actingapi.feature.portfolio.app;

import java.math.BigInteger;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.app.PortfolioRepository.PendingPhoto;
import com.acttub.actingapi.feature.portfolio.domain.CreditRules;
import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.integration.storage.PhotoUploadType;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * 포트폴리오의 규칙 — 항목마다 따로 저장하고, 공유 링크로 로그인 없이 보여 준다 (account.portfolio).
 *
 * <p>값의 형태(길이·값 목록·연도 범위)는 요청을 받는 자리가 보고 422 배열로 답한다. 여기서 거절하는 것은
 * <b>규칙</b>이고 본문은 사유 코드 하나다: 상한({@code portfolio_credit_limit_exceeded}·
 * {@code portfolio_photo_limit_exceeded}), 순서 불일치({@code order_mismatch}), 없는 것
 * ({@code portfolio_credit_not_found}·{@code portfolio_photo_not_found}·{@code portfolio_not_found}).
 *
 * <p>공개 조회에 함께 보이는 이름·사진·성별·만 나이는 프로필의 것이라 {@link PortfolioOwners} 로 받는다
 * (구현은 {@code profile}). 추구하는 방향·경력 구간·목표와 연습·분석은 보이지 않는다.
 */
public class PortfolioService {

    /** 서명 주소와 대기 중인 올리기의 수명. 둘이 같은 값이어야 주소가 살아 있는 동안만 확정된다. */
    static final Duration PHOTO_UPLOAD_TTL = Duration.ofMinutes(30);

    private static final int PHOTO_VIEW_SECONDS = 60 * 60;
    private static final int SLUG_BYTES = 16;
    private static final int SLUG_ATTEMPTS = 5;

    private final PortfolioRepository portfolios;
    private final PortfolioPhotoStorage photos;
    private final PortfolioOwners owners;
    private final Clock clock;
    private final String siteUrl;
    private final SecureRandom random = new SecureRandom();

    /**
     * @param siteUrl 웹의 공개 주소(예: {@code https://acttub.com}). 공유 링크의 {@code url} 을 만드는 데
     *        쓴다. 비어 있으면 {@code url} 은 {@code null} 이다 — 주소를 코드에 박아 두지 않는다
     */
    public PortfolioService(
            PortfolioRepository portfolios,
            PortfolioPhotoStorage photos,
            PortfolioOwners owners,
            Clock clock,
            String siteUrl) {
        this.portfolios = portfolios;
        this.photos = photos;
        this.owners = owners;
        this.clock = clock;
        String trimmed = siteUrl == null ? "" : siteUrl.strip();
        this.siteUrl = trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    public PortfolioView find(UUID userId) {
        return view(portfolios.find(userId));
    }

    /** {@code null} 이나 빈 글이면 지운다. */
    public PortfolioView saveIntro(UUID userId, String intro) {
        portfolios.saveIntro(userId, intro == null || intro.isBlank() ? null : intro.strip());
        return find(userId);
    }

    public Portfolio.Credit addCredit(UUID userId, String title, String role, int year, String kind) {
        Portfolio.Credit added =
                portfolios.addCredit(userId, title.strip(), role.strip(), year, kind, CreditRules.CREDIT_MAX);
        if (added == null) {
            throw new ApiException(422, "portfolio_credit_limit_exceeded");
        }
        return added;
    }

    public Portfolio.Credit updateCredit(
            UUID userId, UUID creditId, String title, String role, Integer year, String kind) {
        Portfolio.Credit updated = portfolios.updateCredit(
                userId, creditId, title == null ? null : title.strip(), role == null ? null : role.strip(), year, kind);
        if (updated == null) {
            throw creditNotFound();
        }
        return updated;
    }

    /** 이미 지운 것을 다시 지우면 404 다. 없는 것과 남의 것을 가르지 않는다. */
    public void deleteCredit(UUID userId, UUID creditId) {
        if (!portfolios.deleteCredit(userId, creditId)) {
            throw creditNotFound();
        }
    }

    /** 다른 기기에서 그 사이 추가·삭제했으면 목록이 어긋난다. 그때는 아무것도 바꾸지 않고 422 다. */
    public PortfolioView orderCredits(UUID userId, List<UUID> ids) {
        if (!portfolios.orderCredits(userId, ids)) {
            throw new ApiException(422, "order_mismatch");
        }
        return find(userId);
    }

    /**
     * 사진을 올릴 자리를 내준다. 프로필 사진과 같은 길이다 — 이미지가 아니면 415 가 크기 검사(413)보다 먼저
     * 나오고, 둘 다 앱을 거치지 않은 올리기를 막는 안전망이다.
     */
    public NewPhotoUpload beginPhotoUpload(UUID userId, String rawContentType, BigInteger sizeBytes) {
        String contentType = PhotoUploadType.accepted(rawContentType);
        if (contentType == null) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (sizeBytes.compareTo(BigInteger.valueOf(PhotoUploadType.MAX_BYTES)) > 0) {
            throw new ApiException(413, "upload_too_large");
        }
        photos.requireConfigured();
        Instant now = clock.instant();
        Instant expiresAt = now.plus(PHOTO_UPLOAD_TTL);
        UUID photoId = UUID.randomUUID();
        String objectKey = "users/" + userId + "/portfolio/"
                + photoId.toString().replace("-", "") + PhotoUploadType.objectSuffix(contentType);
        PortfolioRepository.PhotoSlot slot = portfolios.beginPhoto(
                userId,
                new PendingPhoto(photoId, objectKey, contentType, sizeBytes.longValueExact(), expiresAt, false),
                CreditRules.PHOTO_MAX,
                now);
        slot.abandonedObjectKeys().forEach(this::deleteQuietly);
        if (!slot.accepted()) {
            throw new ApiException(422, "portfolio_photo_limit_exceeded");
        }
        String uploadUrl = photos.presignUpload(
                objectKey, contentType, sizeBytes.longValueExact(), Math.toIntExact(PHOTO_UPLOAD_TTL.toSeconds()));
        return new NewPhotoUpload(photoId, uploadUrl, expiresAt);
    }

    /** 올라온 것을 확인하고 목록 맨 끝에 붙인다. 이미 끝난 사진이면 같은 결과다(응답을 못 받은 앱의 재시도). */
    public PortfolioView completePhotoUpload(UUID userId, UUID photoId) {
        photos.requireConfigured();
        PendingPhoto pending = portfolios.photo(userId, photoId);
        if (pending == null) {
            throw photoNotFound();
        }
        if (pending.uploaded()) {
            return find(userId);
        }
        Instant now = clock.instant();
        if (!now.isBefore(pending.expiresAt())) {
            throw new ApiException(409, "upload_intent_expired");
        }
        Long stored = photos.sizeOf(pending.objectKey());
        if (stored == null) {
            throw new ApiException(409, "upload_not_found");
        }
        if (stored != pending.sizeBytes()) {
            throw new ApiException(409, "upload_size_mismatch");
        }
        portfolios.completePhoto(userId, photoId, now);
        return find(userId);
    }

    /** 행과 사진 객체를 함께 지운다. 이미 지운 것을 다시 지우면 404 다. */
    public void deletePhoto(UUID userId, UUID photoId) {
        String objectKey = portfolios.deletePhoto(userId, photoId);
        if (objectKey == null) {
            throw photoNotFound();
        }
        photos.delete(objectKey);
    }

    public PortfolioView orderPhotos(UUID userId, List<UUID> ids) {
        if (!portfolios.orderPhotos(userId, ids)) {
            throw new ApiException(422, "order_mismatch");
        }
        return find(userId);
    }

    /**
     * 공유 링크를 켜거나 끈다. 같은 값을 다시 보내도 같은 결과다. 처음 켤 때 추측할 수 없는 난수 slug 가
     * 생기고, 꺼도 남아서 다시 켜면 같은 주소가 열린다. 주소 바꾸기("새 링크 만들기")는 없다.
     */
    public ShareView share(UUID userId, boolean enabled) {
        for (int attempt = 0; ; attempt++) {
            try {
                return view(portfolios.share(userId, enabled, newSlug()));
            } catch (DataIntegrityViolationException collision) {
                // 128비트 난수가 겹칠 일은 없지만, 겹치면 다른 사람의 주소를 주는 대신 다시 뽑는다.
                if (attempt + 1 >= SLUG_ATTEMPTS) {
                    throw collision;
                }
            }
        }
    }

    /**
     * 받은 링크를 로그인 없이 여는 사람이 보는 것. 꺼진 링크, 없는 slug, 탈퇴한 사람의 slug 는 <b>같은
     * 404</b> 다 — 그 주소에 누가 있었는지 알려 주지 않는다. 링크를 켠 채 프로필의 이름·사진을 바꾸면 여기도
     * 바로 바뀐다.
     */
    public PublicPortfolio publicView(String slug) {
        UUID ownerId = portfolios.sharedOwner(slug);
        if (ownerId == null) {
            throw new ApiException(404, "portfolio_not_found");
        }
        PortfolioOwners.Owner owner = owners.ownerOf(ownerId);
        if (owner == null) {
            throw new ApiException(404, "portfolio_not_found");
        }
        Portfolio portfolio = portfolios.find(ownerId);
        return new PublicPortfolio(
                owner.name(),
                owner.photoKey() == null ? null : photos.viewUrl(owner.photoKey(), PHOTO_VIEW_SECONDS),
                // 성별이 "선택 안 함"이면 공개 페이지에서 성별 칸을 뺀다.
                "unspecified".equals(owner.gender()) ? null : owner.gender(),
                owner.age(),
                portfolio.intro(),
                portfolio.credits(),
                portfolio.photos().stream()
                        .map(photo -> photos.viewUrl(photo.objectKey(), PHOTO_VIEW_SECONDS))
                        .toList());
    }

    /** {@code '/'}·{@code '+'}·{@code '='} 가 없는 글자다 — 웹의 주소 {@code /p/<slug>} 는 한 단계만 받는다. */
    private String newSlug() {
        byte[] bytes = new byte[SLUG_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private void deleteQuietly(String objectKey) {
        try {
            photos.delete(objectKey);
        } catch (RuntimeException ignored) {
            // 시한이 지난 올리기의 찌꺼기다. 못 지워도 새 올리기를 막지 않는다.
        }
    }

    private PortfolioView view(Portfolio portfolio) {
        return new PortfolioView(
                portfolio.intro(),
                portfolio.credits(),
                portfolio.photos().stream()
                        .map(photo -> new PhotoView(photo.id(), photos.viewUrl(photo.objectKey(), PHOTO_VIEW_SECONDS)))
                        .toList(),
                view(portfolio.share()));
    }

    private ShareView view(Portfolio.Share share) {
        return new ShareView(
                share.enabled(),
                share.slug(),
                share.slug() == null || siteUrl.isEmpty() ? null : siteUrl + "/p/" + share.slug());
    }

    /** 한국 시간의 오늘 — 경력 연도의 "내년"이 이 날짜에서 나온다. */
    public LocalDate today() {
        return owners.today();
    }

    private static ApiException creditNotFound() {
        return new ApiException(404, "portfolio_credit_not_found");
    }

    private static ApiException photoNotFound() {
        return new ApiException(404, "portfolio_photo_not_found");
    }

    /** 응답에 실을 모양. 사진 주소는 저장하지 않고 조회할 때마다 서명한다. */
    public record PortfolioView(String intro, List<Portfolio.Credit> credits, List<PhotoView> photos, ShareView share) {
    }

    /** @param url 스토리지가 설정돼 있지 않으면 {@code null} */
    public record PhotoView(UUID id, String url) {
    }

    /** @param url {@code <웹 주소>/p/<slug>}. slug 가 없거나 웹 주소가 설정돼 있지 않으면 {@code null} */
    public record ShareView(boolean enabled, String slug, String url) {
    }

    public record NewPhotoUpload(UUID photoId, String uploadUrl, Instant expiresAt) {
    }

    /** @param gender {@code female}·{@code male} 또는 {@code null}("선택 안 함") */
    public record PublicPortfolio(
            String name,
            String photoUrl,
            String gender,
            int age,
            String intro,
            List<Portfolio.Credit> credits,
            List<String> photoUrls) {
    }
}
