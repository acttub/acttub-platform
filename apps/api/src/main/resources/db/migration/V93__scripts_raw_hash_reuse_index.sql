-- 같은 글의 나누기 결과 재사용(다른 사람 것 포함)이 raw_hash 로 가장 최근 성공본을 찾는다.
CREATE INDEX idx_scripts_raw_hash_created ON public.scripts USING btree (raw_hash, created_at DESC);
