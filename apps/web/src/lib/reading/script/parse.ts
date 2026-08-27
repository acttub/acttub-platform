/**
 * 대본 텍스트 → 배역·대사 구조.
 *
 * 지원 형식
 *  - 콜론:   `지수: 대사` (전각 콜론 `：`·`지수 : 대사`도 받음)
 *  - 블록:   `지수` 한 줄 + 다음 줄부터 빈 줄 전까지 대사
 *  - 공백:   `강호 대사` (한국 연극 대본식 — 콜론·블록이 하나도 없을 때만)
 *  - 지문:   `(…)`·`[…]`로 감싼 한 줄, `이름, 행동` 꼴
 *
 * 배역 판별은 빈도 기반이다 — 이름 꼴이고 2회 이상 나오면 배역. 한 번만 나온 이름은
 * 사용자가 힌트(roleHints)로 올려 줄 수 있다.
 */

export type DialogueLine = { type: "dialogue"; role: string; text: string };
export type DirectionLine = { type: "direction"; text: string };
export type ScriptLine = DialogueLine | DirectionLine;

export interface ParsedScript {
  title: string | undefined;
  roles: string[];
  lines: ScriptLine[];
}

export interface ParseOptions {
  /** 배역으로 취급할 이름. 본문에 한 번이라도 나와야 채택된다. */
  roleHints?: string[];
  /** true면 힌트에 있는 이름만 배역으로 쓴다. */
  onlyHints?: boolean;
  /**
   * 배역에서 빼기로 한 이름. 형식이 제각각이라 자동 판별이 늘 맞을 수는 없어서
   * 화면에서 직접 뺄 수 있게 한다. 뺀 이름의 줄은 지문으로 내려간다.
   */
  excludeRoles?: string[];
}

/** 배역별로 대사가 몇 줄인지 — 많이 말하는 순으로 보여 주기 위해 쓴다. */
export function countLinesByRole(lines: ScriptLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.type !== "dialogue") continue;
    counts.set(l.role, (counts.get(l.role) ?? 0) + 1);
  }
  return counts;
}

const NAME_RE = /^[가-힣A-Za-z0-9·]{1,6}$/;
/** `[지수] 대사` — 이름만 감싸고 뒤에 대사가 온다. 한글 파일 대본에 흔하다. */
const BRACKET_ROLE_RE = /^[[［【]\s*([가-힣A-Za-z0-9·]{1,6})\s*[\]］】]\s*(.+)$/;
/** 문서에서 딸려 오는 쪽 표시 — 본문이 아니다 */
const PAGE_MARK_RE = /^(?:[-–—]\s*\d+\s*[-–—]|[[［【]?\s*(?:페이지|쪽|면)\s*[\]］】]?\s*\S{0,6})$/;
/**
 * 한글 파일을 옮기면 문서 구조가 `[장] 제1장` 꼴로 남는다. 배역 형식과 똑같이 생겨서
 * 그냥 두면 "장"이 배역이 된다. 사람이 말하는 말이 아니므로 지문으로 내린다.
 */
const STRUCTURE_WORDS = new Set(["장", "막", "씬", "신", "화"]);
/**
 * 한글 파일에서 남는 `<<0>><<것>>` 꼴. 앞의 숫자는 표시일 뿐이고 뒤쪽은 진짜 글자를
 * 감싸고 있다 — 통째로 지우면 본문이 사라지므로 표시만 빼고 껍데기는 벗긴다.
 */
const MARKUP_INDEX_RE = /<<\d*>>/g;
const MARKUP_WRAP_RE = /<<([^>]*)>>/g;
const WRAPPED_DIRECTION_RE = /^[(\[（【].*[)\]）】]$/;
const NAME_COMMA_DIRECTION_RE = /^[가-힣A-Za-z0-9·]{1,6},\s*\S/;
const MIN_ROLE_COUNT = 2;

