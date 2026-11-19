#!/usr/bin/env python3
"""Restore original CAT allies, enemies, stats and sprites from the packed Scratch HTML."""
import base64
import io
import json
import re
import struct
import zipfile
import zlib
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HTML_PATH = ROOT / "CAT大戦争_完全版_1ファイル軽量版.html"
OUT_PATH = ROOT / "legacy-roster.json"


def get_list(target, name):
    for value in target.get("lists", {}).values():
        if value[0] == name:
            return value[1]
    return []


def code_slug(code):
    return "-".join(f"{ord(ch):x}" for ch in code)


def recover_zip(html):
    match = re.search(r'<script\s+type="application/x-b85"\s+id="pl">(.*?)</script>', html, re.S)
    size = re.search(r"window\.__PROJECT_ZIP\s*=\s*\(\)\s*=>\s*__inflate\(plBuf\.subarray\(0,\s*(\d+)\)\)", html)
    if not match or not size:
        raise RuntimeError("Packed Scratch project data was not found in the original HTML")
    raw = match.group(1).strip()
    alphabet = {n + 42: n for n in range(85)}
    alphabet[40], alphabet[41] = 18, 20
    decoded = bytearray((len(raw) // 5) * 4)
    at = 0
    for pos in range(0, len(raw) - 4, 5):
        d = [alphabet[ord(ch)] for ch in raw[pos:pos + 5]]
        value = d[0] + d[1] * 85 + d[2] * 7225 + d[3] * 614125 + d[4] * 52200625
        decoded[at:at + 4] = struct.pack("<I", value & 0xffffffff)
        at += 4
    archive_bytes = zlib.decompress(bytes(decoded[:int(size.group(1))]), -15)
    if not archive_bytes.startswith(b"PK"):
        raise RuntimeError("Could not decode the original Scratch project ZIP")
    return archive_bytes


def sprite_image(archive, targets, sprite_name, costume_name, cache):
    key = (sprite_name, costume_name)
    if key in cache:
        return cache[key]
    sprite = targets[sprite_name]
    costume = next((c for c in sprite["costumes"] if c["name"] == costume_name), None)
    if costume is None:
        raise RuntimeError(f"Missing costume: {sprite_name}/{costume_name}")
    raw = archive.read(costume["md5ext"])
    if costume["dataFormat"] == "svg":
        raw = cairosvg.svg2png(bytestring=raw, output_width=128)
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    image.thumbnail((42, 42), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((48-image.width)//2, (48-image.height)//2))
    out = io.BytesIO()
    canvas.save(out, format="WEBP", quality=58, method=4)
    cache[key] = "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode("ascii")
    return cache[key]


def build():
    html = HTML_PATH.read_text(encoding="utf-8")
    with zipfile.ZipFile(io.BytesIO(recover_zip(html))) as archive:
        project = json.loads(archive.read("project.json"))
        targets = {t["name"]: t for t in project["targets"]}
        stage = targets["Stage"]
        cache, characters = {}, []

        ally_codes = get_list(stage, "味方")
        hp = list(map(float, get_list(stage, "hpp制御システム")))
        attack = list(map(float, get_list(stage, "hp減少")))
        speed = list(map(float, get_list(stage, "idousokudo")))
        reach = list(map(float, get_list(stage, "syatei mikata")))
        kb = list(map(float, get_list(stage, "△味方KB")))
        interval = list(map(float, get_list(stage, "攻撃間隔")))
        abilities = get_list(stage, "味方　能力")
        reduction = get_list(stage, "キャラ別軽減ダメージ数")

        for i, code in enumerate(ally_codes):
            characters.append({
                "id": ["cat-basic", "cat-guard", "cat-wave"][i] if i < 3 else "ally-" + code_slug(code),
                "name": f"味方 {code}", "legacyCode": code, "side": "ally",
                "hp": max(1, round(hp[i])) if i < len(hp) else 1000,
                "attack": max(1, round(abs(attack[i]))) if i < len(attack) else 100,
                "kb": max(0, round(kb[i])) if i < len(kb) else 1,
                "range": max(1, reach[i]) if i < len(reach) else 100,
                "speed": max(0.1, speed[i]) if i < len(speed) else 2,
                "cost": 50 + 25 * (i % 8),
                "cooldown": max(1.5, min(12, interval[i])) if i < len(interval) else 3,
                "rarity": ["normal", "rare", "superRare", "uberRare"][min(3, i * 4 // len(ally_codes))],
                "attributes": ["旧ゲーム引継ぎ"], "abilities": [],
                "legacyAbilityCode": str(abilities[i]) if i < len(abilities) else "",
                "damageReduction": str(reduction[i]) if i < len(reduction) else "",
                "image": sprite_image(archive, targets, "編成表", code, cache),
                "description": f"元のScratch版から引き継いだ味方キャラクター（ID: {code}）",
                "inGacha": True
            })

        enemy_codes = get_list(stage, "teki")
        z_hp = list(map(float, get_list(targets["z"], "HP制御システム")))
        z_kb = list(map(float, get_list(targets["z"], "△敵KB数")))
        special = targets["味方?teki?キャラ"]
        special_codes = get_list(special, "tekiikikikikii")
        special_hp = list(map(float, get_list(special, "は？制限")))
        pico = targets["Pico"]
        pico_codes = get_list(pico, "敵")
        pico_hp = list(map(float, get_list(pico, "ピコHP")))
        pico_kb = list(map(float, get_list(pico, "△敵KB数")))
        damage_by_code = {}
        for code, value in zip(get_list(stage, "てきさん"), map(float, get_list(stage, "hpgs"))):
            damage_by_code.setdefault(code, abs(value))
        special_index = {code: i for i, code in enumerate(special_codes)}
        pico_index = {code: i for i, code in enumerate(pico_codes)}

        for i, code in enumerate(enemy_codes):
            if i < 30:
                source, sprite = "z", "z"
                enemy_hp = z_hp[i] if i < len(z_hp) else 1000
                enemy_kb = z_kb[i] if i < len(z_kb) else 2
                image = sprite_image(archive, targets, sprite, code, cache)
            elif i in list(range(30, 48)) + [59, 60, 67, 68]:
                source, sprite = "special", "味方?teki?キャラ"
                j = special_index.get(code, i-30)
                enemy_hp = special_hp[j] if j < len(special_hp) else 5000
                enemy_kb = 2
                image = sprite_image(archive, targets, sprite, code, cache)
            else:
                source, sprite = "Pico", "Pico"
                j = pico_index.get(code, i-48)
                enemy_hp = pico_hp[j] if j < len(pico_hp) else 1000
                enemy_kb = pico_kb[j] if j < len(pico_kb) else 2
                image = sprite_image(archive, targets, sprite, code, cache)
            uid = "enemy-pico" if i == 0 else ("enemy-brute" if i == 1 else f"enemy-{code_slug(code)}-{i+1}")
            characters.append({
                "id": uid, "name": f"敵 {code}", "legacyCode": code, "side": "enemy",
                "hp": max(1, round(enemy_hp)), "attack": max(1, round(damage_by_code.get(code, 100))),
                "kb": max(0, round(enemy_kb)), "range": 100, "speed": 18,
                "cost": 0, "cooldown": 3, "rarity": "normal",
                "attributes": ["旧ゲーム引継ぎ"], "abilities": [], "legacySource": source,
                "image": image, "description": f"元のScratch版から引き継いだ敵キャラクター（ID: {code}）",
                "inGacha": False
            })

    if len(ally_codes) != 40 or len(enemy_codes) != 69 or len(characters) != 109:
        raise RuntimeError(f"Roster check failed: {len(ally_codes)} allies, {len(enemy_codes)} enemies")
    OUT_PATH.write_text(json.dumps({
        "version": 1, "source": "original Scratch project",
        "counts": {"ally": 40, "enemy": 69}, "characters": characters
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Restored {len(ally_codes)} allies and {len(enemy_codes)} enemies; {OUT_PATH.stat().st_size} bytes")


if __name__ == "__main__":
    build()
