package com.acttub.actingapi.feature.community.app;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.community.domain.CommunityCategory;
import com.acttub.actingapi.feature.community.domain.CommunityComment;
import com.acttub.actingapi.feature.community.domain.CommunityPost;
import com.acttub.actingapi.feature.community.domain.ContactInfo;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 커뮤니티의 규칙. SQL 도 HTTP 요청도 모르며, 요청 하나가 무엇을 확인하고 무엇을 남기는지만 안다.
 *
 * <p>없음·충돌을 {@link ApiException} 으로 던진다. 배관(web)의 타입이지만 다른 feature 의 것이
 * 아니므로 도메인 사이의 결합은 아니다 — 이 예외를 상태코드와 본문으로 옮기는 일은
 * {@code platform/web/ApiErrorAdvice} 하나가 맡고 있고, 그 형태가 곧 계약이다.
 *
 * <p><b>저장소 예외를 오류 코드로 옮기는 자리가 여기다.</b> 같은 {@link CommunityContentNotFound}
 * 가 메서드마다 다른 코드가 되는데, 부르는 자리에서 없을 수 있는 것이 하나로 정해지기 때문이다 —
 * 글을 쓸 때 없을 수 있는 것은 분류뿐이고, 신고할 때 없을 수 있는 것은 신고 대상뿐이다.
 */
@Service
public class CommunityService {

    private final CommunityRepository community;
    private final CommunityImageService images;
    private final CommunityReportNotifier reportNotifier;

    public CommunityService(
            CommunityRepository community, CommunityImageService images, CommunityReportNotifier reportNotifier) {
        this.community = community;
        this.images = images;
        this.reportNotifier = reportNotifier == null ? CommunityReportNotifier.NONE : reportNotifier;
    }

    public List<CommunityCategory> listCategories() {
        return community.listCategories();
    }

    public Page<CommunityPost> listPosts(
            UUID viewerId, String categorySlug, String cursor, Integer limit) {
        try {
            return community.listPosts(viewerId, categorySlug, cursor, limit);
        } catch (InvalidCursor exception) {
            throw new ApiException(400, "invalid_cursor", exception);
        }
    }

    /**
     * 글 하나를 읽고, 남의 글이면 조회수를 올린다.
     *
     * <p>🔥 <b>돌려주는 것은 조회수가 오르기 전의 글이다. 순서가 계약이다</b> — 파이썬도 응답을
     * 만든 뒤에 올리므로, 방금 연 사람에게는 아직 오르지 않은 수가 보인다. 증가를 먼저 하거나
     * 증가 후 다시 읽으면 응답 바이트가 달라진다.
     */
    public CommunityPost view(UUID postId, UUID viewerId) {
        CommunityPost post = getPost(postId, viewerId);
        if (post.countsAsView()) {
            community.incrementViewCount(postId);
        }
        return post;
    }

    /** @param imageIds 붙일 사진(보여 줄 순서, 0~5장). {@code null} 은 없음이다 */
    public CommunityPost createPost(
            UUID authorId, String categorySlug, String title, String body, boolean anonymous, List<UUID> imageIds) {
        rejectContactInfo(title, body);
        List<UUID> attach = imageIds == null ? List.of() : imageIds;
        images.requireAttachable(authorId, attach);
        try {
            return community.createPost(authorId, categorySlug, title, body, anonymous, attach);
        } catch (CommunityContentNotFound exception) {
            throw new ApiException(404, "category_not_found", exception);
        } catch (InvalidImage exception) {
            throw CommunityImageService.invalidImage();
        }
    }

    /** @param imageIds {@code null} 이면 사진은 그대로, 아니면 이 목록으로 바꾼다 */
    public CommunityPost updatePost(UUID postId, UUID authorId, String title, String body, List<UUID> imageIds) {
        rejectContactInfo(title, body);
        if (imageIds != null) {
            images.requireAttachable(authorId, imageIds);
        }
        CommunityRepository.PostWrite written;
        try {
            written = community.updatePost(postId, authorId, title, body, imageIds);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        } catch (NotAuthor exception) {
            throw notAuthor(exception);
        } catch (InvalidImage exception) {
            throw CommunityImageService.invalidImage();
        }
        images.attemptCleanup(written.cleanupOperationIds());
        return written.post();
    }

    /** 글을 지우고 붙은 사진의 객체를 지운다(장부가 커밋과 함께 남아 실패해도 다시 한다). */
    public void deletePost(UUID postId, UUID authorId) {
        List<UUID> cleanups;
        try {
            cleanups = community.deletePost(postId, authorId);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        } catch (NotAuthor exception) {
            throw notAuthor(exception);
        }
        images.attemptCleanup(cleanups);
    }

    public int likePost(UUID postId, UUID userId) {
        try {
            return community.likePost(postId, userId);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        }
    }

    public int unlikePost(UUID postId, UUID userId) {
        try {
            return community.unlikePost(postId, userId);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        }
    }

    public Page<CommunityComment> listComments(
            UUID postId, UUID viewerId, String cursor, Integer limit) {
        try {
            return community.listComments(postId, viewerId, cursor, limit);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        } catch (InvalidCursor exception) {
            throw new ApiException(400, "invalid_cursor", exception);
        }
    }

