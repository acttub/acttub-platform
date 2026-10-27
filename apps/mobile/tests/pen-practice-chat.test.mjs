import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// pen 「acttub 앱 파이프라인 반영버전」 ③ 코칭 준비(03-practice)·⑨ 코칭 대화(09-chat)·⑪ 챌린지 완료(10-11) 수치를 잠근다.
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('③ 단계 표시: 동그라미 20 · 번호 13/700 · 이름 14/700 · 사이 줄 18, 간격 10', () => {
  const chrome = read('components/practice-chrome.tsx');
  assert.match(chrome, /stepper: \{ flexDirection: 'row', alignItems: 'center', gap: 10 \}/);
  assert.match(chrome, /stepperLine: \{ width: 18, height: 1, backgroundColor: palette\.border \}/);
  assert.match(chrome, /width: 20,\s*height: 20,\s*borderRadius: 10,/);
  assert.match(chrome, /circleText: \{ fontSize: 13, fontWeight: '700'/);
  assert.match(chrome, /stepperLabel: \{ fontSize: 14, fontWeight: '700', color: palette\.textMeta \}/);
  assert.doesNotMatch(chrome, /stepperLabelOn: \{ fontWeight: '900'/);
});

test('③ 새 연습: 머리 오른쪽 설정, 본문 좌우 24, 권리 체크 15/700 · 버튼 52 · 안내 14/500', () => {
  const upload = read('app/upload.tsx');
  assert.match(upload, /headerRight: firstTimeUser\s*\? \(\) => \(\s*<NavIconButton icon="settings"/);
  assert.match(upload, /stepBody: \{ paddingTop: 16, paddingHorizontal: 24,/);
  assert.match(upload, /rightsText: \{ flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 21, color: palette\.text \}/);
  assert.match(upload, /submit: \{ height: 52, borderRadius: 16,/);
  assert.match(upload, /submitText: \{ fontSize: 17, fontWeight: '700'/);
  assert.match(upload, /submitTextDisabled: \{ color: palette\.textDisabled \}/);
  assert.match(upload, /submitHint: \{ fontSize: 14, fontWeight: '500', color: palette\.textMeta/);
  // 고른 영상: 높이 178 · 모서리 22, 「영상 다시 선택」 알약 28 · 15/700, 「저장했어요」 15/500.
  assert.match(upload, /preview: \{ width: '100%', height: 178, borderRadius: 22,/);
  assert.match(upload, /repick: \{ height: 28, borderRadius: 14,/);
  assert.match(upload, /repickText: \{ fontSize: 15, fontWeight: '700'/);
  assert.match(upload, /pickedMeta: \{ flex: 1, fontSize: 15, fontWeight: '500'/);
});

test('⑨ 액티 머리줄은 한 부품 — 액티 30×36 · 「액티」 15/800 · 회색 말풍선 모서리 18', () => {
  const message = read('components/coach-message.tsx');
  assert.match(message, /MASCOT_SIZE\.chat/);
  assert.match(read('components/ui/mascot.ts'), /chat: \{ width: 30, height: 36 \}/);
  assert.match(message, /name: \{ fontSize: 15, fontWeight: '800', lineHeight: 19, color: palette\.text \}/);
  assert.match(message, /bubble: \{[^}]*borderRadius: 18,[^}]*paddingVertical: 13,[^}]*paddingHorizontal: 12/);
  for (const file of ['app/coach.tsx', 'components/coach-waiting.tsx']) {
    assert.match(read(file), /<CoachMessage/, file);
  }
});

test('⑨ 오늘 영상 줄: 썸네일 56 · 재생 원 32 · 17/700 · 15/500', () => {
  const row = read('components/coach-video-row.tsx');
  assert.match(row, /thumb: \{ width: 56, height: 56, borderRadius: 14,/);
  assert.match(row, /thumbPlay: \{ width: 32, height: 32, borderRadius: 16, backgroundColor: palette\.text,/);
  assert.match(row, /title: \{ fontSize: 17, fontWeight: '700', lineHeight: 21/);
  assert.match(row, /sub: \{ fontSize: 15, fontWeight: '500', lineHeight: 19/);
});

test('⑨ 질문 대화: 제목 「질문 대화」 고정, 그만하기 17/700, 카톡식으로 쌓이는 대화, 세로 예시 답 칩, 입력 줄', () => {
  const coach = read('app/coach.tsx');
  // 머리는 화면 안 NavHeader 로 그린다(iOS 기본 머리 headerRight 누름 씹힘, 10/23). 제목 고정, 오른쪽에 그만하기.
  assert.match(coach, /<NavHeader\s+title=\{t\('coach\.fallbackTitle'\)\}[\s\S]{0,900}right=\{/);
  assert.match(coach, /endText: \{ fontSize: 17, fontWeight: '700', lineHeight: 21, color: palette\.textMeta \}/);
  // 10/23 pen: 지난 문답을 접지 않고 카톡처럼 쌓는다. 예시 답 칩은 세로로 한 줄씩, 글자 길이만큼.
  assert.doesNotMatch(coach, /pastOpen|pastToggle|quickRow/);
  assert.doesNotMatch(coach, /quickWrite|'write'/);
  assert.match(coach, /\{messages\.map\(\(message, index\) =>/);
  assert.match(coach, /exampleChoices: \{ flexDirection: 'column', alignItems: 'flex-start', gap: 6,/);
  assert.match(coach, /purposeChoiceText: \{ fontSize: 13\.5, fontWeight: '600'/);
  assert.match(coach, /chipGuide: \{ fontSize: 15, fontWeight: '700', lineHeight: 19, color: palette\.blueDeep \}/);
  assert.match(coach, /send: \{ width: 39, height: 39, borderRadius: 20,/);
  assert.match(coach, /fontSize: 17,\s*fontWeight: '500',/);
  const ko = read('locales/ko.ts');
  assert.match(ko, /chipGuide: '답이나 질문을 편하게 적어 주세요'/);
  assert.match(ko, /composerPh: '직접 써도 돼요'/);
});

test('⑨ 영상 보는 중: 경과 15/500, 예시 안내 15, 「끝나면 알려 주세요」 회색 48 · 18/700, 그만두기 15/700', () => {
  const waiting = read('components/coach-waiting.tsx');
  assert.match(waiting, /elapsed: \{ fontSize: 15, fontWeight: '500', lineHeight: 19, color: palette\.textMeta \}/);
  assert.match(waiting, /notice: \{ fontSize: 15, fontWeight: '500', lineHeight: 19,/);
  assert.match(waiting, /notify: \{ alignSelf: 'stretch', height: 48, borderRadius: 16, backgroundColor: palette\.bgSoft,/);
  assert.match(waiting, /notifyText: \{ fontSize: 18, fontWeight: '700', color: palette\.text \}/);
  assert.match(waiting, /link: \{ color: palette\.textMeta, fontSize: 15, fontWeight: '700'/);
});

test('C9.12·C19 챌린지 완료: 올리기·마무리가 같은 ChallengeDone 모양(액티 + 제목 22/800 + 한 줄 + 이어갈 줄 + 홈으로 가기)', () => {
  const upload = read('app/challenge-upload.tsx');
  const done = read('components/challenge-done.tsx');
  assert.match(upload, /<ChallengeDone/);
  assert.match(done, /source=\{MASCOTS\.cheer\}/);
  assert.match(done, /title: \{ fontSize: 24, fontWeight: '800'/);
  assert.match(upload, /router\.push\('\/upload'\)/);
  assert.doesNotMatch(upload, /reportHint|\/ai-report/);
});