/**
 * `사    장 :`·`칠    수 :` — 이름을 한 글자씩 띄워 세로줄을 맞춘 대본이 있다(칠수와 만수).
 * 그대로 두면 첫 글자만 이름이 된다. 한 글자짜리 어절만 이어진 이름은 붙인다.
 * `코라 야코 :` 처럼 두 글자 이상 어절이 섞이면 건드리지 않는다.
 */
const PADDED_NAME_RE = /^((?:\S[ \t]+){1,4}\S)[ \t]*:/;

function joinPaddedName(line: string): string {
  return line.replace(PADDED_NAME_RE, (_m, name: string) => `${name.replace(/\s+/g, "")}:`);
}

function normalize(raw: string): string[] {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/：/g, ":")
    .split("\n")
    .map((l) => joinPaddedName(l).replace(MARKUP_INDEX_RE, "").replace(MARKUP_WRAP_RE, "$1").replace(/\s+/g, " ").trim())
    // 쪽 표시는 대사 사이에 끼어 흐름을 끊는다. 빈 줄로 만들어 없던 것으로 둔다.
    .map((l) => (PAGE_MARK_RE.test(l) ? "" : l));
}

/** 콜론 앞 이름은 `린데 부인 :`·`코라 야코 :` 처럼 두 어절까지 받는다. */
const COLON_NAME_RE = /^[가-힣A-Za-z0-9·]{1,6}(?: [가-힣A-Za-z0-9·]{1,6})?$/;

function splitColon(line: string): { name: string; text: string } | null {
  const idx = line.indexOf(":");
  if (idx <= 0) return null;
  const name = line.slice(0, idx).trim();
  const text = line.slice(idx + 1).trim();
  if (!COLON_NAME_RE.test(name) || !text) return null;
  return { name, text };
}

/**
 * 막·장 표시와 무대 지시어는 화자 자리에 나와도 배역이 아니다.
 * 실물 대본에서 `1막 :`·`잠시 :`·`사이 :` 가 배역으로 잡혔다.
 */
const STAGE_WORDS = new Set(["잠시", "사이", "침묵", "암전", "조명", "음악", "효과음", "무대", "막", "장", "프롤로그", "에필로그", "서막", "종막"]);
const ACT_MARK_RE = /^(?:제\s*)?\d+\s*(?:막|장|경|부|씬|신)(?:\s*\d+\s*(?:장|경|씬|신))?$/;

function isStageWord(name: string): boolean {
  return STAGE_WORDS.has(name) || ACT_MARK_RE.test(name);
}

// ─── 등장인물 목록 ────────────────────────────────────────────────────────────
//
// 대본 첫머리의 등장인물 목록이 배역의 기준이다. 실물 대본에서 본 표기:
//   등장인물 / 나오는 사람들 / -나오는 사람들- / [등장 인물] / 등장인물 (등장 순서대로)
//   한 줄에 하나 · 한 줄에 공백으로 나열 · `/` 로 나열 · `1. 헬머 ------ 변호사` · `벤 - 선실 급사 소년`
//   `1번 배심원(배심원장)` · `자원봉사자 (20대) -이하 자봉으로 표기-` · `엠미, 봅, 이바르`
// 화자 표기는 목록과 어긋나기 일쑤라(`3번` ↔ `3번 배심원`, `박사` ↔ `로다 박사`, `린데부인` ↔ `린데 부인`)
// 이름 전체·어절·괄호 안·설명 어절을 전부 별칭으로 두고 접두·접미로 맞춘다.

