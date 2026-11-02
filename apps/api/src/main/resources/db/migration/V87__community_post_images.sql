-- 배우 게시판 글 사진(SOMA-873). 글 하나에 다섯 장까지 붙는다.
--
-- 포트폴리오 사진과 같은 길이다: 서버가 행을 먼저 만들고(post_id 없음) 서명한 주소를 내주면 앱이 객체를 올리고,
-- 글을 쓰거나 고칠 때 image_ids 로 붙인다. 붙지 않은 채 24시간이 지난 행은 매시 일이 지우고 객체 삭제를 정리
-- 장부(account_cleanup_operations)에 올린다. 글을 지우면 붙은 사진의 행을 지우고 객체도 같은 장부로 보낸다.
--
-- 더하기만 하는 변경이다: 새 테이블 하나. 직전 운영 서버는 이 테이블을 모르고 되돌려도 그대로 뜬다.
CREATE TABLE public.community_post_images (
    id uuid NOT NULL,
    post_id uuid,
    uploader_id uuid NOT NULL,
    object_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sort_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    uploaded_at timestamp with time zone,
    CONSTRAINT community_post_images_pkey PRIMARY KEY (id),
    CONSTRAINT community_post_images_object_key_key UNIQUE (object_key),
    CONSTRAINT community_post_images_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id),
    CONSTRAINT community_post_images_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.users(id),
    CONSTRAINT ck_community_post_images_attached_has_order
        CHECK (((post_id IS NULL) OR ((sort_order IS NOT NULL) AND (uploaded_at IS NOT NULL)))),
    CONSTRAINT ck_community_post_images_sort_order CHECK (((sort_order IS NULL) OR ((sort_order >= 0) AND (sort_order < 5))))
);
CREATE UNIQUE INDEX uq_community_post_images_post_order
    ON public.community_post_images USING btree (post_id, sort_order) WHERE (post_id IS NOT NULL);
CREATE INDEX idx_community_post_images_unattached
    ON public.community_post_images USING btree (created_at) WHERE (post_id IS NULL);
CREATE INDEX idx_community_post_images_uploader
    ON public.community_post_images USING btree (uploader_id);
