"use client";

import { resolveDraft, type ScriptDraft } from "@/lib/reading/draft";
import { Page } from "@/features/reading/page-shell";
import { ReviewList } from "@/features/reading/review-list";
import { ScriptConfirmPanel } from "@/features/reading/screens/ScriptConfirmPanel";
import type { ScriptSave } from "@/features/reading/use-script-save";
import { Button, TopBar } from "@/features/reading/ui";

/**
 * 대본 확인(D16), 폰 전용 — 데스크톱은 대본 넣기 화면의 오른쪽 열이 같은 편집 부분을 보여 준다.
 * 저장을 누르기 전에는 서버에 아무것도 남지 않는다.
 */
export function ReviewScreen({
  draft,
  onChange,
  save,
  onBack,
}: {
  draft: ScriptDraft;
  onChange: (next: ScriptDraft) => void;
  save: ScriptSave;
  onBack: () => void;
}) {
  const { parsed, characters } = resolveDraft(draft);
  const kept = characters.filter((c) => !c.excluded);
  const canSave = kept.length > 0 && !save.saving;
  return (
    <Page>
      <TopBar
        title="대본 확인"
        onBack={onBack}
        right={
          <button type="button" onClick={onBack} className="text-[13px] font-bold text-blue">
            다시 넣기
          </button>
        }
      />
      <div className="flex-1 flex flex-col gap-3 p-4">
        <section className="bg-surface rounded-[18px] p-4">
          <ScriptConfirmPanel draft={draft} onChange={onChange} />
        </section>
        <section className="bg-surface rounded-[18px] px-4 py-1.5">
          <ReviewList lines={parsed.lines} myRole={kept[0]?.original ?? ""} />
        </section>
      </div>
      <div className="sticky bottom-0 p-4 bg-gray-bg-2/90 backdrop-blur flex flex-col gap-2">
        {save.error && <p className="text-[12.5px] text-red">{save.error}</p>}
        <Button size="lg" className="w-full" disabled={!canSave} onClick={() => void save.save(draft)}>
          {save.saving ? "저장하는 중…" : "저장하고 배역 정하러 가기"}
        </Button>
      </div>
    </Page>
  );
}
