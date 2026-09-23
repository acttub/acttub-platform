# 리딩 파서 공통 검증 자료 (reading.script)

웹·앱 파서가 같은 입력에 같은 결과를 내는지 고정하는 샘플이다. 정본은 웹 갈래의
`apps/web/tests/reading/fixtures/`이고, 그 폴더가 생기면 앱 테스트(`tests/reading-script-fixtures.test.mjs`)가
그쪽도 함께 읽는다. 이 폴더는 웹 자료가 없을 때 시작한 앱 쪽 샘플이다.

- `NN-이름.txt`: 대본 원문. 파서에 그대로 넣는다.
- `NN-이름.expected.json`: 기대 결과 `{ title: string|null, roles: string[], lines: [{ kind, role?, text }] }`.
  `kind`는 `dialogue`·`direction`·`scene`이고 대사에만 `role`이 있다.

기대 결과는 `parseScript(원문)`의 출력을 사람이 확인해 굳힌 것이다. 파서 규칙을 바꾸면 JSON도 함께 고친다.
