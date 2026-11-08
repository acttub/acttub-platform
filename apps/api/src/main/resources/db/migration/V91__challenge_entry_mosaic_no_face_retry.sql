-- 얼굴 모자이크를 켰는데 얼굴을 못 찾은 참여작을 다시 처리하게 한다 (SOMA-1066). 이제 워커는 얼굴이 없으면 실패로 닫지
-- 않고 모자이크를 끈 채 원본으로 공개한다. 지금 failed로 닫혀 있는 참여작을 pending·시도 0으로 되돌려 새 규칙으로 다시
-- 집히게 한다 — 얼굴이 없으면 원본으로 공개되고, 그 밖의 실패는 상한까지 다시 시도한 뒤 failed로 닫힌다.
--
-- 워커가 집지 않는 참여작(삭제됨·계정이 활성이 아님·원본 파일이 파기됨)은 되돌리지 않는다 — 영원히 pending으로 남지 않게.
-- 데이터만 바꾸는 변경이다 — 스키마는 그대로이고, 직전 판 API 는 pending을 예전 규칙대로 처리한다.
UPDATE public.challenge_entries e
SET mosaic_status = 'pending', mosaic_attempts = 0
FROM public.videos v, public.users u
WHERE v.id = e.video_id
  AND u.id = e.user_id
  AND e.face_mosaic
  AND e.mosaic_status = 'failed'
  AND e.status <> 'deleted'
  AND e.deleted_at IS NULL
  AND u.status = 'active'
  AND v.purged_at IS NULL;
