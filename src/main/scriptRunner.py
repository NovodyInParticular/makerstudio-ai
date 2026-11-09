"""MakerStudio helper for parametric Python part scripts (standard library only).

A part script keeps its sizes in a block like

    # ============ PARAMETERS ============
    WALL = 1.2                 # minimum wall thickness
    HEAD_C = (0.0, 2.0, 22.0)  # skull centre (x, y, z)
    # ====================================

and writes STL files into an "out" folder next to itself.

    inspect <script>                      -> JSON list of the parameters
    prepare <script> <values.json> <dir>  -> copy of the script in <dir> with the new values,
                                             next to links to everything beside the original
                                             except "out" (so the original's out/ is never written)

The original script is only read, never changed.
"""
import ast
import json
import os
import sys
from pathlib import Path

FENCE = "# ==="


def section(lines):
    """(first, last) 0-based line indexes inside the PARAMETERS block, or None."""
    start = None
    for i, line in enumerate(lines):
        s = line.strip()
        if start is None:
            if s.startswith(FENCE) and "PARAMETERS" in s.upper():
                start = i + 1
        elif s.startswith(FENCE):
            return start, i - 1
    return (start, len(lines) - 1) if start is not None else None


def literal(node):
    """The value if it is a plain number / bool / tuple or list of those (nested once), else None."""
    try:
        value = ast.literal_eval(node)
    except Exception:
        return None
    def ok(v, depth=0):
        if isinstance(v, bool) or isinstance(v, (int, float)):
            return True
        if isinstance(v, (tuple, list)) and depth < 2 and len(v) <= 32:
            return all(ok(x, depth + 1) for x in v)
        return False
    if not ok(value):
        return None
    return json.loads(json.dumps(value))  # tuples -> lists


def numeric_expression(node):
    """True for a computed number (e.g. HEAD_C[2] - 1.5), false for paths, strings, calls..."""
    for n in ast.walk(node):
        if isinstance(n, ast.Constant) and isinstance(n.value, str):
            return False
        if isinstance(n, (ast.Call, ast.Attribute, ast.Lambda, ast.Dict, ast.Set)):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name) and n.func.value.id == "math":
                continue
            if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name) and n.value.id == "math":
                continue
            return False
    return True


def parameters(path):
    source = Path(path).read_text(encoding="utf-8")
    lines = source.splitlines()
    span = section(lines)
    if span is None:
        return None
    first, last = span
    tree = ast.parse(source)
    group = ""
    groups = {}
    for i in range(first, last + 1):
        s = lines[i].strip()
        if s.startswith("# ---"):
            group = s.strip("#- ").strip()
        groups[i] = group
    out = []
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        line = node.lineno - 1
        if line < first or line > last or node.end_lineno - 1 != line:
            continue
        name = node.targets[0].id
        text = ast.get_source_segment(source, node.value) or ""
        rest = lines[line][node.end_col_offset:]
        comment = rest.split("#", 1)[1].strip() if "#" in rest else ""
        value = literal(node.value)
        if value is None and not numeric_expression(node.value):
            continue  # paths, strings, helpers: not sizes
        out.append({
            "name": name, "line": line + 1, "group": groups.get(line, ""), "comment": comment,
            "text": text, "value": value, "editable": value is not None,
        })
    return out


def py(value):
    if isinstance(value, bool):
        return "True" if value else "False"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, list):
        inner = ", ".join(py(v) for v in value)
        return f"({inner},)" if len(value) == 1 else f"({inner})"
    raise ValueError(f"unsupported value {value!r}")


def same_shape(old, new):
    if isinstance(old, list):
        return isinstance(new, list) and len(old) == len(new) and all(same_shape(a, b) for a, b in zip(old, new))
    if isinstance(old, bool):
        return isinstance(new, bool)
    return isinstance(new, (int, float)) and not isinstance(new, bool)


def prepare(path, values_file, target):
    path = Path(path).resolve()
    values = json.loads(Path(values_file).read_text(encoding="utf-8"))
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines(keepends=True)
    params = {p["name"]: p for p in (parameters(path) or [])}
    tree = ast.parse(source)
    edits = []
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        name = node.targets[0].id
        if name not in values or name not in params:
            continue
        p = params[name]
        if not p["editable"] or p["line"] != node.lineno:
            raise SystemExit(f"{name} cannot be changed")
        if not same_shape(p["value"], values[name]):
            raise SystemExit(f"{name}: the new value does not have the same form as {p['text']}")
        edits.append((node.lineno - 1, node.value.col_offset, node.value.end_col_offset, py(values[name])))
    unknown = set(values) - set(params)
    if unknown:
        raise SystemExit("unknown parameters: " + ", ".join(sorted(unknown)))
    for line, a, b, text in edits:
        # Offsets are in UTF-8 bytes.
        raw = lines[line].encode("utf-8")
        lines[line] = (raw[:a] + text.encode("utf-8") + raw[b:]).decode("utf-8")
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    for entry in path.parent.iterdir():
        if entry.name in ("out", path.name, "__pycache__", ".venv") or entry.name.startswith("."):
            continue
        os.symlink(entry, target / entry.name)
    (target / "out").mkdir()
    (target / path.name).write_text("".join(lines), encoding="utf-8")
    print(json.dumps({"script": str(target / path.name), "changed": [e[0] + 1 for e in edits]}))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "inspect" and len(sys.argv) == 3:
        print(json.dumps(parameters(sys.argv[2])))
    elif mode == "prepare" and len(sys.argv) == 5:
        prepare(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise SystemExit("usage: inspect <script> | prepare <script> <values.json> <dir>")
