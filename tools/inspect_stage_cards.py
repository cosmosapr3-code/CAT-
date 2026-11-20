#!/usr/bin/env python3
import io, sys
from pathlib import Path
import cairosvg
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, "tools")
from restore_legacy_characters import decode_project

html = Path("CAT大戦争_完全版_1ファイル軽量版.html").read_text(encoding="utf-8")
archive = decode_project(html)
import json
project = json.loads(archive.read("project.json"))
target = next(t for t in project["targets"] if t["name"] == "ステージ名")
costumes = target.get("costumes", [])
out_dir = Path("stage-contact-sheets")
out_dir.mkdir(exist_ok=True)

cell_w, cell_h = 500, 130
cols, rows = 4, 7
per_sheet = cols * rows
font = ImageFont.load_default(size=22)
for sheet_no, start in enumerate(range(0, len(costumes), per_sheet), 1):
    items = costumes[start:start+per_sheet]
    sheet = Image.new("RGB", (cols*cell_w, rows*cell_h), "white")
    draw = ImageDraw.Draw(sheet)
    for local_idx, costume in enumerate(items):
        idx = start + local_idx
        x, y = (local_idx % cols)*cell_w, (local_idx // cols)*cell_h
        draw.rectangle((x+2,y+2,x+cell_w-3,y+cell_h-3), outline="#333333", width=2)
        draw.text((x+10,y+7), f"{idx+1:03d}  {costume.get('name','')}", fill="black", font=font)
        try:
            raw = archive.read(costume["md5ext"])
            if costume.get("dataFormat") == "svg":
                raw = cairosvg.svg2png(bytestring=raw, output_width=920)
            im = Image.open(io.BytesIO(raw)).convert("RGBA")
            im.thumbnail((cell_w-20, cell_h-40), Image.Resampling.LANCZOS)
            sheet.paste(im, (x+10, y+34), im)
        except Exception as exc:
            draw.text((x+10,y+50), f"IMAGE ERROR: {exc}", fill="red", font=font)
    path = out_dir / f"stage-cards-{sheet_no:02d}.jpg"
    sheet.save(path, "JPEG", quality=88, optimize=True)
    print(f"created {path} ({len(items)} stage title cards)")