const CAST_HEADER_RE = /^[-–—[［【(\s]*(?:등장\s*인물(?:\s*소개)?|나오는\s*사람들?|배\s*역)\s*[-–—\]］】)]*\s*:?\s*(.*)$/;
const CAST_MAX_LINES = 60;
const CAST_MAX_BLANKS = 3;
/** 목록에 없는 화자를 배역으로 받아 주는 선 — 표기가 어긋난 주연을 놓치지 않기 위한 안전판 */
const OFF_CAST_MIN_LINES = 8;
const OFF_CAST_MIN_SHARE = 0.01;
/** 목록 안의 때·곳 항목 — 사람이 아니다 */
const CAST_SKIP_RE = /^(?:때|곳|장소|시간|시대|배경|무대|때와\s*곳|시간과\s*장소)\b/;
/**
 * 화자 자리에 홀로 서면 안 되는 한 글자 — 조사·관형사·수사. PDF 는 줄을 문장 중간에서 끊어서
 * `이`·`을`·`는` 같은 조각이 줄머리에 온다. `얀`·`웹`·`쌤`·`형` 같은 진짜 한 글자 이름은 여기 없다.
 */
const SINGLE_CHAR_STOP = new Set(["이", "가", "은", "는", "을", "를", "의", "에", "로", "도", "와", "과", "고", "지", "게", "한", "두", "세", "그", "저", "제", "번", "채", "등", "및", "또", "더", "곧", "못", "안", "잘", "다", "뭐", "왜", "자", "거", "것", "좀"]);

interface CastList {
  /** 화자 표기를 맞춰 볼 별칭 — 이름·어절·괄호 안·설명 어절·조사 뗀 어절 (공백 없는 소문자) */
  aliases: Set<string>;
  /** 목록에 적힌 그대로의 이름과 어절. "이름에 조사가 붙었나"를 볼 때만 쓴다 — 조사 뗀 것을 여기 넣으면 `페르난도`가 `페르난`+도 로 보인다 */
  names: Set<string>;
  /** 여러 항목에 걸친 어절(성). 화자 표기가 이것과 같으면 누구인지 알 수 없으므로 맞춰 주지 않는다 */
  ambiguous: Set<string>;
  /** normalize 된 줄 배열에서 목록이 차지하는 [시작, 끝) */
  start: number;
  end: number;
}

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function isCastStop(line: string): boolean {
  if (ACT_MARK_RE.test(line.replace(/\s+/g, "")) || /^(?:제\s*)?\d+\s*(?:막|장)\b/.test(line)) return true;
  if (/^(?:프롤로그|서막|에필로그)/.test(line)) return true;
  if (isStructureMark(line) || /^[<＜〈].*[>＞〉]$/.test(line)) return true;
  // `사몬 모리오(남) 목격자, 취미로 소설을 쓴다.` — 설명이 마침표로 끝나도 목록 항목이다.
  // 이름 바로 뒤에 괄호(성별·나이)가 오면 그렇게 본다.
  const looksLikeEntry = /^[^,()（）]{1,20}[(（][^)）]*[)）]/.test(line);
  if (!looksLikeEntry && /[.。!?]$/.test(line)) return true; // 문장이다
  if (!looksLikeEntry && line.length > 60) return true;
  const bracket = splitBracket(line);
  if (bracket) return true;
  const colon = splitColon(line);
  if (colon) return true;
  return false;
}

