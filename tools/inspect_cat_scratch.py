#!/usr/bin/env python3
import json, re, struct, sys, zipfile, zlib, io
from pathlib import Path

html_path = Path("CAT大戦争_完全版_1ファイル軽量版.html")
html = html_path.read_text(encoding="utf-8")
match = re.search(r'<script\s+type="application/x-b85"\s+id="pl">(.*?)</script>', html, re.S)
size = re.search(r"window\.__PROJECT_ZIP\s*=\s*\(\)\s*=>\s*__inflate\(plBuf\.subarray\(0,\s*(\d+)\)\)", html)
if not match or not size:
    raise SystemExit("Scratch project archive not found")
raw = match.group(1).strip()
alphabet = {n + 42: n for n in range(85)}
alphabet[40], alphabet[41] = 18, 20
decoded = bytearray((len(raw) // 5) * 4)
at = 0
for pos in range(0, len(raw) - 4, 5):
    d = [alphabet[ord(ch)] for ch in raw[pos:pos+5]]
    value = d[0] + d[1]*85 + d[2]*7225 + d[3]*614125 + d[4]*52200625
    decoded[at:at+4] = struct.pack("<I", value & 0xffffffff)
    at += 4
archive_bytes = zlib.decompress(bytes(decoded[:int(size.group(1))]), -15)
with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
    project = json.loads(archive.read("project.json"))

targets = project.get("targets", [])
summary = {"targets": [], "matches": [], "broadcasts": [], "stage_costumes": []}
keywords = re.compile(r"勝|勝利|勝ち|負け|敗北|クリア|終了|clear|win|result|TERRA|ステージ", re.I)
broadcasts = set()

def collect_literals(value):
    out = []
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, list):
        for item in value:
            out.extend(collect_literals(item))
    elif isinstance(value, dict):
        for item in value.values():
            out.extend(collect_literals(item))
    return out

for target in targets:
    name = target.get("name", "")
    info = {"name": name, "isStage": bool(target.get("isStage"))}
    for label, key in (("variables", "variables"), ("lists", "lists")):
        records = target.get(key, {})
        info[label] = []
        for item in records.values():
            if label == "variables":
                info[label].append({"name": item[0], "value": item[1]})
            else:
                vals = item[1]
                info[label].append({"name": item[0], "count": len(vals), "sample": vals[:12]})
    costumes = [{"name": c.get("name", ""), "format": c.get("dataFormat", "")} for c in target.get("costumes", [])]
    if "ステージ名" in name or target.get("isStage"):
        info["costumes"] = costumes
    if name == "ステージ名":
        summary["stage_costumes"] = [c["name"] for c in costumes]
    summary["targets"].append(info)

    blocks = target.get("blocks", {})
    for bid, block in blocks.items():
        if not isinstance(block, dict):
            continue
        opcode = block.get("opcode", "")
        fields = block.get("fields", {})
        inputs = block.get("inputs", {})
        literals = collect_literals(fields) + collect_literals(inputs)
        for field_name, field_value in fields.items():
            if field_name == "BROADCAST_OPTION" and isinstance(field_value, list) and field_value:
                broadcasts.add(str(field_value[0]))
        if opcode in ("event_broadcast", "event_broadcastandwait", "event_whenbroadcastreceived"):
            for v in literals:
                if v and len(v) < 120:
                    broadcasts.add(v)
        relevant = [v for v in literals if keywords.search(v)]
        if relevant:
            summary["matches"].append({
                "target": name, "opcode": opcode, "block": bid,
                "fields": fields, "relevantLiterals": relevant[:20]
            })

summary["broadcasts"] = sorted(broadcasts)
print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
