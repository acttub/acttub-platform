"""OpenAPI 3.1 컴포넌트를 그대로 먹는 최소 JSON Schema 검증기.

외부 의존을 새로 들이지 않으려고 직접 쓴다. 지원 범위는 FastAPI 가 실제로
만들어 내는 키워드로 한정한다 — 응답 컴포넌트가 전부 `additionalProperties:
false` 라 필드 과부족이 즉시 잡히는 것이 L1 의 존재 이유이므로, 그 키워드만은
정확해야 한다.
"""

from __future__ import annotations

from typing import Any

_TYPE_CHECKS = {
    "null": lambda value: value is None,
    "boolean": lambda value: isinstance(value, bool),
    "integer": lambda value: isinstance(value, int) and not isinstance(value, bool),
    "number": lambda value: isinstance(value, (int, float))
    and not isinstance(value, bool),
    "string": lambda value: isinstance(value, str),
    "array": lambda value: isinstance(value, list),
    "object": lambda value: isinstance(value, dict),
}


def resolve_ref(reference: str, root: dict) -> dict:
    if not reference.startswith("#/"):
        raise ValueError(f"external reference is not supported: {reference}")
    target: Any = root
    for segment in reference.removeprefix("#/").split("/"):
        target = target[segment.replace("~1", "/").replace("~0", "~")]
    return target


def validate(instance, schema: dict, root: dict, path: str = "$") -> list[str]:
    errors: list[str] = []
    _validate(instance, schema, root, path, errors)
    return errors


def _validate(instance, schema, root, path, errors) -> None:
    if schema is True or schema == {}:
        return
    if schema is False:
        errors.append(f"{path}: 허용되지 않는 값")
        return
    if "$ref" in schema:
        merged = {
            key: value for key, value in schema.items() if key != "$ref"
        }
        target = resolve_ref(schema["$ref"], root)
        _validate(instance, {**target, **merged}, root, path, errors)
        return

    if "anyOf" in schema:
        branches = schema["anyOf"]
        if not any(not validate(instance, branch, root, path) for branch in branches):
            errors.append(f"{path}: anyOf 의 어느 분기와도 맞지 않는다")
            return
    if "oneOf" in schema:
        matched = sum(
            1 for branch in schema["oneOf"] if not validate(instance, branch, root, path)
        )
        if matched != 1:
            errors.append(f"{path}: oneOf 에 맞는 분기가 {matched}개다")
            return
    for branch in schema.get("allOf", []):
        _validate(instance, branch, root, path, errors)

    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: const {schema['const']!r} 이어야 한다 (실제 {instance!r})")
    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: enum {schema['enum']!r} 밖의 값 {instance!r}")

    declared = schema.get("type")
    if declared is not None:
        types = declared if isinstance(declared, list) else [declared]
        if not any(_TYPE_CHECKS[name](instance) for name in types):
            errors.append(f"{path}: 타입이 {declared} 가 아니다 (실제 {type(instance).__name__})")
            return

    if isinstance(instance, str):
        _validate_string(instance, schema, path, errors)
    elif isinstance(instance, bool):
        pass
    elif isinstance(instance, (int, float)):
        _validate_number(instance, schema, path, errors)
    elif isinstance(instance, list):
        _validate_array(instance, schema, root, path, errors)
    elif isinstance(instance, dict):
        _validate_object(instance, schema, root, path, errors)


def _validate_string(instance, schema, path, errors) -> None:
    if "minLength" in schema and len(instance) < schema["minLength"]:
        errors.append(f"{path}: minLength {schema['minLength']} 미만")
    if "maxLength" in schema and len(instance) > schema["maxLength"]:
        errors.append(f"{path}: maxLength {schema['maxLength']} 초과")


def _validate_number(instance, schema, path, errors) -> None:
    for keyword, ok in (
        ("minimum", lambda bound: instance >= bound),
        ("maximum", lambda bound: instance <= bound),
        ("exclusiveMinimum", lambda bound: instance > bound),
        ("exclusiveMaximum", lambda bound: instance < bound),
    ):
        if keyword in schema and not ok(schema[keyword]):
            errors.append(f"{path}: {keyword} {schema[keyword]} 위반 (실제 {instance})")


def _validate_array(instance, schema, root, path, errors) -> None:
    if "minItems" in schema and len(instance) < schema["minItems"]:
        errors.append(f"{path}: minItems {schema['minItems']} 미만")
    if "maxItems" in schema and len(instance) > schema["maxItems"]:
        errors.append(f"{path}: maxItems {schema['maxItems']} 초과")
    item_schema = schema.get("items")
    if item_schema is None:
        return
    for index, item in enumerate(instance):
        _validate(item, item_schema, root, f"{path}[{index}]", errors)


def _validate_object(instance, schema, root, path, errors) -> None:
    properties = schema.get("properties", {})
    for name in schema.get("required", []):
        if name not in instance:
            errors.append(f"{path}: 필수 필드 {name!r} 누락")
    additional = schema.get("additionalProperties", True)
    for name, value in instance.items():
        if name in properties:
            _validate(value, properties[name], root, f"{path}.{name}", errors)
            continue
        if additional is False:
            errors.append(f"{path}: 선언되지 않은 필드 {name!r} (additionalProperties: false)")
        elif isinstance(additional, dict):
            _validate(value, additional, root, f"{path}.{name}", errors)
