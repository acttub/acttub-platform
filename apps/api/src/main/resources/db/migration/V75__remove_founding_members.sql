-- 창립 멤버(SOMA-861)를 뺀다. V68 은 dev DB 에 이미 들어가 있어 파일을 지우지 않고 여기서 표를 지운다.
-- 운영에는 V68 이 아직 안 들어갔다. 운영은 V68 과 이 판을 한 번에 지나가 V67 뒤와 같은 모양이 된다.
-- 입시 준비 첫 화면 되돌리기(V74, SOMA-864)보다 뒤에 머지해야 한다(Flyway 는 앞 번호를 나중에 받지 않는다).
DROP TABLE IF EXISTS public.founding_members;
