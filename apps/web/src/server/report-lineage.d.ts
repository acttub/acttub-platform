export function validateReportSectionLineage(input: {
  key: string;
  section: { status:string; content:string|null; observationEvidenceIds:string[]; turnEvidenceIds:string[]; timestampRange:null|{startMs:number;endMs:number} };
  selectedObservationIds:Set<string>|string[];
  selectedAnswerIds:Set<string>|string[];
  selectedAnswerTurnIds:Set<string>|string[];
  correctionTurnIds:Set<string>|string[];
  observationSegments:Map<string,{startMs:number;endMs:number}>;
  correctionSegments:Map<string,{startMs:number;endMs:number}>;
  fail?:(code:string)=>void;
}): void;
