# apps/pron — 리딩 발음 채점 서비스 (SOMA-606)

api 가 리딩 회차의 줄 녹음을 보내 음소별 점수(lpr)를 받는 내부 서비스. 외부 API 를 쓰지 않는다(비용 없음).

- 모델: [slplab/wav2vec2-xls-r-300m_phone-mfa_korean](https://huggingface.co/slplab/wav2vec2-xls-r-300m_phone-mfa_korean) (Apache-2.0). 이미지 빌드 때 받아 넣는다.
- 방법: 대본 → 표준 발음 음소열 → CTC-GOP(대본대로 vs 한 소리를 바꾼 것)로 lpr. `lpr < -3` 이고 모음↔모음·자음↔자음이면 짚는다.
- 대본의 지문 괄호는 지우고 숫자는 한글 읽기로 바꾼 뒤 채점한다. 숫자가 든 어절은 짚지 않는다.
- `POST /score`(audio, text) → 어절마다 음소의 `expected`·`heard`·`lpr`·`syllable`·`start_ms`·`end_ms`·`flagged`.
- 줄 녹음의 소리 없는 앞뒤를 잘라 내고 채점한다(시각은 원래 녹음 기준으로 되돌린다). 잘라도 `PRON_MAX_SECONDS`(기본 30초)보다 길면 422 `audio_too_long`. api 는 1분 넘는 줄은 보내지 않고, 줄 하나가 실패하면 그 줄만 빼고 보고서를 만든다.
- `script_match`: 모델이 녹음에서 바로 알아들은 음소열이 대본과 얼마나 같은지(0~1). 앱 받아쓰기가 잘려도 대본대로 읽었는지 다시 본다(api 는 0.7 이상이면 쓴다).
- ㅘ·ㅙ·ㅝ·ㅟ·ㅢ 는 표준 발음 낭독에서도 12~33% 짚혀 짚지 않는다.
- `POST /measure`(audio, text): 리딩 녹음 코치용 소리 값(크기·빠르기·쉼·끝 높이·끝 크기). 모델 없이 파형만 본다.
- CPU 전용. `PRON_THREADS`(기본 2)로 torch 스레드를 묶는다. 운영 서버 CPU 에서 한 줄에 몇 초 걸리는지는 아직 재지 않았다.

로컬: `pip install -r requirements.txt && uvicorn app:app --port 8000`, 테스트: `pytest tests`(모델 없이 도는 규칙만).
한계·검증 상태: 로컬 실험(배우 8명 168줄)과 사람 청취 48줄 확인뿐이다. 정확도는 검증되지 않았다.
