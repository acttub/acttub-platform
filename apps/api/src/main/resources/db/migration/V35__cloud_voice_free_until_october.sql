-- 고품질 목소리 무료 기간을 11월 30일에서 10월 31일(KST)까지로 줄인다(reading.cloud-voice).
-- 첫 포스터(V29)의 끝과 문구를 맞춘다. 끝은 KST 11/1 00:00 이다. 내용만 고치고 revision 은 그대로 둔다 —
-- 「다시 보지 않기」를 누른 사람에게 다시 띄우지 않는다.
UPDATE public.app_posters
SET ends_at = '2026-10-31T15:00:00Z',
    badge = '출시 기념 · 10월 31일까지 무료',
    body = '대본 리딩 상대 대사를 더 자연스러운 AI 목소리로. 10월 말까지 무료예요.',
    updated_at = now()
WHERE slug = 'cloud-voice-launch' AND locale = 'ko';

UPDATE public.app_posters
SET ends_at = '2026-10-31T15:00:00Z',
    badge = 'Launch offer · Free until Oct 31',
    body = 'Hear scene-partner lines in a more natural AI voice during script reading. Free through October.',
    updated_at = now()
WHERE slug = 'cloud-voice-launch' AND locale = 'en';