    public CommunityComment createComment(
            UUID postId, UUID authorId, String body, boolean anonymous) {
        rejectContactInfo(null, body);
        try {
            return community.createComment(postId, authorId, body, anonymous);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        }
    }

    public void deleteComment(UUID commentId, UUID authorId) {
        try {
            community.deleteComment(commentId, authorId);
        } catch (CommunityContentNotFound exception) {
            throw commentNotFound(exception);
        } catch (NotAuthor exception) {
            throw notAuthor(exception);
        }
    }

    public void createReport(
            UUID reporterId, String targetType, UUID targetId, String reason, String detail) {
        try {
            community.createReport(reporterId, targetType, targetId, reason, detail);
        } catch (CommunityContentNotFound exception) {
            throw new ApiException(404, "target_not_found", exception);
        } catch (ReportingOwnContent exception) {
            throw new ApiException(400, "cannot_report_own", exception);
        } catch (DuplicateReport exception) {
            throw new ApiException(409, "already_reported", exception);
        }
        // 저장소가 커밋한 뒤 팀에 알린다(SOMA-1042). 같은 대상 재신고는 위에서 409 로 끝나 여기 오지 않는다.
        reportNotifier.filed(new CommunityReportNotifier.Notice(targetType, targetId, reason, detail));
    }

    /**
     * 차단한다.
     *
     * <p>자기 자신인지를 <b>상대가 실재하는지보다 먼저</b> 본다. 순서를 뒤집으면 자기 id 로 부른
     * 요청이 400 이 아니라 200 쪽으로 새어 나간다 — 자기 자신은 늘 실재하기 때문이다.
     */
    public void blockUser(UUID blockerId, UUID blockedId) {
        if (blockerId.equals(blockedId)) {
            throw new ApiException(400, "cannot_block_self");
        }
        try {
            community.blockUser(blockerId, blockedId);
        } catch (CommunityContentNotFound exception) {
            throw new ApiException(404, "user_not_found", exception);
        }
    }

    /**
     * 1:1 메시지 대화방 머리에 적을 시작 글(SOMA-1039). 보는 사람에게 지금 보이는 글만 준다 — 지워졌거나 가려졌거나 차단으로
     * 보이지 않으면 비어 있다. 조회수는 올리지 않는다.
     */
    public Optional<PostHeadline> postHeadline(UUID postId, UUID viewerId) {
        try {
            CommunityPost post = community.getPost(postId, viewerId);
            return Optional.of(new PostHeadline(post.id(), post.title()));
        } catch (CommunityContentNotFound exception) {
            return Optional.empty();
        }
    }

    /**
     * 0.1.0 전 게시판 차단({@code community_blocks})이 두 사람 사이에 어느 쪽으로든 있는가. 1:1 메시지는 이 옛 차단도
     * 사람 차단({@code user_blocks})처럼 막는다(SOMA-1039).
     */
    public boolean legacyBlockedEitherWay(UUID first, UUID second) {
        return community.legacyBlockedEitherWay(first, second);
    }

    /**
     * 1:1 메시지 대화를 신고한다(SOMA-1039). 게시판 신고 표에 {@code conversation} 대상으로 남기고 커밋 뒤 팀에 알린다. 참여자인지는
     * 부르는 쪽(message)이 이미 확인했다. 같은 대화를 다시 신고하면 409 {@code already_reported}.
     */
    public void fileConversationReport(UUID reporterId, UUID conversationId, String reason, String detail) {
        try {
            community.createConversationReport(reporterId, conversationId, reason, detail);
        } catch (DuplicateReport exception) {
            throw new ApiException(409, "already_reported", exception);
        }
        reportNotifier.filed(new CommunityReportNotifier.Notice("conversation", conversationId, reason, detail));
    }

    /** 대화방 머리의 한 줄. */
    public record PostHeadline(UUID id, String title) {
    }

    private CommunityPost getPost(UUID postId, UUID viewerId) {
        try {
            return community.getPost(postId, viewerId);
        } catch (CommunityContentNotFound exception) {
            throw postNotFound(exception);
        }
    }

    /**
     * 글·댓글에 연락처가 있으면 422 {@code community_contact_info}. 무엇이 연락처인지는 {@link ContactInfo} 가 안다.
     *
     * <p>있는지·내 것인지보다 <b>먼저</b> 본다. 본문만 보고 정해지는 거절이라 DB 를 열 까닭이 없고, 없는 글을 고치려는
     * 요청이라도 연락처를 담았으면 같은 답을 받는다.
     */
    private static void rejectContactInfo(String title, String body) {
        if (ContactInfo.contains(title) || ContactInfo.contains(body)) {
            throw new ApiException(422, "community_contact_info");
        }
    }

    private static ApiException postNotFound(Throwable cause) {
        return new ApiException(404, "post_not_found", cause);
    }

    private static ApiException commentNotFound(Throwable cause) {
        return new ApiException(404, "comment_not_found", cause);
    }

    private static ApiException notAuthor(Throwable cause) {
        return new ApiException(403, "not_author", cause);
    }
}
