-- 개인화 연습 알림(SOMA-720)의 보낸 기록. 회원·한국 날짜·칸(slot)마다 한 줄이다.
--
-- slot 은 'practice'(연습 권유)와 'streak'(연속 기록 지키기) 둘이고, 한국 날짜마다 칸별로 한 번만 보낸다(하루 최대 둘).
-- 보내기 전에 이 줄을 먼저 넣어(ON CONFLICT DO NOTHING) 선점한 쪽만 보내므로 동시에 도는 두 인스턴스가 겹쳐 보내지 않는다.
-- kind·skipped_days·template_id 는 어떤 문구를 보냈는지의 기록이며, 14일 안에 보낸 문구를 피해 돌려 쓰는 데 읽는다.
-- 더하기만 하는 변경이다: 새 표 하나이고 옛 표는 건드리지 않는다. 옛 서버(저녁 8시 고정 알림)는 이 표를 모른다.
-- 탈퇴와 게스트 파기는 users 행을 남기므로 ON DELETE CASCADE 만으로는 지워지지 않아 해당 절차가 이 표를 직접 지운다.
CREATE TABLE public.practice_reminder_sends (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    day date NOT NULL,
    slot text NOT NULL,
    kind text NOT NULL,
    skipped_days integer NOT NULL,
    template_id text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (user_id, day, slot),
    CONSTRAINT ck_practice_reminder_sends_slot CHECK (slot IN ('practice', 'streak'))
);
