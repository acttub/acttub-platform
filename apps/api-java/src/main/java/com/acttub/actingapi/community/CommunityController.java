package com.acttub.actingapi.community;

import static com.acttub.actingapi.community.CommunityDtos.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.security.AccessGate;
import com.acttub.actingapi.web.ApiException;
import com.acttub.actingapi.web.ApiValidationException;
import com.acttub.actingapi.web.PythonText;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(value = "/v2/community", produces = MediaType.APPLICATION_JSON_VALUE)
class CommunityController {
    private static final Set<String> REPORT_TARGETS = Set.of("post", "comment");
    private static final Set<String> REPORT_REASONS =
            Set.of("spam", "abuse", "sexual", "privacy", "other");

    private final CommunityStore store;
    private final AccessGate auth;

    CommunityController(CommunityStore store, AccessGate auth) {
        this.store = store;
        this.auth = auth;
    }

    @Operation(
            summary = "List Categories",
            operationId = "list_categories_v2_community_categories_get",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = CategoryListResponse.class)))
    @GetMapping("/categories")
    CategoryListResponse listCategories(HttpServletRequest request) {
        auth.optionalUser(request);
        return new CategoryListResponse(store.listCategories().stream()
                .map(category -> new CategoryPayload(
                        category.slug(), category.name(), category.description()))
                .toList());
    }

    @Operation(
            summary = "List Posts",
            operationId = "list_posts_v2_community_posts_get",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PostListResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/posts")
    PostListResponse listPosts(
            @Parameter(schema = @Schema(nullable = true))
            @RequestParam(required = false) String category,
            @Parameter(schema = @Schema(nullable = true))
            @RequestParam(required = false) String cursor,
            // type 을 적지 않으면 @Schema 가 파라미터 타입을 덮어써 string 으로 문서화된다.
            @Parameter(schema = @Schema(
                    type = "integer",
                    nullable = true,
                    minimum = "1",
                    maximum = "50",
                    exclusiveMinimum = false,
                    exclusiveMaximum = false))
            @RequestParam(required = false) Integer limit,
            HttpServletRequest request) {
        UUID viewerId = optionalUserId(request);
        validateLimit(limit);
        try {
            CommunityStore.Page<CommunityStore.Post> page =
                    store.listPosts(viewerId, category, cursor, limit);
            return new PostListResponse(
                    page.items().stream().map(this::postPayload).toList(),
                    page.nextCursor());
        } catch (CommunityStore.InvalidCursor exception) {
            throw new ApiException(400, "invalid_cursor");
        }
    }

    @Operation(
            summary = "Create Post",
            operationId = "create_post_v2_community_posts_post",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PostPayload.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping(value = "/posts", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<PostPayload> createPost(
            @Valid @RequestBody PostWriteRequest body,
            HttpServletRequest request) {
        UUID authorId = authorId(request);
        String title = trimmed("title", body.title());
        String postBody = trimmed("body", body.body());
        try {
            CommunityStore.Post post = store.createPost(
                    authorId,
                    body.categorySlug(),
                    title,
                    postBody,
                    body.anonymous());
            return ResponseEntity.status(201).body(postPayload(post));
        } catch (CommunityStore.CategoryNotFound exception) {
            throw new ApiException(404, "category_not_found");
        }
    }

    @Operation(
            summary = "Get Post",
            operationId = "get_post_v2_community_posts__post_id__get",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PostPayload.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/posts/{post_id}")
    PostPayload getPost(
            @PathVariable("post_id") UUID postId,
            HttpServletRequest request) {
        UUID viewerId = optionalUserId(request);
        try {
            CommunityStore.Post post = store.getPost(postId, viewerId);
            PostPayload response = postPayload(post);
            if (!post.mine()) {
                store.incrementViewCount(postId);
            }
            return response;
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        }
    }

    @Operation(
            summary = "Update Post",
            operationId = "update_post_v2_community_posts__post_id__patch",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PostPayload.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PatchMapping(value = "/posts/{post_id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    PostPayload updatePost(
            @PathVariable("post_id") UUID postId,
            @Valid @RequestBody PostUpdateRequest body,
            HttpServletRequest request) {
        UUID authorId = authorId(request);
        try {
            return postPayload(store.updatePost(
                    postId,
                    authorId,
                    trimmed("title", body.title()),
                    trimmed("body", body.body())));
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        } catch (CommunityStore.NotAuthor exception) {
            throw new ApiException(403, "not_author");
        }
    }

    @Operation(
            summary = "Delete Post",
            operationId = "delete_post_v2_community_posts__post_id__delete",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping("/posts/{post_id}")
    ResponseEntity<Void> deletePost(
            @PathVariable("post_id") UUID postId,
            HttpServletRequest request) {
        try {
            store.deletePost(postId, authorId(request));
            return ResponseEntity.noContent().build();
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        } catch (CommunityStore.NotAuthor exception) {
            throw new ApiException(403, "not_author");
        }
    }

    @Operation(
            summary = "Like Post",
            operationId = "like_post_v2_community_posts__post_id__likes_post",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = LikeResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/posts/{post_id}/likes")
    LikeResponse likePost(
            @PathVariable("post_id") UUID postId,
            HttpServletRequest request) {
        try {
            return new LikeResponse(store.likePost(postId, authorId(request)), true);
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        }
    }

    @Operation(
            summary = "Unlike Post",
            operationId = "unlike_post_v2_community_posts__post_id__likes_delete",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = LikeResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping("/posts/{post_id}/likes")
    LikeResponse unlikePost(
            @PathVariable("post_id") UUID postId,
            HttpServletRequest request) {
        try {
            return new LikeResponse(store.unlikePost(postId, authorId(request)), false);
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        }
    }

    @Operation(
            summary = "List Comments",
            operationId = "list_comments_v2_community_posts__post_id__comments_get",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = CommentListResponse.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/posts/{post_id}/comments")
    CommentListResponse listComments(
            @PathVariable("post_id") UUID postId,
            @Parameter(schema = @Schema(nullable = true))
            @RequestParam(required = false) String cursor,
            // type 을 적지 않으면 @Schema 가 파라미터 타입을 덮어써 string 으로 문서화된다.
            @Parameter(schema = @Schema(
                    type = "integer",
                    nullable = true,
                    minimum = "1",
                    maximum = "50",
                    exclusiveMinimum = false,
                    exclusiveMaximum = false))
            @RequestParam(required = false) Integer limit,
            HttpServletRequest request) {
        UUID viewerId = optionalUserId(request);
        validateLimit(limit);
        // 커서 해독은 store 안에서, **글 조회 뒤에** 일어난다 —
        // `db/community_store.py:CommunityStore.list_comments` 가 `_load_post_row` 를 먼저 부르고
        // 호출부가 PostNotFound 를 ValueError 보다 먼저 잡는다. 여기서 미리 검증하면
        // "없는 글 + 잘못된 커서" 가 404 대신 400 이 된다.
        try {
            CommunityStore.Page<CommunityStore.Comment> page =
                    store.listComments(postId, viewerId, cursor, limit);
            return new CommentListResponse(
                    page.items().stream().map(this::commentPayload).toList(),
                    page.nextCursor());
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        } catch (CommunityStore.InvalidCursor exception) {
            throw new ApiException(400, "invalid_cursor");
        }
    }

    @Operation(
            summary = "Create Comment",
            operationId = "create_comment_v2_community_posts__post_id__comments_post",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "201",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = CommentPayload.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping(value = "/posts/{post_id}/comments", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<CommentPayload> createComment(
            @PathVariable("post_id") UUID postId,
            @Valid @RequestBody CommentWriteRequest body,
            HttpServletRequest request) {
        try {
            CommunityStore.Comment comment = store.createComment(
                    postId,
                    authorId(request),
                    trimmed("body", body.body()),
                    body.anonymous());
            return ResponseEntity.status(201).body(commentPayload(comment));
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "post_not_found");
        }
    }

    @Operation(
            summary = "Update Comment",
            operationId = "update_comment_v2_community_comments__comment_id__patch",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = CommentPayload.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PatchMapping(value = "/comments/{comment_id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    CommentPayload updateComment(
            @PathVariable("comment_id") UUID commentId,
            @Valid @RequestBody CommentWriteRequest body,
            HttpServletRequest request) {
        try {
            return commentPayload(store.updateComment(
                    commentId,
                    authorId(request),
                    trimmed("body", body.body())));
        } catch (CommunityStore.CommentNotFound exception) {
            throw new ApiException(404, "comment_not_found");
        } catch (CommunityStore.NotAuthor exception) {
            throw new ApiException(403, "not_author");
        }
    }

    @Operation(
            summary = "Delete Comment",
            operationId = "delete_comment_v2_community_comments__comment_id__delete",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping("/comments/{comment_id}")
    ResponseEntity<Void> deleteComment(
            @PathVariable("comment_id") UUID commentId,
            HttpServletRequest request) {
        try {
            store.deleteComment(commentId, authorId(request));
            return ResponseEntity.noContent().build();
        } catch (CommunityStore.CommentNotFound exception) {
            throw new ApiException(404, "comment_not_found");
        } catch (CommunityStore.NotAuthor exception) {
            throw new ApiException(403, "not_author");
        }
    }

    @Operation(
            summary = "Create Report",
            operationId = "create_report_v2_community_reports_post",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping(value = "/reports", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<Void> createReport(
            @Valid @RequestBody ReportRequest body,
            HttpServletRequest request) {
        validateEnum("target_type", body.targetType(), REPORT_TARGETS, "'post' or 'comment'");
        validateEnum(
                "reason",
                body.reason(),
                REPORT_REASONS,
                "'spam', 'abuse', 'sexual', 'privacy' or 'other'");
        try {
            store.createReport(
                    authorId(request),
                    body.targetType(),
                    body.targetId(),
                    body.reason(),
                    body.detail());
            return ResponseEntity.noContent().build();
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "target_not_found");
        } catch (CommunityStore.NotAuthor exception) {
            throw new ApiException(400, "cannot_report_own");
        } catch (CommunityStore.DuplicateReport exception) {
            throw new ApiException(409, "already_reported");
        }
    }

    @Operation(
            summary = "List Blocks",
            operationId = "list_blocks_v2_community_blocks_get",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponse(
            responseCode = "200",
            description = "Successful Response",
            content = @Content(schema = @Schema(implementation = BlockListResponse.class)))
    @GetMapping("/blocks")
    BlockListResponse listBlocks(HttpServletRequest request) {
        return new BlockListResponse(store.listBlocks(authorId(request)).stream()
                .map(blocked -> new BlockPayload(blocked.id(), blocked.nickname()))
                .toList());
    }

    @Operation(
            summary = "Block User",
            operationId = "block_user_v2_community_blocks_post",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping(value = "/blocks", consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<Void> blockUser(
            @Valid @RequestBody BlockRequest body,
            HttpServletRequest request) {
        try {
            store.blockUser(authorId(request), body.userId());
            return ResponseEntity.noContent().build();
        } catch (CommunityStore.NotAuthor exception) {
            throw new ApiException(400, "cannot_block_self");
        } catch (CommunityStore.PostNotFound exception) {
            throw new ApiException(404, "user_not_found");
        }
    }

    @Operation(
            summary = "Unblock User",
            operationId = "unblock_user_v2_community_blocks__blocked_id__delete",
            tags = "v2-community",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @DeleteMapping("/blocks/{blocked_id}")
    ResponseEntity<Void> unblockUser(
            @PathVariable("blocked_id") UUID blockedId,
            HttpServletRequest request) {
        store.unblockUser(authorId(request), blockedId);
        return ResponseEntity.noContent().build();
    }

    private UUID optionalUserId(HttpServletRequest request) {
        var user = auth.optionalUser(request);
        return user == null ? null : user.id();
    }

    private UUID authorId(HttpServletRequest request) {
        return auth.consentedUser(request).id();
    }

    private PostPayload postPayload(CommunityStore.Post post) {
        AuthorPayload author = post.anonymous()
                ? new AuthorPayload(null, null, "익명")
                : new AuthorPayload(post.authorId(), post.authorNickname(), null);
        return new PostPayload(
                post.id(),
                post.anonymous(),
                post.categorySlug(),
                post.categoryName(),
                author,
                post.title(),
                post.body(),
                post.likeCount(),
                post.commentCount(),
                post.viewCount(),
                post.likedByMe(),
                post.mine(),
                post.createdAt(),
                post.updatedAt());
    }

    private CommentPayload commentPayload(CommunityStore.Comment comment) {
        AuthorPayload author = comment.anonymous()
                ? new AuthorPayload(null, null, comment.alias())
                : new AuthorPayload(comment.authorId(), comment.authorNickname(), null);
        return new CommentPayload(
                comment.id(),
                comment.postId(),
                comment.anonymous(),
                author,
                comment.body(),
                comment.mine(),
                comment.createdAt(),
                comment.updatedAt());
    }

    private static String trimmed(String field, String raw) {
        // String.strip() 은 NBSP 를 공백으로 보지 않아 파이썬과 갈린다 — PythonText 참조.
        String trimmed = PythonText.strip(raw);
        if (trimmed.isEmpty()) {
            throw ApiValidationException.valueError(
                    List.of("body", field),
                    "Value error, " + field + " must not be blank",
                    raw);
        }
        return trimmed;
    }

    private static void validateLimit(Integer limit) {
        if (limit == null) {
            return;
        }
        if (limit < 1) {
            throw validationError(
                    "greater_than_equal",
                    List.of("query", "limit"),
                    "Input should be greater than or equal to 1",
                    limit,
                    Map.of("ge", 1));
        }
        if (limit > 50) {
            throw validationError(
                    "less_than_equal",
                    List.of("query", "limit"),
                    "Input should be less than or equal to 50",
                    limit,
                    Map.of("le", 50));
        }
    }

    private static void validateEnum(
            String field,
            String value,
            Set<String> allowed,
            String expected) {
        if (allowed.contains(value)) {
            return;
        }
        throw validationError(
                "literal_error",
                List.of("body", field),
                "Input should be " + expected,
                value,
                Map.of("expected", expected));
    }

    private static ApiValidationException validationError(
            String type,
            List<Object> location,
            String message,
            Object input,
            Map<String, Object> context) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", type);
        error.put("loc", location);
        error.put("msg", message);
        error.put("input", input);
        error.put("ctx", context);
        return new ApiValidationException(List.of(error));
    }
}
