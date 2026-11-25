-- 옛 저녁 8시 고정 알림의 보내기 장부를 지운다 (SOMA-1142).
--
-- evening_reminder_sends 는 2026-10-20 뒤로 쓰는 코드가 없다(운영 1,876행, 10-03~10-20). 직전 운영 API 는 보내는 코드와 검증용
-- 매핑(EveningReminderSendEntity)을 모두 지운 코드다. 알림 집계는 머지 전에 따로 남겼고 행은 보관하지 않는다.
--
-- 잠금: 표를 지우면 외래 키(user_id → users)가 함께 사라지면서 users 에도 ACCESS EXCLUSIVE 를 잠깐 잡는다(운영 행 수로 채운
-- PostgreSQL 18 에서 1.4ms). 기다림이 5초를 넘으면 실패시킨다 — 새 API 가 뜨지 않고 옛 API 가 그대로 돌며, 다시 배포하면 된다.
SET LOCAL lock_timeout = '5s';

DROP TABLE public.evening_reminder_sends;
