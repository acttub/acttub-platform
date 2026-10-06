// useScriptImport 를 실제로 돌려 보기 위한 최소 컴포넌트. 서버 함수는 테스트가 넘긴 가짜이고,
// 나누기가 끝났을 때 부르는 onSaved 를 센다.
import { useScriptImport, type ScriptImporter, type ScriptImportDeps } from "@/features/reading/use-script-import";

export function scriptImportProbe(deps: ScriptImportDeps, onSaved: () => void) {
  return function ScriptImportProbe({ onRender }: { onRender: (value: ScriptImporter) => void }) {
    onRender(useScriptImport(onSaved, deps));
    return null;
  };
}
