"""기대값 소스 — 숫자를 하드코딩하지 않고 소스/OpenAPI 에서 생성한다.

박아 둔 숫자는 반드시 낡는다(§기대값 소스). 여기서 만드는 inventory 는 전부
**실행 시점의** `openapi.json` 과 파이썬 소스에서 나온다.
"""

from __future__ import annotations

import ast
import json
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import status as http_status

from contract_harness import config as cfg

SOURCE_ROOTS = (
    cfg.API_ROOT / "acting-api" / "src" / "acting_api",
    cfg.API_ROOT / "acting-agent" / "src" / "acting_agent",
    cfg.API_ROOT / "acting-report" / "src" / "acting_report",
    cfg.API_ROOT / "acting-summary" / "src" / "acting_summary",
)
HTTP_METHODS = frozenset(
    {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
)


# --- ① 성공 응답 형상 -------------------------------------------------------


def success_response_models(openapi: dict) -> dict[str, str]:
    """(method, path, status) → 응답 컴포넌트 이름. `openapi.json` 에서 생성한다."""
    out: dict[str, str] = {}
    for path, path_item in openapi["paths"].items():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            for code, response in operation.get("responses", {}).items():
                if not code.startswith("2"):
                    continue
                schema = (
                    response.get("content", {})
                    .get("application/json", {})
                    .get("schema")
                )
                if schema is None:
                    continue
                out[f"{method} {path} {code}"] = _schema_label(schema)
    return dict(sorted(out.items()))


def _schema_label(schema: dict) -> str:
    if "$ref" in schema:
        return schema["$ref"].rsplit("/", 1)[-1]
    if "anyOf" in schema:
        return " | ".join(sorted(_schema_label(item) for item in schema["anyOf"]))
    return json.dumps(schema, sort_keys=True, ensure_ascii=False)


def response_component_shapes(openapi: dict) -> dict[str, dict]:
    """응답으로 도달 가능한 컴포넌트의 required/optional/additionalProperties."""
    reachable = _reachable_response_components(openapi)
    schemas = openapi["components"]["schemas"]
    out = {}
    for name in sorted(reachable):
        schema = schemas[name]
        properties = set(schema.get("properties", {}))
        required = set(schema.get("required", []))
        out[name] = {
            "required": sorted(required),
            "optional": sorted(properties - required),
            "additional_properties": schema.get("additionalProperties", True),
        }
    return out


def _reachable_response_components(openapi: dict) -> set[str]:
    schemas = openapi["components"]["schemas"]
    seen: set[str] = set()
    queue: list[dict] = []
    for path_item in openapi["paths"].values():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            for code, response in operation.get("responses", {}).items():
                if not code.startswith("2"):
                    continue
                schema = (
                    response.get("content", {})
                    .get("application/json", {})
                    .get("schema")
                )
                if schema is not None:
                    queue.append(schema)
    while queue:
        node = queue.pop()
        if isinstance(node, list):
            queue.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        reference = node.get("$ref")
        if isinstance(reference, str) and reference.startswith("#/components/schemas/"):
            name = reference.rsplit("/", 1)[-1]
            if name not in seen:
                seen.add(name)
                queue.append(schemas[name])
            continue
        for value in node.values():
            if isinstance(value, (dict, list)):
                queue.append(value)
    return seen


# --- ② 오류 계약 (AST) -----------------------------------------------------


@dataclass(frozen=True)
class ErrorSite:
    key: str
    source: str
    symbol: str
    status: int | None
    detail: str | None
    dynamic: bool
    category: str
    route: str | None

    def as_dict(self) -> dict:
        return {
            "key": self.key,
            "source": self.source,
            "symbol": self.symbol,
            "status": self.status,
            "detail": self.detail,
            "dynamic": self.dynamic,
            "category": self.category,
            "route": self.route,
        }


def _status_value(node: ast.AST) -> int | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    if isinstance(node, ast.Attribute):
        value = getattr(http_status, node.attr, None)
        if isinstance(value, int):
            return value
    return None


def _detail_value(node: ast.AST | None) -> tuple[str | None, bool]:
    if node is None:
        return None, False
    try:
        value = ast.literal_eval(node)
    except (ValueError, SyntaxError):
        return ast.unparse(node), True
    if isinstance(value, str):
        return value, False
    return json.dumps(value, ensure_ascii=False, sort_keys=True), False


class _ErrorVisitor(ast.NodeVisitor):
    def __init__(self, source_label: str) -> None:
        self.source = source_label
        self.sites: list[ErrorSite] = []
        self._stack: list[ast.AST] = []
        self._router_prefix: str | None = None

    # 라우터 prefix 는 모듈 전체에서 하나만 쓰는 구조라 마지막 것을 기억한다.
    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id == "APIRouter":
            for keyword in node.keywords:
                if keyword.arg == "prefix":
                    value, _ = _detail_value(keyword.value)
                    self._router_prefix = value
        self.generic_visit(node)

    def _qualname(self) -> str:
        return ".".join(
            item.name
            for item in self._stack
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        )

    def _route(self) -> str | None:
        for item in reversed(self._stack):
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in item.decorator_list:
                if not isinstance(decorator, ast.Call):
                    continue
                func = decorator.func
                if not isinstance(func, ast.Attribute) or func.attr not in HTTP_METHODS:
                    continue
                if not decorator.args:
                    continue
                suffix, _ = _detail_value(decorator.args[0])
                prefix = self._router_prefix or ""
                return f"{func.attr.upper()} {prefix}{suffix}"
        return None

    def _push(self, node):
        self._stack.append(node)
        self.generic_visit(node)
        self._stack.pop()

    visit_FunctionDef = _push
    visit_AsyncFunctionDef = _push
    visit_ClassDef = _push

    def visit_Raise(self, node: ast.Raise) -> None:
        exc = node.exc
        if isinstance(exc, ast.Call) and isinstance(exc.func, ast.Name):
            if exc.func.id == "HTTPException":
                self._http_exception(exc)
            elif exc.func.id == "ValueError" and self._in_validator():
                self._validator_error(exc)
        self.generic_visit(node)

    def _in_validator(self) -> bool:
        for item in self._stack:
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in item.decorator_list:
                text = ast.unparse(decorator)
                if "model_validator" in text or "field_validator" in text:
                    return True
        return False

    def _http_exception(self, exc: ast.Call) -> None:
        status_node = None
        detail_node = None
        if exc.args:
            status_node = exc.args[0]
        if len(exc.args) > 1:
            detail_node = exc.args[1]
        for keyword in exc.keywords:
            if keyword.arg == "status_code":
                status_node = keyword.value
            elif keyword.arg == "detail":
                detail_node = keyword.value
        status = _status_value(status_node) if status_node is not None else None
        detail, dynamic = _detail_value(detail_node)
        self._record(status, detail, dynamic, "http_exception")

    def _validator_error(self, exc: ast.Call) -> None:
        detail, dynamic = _detail_value(exc.args[0] if exc.args else None)
        self._record(422, detail, dynamic, "pydantic_validator")

    def _record(self, status, detail, dynamic, category) -> None:
        symbol = self._qualname()
        key = f"{self.source}:{symbol}|{status}|{detail}"
        self.sites.append(
            ErrorSite(
                key=key,
                source=self.source,
                symbol=symbol,
                status=status,
                detail=detail,
                dynamic=dynamic,
                category=category,
                route=self._route(),
            )
        )


class _HandlerVisitor(ast.NodeVisitor):
    """라우트 밖에서 나는 오류 — exception handler 의 `JSONResponse`."""

    def __init__(self, source_label: str) -> None:
        self.source = source_label
        self.sites: list[ErrorSite] = []
        self._stack: list[ast.AST] = []

    def _push(self, node):
        self._stack.append(node)
        self.generic_visit(node)
        self._stack.pop()

    visit_FunctionDef = _push
    visit_AsyncFunctionDef = _push
    visit_ClassDef = _push

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if name == "JSONResponse":
            status = None
            detail = None
            for keyword in node.keywords:
                if keyword.arg == "status_code":
                    status = _status_value(keyword.value)
                elif keyword.arg == "content":
                    try:
                        content = ast.literal_eval(keyword.value)
                    except (ValueError, SyntaxError):
                        content = None
                    if isinstance(content, dict) and "detail" in content:
                        detail = content["detail"]
            if status is not None and detail is not None and status >= 400:
                symbol = ".".join(
                    item.name
                    for item in self._stack
                    if isinstance(
                        item, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
                    )
                )
                self.sites.append(
                    ErrorSite(
                        key=f"{self.source}:{symbol}|{status}|{detail}",
                        source=self.source,
                        symbol=symbol,
                        status=status,
                        detail=detail,
                        dynamic=False,
                        category="exception_handler",
                        route=None,
                    )
                )
        self.generic_visit(node)


def error_inventory() -> list[ErrorSite]:
    """정규식이 아니라 **AST 파싱**으로 뽑는다 (멀티라인 detail 포함)."""
    sites: list[ErrorSite] = []
    for root in SOURCE_ROOTS:
        for path in sorted(root.rglob("*.py")):
            label = str(path.relative_to(cfg.API_ROOT))
            tree = ast.parse(path.read_text(encoding="utf-8"))
            visitor = _ErrorVisitor(label)
            visitor.visit(tree)
            sites.extend(visitor.sites)
            handler = _HandlerVisitor(label)
            handler.visit(tree)
            sites.extend(handler.sites)
    # 같은 (파일, 심볼, status, detail) 이 두 번 나오면 한 항목으로 본다.
    unique: dict[str, ErrorSite] = {}
    for site in sites:
        unique.setdefault(site.key, site)
    return [unique[key] for key in sorted(unique)]


# --- ③ 멱등 전이표 ---------------------------------------------------------


def idempotency_transitions() -> dict[str, list[dict]]:
    """`_idempotent_response` · `_existing_operation_response` 의 상태 전이."""
    targets = {
        "practice_sessions.py:_idempotent_response": (
            cfg.API_ROOT / "acting-api/src/acting_api/practice_sessions.py",
            "_idempotent_response",
        ),
        "sync_operations.py:_existing_operation_response": (
            cfg.API_ROOT / "acting-api/src/acting_api/sync_operations.py",
            "_existing_operation_response",
        ),
    }
    out: dict[str, list[dict]] = {}
    for label, (path, function_name) in targets.items():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        node = next(
            item
            for item in ast.walk(tree)
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
            and item.name == function_name
        )
        out[label] = _transitions(node)
    return out


def _transitions(node: ast.AST) -> list[dict]:
    rows: list[dict] = []
    for child in ast.walk(node):
        if not isinstance(child, ast.If):
            continue
        condition = ast.unparse(child.test)
        statuses = sorted(
            {
                value
                for value in (
                    _status_value(keyword.value)
                    for statement in ast.walk(child)
                    if isinstance(statement, ast.Call)
                    for keyword in statement.keywords
                    if keyword.arg == "status_code"
                )
                if value is not None
            }
        )
        details = sorted(
            {
                _detail_value(keyword.value)[0]
                for statement in ast.walk(child)
                if isinstance(statement, ast.Call)
                for keyword in statement.keywords
                if keyword.arg == "detail"
            }
        )
        if statuses or details:
            rows.append(
                {"condition": condition, "statuses": statuses, "details": details}
            )
    return rows


# --- unknown key 허용 집합 --------------------------------------------------


def unknown_key_policy(openapi: dict) -> dict[str, dict]:
    """요청 바디별 unknown key 허용 여부. 개수·목록을 박지 않는다."""
    schemas = openapi["components"]["schemas"]
    out: dict[str, dict] = {}
    for path, path_item in openapi["paths"].items():
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            body = operation.get("requestBody")
            if not body:
                continue
            schema = (
                body.get("content", {}).get("application/json", {}).get("schema", {})
            )
            name = schema.get("$ref", "").rsplit("/", 1)[-1] or None
            resolved = schemas.get(name, schema)
            out[f"{method} {path}"] = {
                "component": name,
                "additional_properties": resolved.get("additionalProperties", True),
                "allows_unknown": resolved.get("additionalProperties", True) is not False,
                "required_body": bool(body.get("required")),
            }
    return dict(sorted(out.items()))


def allowed_unknown_key_operations(openapi: dict) -> set[str]:
    return {
        key
        for key, value in unknown_key_policy(openapi).items()
        if value["allows_unknown"]
    }


# --- 드리프트 검사 ---------------------------------------------------------


@dataclass
class DriftReport:
    problems: list[str] = field(default_factory=list)

    def ok(self) -> bool:
        return not self.problems


def _literal_from_test_module(name: str):
    """원본 테스트 파일을 **읽기만** 해서 상수를 뽑는다(수정하지 않는다)."""
    path = cfg.ACTING_API_ROOT / "tests" / "test_response_contracts.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise KeyError(name)


def check_drift(openapi: dict) -> DriftReport:
    """fixture 와 실제 소스가 어긋나면 실패한다."""
    report = DriftReport()

    declared = _literal_from_test_module("SUCCESS_RESPONSE_MODELS")
    declared_keys = {f"{method} {path} {code}" for method, path, code in declared}
    generated = success_response_models(openapi)
    if declared_keys != set(generated):
        missing = sorted(declared_keys - set(generated))
        extra = sorted(set(generated) - declared_keys)
        report.problems.append(
            "성공 응답 매트릭스가 소스와 어긋난다 "
            f"(테스트에만 있음={missing}, openapi 에만 있음={extra})"
        )
    for (method, path, code), model in declared.items():
        key = f"{method} {path} {code}"
        if key not in generated:
            continue
        expected = generated[key]
        if model == "PracticeReport":
            if set(expected.split(" | ")) != {
                "AnalysisReport",
                "BlockedReport",
                "ExpressionReport",
            }:
                report.problems.append(f"{key}: PracticeReport 합집합이 달라졌다 ({expected})")
            continue
        if expected != model:
            report.problems.append(
                f"{key}: 응답 컴포넌트가 다르다 (테스트={model}, openapi={expected})"
            )

    declared_shapes = _literal_from_test_module("RESPONSE_COMPONENT_SHAPES")
    generated_shapes = response_component_shapes(openapi)
    for name, expected in declared_shapes.items():
        actual = generated_shapes.get(name)
        if actual is None:
            report.problems.append(f"{name}: 응답에서 더 이상 도달하지 않는 컴포넌트다")
            continue
        if set(expected["required"]) != set(actual["required"]):
            report.problems.append(
                f"{name}: required 가 다르다 "
                f"(테스트={sorted(expected['required'])}, openapi={actual['required']})"
            )
        if set(expected.get("optional", set())) != set(actual["optional"]):
            report.problems.append(
                f"{name}: optional 이 다르다 "
                f"(테스트={sorted(expected.get('optional', set()))}, openapi={actual['optional']})"
            )
        allows_extra = expected.get("allows_extra", False)
        if (actual["additional_properties"] is not False) != allows_extra:
            report.problems.append(
                f"{name}: additionalProperties 가 다르다 "
                f"({actual['additional_properties']})"
            )

    committed = json.loads(cfg.COMMITTED_OPENAPI.read_text(encoding="utf-8"))
    if committed != openapi:
        report.problems.append(
            "live openapi 가 커밋된 spec/openapi.json 과 다르다 "
            "— 계약 변경이 스펙 재생성 없이 들어왔다"
        )
    return report


def write_fixture(path: Path, payload) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
