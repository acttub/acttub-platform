"""질문 문안 가드 — 규칙을 문구로 부탁하지 않고 검사로 강제한다.

볼트 하네스 `tools/question-prompt-test/real-agent-stub.mjs` 의 lintQ / echoHits 를
옮겨 왔다. 모델이 규칙을 흘리는 만큼 여기서 잡아 재생성시킨다.
"""

import re
from typing import Optional

BANNED: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"의도(한|하신)\s*(건가요|부분|거예요)|의도하신\s*거|그냥\s*(그렇게\s*)?나온"), "의도했나요 문형"),
    (re.compile(r"어떤\s*(생각|감정)\s*(이나\s*(생각|감정))?\s*때문에"), "원인 지정 문형"),
    (re.compile(r"\d+\s*초|\d{1,2}:\d{2}|데시벨|[0-9]+\s*회"), "계측치 나열"),
    # 한글 숫자로 쓰면 위 정규식을 빠져나간다 ("대략 이십 초가 넘는")
    (
        re.compile(
            r"(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|십|이십|삼십|사십|오십|수십|몇)"
            r"\s*(초|분|번|차례)(\s*(가|를|쯤|여|가량|정도|남|이상|넘))?"
        ),
        "계측치 나열 (한글 숫자)",
    ),
    (re.compile(r"하세요|해보세요|해야\s*(합니다|돼요|해요)|좋을\s*것\s*같아요"), "처방·지시 문형"),
    (re.compile(r"점수|등급|연기력|몰입도|진정성|합격|불합격"), "판정 어휘"),
    # 좋다/나쁘다 계열 활용형. 옛 guard 에 있던 목록이며 이식하면서 빠뜨렸다 — 되살린다.
    (re.compile(r"좋(다|아|은|았|네|겠)|나쁘|나빠|나쁜|나빴|훌륭|멋지|대단"), "좋다/나쁘다 판정"),
    # 1층 분석 어휘. 발화는 연기 현장 언어로만 한다 (옛 guard 목록 복원).
    (re.compile(r"피치|데시벨|헤르츠|구간|Hz|dB|severity|dimension"), "1층 분석 어휘 노출"),
    (re.compile(r"여쭤봐도\s*될까요|여쭈어도\s*될까요|여쭤도\s*될까요|여쭙고\s*싶|조심스럽"), "메타 서두·허락 구하기"),
    (re.compile(r"(아픔|슬픔|기쁨|분노)이\s*(느껴|전해)"), "감정 판단 어휘"),
    (
        re.compile(
            r"스타니슬랍스키|마이즈너|체홉|스트라스버그|알렉산더\s*테크닉|메소드\s*연기"
            r"|액팅\s*원|GOTE|프랙티컬\s*에스테틱스"
        ),
        "이론가·유파 이름 노출",
    ),
    # 내면·감정은 관찰이 아니다. hedge를 붙여도 화면에서 감정을 읽었다고 말한 것이다.
    (
        re.compile(
            r"(두려움|불안|슬픔|분노|아픔|기쁨|외로움|서러움|억울함|후회|절박함|초조함"
            r"|망설임|체념|긴장감)(이|을|도|만|가)?\s*"
            r"(스치|스쳐|스쳤|어리|어렸|묻어|묻었|비치|비쳐|비쳤|드러나|드러났|깃들|깃들었"
            r"|번지|번져|번졌|배어|배었|느껴|느꼈|전해|전했|읽히|읽혔|보이|보였|들리|들렸|묻혀)"
        ),
        "내면·감정을 관찰로 서술",
    ),
    (re.compile(r"말씀하신\s*것처럼\s*보였|하셨다는\s*게\s*보였"), "배우 발화를 영상 관찰로 귀속"),
    (
        re.compile(r"(최선의|더\s*(나은|좋은)|제대로\s*된|올바른|바람직한)\s*(행동|선택|방법|연기|접근|표현)"),
        "정답 전제 — 최선의 행동을 묻는다",
    ),
    (re.compile(r"[가-힣]{2,4}\s*씨(는|가|의|에게|한테|께)?\s"), "인물 이름+씨 — 배우를 부르는 말"),
    # 답변을 통째로 되풀고 질문을 붙이면 이해한 게 아니라 받아쓴 것으로 읽힌다 (화법 규칙 10).
    # 2026-07-28 실사용: 꼬리 질문 다섯 개가 전부 이 서두로 시작했다.
    (re.compile(r"^[^?]{0,40}(라고|다고)\s*하셨는데"), "배우 답변 되풀이 서두"),
    (re.compile(r"말씀하신\s*[\"'“”‘’]"), "배우 답변 되풀이 서두"),
    # 표현의 세기를 매기는 순간 그건 관찰이 아니라 연기 평가다 (가드레일 — 감정 전달력 판단 금지).
    # 2026-07-28 실사용: "감정의 고조가 약하게 표현된 것처럼 보였어요"
    (
        re.compile(
            r"(감정선|감정|고조|긴장감|몰입|에너지|톤|표현|전달력?)[^.?!]{0,12}"
            r"(약하|강하|부족|아쉽|밋밋|단조|평면|과하|옅|충분)"
        ),
        "연기 세기 판정",
    ),
]

