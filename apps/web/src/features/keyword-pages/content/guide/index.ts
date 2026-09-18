import type { KeywordPageContent } from "../../types";
import { ACTING_EXAM_PREP_TIMELINE } from "./acting-exam-prep-timeline";
import { ACTING_SELF_STUDY_ROUTINE } from "./acting-self-study-routine";
import { CHOOSING_FREE_ACTING_PIECE } from "./choosing-free-acting-piece";
import { HOW_TO_CHOOSE_ACTING_ACADEMY } from "./how-to-choose-acting-academy";
import { MONOLOGUE_PRACTICE } from "./monologue-practice";
import { REVIEWING_YOUR_ACTING_VIDEO } from "./reviewing-your-acting-video";
import { SCENE_ANALYSIS_BASICS } from "./scene-analysis-basics";
import { SELF_TAPE } from "./self-tape";

export const GUIDES: readonly KeywordPageContent[] = [
  MONOLOGUE_PRACTICE,
  SELF_TAPE,
  CHOOSING_FREE_ACTING_PIECE,
  ACTING_SELF_STUDY_ROUTINE,
  HOW_TO_CHOOSE_ACTING_ACADEMY,
  ACTING_EXAM_PREP_TIMELINE,
  SCENE_ANALYSIS_BASICS,
  REVIEWING_YOUR_ACTING_VIDEO,
];

export function guideSlug(content: KeywordPageContent): string {
  return content.path.slice("/guide/".length);
}

export function findGuide(slug: string): KeywordPageContent | null {
  return GUIDES.find((content) => guideSlug(content) === slug) ?? null;
}
