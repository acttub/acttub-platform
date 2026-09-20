-- 계정 1.0.0 코드 리뷰 뒤의 보강 (SOMA-528, account.guest · account.withdraw).
--
-- ⚠️ 이 파일도 넓히기만 한다(V9 머리말과 같은 규칙). 기존 테이블에 더하는 컬럼은 NULL 허용이고,
-- 유일성을 거는 `guest_transfer_codes` 는 직전 운영 태그의 서버가 모르는 테이블이라 되돌려도 그 서버가
-- 그대로 뜬다.


-- ① guest_transfer_codes — "게스트마다 살아 있는 코드는 하나"와 "같은 숫자의 살아 있는 코드는 하나"를
--    DB 가 지킨다(account.guest).
--
--    V9 는 이 규칙을 애플리케이션에 맡겼는데, 발급의 "앞의 코드 지우기 → 새 코드 넣기"는 겹쳐 온 두 요청을
--    막지 못했다 — 지울 행이 없으면 잠글 행도 없어 둘 다 넣는다. 부분 유니크 인덱스를 걸면 뒤의 INSERT 가
--    앞의 커밋을 기다렸다가 겹침을 본다. 발급은 `ON CONFLICT DO NOTHING` 의 0행을 "다시 뽑기"로 읽는다
--    (`PostgresTransferCodeRepository#issue`).
--
--    "살아 있다"의 시한(`expires_at > now()`)은 인덱스 조건에 넣을 수 없어(불변 식이 아니다) 조건은
--    "쓰지 않음" 하나다. 시한이 지난 미사용 행은 발급이 비키고(같은 게스트의 것은 전부, 다른 게스트의 것은
--    같은 숫자일 때) 매일 도는 정리가 나머지를 지운다.
--
--    이미 겹친 행이 있으면 인덱스를 만들 수 없으므로 늦게 만든 것 하나만 남긴다. 쓰인 코드
--    (`guest_transferred` 의 표식)는 건드리지 않는다.
DELETE FROM public.guest_transfer_codes AS older
USING public.guest_transfer_codes AS newer
WHERE older.used_at IS NULL
  AND newer.used_at IS NULL
  AND older.id <> newer.id
  AND (older.user_id = newer.user_id OR older.code_hash = newer.code_hash)
  AND (older.created_at, older.id) < (newer.created_at, newer.id);

CREATE UNIQUE INDEX uq_guest_transfer_codes_unused_user
    ON public.guest_transfer_codes USING btree (user_id)
    WHERE (used_at IS NULL);

CREATE UNIQUE INDEX uq_guest_transfer_codes_unused_code_hash
    ON public.guest_transfer_codes USING btree (code_hash)
    WHERE (used_at IS NULL);


-- ② users.retention_purged_at — 탈퇴 3년 뒤의 파기를 마친 시각(account.withdraw, ADR-029).
--
--    매일 도는 일은 "신원 해시 행이 남아 있는가"로 파기할 계정을 골랐다. 그런데 제공자의 연결 끊기 알림은
--    신원을 행째 지우므로, 마지막 신원이 끊긴 뒤 탈퇴한 회원은 해시 행이 없어 보관에 동의한 영상이 3년이
--    지나도 영영 골라지지 않았다. 고르는 기준을 신원과 떼어 "탈퇴한 지 3년이 지났고 아직 파기를 마치지
--    않은 계정"으로 바꾼다 — 이 컬럼이 그 "마쳤다"의 표식이다. NULL 은 아직 하지 않았다는 뜻이다.
ALTER TABLE public.users
    ADD COLUMN retention_purged_at timestamp with time zone;
