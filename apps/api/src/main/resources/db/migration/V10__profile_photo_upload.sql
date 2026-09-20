-- 프로필 사진 올리기의 대기 상태 (SOMA-528, account.profile).
--
-- 프로필 사진은 영상과 같이 "주소 받기 → 직접 올리기 → 끝 알리기" 로 올린다. 주소를 받고 끝을
-- 알리기 전까지의 상태를 프로필 행에 둔다 — 사진은 한 장이라 대기 중인 올리기도 회원당 하나이고,
-- 새로 주소를 받으면 앞의 것을 덮어쓴다. 끝을 알리면 `photo_upload_key` 가 `photo_key` 로 옮겨지고
-- 네 컬럼은 다시 빈다.
--
-- `user_profiles` 는 V9 가 만든 테이블이라 직전 운영 태그의 서버는 이 테이블을 모른다. 컬럼은 전부
-- NULL 허용이다 — 넷은 함께 차고 함께 빈다.
ALTER TABLE public.user_profiles
    ADD COLUMN photo_upload_key text,
    ADD COLUMN photo_upload_mime_type text,
    ADD COLUMN photo_upload_size_bytes bigint,
    ADD COLUMN photo_upload_expires_at timestamp with time zone,
    ADD CONSTRAINT ck_user_profiles_photo_upload_together
        CHECK ((((photo_upload_key IS NULL) AND (photo_upload_mime_type IS NULL)
                 AND (photo_upload_size_bytes IS NULL) AND (photo_upload_expires_at IS NULL))
            OR ((photo_upload_key IS NOT NULL) AND (photo_upload_mime_type IS NOT NULL)
                 AND (photo_upload_size_bytes IS NOT NULL) AND (photo_upload_expires_at IS NOT NULL))));