function addAlias(set: Set<string>, s: string) {
  const v = squash(s.replace(/[()（）[\]［］【】"“”'‘’]/g, " "));
  if (v.length >= 2 || (v.length === 1 && /[가-힣]/.test(v))) set.add(v);
}

/** 목록 한 줄에서 이름과 별칭을 뽑는다. */
interface CastDraft {
  aliases: Set<string>;
  names: Set<string>;
  /** 어절이 몇 항목에 나왔나 — 둘 이상이면 성(姓) 같은 공통 어절이라 누구도 가리키지 않는다 */
  tokenHits: Map<string, number>;
}

function castEntries(line: string, cast: CastDraft) {
  const { aliases, names } = cast;
  let l = line.replace(/^\d+\s*[.)]\s*/, "").trim();
  if (!l || CAST_SKIP_RE.test(l)) return;
  // "-이하 자봉으로 표기-"
  const short = /이하\s*(\S+?)\s*(?:으로|로)\s*표기/.exec(l);
  if (short) {
    addAlias(aliases, short[1]);
    addAlias(names, short[1]);
    l = l.replace(/[-–—]?\s*이하[^-–—]*표기\s*[-–—]?/, " ").trim();
  }
  const pieces = l.includes("/") ? l.split(/\s*\/\s*/) : [l];
  for (const piece of pieces) {
    if (!piece.trim()) continue;
    // 괄호 안은 별칭 (배심원장) — 나이 표기 (20대) 같은 것도 들어가지만 화자로 쓰일 일이 없다
    for (const m of piece.matchAll(/[(（]([^)）]*)[)）]/g)) {
      addAlias(aliases, m[1]);
      addAlias(names, m[1]);
    }
    const bare = piece.replace(/[(（][^)）]*[)）]/g, " ").trim();
    // `헬머 ------ 변호사`, `벤 - 선실 급사 소년`, `죠어- 작살잡이` → 이름 | 설명
    const [namePart, ...descParts] = bare.split(/\s*-{2,}\s*|\s*[-–—]\s+|\s*:\s+/);
    for (const d of descParts) for (const t of d.split(/[\s,]+/)) addAlias(aliases, t);
    // `엠미, 봅, 이바르`
    for (const n of namePart.split(/\s*,\s*/).filter(Boolean)) {
      addAlias(aliases, n);
      addAlias(names, n);
      const tokens = n.split(/\s+/);
      for (const t of tokens) {
        addAlias(aliases, t);
        addAlias(names, t);
        // `재판장의 목소리` → `재판장` 도 별칭으로. 화자 표기는 보통 조사 없이 `재판장 :` 이다
        const base = stripParticle(t);
        if (base && base.length >= 2) addAlias(aliases, base);
        // 성(姓)처럼 여러 항목에 걸치는 어절은 뒤에서 걷어낸다 — `사몬 모리오`·`사몬 요이치` 의 `사몬` 은 누구도 아니다
        if (tokens.length >= 2) cast.tokenHits.set(squash(t), (cast.tokenHits.get(squash(t)) ?? 0) + 1);
      }
    }
  }
}

function extractCast(lines: string[]): CastList | null {
  const headerAt = lines.findIndex((l, i) => i < 80 && CAST_HEADER_RE.test(l));
  if (headerAt < 0) return null;
  const cast: CastDraft = { aliases: new Set(), names: new Set(), tokenHits: new Map() };
  const rest = CAST_HEADER_RE.exec(lines[headerAt])![1].replace(/^[(（][^)）]*[)）]\s*/, "").trim();
  if (rest) castEntries(rest, cast);

  let end = headerAt + 1;
  let blanks = 0;
  for (let j = headerAt + 1; j < lines.length && j < headerAt + CAST_MAX_LINES; j++) {
    const line = lines[j];
    if (line === "") {
      blanks++;
      if (blanks > CAST_MAX_BLANKS) break;
      continue;
    }
    if (isCastStop(line)) break;
    blanks = 0;
    castEntries(line, cast);
    end = j + 1;
  }
  // 여러 항목에 걸치는 어절(성)은 누구도 가리키지 않으므로 뺀다
  const ambiguous = new Set<string>();
  for (const [t, hits] of cast.tokenHits) {
    if (hits >= 2) {
      cast.aliases.delete(t);
      cast.names.delete(t);
      ambiguous.add(t);
    }
  }
  // 이름이 두 개는 나와야 목록이라고 본다
  if (cast.names.size < 2) return null;
  return { aliases: cast.aliases, names: cast.names, ambiguous, start: headerAt, end };
}

/**
 * `촐레가`·`경비가`·`마카베는`·`재판장의` — 이름에 조사가 붙은 것은 화자가 아니라
 * "촐레가 들어온다" 같은 지문의 첫 어절이다. 이름 자체가 따로 있을 때만 그렇게 본다.
 */
