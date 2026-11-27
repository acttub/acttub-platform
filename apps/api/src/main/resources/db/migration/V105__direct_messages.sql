-- 배우끼리 1:1 메시지(SOMA-1039, docs/specs/community/messages.md).
--
-- 대화는 두 사람 사이에 하나다. 게시판 글·댓글의 작성자 이름에서 시작하고, 먼저 보낸 쪽이 starter 다. 같은 두 사람의
-- 대화는 방향과 무관하게 하나만 둔다 — 같은 방향은 유일 제약이, 반대 방향은 두 사람의 계정 행을 id 순서로 잠근 뒤
-- 찾는 저장소가 막는다. origin_post_id 는 대화를 연 게시판 글이다(대화방 머리의 한 줄). 참여자마다 마지막으로 읽은
-- 시각(*_read_at)과 마지막으로 푸시를 받은 시각(*_pushed_at, 같은 대화는 1분에 한 번)을 같은 행에 둔다.
--
-- 메시지는 글자만이고 앞뒤 공백을 걷은 1~1000자다. (sender_user_id, request_id) 가 유일해 재전송이 두 줄이 되지 않는다.
-- 탈퇴해도 대화와 메시지 행은 남고 상대 화면에 "탈퇴한 사용자"로 보인다(게시판 댓글과 같다, ADR-029).
--
-- 신고는 게시판 신고 표(community_reports)에 target_type 'conversation' 으로 남긴다.
--
-- 더하기만 하는 변경이다: 새 테이블 둘과 신고 대상 값 하나. 직전 운영 서버는 두 테이블을 모르고, 새 값의 신고 행은
-- 읽지 않으므로 되돌려도 그대로 뜬다.
CREATE TABLE public.direct_conversations (
    id uuid NOT NULL,
    starter_user_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL,
    origin_post_id uuid,
    starter_read_at timestamp with time zone,
    recipient_read_at timestamp with time zone,
    starter_pushed_at timestamp with time zone,
    recipient_pushed_at timestamp with time zone,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT direct_conversations_pkey PRIMARY KEY (id),
    CONSTRAINT direct_conversations_starter_user_id_fkey FOREIGN KEY (starter_user_id) REFERENCES public.users(id),
    CONSTRAINT direct_conversations_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id),
    CONSTRAINT direct_conversations_origin_post_id_fkey FOREIGN KEY (origin_post_id) REFERENCES public.community_posts(id),
    CONSTRAINT ck_direct_conversations_not_self CHECK ((starter_user_id <> recipient_user_id)),
    CONSTRAINT uq_direct_conversations_pair UNIQUE (starter_user_id, recipient_user_id)
);
CREATE INDEX idx_direct_conversations_recipient
    ON public.direct_conversations USING btree (recipient_user_id);

CREATE TABLE public.direct_messages (
    id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    sender_user_id uuid NOT NULL,
    body text NOT NULL,
    request_id uuid NOT NULL,
    request_fingerprint text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT direct_messages_pkey PRIMARY KEY (id),
    CONSTRAINT direct_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.direct_conversations(id),
    CONSTRAINT direct_messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id),
    CONSTRAINT ck_direct_messages_body_length CHECK (((char_length(body) >= 1) AND (char_length(body) <= 1000))),
    CONSTRAINT uq_direct_messages_sender_request UNIQUE (sender_user_id, request_id)
);
CREATE INDEX idx_direct_messages_conversation_created
    ON public.direct_messages USING btree (conversation_id, created_at DESC, id DESC);
CREATE INDEX idx_direct_messages_sender_created
    ON public.direct_messages USING btree (sender_user_id, created_at);

ALTER TABLE public.community_reports DROP CONSTRAINT ck_community_reports_target_type;
ALTER TABLE public.community_reports ADD CONSTRAINT ck_community_reports_target_type
    CHECK ((target_type = ANY (ARRAY['post'::text, 'comment'::text, 'conversation'::text])));
