/**
 * 리딩 한 회차의 요약 계측(11/27 운영 데이터 검토). [다음] 연타와 상대 대사 건너뛰기가 많은데 왜인지(목소리가 늦어서인지,
 * 넘김이 느려서인지) 운영 빌드에 남는 기록이 없었다 — advance-log 는 dev 빌드 콘솔에만 남는다. 줄마다 보내지 않고 회차가
 * 끝날 때 숫자만 한 번 보낸다(app/reading/play 의 reading_run_summary). 대사·받아쓴 글·id 는 담지 않는다.
 *
 * 화면은 사건만 알리고 셈은 여기서 한다. 시각은 부르는 쪽이 넘긴다(시험에서 정할 수 있게).
 */
export type RunEnded = 'completed' | 'stopped' | 'left';
export type MineAdvance = 'auto' | 'manual' | 'late';
export type RunSummaryParams = Record<string, string | number | boolean>;

export type RunSummary = {
  /** 줄이 바뀌어 새 줄이 보였다. */
  lineShown: () => void;
  /** 상대 줄 읽기를 시작했다(지문 멈춤·시작 안내가 끝나 읽기에 들어간 때). 일시정지 뒤 다시 읽으면 또 부른다. */
  partnerShown: (at: number) => void;
  /** 상대 줄의 소리가 실제로 나기 시작했다. 그 줄의 첫 소리만 센다. */
  partnerAudio: (at: number) => void;
  /** 상대 줄을 끝까지 읽고 넘어갈 차례가 됐다. */
  partnerHeard: () => void;
  /** 상대 줄을 글로만 보였다(소리 낼 길이 없음) — [다음]으로 넘겨도 건너뛰기가 아니다. */
  partnerTextOnly: () => void;
  /** 상대 줄에서 [다음]을 눌렀다. 끝까지 들었거나 글로만 보인 줄이면 건너뛰기로 세지 않는다. */
  partnerTapped: () => void;
  mineAdvanced: (how: MineAdvance) => void;
  /** 내 차례 닫기가 끝났다. ms 는 손으로 누른 [다음]의 누름→줄 바뀜 시간(자동 넘김이면 null), timeouts 는 상한에 걸린 대기 수. */
  turnClosed: (ms: number | null, timeouts: number) => void;
  sttError: () => void;
  /** 보낼 값. 이미 한 번 끝냈으면 null — 한 회차에 한 번만 보낸다. */
  finish: (ended: RunEnded, engine: string) => RunSummaryParams | null;
};

/** 가운데 값(짝수 개면 아래쪽). 비었으면 null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** 이벤트 값은 100자 이내(GA4) — 엔진 이름 같은 짧은 글도 자른다. */
const short = (value: string) => value.slice(0, 40);

export function createRunSummary(base: { advance: string; handsFree: boolean }): RunSummary {
  let finished = false;
  let lines = 0;
  let mineAuto = 0;
  let mineManual = 0;
  let mineLate = 0;
  let partnerSkip = 0;
  let partnerFull = 0;
  let partnerSkipBeforeAudio = 0;
  const partnerWaits: number[] = [];
  const closeMs: number[] = [];
  let closeTimeouts = 0;
  let sttErrors = 0;
  /** 지금 상대 줄 — 읽기 시작 시각, 소리가 났는가, 이미 끝(끝까지 들음·글로 보임)이 났는가. */
  let partner: { shownAt: number; audio: boolean; resolved: boolean } | null = null;

  return {
    lineShown: () => {
      lines += 1;
      partner = null;
    },
    partnerShown: (at) => {
      partner = { shownAt: at, audio: false, resolved: false };
    },
    partnerAudio: (at) => {
      if (!partner || partner.audio || partner.resolved) return;
      partner.audio = true;
      partnerWaits.push(Math.max(0, Math.round(at - partner.shownAt)));
    },
    partnerHeard: () => {
      if (!partner || partner.resolved) return;
      partner.resolved = true;
      partnerFull += 1;
    },
    partnerTextOnly: () => {
      if (partner) partner.resolved = true;
    },
    partnerTapped: () => {
      if (!partner || partner.resolved) return;
      partner.resolved = true;
      partnerSkip += 1;
      if (!partner.audio) partnerSkipBeforeAudio += 1;
    },
    mineAdvanced: (how) => {
      if (how === 'auto') mineAuto += 1;
      else if (how === 'manual') mineManual += 1;
      else mineLate += 1;
    },
    turnClosed: (ms, timeouts) => {
      if (ms !== null) closeMs.push(Math.max(0, Math.round(ms)));
      closeTimeouts += timeouts;
    },
    sttError: () => {
      sttErrors += 1;
    },
    finish: (ended, engine) => {
      if (finished) return null;
      finished = true;
      const params: RunSummaryParams = {
        advance: short(base.advance),
        hands_free: base.handsFree,
        engine: short(engine),
        mine_auto: mineAuto,
        mine_manual: mineManual,
        mine_late: mineLate,
        partner_skip: partnerSkip,
        partner_full: partnerFull,
        partner_skip_before_audio: partnerSkipBeforeAudio,
        close_timeouts: closeTimeouts,
        stt_errors: sttErrors,
        lines,
        ended,
      };
      // 잰 값이 없으면(상대 소리가 한 번도 안 났다·손으로 넘긴 적 없다) 0 으로 오해하지 않게 빼고 보낸다.
      const waitMid = median(partnerWaits);
      if (waitMid !== null) {
        params.partner_wait_ms_p50 = waitMid;
        params.partner_wait_ms_max = Math.max(...partnerWaits);
      }
      const closeMid = median(closeMs);
      if (closeMid !== null) {
        params.close_ms_p50 = closeMid;
        params.close_ms_max = Math.max(...closeMs);
      }
      return params;
    },
  };
}