const PARTICLE_RE = /(?:이|가|은|는|을|를|과|와|의|도|만|에|에게|한테|께서|에서|으로|로)$/;

function stripParticle(name: string): string | null {
  const m = PARTICLE_RE.exec(name);
  if (!m || m.index < 1) return null;
  return name.slice(0, m.index);
}

/**
 * 화자 표기가 목록의 어느 이름과 맞는지.
 *  exact — 이름·어절·별칭과 똑같다. 한 줄만 말해도 배역이다(심부름꾼).
 *  fuzzy — 앞이나 뒤가 겹친다(`3번`↔`3번 배심원`, `박사`↔`로다 박사`, `깁스부인`↔`깁스`). 두 줄은 말해야 배역이다.
 * 이름 뒤에 붙은 것이 조사이거나 세 글자 이상이면(`뉴욕지방법원`↔`뉴욕`) 겹친 것으로 치지 않는다.
 */
function castMatch(label: string, cast: CastList): "exact" | "fuzzy" | null {
  const l = squash(label);
  if (!l || /^\d+$/.test(l) || cast.ambiguous.has(l)) return null;
  if (cast.aliases.has(l)) return "exact";
  const base = stripParticle(l);
  if (base && cast.names.has(base)) return null;
  for (const a of cast.aliases) {
    if (l.length >= 2 && (a.startsWith(l) || a.endsWith(l))) return "fuzzy";
    if (a.length >= 2 && l.startsWith(a)) {
      const rest = l.slice(a.length);
      if (rest.length <= 2 && !PARTICLE_RE.test(rest)) return "fuzzy";
    }
  }
  return null;
}

function splitBracket(line: string): { name: string; text: string } | null {
  const m = BRACKET_ROLE_RE.exec(line);
  if (!m) return null;
  const name = m[1];
  // 문서 구조 표시와 숫자뿐인 이름은 사람이 아니다.
  if (STRUCTURE_WORDS.has(name) || /^\d+$/.test(name)) return null;
  return { name, text: m[2].trim() };
}

/** `[장] 제1장` 처럼 구조를 알려 주는 줄인지 */
function isStructureMark(line: string): boolean {
  const m = BRACKET_ROLE_RE.exec(line);
  return m !== null && STRUCTURE_WORDS.has(m[1]);
}

function splitSpace(line: string): { name: string; text: string } | null {
  const idx = line.indexOf(" ");
  if (idx <= 0) return null;
  const name = line.slice(0, idx);
  const text = line.slice(idx + 1).trim();
  if (!NAME_RE.test(name) || !text) return null;
  return { name, text };
}

function isSoloName(line: string): boolean {
  return NAME_RE.test(line);
}

function isWrappedDirection(line: string): boolean {
  return WRAPPED_DIRECTION_RE.test(line);
}

function stripWrap(line: string): string {
  return line.replace(/^[(\[（【]\s*/, "").replace(/\s*[)\]）】]$/, "");
}

/** 등장 순서를 지키면서 빈도를 센다. */
class Counter {
  private counts = new Map<string, number>();
  add(name: string) {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }
  atLeast(n: number): string[] {
    return [...this.counts.entries()].filter(([, c]) => c >= n).map(([name]) => name);
  }
  has(name: string) {
    return this.counts.has(name);
  }
  countOf(name: string): number {
    return this.counts.get(name) ?? 0;
  }
  total(): number {
    let t = 0;
    for (const c of this.counts.values()) t += c;
    return t;
  }
}

