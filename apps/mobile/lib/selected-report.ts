import type { ReportRecord } from '@/lib/api';

/** 기록 화면 → 상세 화면으로 넘길 선택된 리포트(모듈 스토어). */
let selected: ReportRecord | null = null;

export function setSelectedReport(record: ReportRecord) {
  selected = record;
}

export function getSelectedReport(): ReportRecord | null {
  return selected;
}
