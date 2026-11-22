#!/usr/bin/env python3
import json, re, struct, sys, zipfile, zlib, io
from PIL import Image, ImageDraw
import cairosvg
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

def block_tree(blocks, root_id, seen=None, depth=0):
    if seen is None:
        seen = set()
    if not root_id or root_id in seen or root_id not in blocks or depth > 40:
        return []
    seen.add(root_id)
    block = blocks[root_id]
    if not isinstance(block, dict):
        return []
    result = [(root_id, block)]
    child_ids = []
    for value in block.get("inputs", {}).values():
        child_ids.extend(x for x in collect_literals(value) if x in blocks)
    if block.get("next"):
        child_ids.append(block["next"])
    for child_id in child_ids:
        result.extend(block_tree(blocks, child_id, seen, depth + 1))
    return result

summary["victory_scripts"] = []
for target in targets:
    if target.get("name") not in ("Stage", "味方攻撃", "勝ち負け判定", "セーブ", "ステージ集"):
        continue
    blocks = target.get("blocks", {})
    for root_id, root in blocks.items():
        if not isinstance(root, dict) or not root.get("topLevel"):
            continue
        nodes = block_tree(blocks, root_id)
        hit_nodes = []
        for block_id, block in nodes:
            txt = collect_literals(block.get("fields", {})) + collect_literals(block.get("inputs", {}))
            if any(re.search(r"勝ち判定|ステージクリア|負けた|CLEAR", value, re.I) for value in txt):
                hit_nodes.append({
                    "id": block_id, "opcode": block.get("opcode"),
                    "fields": block.get("fields", {}),
                    "inputs": block.get("inputs", {}),
                    "mutation": block.get("mutation", {})
                })
        if hit_nodes:
            summary["victory_scripts"].append({
                "target": target.get("name"), "root": root_id,
                "rootOpcode": root.get("opcode"),
                "rootFields": root.get("fields", {}),
                "nodes": hit_nodes[:40]
            })
# Extra diagnostics for recovering the actual character display names.  The
# roster builder previously copied Scratch sprite IDs (e.g. n, p, k) as names.
stage_target = next((t for t in targets if t.get("isStage") or t.get("name") == "Stage"), {})
summary["character_name_sources"] = {
    "stage_variables": [
        {"name": item[0], "value": item[1]}
        for item in stage_target.get("variables", {}).values()
        if any(key in str(item[0]) for key in ("味方", "敵", "キャラ", "名前", "経験値", "チュール", "お金", "所持"))
    ],
    "stage_lists": [
        {"name": item[0], "values": item[1]}
        for item in stage_target.get("lists", {}).values()
        if any(key in str(item[0]) for key in ("味方", "敵", "キャラ", "名前", "経験値", "チュール", "お金", "所持", "図鑑", "セーブ"))
    ],
    "target_costumes": {
        t.get("name", ""): [c.get("name", "") for c in t.get("costumes", [])]
        for t in targets
        if t.get("name") in ("編成表", "mikata", "mikata2", "z", "Pico", "味方?teki?キャラ", "図鑑", "Stage")
    }
}
# Capture Japanese text literals from Scratch blocks; these may contain the
# in-game labels that are not the internal sprite IDs.
japanese_literals = set()
say_blocks = []
for target in targets:
    for block_id, block in target.get("blocks", {}).items():
        if not isinstance(block, dict):
            continue
        fields = block.get("fields", {})
        inputs = block.get("inputs", {})
        literals = collect_literals(fields) + collect_literals(inputs)
        for value in literals:
            if isinstance(value, str) and re.search(r"[ぁ-んァ-ヶ一-龠]", value):
                if len(value) <= 100:
                    japanese_literals.add(value)
        if block.get("opcode", "").startswith("looks_say") or block.get("opcode", "").startswith("looks_think"):
            if literals:
                say_blocks.append({"target": target.get("name", ""), "opcode": block.get("opcode", ""), "texts": [v for v in literals if isinstance(v, str) and len(v) <= 100]})
summary["japanese_text_literals"] = sorted(japanese_literals)
summary["say_and_think_blocks"] = say_blocks[:1000]

# Find any real display-name tables, not only the two known ID-code lists.
summary["named_lists"] = []
for target in targets:
    for item in target.get("lists", {}).values():
        label, values = item[0], item[1]
        text_values = [str(value) for value in values if isinstance(value, str)]
        human_readable = [
            value for value in text_values
            if len(value.strip()) > 2 and re.search(r"[ぁ-んァ-ヶ一-龠]", value)
        ]
        if human_readable:
            summary["named_lists"].append({
                "target": target.get("name", ""),
                "list": label,
                "count": len(values),
                "values": list(dict.fromkeys(human_readable))[:200]
            })

summary["character_costume_names"] = {
    t.get("name", ""): [c.get("name", "") for c in t.get("costumes", [])]
    for t in targets
    if t.get("name") in ("編成表", "mikata", "mikata2", "z", "Pico", "味方?teki?キャラ", "図鑑")
}