/**
 * 한두 줄만 걸린 이름을 걷어낸다.
 *
 * 실물 대본에서 배역이 87명, 145명씩 잡히는 일이 있었다. 대부분은 줄머리에 두 번
 * 나온 조사나 부사였다. 진짜 배역은 대사를 여러 번 말하므로, 가장 많이 말하는
 * 배역에 견주어 너무 적게 말하는 이름은 뺀다.
 *
 * 세게 자르지는 않는다. 대사 두어 줄짜리 조연은 진짜 배역이고, 그런 배역과
 * 연습하고 싶을 수도 있다. 여기서는 "압도적으로 적은" 것만 걷어내고, 나머지 판단은
 * 사람에게 맡긴다 — 화면에서 배역을 빼고 더할 수 있다.
 */
function pruneRare(names: string[], counter: Counter): string[] {
  if (names.length <= 2) return names;
  const top = Math.max(...names.map((n) => counter.countOf(n)));
  const floor = Math.max(MIN_ROLE_COUNT, top * 0.02);
  return names.filter((n) => counter.countOf(n) >= floor);
}

/**
 * 배역 후보를 센다. 콜론·블록 형식이 우선이고, 둘 다 없을 때만 공백 형식을 본다 —
 * 공백 형식은 평범한 문장의 첫 어절("오늘 날씨…")도 이름처럼 보여서 오탐이 많다.
 */
function countCandidates(lines: string[]): { primary: Counter; space: Counter; strong: Set<string> } {
  const primary = new Counter();
  const space = new Counter();
  // 콜론·대괄호로 화자임이 분명한 이름. 줄이 끊겨 생긴 후보(`그녀는` 한 줄)와 구분한다.
  const strong = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || isWrappedDirection(line)) continue;
    const bracket = splitBracket(line);
    if (bracket) {
      primary.add(bracket.name);
      strong.add(bracket.name);
      continue;
    }
    const colon = splitColon(line);
    if (colon) {
      primary.add(colon.name);
      strong.add(colon.name);
      continue;
    }
    if (isSoloName(line)) {
      const next = lines.slice(i + 1).find((l) => l !== "");
      if (next && !isSoloName(next) && !isWrappedDirection(next)) primary.add(line);
      continue;
    }
    if (NAME_COMMA_DIRECTION_RE.test(line)) continue;
    const sp = splitSpace(line);
    if (sp) space.add(sp.name);
  }
  return { primary, space, strong };
}

interface Resolved {
  roles: string[];
  spaceMode: boolean;
  /** 등장인물 목록이 차지한 줄 — 본문에서 뺀다 */
  cast: CastList | null;
}

/**
 * 목록이 있으면 목록에 맞는 화자만 배역이다. 다만 표기가 어긋난 주연(`키니` ↔ `키이니 선장`)을
 * 놓치지 않으려고, 목록에 없어도 대사가 아주 많은 화자는 남긴다.
 */
function filterByCast(names: string[], counter: Counter, strong: Set<string>, cast: CastList): string[] {
  const floor = Math.max(OFF_CAST_MIN_LINES, counter.total() * OFF_CAST_MIN_SHARE);
  return names.filter((n) => {
    const m = castMatch(n, cast);
    // 똑같이 맞아도 콜론·대괄호로 화자임이 분명하거나 두 줄은 있어야 한다 —
    // 목록의 장소 이름(`뉴욕 지방법원`)이 줄머리에 한 번 나온 것을 배역으로 세지 않기 위해
    if (m === "exact") return strong.has(n) || counter.countOf(n) >= MIN_ROLE_COUNT;
    if (m === "fuzzy") return counter.countOf(n) >= MIN_ROLE_COUNT;
    return counter.countOf(n) >= floor;
  });
}

