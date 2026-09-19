import { ApiError, classifyUnprocessable } from './api-request.ts';

/**
 * 웹 체험 자료를 앱 계정으로 옮기기(account.guest). 웹이 보여 준 여섯 자리 코드를 넣으면 서버가
 * 게스트 자료의 주인을 이 회원으로 바꾼다. 복사가 아니라 주인 바꾸기라 영상·분석·대화·노트가
 * 그대로 따라온다.
 *
 * 회원과 게스트 둘 다 배우 기억이 있으면 서버는 아무것도 옮기지 않고 409 로 알린다. 앱은
 * 팝업에서 어느 쪽을 둘지 받아 같은 코드로 다시 보낸다. 409 는 코드를 소진하지 않고, 팝업을
 * 닫으면 없던 일이 된다.
 */
export const TRANSFER_CODE_LENGTH = 6;

export type MemoryChoice = 'member' | 'guest';

/** 팝업의 기본은 회원 것이다. 고른 쪽만 남는다. */
export const DEFAULT_MEMORY_CHOICE: MemoryChoice = 'member';

export type TransferRequestBody = { code: string; memory_choice?: MemoryChoice };

/** 숫자만 남겨 여섯 자리까지 받는다. */
export function formatTransferCodeInput(text: string): string {
  return text.replace(/[^0-9]/g, '').slice(0, TRANSFER_CODE_LENGTH);
}

export function isTransferCodeComplete(code: string): boolean {
  return new RegExp(`^[0-9]{${TRANSFER_CODE_LENGTH}}$`).test(code);
}

/** memory_choice 는 409 를 받은 뒤에만 싣는다. */
export function transferRequestBody(code: string, memoryChoice?: MemoryChoice): TransferRequestBody {
  return memoryChoice ? { code, memory_choice: memoryChoice } : { code };
}

export type TransferOutcome =
  | { kind: 'transferred' }
  /** 기억이 둘 다 있다. 팝업을 띄운다 — 아직 아무것도 옮겨지지 않았다. */
  | { kind: 'memory_choice_required' }
  /** 코드가 틀림·만료·이미 씀·새 코드로 무효. 서버가 넷을 구분하지 않는다. */
  | { kind: 'code_not_found' }
  | { kind: 'rate_limited' }
  /** 본문 모양이 틀린 422(배열). 화면 검증이 놓친 앱 버그다. */
  | { kind: 'client_bug' }
  /** 옮기기 도중 실패·네트워크 오류. 코드는 살아 있어 같은 코드로 다시 시도하면 된다. */
  | { kind: 'retry'; message: string | null };

function outcomeForFailure(error: unknown): TransferOutcome {
  if (error instanceof ApiError) {
    if (error.code === 'memory_choice_required') return { kind: 'memory_choice_required' };
    if (error.code === 'transfer_code_not_found') return { kind: 'code_not_found' };
    if (error.status === 429) return { kind: 'rate_limited' };
    if (classifyUnprocessable(error)?.kind === 'client_bug') return { kind: 'client_bug' };
  }
  return { kind: 'retry', message: error instanceof Error ? error.message : null };
}

export function createGuestTransfer(dependencies: {
  send: (body: TransferRequestBody) => Promise<unknown>;
}) {
  /** 409 를 받아 선택을 기다리는 코드. 팝업을 닫으면 비운다. */
  let awaitingChoice: string | null = null;

  async function request(code: string, memoryChoice?: MemoryChoice): Promise<TransferOutcome> {
    try {
      await dependencies.send(transferRequestBody(code, memoryChoice));
      awaitingChoice = null;
      return { kind: 'transferred' };
    } catch (error) {
      const outcome = outcomeForFailure(error);
      awaitingChoice = outcome.kind === 'memory_choice_required' ? code : null;
      return outcome;
    }
  }

  return {
    /** 코드를 넣고 "옮기기". 여섯 자리가 아니면 서버에 보내지 않는다(틀린 시도로 세지 않게). */
    submit(code: string): Promise<TransferOutcome> {
      if (!isTransferCodeComplete(code)) {
        awaitingChoice = null;
        return Promise.resolve({ kind: 'code_not_found' });
      }
      return request(code);
    },

    /** 팝업에서 고른 쪽을 실어 같은 코드로 다시 보낸다. */
    choose(memoryChoice: MemoryChoice): Promise<TransferOutcome> {
      if (awaitingChoice === null) {
        // 화면에 닿지 않는 가드다 — 팝업은 memory_choice_required 뒤에만 뜬다.
        return Promise.reject(new Error('choose() called with no transfer awaiting a memory choice'));
      }
      return request(awaitingChoice, memoryChoice);
    },

    /** 팝업을 닫는다. 요청을 보내지 않는다 — 아무것도 옮겨지지 않았고 코드는 살아 있다. */
    dismiss(): void {
      awaitingChoice = null;
    },
  };
}