# 발화는 한두 문장. 세 문장을 넘기면 배우가 읽다가 질문을 놓친다 (화법 규칙 0).
_SENTENCE_END = re.compile(r"[.!?…]")
MAX_SENTENCES = 2

# 몸·소리 관찰을 인용하면 hedge가 반드시 붙어야 한다 — 문구가 아니라 검사로 강제한다.
OBSERVATION_NOUN = re.compile(r"입꼬리|시선|눈빛|숨소리|호흡|어깨|손끝|턱|목소리|말투|템포|침묵|정지|움직임|고개|미간")
HEDGE = re.compile(r"처럼|듯|보였|들렸|보이던|들리던|같았")
# 이지선다. 말끝이 '까요'만 있는 게 아니다 — '건가요?'·'거였나요?' 도 같은 형태다.
BINARY = re.compile(r"아니면[^?]{0,60}(까요|가요|나요|어요|예요|에요)\s*\?")
ALLOWED_CONTRAST = re.compile(r"같(은|을|이)[^?]{0,40}(달라|바뀌|변했|변화)")
QUOTED = re.compile(r"[\"'“”‘’][^\"'“”‘’]*[\"'“”‘’]")
# 앞 글자가 한글이면 다른 낱말의 일부다 — '하나를'이 '나를'로 잡히던 오탐을 막는다.
FIRST_PERSON = re.compile(r"(?<![가-힣])(나에게|나를|나의|내가|나한테|제가|저에게|저를|저한테)")

FALLBACK_QUESTION = "이 장면에서 인물이 원하는 게 뭐예요?"


def lint_question(question: str) -> list[str]:
    q = question or ""
    hits = [label for pattern, label in BANNED if pattern.search(q)]
    if OBSERVATION_NOUN.search(q) and not HEDGE.search(q):
        hits.append("관찰 인용에 hedge 없음")
    if BINARY.search(q) and not ALLOWED_CONTRAST.search(q):
        hits.append("이지선다 — 배우에게 보기를 줌")
    if FIRST_PERSON.search(QUOTED.sub("", q)):
        hits.append("인물을 '나'로 지칭 — 주어가 배우로 넘어감")
    if len(_SENTENCE_END.findall(q)) > MAX_SENTENCES:
        hits.append("발화가 세 문장 이상 — 한두 문장으로")
    return hits


# ── 입력 되읽기 ─────────────────────────────────────────────────
# 배우가 적은 상황·목표의 어절을 질문이 그대로 옮기면 "요약해서 돌려주는" 질문이 된다.
# 실측 보정: 되읽기 출력은 7~11개, 읽어낸 형태는 0개로 갈렸다 → 임계값 4.
# 인물(이름)은 세지 않는다 — 이름을 부르는 건 되읽기가 아니다.
_PARTICLE = re.compile(
    r"(으로서|이라고|에게서|에서|으로|라고|에게|한테|부터|까지|처럼|보다|와의|과의"
    r"|은|는|이|가|을|를|에|의|와|과|도|만|로|랑|께|야|여)$"
)
_ECHO_STOP = {
    "장면", "순간", "인물", "사람", "것을", "그리고", "하는", "있는", "되는", "위해",
    "상대", "마음", "목표", "목적", "감정", "생각", "이야기", "말하", "하기", "하고",
    "하며", "않고", "여기", "여기서", "거기", "자기", "지금", "어떤", "무엇", "때문", "대해", "통해",
}
ECHO_LIMIT = 4
_SPLIT = re.compile(r"[\s,·.!?\"'“”‘’()\[\]…]+")


def echo_tokens(text: Optional[str]) -> set[str]:
    out: set[str] = set()
    for word in _SPLIT.split(str(text or "")):
        word = _PARTICLE.sub("", word)
        if len(word) >= 2 and word not in _ECHO_STOP:
            out.add(word)
    return out


def echo_hits(question: str, situation: str, goal: str) -> list[str]:
    source = f"{situation or ''} {goal or ''}"
    return sorted(t for t in echo_tokens(source) if t in (question or ""))