function resolveRoles(lines: string[], options: ParseOptions): Resolved {
  const cast = extractCast(lines);
  // 목록 줄은 화자 후보에서 뺀다 — "키이니 선장" 이 공백 형식의 화자처럼 보인다
  const body = cast ? lines.map((l, i) => (i >= cast.start && i < cast.end ? "" : l)) : lines;
  const { primary, space, strong } = countCandidates(body);
  const hints = (options.roleHints ?? []).map((h) => h.trim()).filter(Boolean);
  // 무대 지시어·숫자만·홀로 선 조사는 빼고, 조사가 붙은 이름은 지문 첫 어절로 본다 —
  // 콜론·대괄호로 화자임이 분명한 것(strong)은 예외. `우연은` 처럼 이름 일부에 조사가 붙은 것도 잡는다.
  const clean = (names: string[], counter: Counter) => {
    const kept = names.filter((n) => !isStageWord(n) && !/^\d+$/.test(n) && !SINGLE_CHAR_STOP.has(n));
    const set = new Set(kept.map(squash));
    // 조사를 뗀 것이 다른 이름의 끝부분이면(`우연은`↔`안우연`, `기루는`↔`신기루`) 지문이다.
    // 앞부분 비교는 하지 않는다 — `페르난도야` 가 있으면 `페르난도` 가 제 이름에 걸려 사라진다.
    const knownBase = (self: string, base: string) =>
      set.has(base) ||
      (cast?.names.has(base) ?? false) ||
      (base.length >= 2 && [...set].some((k) => k !== self && k.endsWith(base)));
    // 조사 글자로 끝나는 진짜 이름(`도로`·`하우이`·`극작가`)을 지키는 근거 — 콜론·대괄호로 화자임이 분명하거나,
    // 목록에 맞거나, 목록이 없으면 대사가 아주 많아야 한다(`그녀는` 같은 지문 첫 어절은 그만큼 많지 않다).
    const trusted = (n: string) =>
      strong.has(n) ||
      (cast !== null && castMatch(n, cast) !== null) ||
      counter.countOf(n) >= Math.max(OFF_CAST_MIN_LINES, counter.total() * 0.05);
    return kept.filter((n) => {
      const base = stripParticle(n);
      if (!base) return true;
      if (knownBase(squash(n), base)) return false;
      return trusted(n);
    });
  };

  let detected: string[];
  let spaceMode = false;
  if (cast) {
    detected = clean(filterByCast(primary.atLeast(1), primary, strong, cast), primary);
    if (detected.length < 2) {
      const fromSpace = clean(filterByCast(space.atLeast(1), space, strong, cast), space);
      if (fromSpace.length >= 2) {
        detected = fromSpace;
        spaceMode = true;
      }
    }
  } else {
    detected = clean(pruneRare(primary.atLeast(MIN_ROLE_COUNT), primary), primary);
    if (detected.length < 2) {
      const fromSpace = clean(pruneRare(space.atLeast(MIN_ROLE_COUNT), space), space);
      if (fromSpace.length >= 2) {
        detected = fromSpace;
        spaceMode = true;
      }
    }
  }

  const appears = (name: string) => primary.has(name) || space.has(name);
  const hintRoles = hints.filter(appears);
  if (hintRoles.some((h) => !primary.has(h) && space.has(h))) spaceMode = true;

  // 뺀 이름은 힌트로 들어와도 되살리지 않는다 — 사람이 내린 판단이 먼저다.
  const excluded = new Set(options.excludeRoles ?? []);
  const keep = (names: string[]) => names.filter((n) => !excluded.has(n));

  if (options.onlyHints) return { roles: orderByAppearance(keep(hintRoles), body), spaceMode, cast };

  const merged = [...detected, ...hintRoles.filter((h) => !detected.includes(h))];
  return { roles: orderByAppearance(keep(merged), body), spaceMode, cast };
}

function orderByAppearance(roles: string[], lines: string[]): string[] {
  const first = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const r of roles) {
      if (first.has(r)) continue;
      if (line === r || line.startsWith(r + ":") || line.startsWith(r + " ") || splitBracket(line)?.name === r) first.set(r, i);
    }
  }
  return [...roles].sort((a, b) => (first.get(a) ?? Infinity) - (first.get(b) ?? Infinity));
}

