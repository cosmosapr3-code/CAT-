#!/usr/bin/env python3
"""Restore original Scratch CAT units, evolution forms, enemy encyclopedia and stage title cards."""
import base64, io, json, re, struct, zlib, zipfile
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

def numbers(values, default=0):
    out = []
    for value in values:
        try: out.append(float(value))
        except (TypeError, ValueError): out.append(float(default))
    return out

def slug_code(code):
    return "-".join(f"{ord(ch):x}" for ch in str(code)) or "empty"

def ally_id(code):
    return {"n":"cat-basic","t":"cat-guard","p":"cat-wave"}.get(code, "ally-" + slug_code(code))

def decode_project(html):
    match = re.search(r'<script\s+type="application/x-b85"\s+id="pl">(.*?)</script>', html, re.S)
    size = re.search(r"window\.__PROJECT_ZIP\s*=\s*\(\)\s*=>\s*__inflate\(plBuf\.subarray\(0,\s*(\d+)\)\)", html)
    if not match or not size: raise RuntimeError("Original Scratch project payload was not found")
    raw = match.group(1).strip()
    alphabet = {n+42:n for n in range(85)}
    alphabet[40], alphabet[41] = 18, 20
    decoded = bytearray((len(raw)//5)*4)
    at = 0
    for pos in range(0, len(raw)-4, 5):
        d = [alphabet[ord(ch)] for ch in raw[pos:pos+5]]
        value = d[0] + d[1]*85 + d[2]*7225 + d[3]*614125 + d[4]*52200625
        decoded[at:at+4] = struct.pack("<I", value & 0xffffffff)
        at += 4
    archive = zlib.decompress(bytes(decoded[:int(size.group(1))]), -15)
    if not archive.startswith(b"PK"): raise RuntimeError("Scratch archive decode failed")
    return zipfile.ZipFile(io.BytesIO(archive))

def data_uri(archive, targets, sprite_name, costume_name, size=(64,64), quality=62, cache=None):
    key = (sprite_name, str(costume_name), size)
    if cache is not None and key in cache: return cache[key]
    target = targets[sprite_name]
    costume = next((c for c in target.get("costumes",[]) if c["name"] == str(costume_name)), None)
    if costume is None: return None
    raw = archive.read(costume["md5ext"])
    if costume.get("dataFormat") == "svg": raw = cairosvg.svg2png(bytestring=raw, output_width=max(size[0],160))
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0,0,0,0))
    canvas.alpha_composite(im, ((size[0]-im.width)//2,(size[1]-im.height)//2))
    buf = io.BytesIO(); canvas.save(buf, format="WEBP", quality=quality, method=4)
    result = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    if cache is not None: cache[key] = result
    return result

def image_data(archive, targets, sprite_name, costume_name, width=720, max_height=190):
    target = targets[sprite_name]
    costume = next((c for c in target.get("costumes",[]) if c["name"] == str(costume_name)), None)
    if costume is None: return None
    raw = archive.read(costume["md5ext"])
    if costume.get("dataFormat") == "svg": raw = cairosvg.svg2png(bytestring=raw, output_width=width)
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    im.thumbnail((width,max_height), Image.Resampling.LANCZOS)
    buf = io.BytesIO(); im.save(buf, format="WEBP", quality=75, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def series_for(code):
    if re.fullmatch(r"z\d+",code): return "はじめの一歩・基本ステージ"
    if re.fullmatch(r"p\d+",code): return "Picoの戦場"
    if code.startswith("h"): return "ハゲバ戦"
    if code.startswith("b"): return "合唱場の戦い"
    if code.startswith("g"): return "春の戦い"
    if code in {"t","春","春2","春3","夏","rr"}: return "季節ステージ"
    if code.startswith("m") or code=="試練": return "試練・最強への道"
    if code.startswith("a") or code in {"sd","mh","au","ks"}: return "特別ステージ"
    if code.startswith("sr"): return "SRステージ"
    if code.startswith("l"): return "コラボステージ"
    if code in {"sinka","→","←"}: return "進化・特殊ステージ"
    return "その他のステージ"

def main():
    html = HTML_PATH.read_text(encoding="utf-8")
    archive = decode_project(html)
    project = json.loads(archive.read("project.json"))
    targets = {t["name"]:t for t in project["targets"]}
    stage = targets["Stage"]; cache = {}
    allies = get_list(stage,"味方"); enemies = get_list(stage,"teki")
    ahp=numbers(get_list(stage,"hpp制御システム")); atk=numbers(get_list(stage,"hp減少"))
    speed=numbers(get_list(stage,"idousokudo")); reach=numbers(get_list(stage,"syatei mikata"))
    akb=numbers(get_list(stage,"△味方KB")); interval=numbers(get_list(stage,"攻撃間隔"))
    abilities=get_list(stage,"味方　能力"); reductions=get_list(stage,"キャラ別軽減ダメージ数")
    evolution_map={"n":["n","v","5"],"t":["t","c","4"],"p":["p","pp","ppp"],
      "m":["m","w","rm"],"a":["a","s","q"],"b":["b","b","@"],
      "kbi":["kbi","ku","ku"],"e":["e","nh","nh"]}
    evo_order=get_list(targets["レベル"],"pawa-相手")
    evo_flags=get_list(stage,"進化あり？")
    evolvable={code for i,code in enumerate(evo_order) if i<len(evo_flags) and str(evo_flags[i])=="1"}
    chars=[]
    for i,code in enumerate(allies):
        child=next((base for base,forms in evolution_map.items() if code!=base and code in forms[1:]),None)
        forms=[]
        for level,form_code in enumerate(evolution_map.get(code,[code]),1):
            img=data_uri(archive,targets,"編成表",form_code,(64,64),64,cache)
            if img:
                forms.append({"id":ally_id(form_code),"level":level,"legacyCode":form_code,"image":img,
                  "name":["第一形態","第二形態","第三形態"][level-1]})
        chars.append({
          "id":ally_id(code),"name":f"味方 {code}","legacyCode":code,"side":"ally",
          "hp":max(1,round(ahp[i])) if i<len(ahp) else 1000,
          "attack":max(1,round(abs(atk[i]))) if i<len(atk) else 100,
          "kb":max(0,round(akb[i])) if i<len(akb) else 1,
          "range":max(1,reach[i]) if i<len(reach) else 100,
          "speed":max(0.1,speed[i]) if i<len(speed) else 2,
          "cost":50+25*(i%8),"cooldown":max(0.8,min(30,interval[i])) if i<len(interval) else 3,
          "reproduction":max(3,5+(i%7)*2),
          "rarity":["normal","rare","superRare","uberRare"][min(3,i*4//max(1,len(allies)))],
          "attributes":["旧ゲーム引継ぎ"],"abilities":[],
          "legacyAbilityCode":str(abilities[i]) if i<len(abilities) else "",
          "damageReduction":str(reductions[i]) if i<len(reductions) else "",
          "image":data_uri(archive,targets,"編成表",code,(64,64),64,cache) or data_uri(archive,targets,"mikata",code,(64,64),64,cache),
          "description":f"元のScratch版から引き継いだ味方キャラクター（ID: {code}）",
          "inGacha":not bool(child),"evolutionAvailable":code in evolvable and code in evolution_map,
          "forms":forms,"evolutionOf":child
        })
    z=targets["z"]; zhp=numbers(get_list(z,"hpp制御システム")); zkb=numbers(get_list(z,"△敵KB数"))
    special=targets["味方?teki?キャラ"]; scodes=get_list(special,"tekiikikikikii"); shp=numbers(get_list(special,"は？制限"))
    pico=targets["Pico"]; pcodes=get_list(pico,"敵"); php=numbers(get_list(pico,"HP制御システム")); pkb=numbers(get_list(pico,"△敵KB数"))
    cash=numbers(get_list(stage,"敵　金")); atk_by={}
    for code,value in zip(get_list(stage,"てきさん"),numbers(get_list(stage,"hpgs"))): atk_by.setdefault(code,abs(value))
    si={c:i for i,c in enumerate(scodes)}; pi={c:i for i,c in enumerate(pcodes)}
    enemies_out=[]
    for i,code in enumerate(enemies):
        if i<30: source="z"; hp=zhp[i] if i<len(zhp) else 1000; kb=zkb[i] if i<len(zkb) else 2
        elif i in list(range(30,48))+[59,60,67,68]:
            source="味方?teki?キャラ"; j=si.get(code,i-30); hp=shp[j] if j<len(shp) else 5000; kb=2
        else:
            source="Pico"; j=pi.get(code,i-48); hp=php[j] if j<len(php) else 1000; kb=pkb[j] if j<len(pkb) else 2
        uid="enemy-pico" if i==0 else ("enemy-brute" if i==1 else f"enemy-{slug_code(code)}-{i+1}")
        enemies_out.append({
          "id":uid,"name":f"敵 {code}","legacyCode":code,"side":"enemy",
          "hp":max(1,round(hp)),"attack":max(1,round(atk_by.get(code,100))),
          "kb":max(0,round(kb)),"range":100,"speed":18,"cost":0,"cooldown":3,
          "reward":max(5,round(cash[i])) if i<len(cash) else 30,
          "rarity":"normal","attributes":["旧ゲーム引継ぎ"],"abilities":[],"legacySource":source,
          "image":data_uri(archive,targets,source,code,(64,64),64,cache),
          "encyclopediaImage":image_data(archive,targets,"図鑑",str(i),680,190),
          "description":f"元のScratch版から引き継いだ敵キャラクター（ID: {code}）","inGacha":False
        })
    stage_codes=[c["name"] for c in targets["ステージ名"].get("costumes",[])]
    group_codes=get_list(stage,"ステージ")
    stages=[]
    enemy_ids=[e["id"] for e in enemies_out]
    for i,code in enumerate(stage_codes):
        series=series_for(code); difficulty=1+(i//10)*0.18
        stages.append({
          "id":"legacy-stage-"+slug_code(code),"legacyCode":code,"name":f"{series} {i+1}",
          "chapter":series,"series":series,
          "titleImage":image_data(archive,targets,"ステージ名",code,760,170),
          "multiplier":round(difficulty,2),"rewardXp":100+i*15,"rewardChuru":50+i*10,
          "music":"",
          "enemyWaves":[
            {"characterId":enemy_ids[i%len(enemy_ids)],"at":4,"interval":max(5,10-i//20),"count":2+min(5,i//15),"hpMultiplier":difficulty,"attackMultiplier":difficulty},
            {"characterId":enemy_ids[(i+3)%len(enemy_ids)],"at":24,"interval":12,"count":1+min(3,i//25),"hpMultiplier":difficulty*1.1,"attackMultiplier":difficulty},
            {"characterId":enemy_ids[(i+8)%len(enemy_ids)],"at":55,"interval":20,"count":1,"hpMultiplier":difficulty*1.25,"attackMultiplier":difficulty*1.1}
          ],
          "legacyWaveData":False
        })
    enemy_book=[]
    for code in get_list(stage,"敵キャラクター図鑑"):
        found=next((e["id"] for e in enemies_out if e["legacyCode"]==code),None)
        if found and found not in enemy_book: enemy_book.append(found)
    result={"version":2,"source":"original Scratch project",
      "counts":{"ally":len(allies),"enemy":len(enemies),"stages":len(stages)},
      "characters":chars+enemies_out,"stages":stages,"stageGroups":group_codes,
      "initialEnemyBook":enemy_book,"evolutionMap":evolution_map,
      "notes":{"evolutions":"Original evolution form costumes recovered.",
        "stages":"Original 109 stage title cards recovered. Exact Scratch wave timing is not yet ported one-for-one."}}
    if len(allies)!=40 or len(enemies)!=69 or len(stages)!=109:
        raise RuntimeError(f"Unexpected recovered counts: {len(allies)} allies, {len(enemies)} enemies, {len(stages)} stages")
    OUT_PATH.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"Restored {len(allies)} allies, {len(enemies)} enemies, {len(stages)} stages: {OUT_PATH.stat().st_size} bytes")

if __name__=="__main__": main()