# Trace the actual Scratch data blocks for player-owned character lists and
# currency variables. These records determine how server rewards are applied.
focus_names = {
    "味方", "味方キャラ名前", "CAT軍団のレベルセーブ用", "味方キャラ",
    "経験値", "catチュール", "セーブ？", "getto", "kosu", "出陣",
    "mikata!", "mikatakyara", "パワーアップセーブ", "〇現時点のlevel",
    "〇そのキャラの必須経験値", "何ゲット？"
}
summary["profile_data_blocks"] = []
for target in targets:
    blocks = target.get("blocks", {})
    for block_id, block in blocks.items():
        if not isinstance(block, dict):
            continue
        fields = block.get("fields", {})
        inputs = block.get("inputs", {})
        field_literals = collect_literals(fields)
        input_literals = collect_literals(inputs)
        found = sorted(focus_names.intersection(field_literals + input_literals))
        if not found:
            continue
        summary["profile_data_blocks"].append({
            "target": target.get("name", ""),
            "blockId": block_id,
            "opcode": block.get("opcode", ""),
            "fields": fields,
            "inputs": inputs,
            "next": block.get("next"),
            "parent": block.get("parent"),
            "topLevel": block.get("topLevel", False),
            "names": found
        })

# Reconstruct whole Scratch scripts that read/write the selected profile data.
summary["profile_data_scripts"] = []
for target in targets:
    blocks = target.get("blocks", {})
    relevant_ids = {
        entry["blockId"] for entry in summary["profile_data_blocks"]
        if entry["target"] == target.get("name")
    }
    roots = set()
    for block_id in relevant_ids:
        current = blocks.get(block_id)
        seen = set()
        while isinstance(current, dict) and current.get("parent") and current["parent"] not in seen:
            seen.add(current["parent"])
            current = blocks.get(current["parent"])
        if isinstance(current, dict):
            roots.add(next((key for key, value in blocks.items() if value is current), block_id))
    for root_id in sorted(roots):
        nodes = block_tree(blocks, root_id)
        if not nodes:
            continue
        summary["profile_data_scripts"].append({
            "target": target.get("name", ""),
            "root": root_id,
            "blocks": [{
                "id": bid,
                "opcode": block.get("opcode", ""),
                "fields": block.get("fields", {}),
                "inputs": block.get("inputs", {}),
                "next": block.get("next"),
            } for bid, block in nodes]
        })

# Produce contact sheets from the original costume art so names can be
# matched to the actual in-game characters instead of guessing from sprite IDs.
# The initial project.json read closes its ZipFile context, so reopen the archive.
archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
def costume_rgba(target_name, costume_name):
    target = next((t for t in targets if t.get("name") == target_name), None)
    if not target:
        return None
    costume = next((c for c in target.get("costumes", []) if str(c.get("name", "")) == str(costume_name)), None)
    if not costume:
        return None
    raw = archive.read(costume["md5ext"])
    try:
        if costume.get("dataFormat") == "svg":
            raw = cairosvg.svg2png(bytestring=raw, output_width=180, output_height=180)
        image = Image.open(io.BytesIO(raw)).convert("RGBA")
        image.thumbnail((112, 112), Image.Resampling.LANCZOS)
        return image
    except Exception:
        return None

