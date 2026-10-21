# apps/pron — 리딩 발음 채점 서비스 (SOMA-606)

api 가 리딩 회차의 줄 녹음을 보내 음소별 점수(lpr)를 받는 내부 서비스. 외부 API 를 쓰지 않는다(비용 없음).

- 모델: [slplab/wav2vec2-xls-r-300m_phone-mfa_korean](https://huggingface.co/slplab/wav2vec2-xls-r-300m_phone-mfa_korean) (Apache-2.0). 이미지 빌드 때 받아 넣는다.
- 방법: 대본 → 표준 발음 음소열 → CTC-GOP(대본대로 vs 한 소리를 바꾼 것)로 lpr. `lpr < -3` 이고 모음↔모음·자음↔자음이면 짚는다.
- 대본의 지문 괄호는 지우고 숫자는 한글 읽기로 바꾼 뒤 채점한다. 숫자가 든 어절은 짚지 않는다.
- `POST /score`(audio, text) → 어절마다 음소의 `expected`·`heard`·`lpr`·`syllable`·`start_ms`·`end_ms`·`flagged`.
- CPU 전용. `PRON_THREADS`(기본 2)로 torch 스레드를 묶는다. 운영 서버 CPU 에서 한 줄에 몇 초 걸리는지는 아직 재지 않았다.

로컬: `pip install -r requirements.txt && uvicorn app:app --port 8000`, 테스트: `pytest tests`(모델 없이 도는 규칙만).
한계·검증 상태: 로컬 실험(배우 8명 168줄)과 사람 청취 48줄 확인뿐이다. 정확도는 검증되지 않았다.
