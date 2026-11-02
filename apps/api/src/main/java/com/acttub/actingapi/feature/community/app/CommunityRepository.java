package com.acttub.actingapi.feature.community.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.community.domain.BlockedUser;
import com.acttub.actingapi.feature.community.domain.CommunityCategory;
import com.acttub.actingapi.feature.community.domain.CommunityComment;
import com.acttub.actingapi.feature.community.domain.CommunityPost;

/**
 * community 가 저장소에 요구하는 것. 구현은 {@code adapter/db/PostgresCommunityRepository} 하나뿐
 * 이지만, 선언이 이쪽에 있어야 규칙이 저장 방식을 모른 채로 설 수 있다.
 *
 * <p><b>없음과 소유권 판정이 여기 있다.</b> practice 의 포트가 {@code null} 로 없음을 알리는 것과
 * 다른데, 이쪽은 한 연산 안에서 갈릴 것이 둘 이상이고(없다 / 내 것이 아니다) 그 판정이 같은
 * 트랜잭션·같은 잠금 안에서 일어나야 하기 때문이다. 뜻을 오류 코드로 옮기는 일은
 * {@link CommunityService} 가 한다.
 *
 * <p><b>보는 사람이 인자로 따라다닌다.</b> 차단은 조회하는 쪽의 상태이므로 같은 글이라도 누가
 * 보느냐에 따라 보이고 안 보인다 — 조건은 SQL 의 {@code WHERE} 에 들어간다.
 */
public interface CommunityRepository {

    List<CommunityCategory> listCategories();

    /**
     * @throws InvalidCursor 커서가 우리가 발급한 형태가 아닐 때
     */
    Page<CommunityPost> listPosts(UUID viewerId, String categorySlug, String cursor, Integer limit);

    /**
     * @throws CommunityContentNotFound 글이 없거나, 보는 사람이 글쓴이를 차단했을 때
     */
    CommunityPost getPost(UUID postId, UUID viewerId);

    /**
     * @throws CommunityContentNotFound 분류가 없거나 비활성일 때
     */
    CommunityPost createPost(
            UUID authorId, String categorySlug, String title, String body, boolean anonymous);

    /**
     * @throws CommunityContentNotFound 글이 없을 때
     * @throws NotAuthor 남의 글일 때
     */
    CommunityPost updatePost(UUID postId, UUID authorId, String title, String body);

    /**
     * @throws CommunityContentNotFound 글이 없을 때
     * @throws NotAuthor 남의 글일 때
     */
    void deletePost(UUID postId, UUID authorId);

    /** 조회수를 하나 올린다. 없는 글이면 아무 일도 일어나지 않는다. */
    void incrementViewCount(UUID postId);

    /**
     * 좋아요를 남기고 <b>다시 세어</b> 그 수를 돌려준다. 이미 눌렀으면 수만 돌아온다.
     *
     * @throws CommunityContentNotFound 글이 없을 때
     */
    int likePost(UUID postId, UUID userId);

    /**
     * @throws CommunityContentNotFound 글이 없을 때
     */
    int unlikePost(UUID postId, UUID userId);

    /**
     * <b>글을 먼저 찾고 커서를 나중에 읽는다.</b> 순서가 뒤집히면 "없는 글 + 깨진 커서" 가 404 가
     * 아니라 400 이 되어 파이썬과 갈린다.
     *
     * @throws CommunityContentNotFound 글이 없거나, 보는 사람이 글쓴이를 차단했을 때
     * @throws InvalidCursor 커서가 우리가 발급한 형태가 아닐 때
     */
    Page<CommunityComment> listComments(UUID postId, UUID viewerId, String cursor, Integer limit);

    /**
     * @throws CommunityContentNotFound 글이 없을 때
     */
    CommunityComment createComment(UUID postId, UUID authorId, String body, boolean anonymous);

    /**
     * @throws CommunityContentNotFound 댓글이 없거나 이미 지워졌을 때
     * @throws NotAuthor 남의 댓글일 때
     */
    CommunityComment updateComment(UUID commentId, UUID authorId, String body);

    /**
     * @throws CommunityContentNotFound 댓글이 없거나 이미 지워졌을 때
     * @throws NotAuthor 남의 댓글일 때
     */
    void deleteComment(UUID commentId, UUID authorId);

    /**
     * @throws CommunityContentNotFound 신고 대상이 없거나 이미 지워졌을 때
     * @throws ReportingOwnContent 자기가 쓴 것을 신고했을 때
     * @throws DuplicateReport 같은 대상을 이미 신고했을 때
     */
    void createReport(
            UUID reporterId, String targetType, UUID targetId, String reason, String detail);

    List<BlockedUser> listBlocks(UUID blockerId);

    /**
     * 차단한다. 이미 차단했으면 아무 일도 일어나지 않는다.
     *
     * <p><b>둘이 다른 사람인지는 부르는 쪽이 이미 확인했다.</b> 자기 자신을 차단하는 것은 저장할
     * 것이 있느냐가 아니라 허용되느냐의 문제라 규칙 쪽에 있다 — 여기까지 내려오면 조건이
     * 실재 확인 뒤로 밀려, 자기 자신은 늘 실재하므로 걸러지지 않는다.
     *
     * @throws CommunityContentNotFound 그런 사용자가 없을 때
     */
    void blockUser(UUID blockerId, UUID blockedId);

    /** 차단을 푼다. 차단한 적이 없어도 오류가 아니다. */
    void unblockUser(UUID blockerId, UUID blockedId);
}