def write_contact_sheet(items, filename, columns=5):
    cell_w, cell_h = 150, 152
    rows = (len(items) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_w, rows * cell_h), (238, 238, 238))
    draw = ImageDraw.Draw(sheet)
    for index, (label, target_name, costume_name) in enumerate(items):
        image = costume_rgba(target_name, costume_name)
        x = (index % columns) * cell_w
        y = (index // columns) * cell_h
        if image:
            px = x + (cell_w - image.width) // 2
            py = y + 4 + (112 - image.height) // 2
            sheet.paste(image, (px, py), image)
        draw.text((x + 6, y + 118), str(index + 1) + ". " + str(label)[:22], fill=(0, 0, 0))
    sheet.save(filename, format="PNG", optimize=True)

ally_codes = get_stage_list = next((v[1] for v in stage_target.get("lists", {}).values() if v[0] == "味方"), [])
write_contact_sheet([(code, "編成表", code) for code in ally_codes], "ally-contact-sheet.png")
enemy_codes = next((v[1] for v in stage_target.get("lists", {}).values() if v[0] == "teki"), [])
enemy_items = []
special_codes = set(enemy_codes[30:48] + [enemy_codes[i] for i in (59, 60, 67, 68) if i < len(enemy_codes)])
for index, code in enumerate(enemy_codes):
    if index < 30:
        source = "z"
    elif index in list(range(30, 48)) + [59, 60, 67, 68]:
        source = "味方?teki?キャラ"
    else:
        source = "Pico"
    enemy_items.append((code, source, code))
write_contact_sheet(enemy_items, "enemy-contact-sheet.png")

summary["contact_sheets"] = ["ally-contact-sheet.png", "enemy-contact-sheet.png"]

# Focused extraction for admin-editor implementation: actual Scratch costume labels
# and source lists used to show character names in the gacha and enemy encyclopedia.
focus_targets = {
    "ガチャ", "中身", "編成表", "mikata", "mikata2", "図鑑",
    "z", "Pico", "味方?teki?キャラ", "Stage", "味方攻撃",
    "パネル", "喋るcat"
}
summary["focused_costumes"] = {
    t.get("name", ""): [c.get("name", "") for c in t.get("costumes", [])]
    for t in targets if t.get("name", "") in focus_targets
}
stage_target = next((t for t in targets if t.get("isStage")), {})
stat_list_names = {
    "味方", "味方キャラ名前", "hpp制御システム", "hp減少",
    "idousokudo", "syatei mikata", "△味方KB", "攻撃間隔",
    "teki", "敵キャラクター図鑑", "てきさん", "hpgs",
    "敵　金", "cat　ｃ", "〇そのキャラの必須経験値"
}
summary["focused_stat_lists"] = {
    item[0]: item[1] for item in stage_target.get("lists", {}).values()
    if item[0] in stat_list_names
}
summary["focused_name_blocks"] = []
# Capture complete Scratch scripts that reference unit stats, prices, and UI-name values.
summary["focused_stat_scripts"] = []
summary["focused_panel_procedures"] = []
summary["focused_gacha_name_strings"] = []
for target in targets:
    if target.get("name", "") not in {"パネル", "ガチャ", "中身", "図鑑", "編成表", "シールド コンボ"}:
        continue
    blocks = target.get("blocks", {})
    if target.get("name", "") == "パネル":
        for block_id, block in blocks.items():
            if isinstance(block, dict) and block.get("opcode") in {"procedures_prototype", "procedures_definition", "procedures_call"}:
                summary["focused_panel_procedures"].append({
                    "target": target.get("name", ""), "id": block_id,
                    "opcode": block.get("opcode", ""), "mutation": block.get("mutation", {}),
                    "fields": block.get("fields", {}), "inputs": block.get("inputs", {}),
                    "next": block.get("next"), "parent": block.get("parent")
                })
    # Gather string literals from gacha/encyclopedia blocks which look like unit labels.
    if target.get("name", "") in {"ガチャ", "中身", "図鑑", "編成表"}:
        for block_id, block in blocks.items():
            if not isinstance(block, dict):
                continue
            strings = collect_literals(block.get("inputs", {})) + collect_literals(block.get("fields", {}))
            for value in strings:
                if isinstance(value, str) and len(value) > 1 and any("\u3040" <= ch <= "\u30ff" or "\u4e00" <= ch <= "\u9fff" for ch in value):
                    summary["focused_gacha_name_strings"].append({
                        "target": target.get("name", ""), "id": block_id,
                        "opcode": block.get("opcode", ""), "value": value
                    })
stat_list_terms = {
    "hp減少", "hpp制御システム", "idousokudo", "攻撃間隔",
    "syatei mikata", "△味方KB", "敵　金", "hpgs", "teki",
    "てきさん", "味方", "味方キャラ名前", "敵キャラクター図鑑",
    "cat　ｃ", "値段", "コスト", "出撃コスト", "お金数", "お金上限"
}
for target in targets:
    blocks = target.get("blocks", {})
    relevant_ids = set()
    for block_id, block in blocks.items():
        if not isinstance(block, dict):
            continue
        found = False
        for value in block.get("fields", {}).values():
            if isinstance(value, list) and value and value[0] in stat_list_terms:
                found = True
        for value in collect_literals(block.get("inputs", {})):
            if value in stat_list_terms:
                found = True
        if found:
            relevant_ids.add(block_id)
    roots = set()
    for block_id in relevant_ids:
        current = blocks.get(block_id)
        seen = set()
        while isinstance(current, dict) and current.get("parent") and current["parent"] not in seen:
            seen.add(current["parent"])
            current = blocks.get(current["parent"])
        if isinstance(current, dict) and current.get("topLevel"):
            roots.add(next((key for key, value in blocks.items() if value is current), block_id))
    for root_id in sorted(roots):
        nodes = block_tree(blocks, root_id)
        summary["focused_stat_scripts"].append({
            "target": target.get("name", ""), "root": root_id,
            "rootOpcode": blocks[root_id].get("opcode", ""),
            "blocks": [{
                "id": bid, "opcode": block.get("opcode", ""),
                "fields": block.get("fields", {}), "inputs": block.get("inputs", {}),
                "next": block.get("next"), "parent": block.get("parent")
            } for bid, block in nodes]
        })
name_terms = {
    "namae", "味方キャラ名前", "敵キャラクター図鑑",
    "敵名前", "出てくる敵の名前", "味方キャラ"
}
for target in targets:
    for block_id, block in target.get("blocks", {}).items():
        if not isinstance(block, dict):
            continue
        fields = block.get("fields", {})
        inputs = block.get("inputs", {})
        literals = collect_literals(fields) + collect_literals(inputs)
        if name_terms.intersection(literals):
            summary["focused_name_blocks"].append({
                "target": target.get("name", ""), "blockId": block_id,
                "opcode": block.get("opcode", ""), "fields": fields,
                "inputs": inputs, "next": block.get("next"),
                "parent": block.get("parent")
            })

print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
