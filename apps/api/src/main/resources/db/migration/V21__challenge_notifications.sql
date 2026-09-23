-- 챌린지 알림함과 푸시 묶음 선점 (challenge.notification). 기존 표는 넓히기만 한다.

-- 댓글 알림이 가리키는 댓글이 그 참여작의 것인지 제약으로 묶는다.
ALTER TABLE public.entry_comments ADD CONSTRAINT uq_entry_comments_parent UNIQUE (id,entry_id);

-- 한 행 = 수신자 한 명의 원인 사건 하나. 이름·캡션·본문·주소는 복사하지 않고 조회 때 조립한다.
CREATE TABLE public.notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    kind text NOT NULL,
    actor_user_id uuid REFERENCES public.users(id),
    challenge_id uuid NOT NULL REFERENCES public.challenges(id),
    entry_id uuid,
    comment_id uuid,
    event_key text NOT NULL,
    group_key text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    read_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    push_after timestamp with time zone,
    push_status text NOT NULL,
    push_attempted_at timestamp with time zone,
    CONSTRAINT uq_notifications_event UNIQUE (user_id,event_key),
    CONSTRAINT ck_notifications_kind CHECK (kind IN ('entry_liked','entry_commented','challenge_ended','entry_ai_report_ready')),
    CONSTRAINT ck_notifications_push_status CHECK (push_status IN ('pending','attempted','skipped')),
    CONSTRAINT ck_notifications_entry CHECK ((kind='challenge_ended') = (entry_id IS NULL)),
    CONSTRAINT ck_notifications_comment CHECK ((kind='entry_commented') = (comment_id IS NOT NULL)),
    CONSTRAINT ck_notifications_actor CHECK (kind IN ('entry_liked','entry_commented') OR actor_user_id IS NULL),
    CONSTRAINT ck_notifications_pending CHECK (push_status<>'pending' OR push_after IS NOT NULL),
    CONSTRAINT fk_notifications_entry FOREIGN KEY (entry_id,challenge_id)
        REFERENCES public.challenge_entries(id,challenge_id),
    CONSTRAINT fk_notifications_comment FOREIGN KEY (comment_id,entry_id)
        REFERENCES public.entry_comments(id,entry_id)
);
CREATE INDEX ix_notifications_inbox ON public.notifications(user_id,group_key,created_at DESC);
CREATE INDEX ix_notifications_due ON public.notifications(push_after) WHERE push_status='pending';
CREATE INDEX ix_notifications_expires ON public.notifications(expires_at);
CREATE INDEX ix_notifications_entry ON public.notifications(entry_id);

-- 묶음마다 최초·요약 푸시를 한 번씩만 보내도록 선점한다.
CREATE TABLE public.notification_pushes (
    id uuid PRIMARY KEY,
    group_key text NOT NULL,
    stage text NOT NULL,
    user_id uuid NOT NULL REFERENCES public.users(id),
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT uq_notification_pushes_stage UNIQUE (group_key,stage),
    CONSTRAINT ck_notification_pushes_stage CHECK (stage IN ('first','summary'))
);
CREATE INDEX ix_notification_pushes_created ON public.notification_pushes(created_at);