export function detectRoles(raw: string, options: ParseOptions = {}): string[] {
  return resolveRoles(normalize(raw), options).roles;
}

export function parseScript(raw: string, options: ParseOptions = {}): ParsedScript {
  const all = normalize(raw);
  if (all.every((l) => l === "")) return { title: undefined, roles: [], lines: [] };

  const { roles, spaceMode, cast } = resolveRoles(all, options);
  const roleSet = new Set(roles);
  // 등장인물 목록은 대본 본문이 아니다 — 대사도 지문도 아니므로 뺀다
  const lines = cast ? all.map((l, i) => (i >= cast.start && i < cast.end ? "" : l)) : all;

  const out: ScriptLine[] = [];
  let prev: DialogueLine | null = null;
  let pendingRole: string | null = null;

  for (const line of lines) {
    if (line === "") {
      prev = null;
      pendingRole = null;
      continue;
    }
    if (isWrappedDirection(line)) {
      out.push({ type: "direction", text: stripWrap(line) });
      prev = null;
      pendingRole = null;
      continue;
    }
    if (isStructureMark(line)) {
      out.push({ type: "direction", text: BRACKET_ROLE_RE.exec(line)![2].trim() });
      prev = null;
      pendingRole = null;
      continue;
    }
    const bracket = splitBracket(line);
    if (bracket && roleSet.has(bracket.name)) {
      prev = { type: "dialogue", role: bracket.name, text: bracket.text };
      out.push(prev);
      pendingRole = null;
      continue;
    }
    const colon = splitColon(line);
    if (colon && roleSet.has(colon.name)) {
      prev = { type: "dialogue", role: colon.name, text: colon.text };
      out.push(prev);
      pendingRole = null;
      continue;
    }
    if (colon) {
      // `이름: …` 꼴인데 배역이 아니다 — 앞 대사에 붙이지 않고 지문으로 둔다
      out.push({ type: "direction", text: line });
      prev = null;
      pendingRole = null;
      continue;
    }
    if (isSoloName(line) && roleSet.has(line)) {
      pendingRole = line;
      prev = null;
      continue;
    }
    if (isSoloName(line) && stripParticle(line) && roleSet.has(stripParticle(line)!)) {
      // `촐레가` 한 줄 — 배역이 아니라 "촐레가 …한다" 지문의 첫 어절이다. 앞 대사에 붙이지 않는다.
      out.push({ type: "direction", text: line });
      prev = null;
      pendingRole = null;
      continue;
    }
    if (pendingRole) {
      prev = { type: "dialogue", role: pendingRole, text: line };
      out.push(prev);
      pendingRole = null;
      continue;
    }
    if (spaceMode) {
      const sp = splitSpace(line);
      if (sp && roleSet.has(sp.name)) {
        prev = { type: "dialogue", role: sp.name, text: sp.text };
        out.push(prev);
        continue;
      }
    }
    if (NAME_COMMA_DIRECTION_RE.test(line)) {
      out.push({ type: "direction", text: line });
      prev = null;
      continue;
    }
    if (prev) {
      prev.text = `${prev.text} ${line}`;
      continue;
    }
    out.push({ type: "direction", text: line });
  }

  // 제목: 첫 줄이 대사·배역·지문이 아니고 바로 뒤가 빈 줄이면 제목으로 뺀다.
  let title: string | undefined;
  const firstIdx = lines.findIndex((l) => l !== "");
  const first = lines[firstIdx];
  if (
    first &&
    lines[firstIdx + 1] === "" &&
    first.length <= 30 &&
    out[0]?.type === "direction" &&
    out[0].text === first
  ) {
    title = first;
    out.shift();
  }

  return { title, roles, lines: out };
}

/** TTS로 읽을 때 괄호 지문·따옴표를 뺀 본문. */
export function speakableText(text: string): string {
  return text
    .replace(/[(（\[【][^)）\]】]*[)）\]】]/g, " ")
    .replace(/["“”'‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
