#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import JSZip from "jszip";
import { optimize as optimizeSvg } from "svgo";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const alphabet = Array.from({length:85},(_,i)=>i===18?"(":i===20?")":String.fromCharCode(i+42));
const reverse = new Map(alphabet.map((c,i)=>[c.charCodeAt(0),i]));

function decode85(input) {
  const s = input.replace(/\s+/g,"");
  if (s.length % 5) throw new Error("Base85 length is invalid");
  const out = Buffer.allocUnsafe(s.length / 5 * 4);
  let at = 0;
  for (let i=0;i<s.length;i+=5) {
    let value = 0;
    for (let j=0;j<5;j++) {
      const digit = reverse.get(s.charCodeAt(i+j));
      if (digit === undefined) throw new Error("Invalid Base85 character");
      value += digit * 85 ** j;
    }
    out.writeUInt32LE(value >>> 0, at);
    at += 4;
  }
  return out;
}

function encode85(input) {
  const padded = Buffer.alloc(Math.ceil(input.length/4)*4);
  input.copy(padded);
  let output = "";
  for (let i=0;i<padded.length;i+=4) {
    let value = padded.readUInt32LE(i);
    for (let j=0;j<5;j++) {
      const digit = value % 85;
      value = Math.floor(value/85);
      output += alphabet[digit];
    }
  }
  return output;
}

function extractArchive(html) {
  const payload = html.match(/<script\s+type="application\/x-b85"\s+id="pl">([\s\S]*?)<\/script>/i);
  const size = html.match(/window\.__PROJECT_ZIP\s*=\s*\(\)\s*=>\s*__inflate\(plBuf\.subarray\(0,\s*(\d+)\)\)/);
  if (!payload || !size) throw new Error("元HTMLのBase85プロジェクトデータが見つかりません");
  const compressed = decode85(payload[1]).subarray(0, Number(size[1]));
  const zip = inflateRawSync(compressed);
  if (zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error("プロジェクトZIPの展開に失敗しました");
  return {zip, compressedSize:Number(size[1]), payload:payload[0]};
}

function safeOptimizeSvg(buffer) {
  const source = buffer.toString("utf8");
  const result = optimizeSvg(source, {
    multipass: true,
    // 寸法・ID・viewBox・タイトルを保持し、ベクター形状を高精度で最適化する。
    plugins: [{
      name:"preset-default",
      params:{overrides:{
        cleanupIds:false,
        removeViewBox:false,
        removeTitle:false,
        removeDesc:false,
        convertPathData:{floatPrecision:4}
      }}
    }]
  });
  return Buffer.from(result.data, "utf8");
}
async function optimizeZip(buffer, maxSvg) {
  const sourceZip = await JSZip.loadAsync(buffer);
  const projectFile = sourceZip.file("project.json");
  if (!projectFile) throw new Error("project.json がありません");
  const project = JSON.parse(await projectFile.async("string"));

  const referenced = new Map();
  for (const target of project.targets || []) {
    for (const costume of target.costumes || []) {
      if (costume.dataFormat !== "svg") continue;
      const name = costume.md5ext || `${costume.assetId}.svg`;
      if (!referenced.has(name) && sourceZip.file(name)) {
        referenced.set(name, sourceZip.file(name));
      }
    }
  }

  const items = await Promise.all([...referenced].map(async ([name,file]) => ({
    name,
    data: await file.async("nodebuffer")
  })));
  items.sort((a,b)=>b.data.length-a.data.length);
  const selected = items.slice(0, Math.max(0,maxSvg));
  const replacements = new Map();
  let cursor = 0;

  await Promise.all(Array.from({length:4}, async () => {
    while (true) {
      const index = cursor++;
      if (index >= selected.length) return;
      const item = selected[index];
      try {
        const optimized = safeOptimizeSvg(item.data);
        const before = deflateRawSync(item.data, {level:6}).length;
        const after = deflateRawSync(optimized, {level:6}).length;
        if (after < before) {
          const hash = crypto.createHash("md5").update(optimized).digest("hex");
          replacements.set(item.name, {name:hash+".svg", hash, data:optimized});
        }
      } catch (error) {
        console.warn("SVGを変更せず保持:", item.name, String(error).slice(0,120));
      }
    }
  }));

  for (const target of project.targets || []) {
    for (const costume of target.costumes || []) {
      if (costume.dataFormat !== "svg") continue;
      const oldName = costume.md5ext || `${costume.assetId}.svg`;
      const replacement = replacements.get(oldName);
      if (!replacement) continue;
      costume.assetId = replacement.hash;
      costume.md5ext = replacement.name;
      costume.dataFormat = "svg";
    }
  }

  const outputZip = new JSZip();
  for (const replacement of replacements.values()) {
    outputZip.file(replacement.name, replacement.data, {
      binary:true,
      compression:"DEFLATE",
      compressionOptions:{level:9}
    });
  }
  for (const name of Object.keys(sourceZip.files)) {
    const file = sourceZip.files[name];
    if (file.dir || name === "project.json" || replacements.has(name)) continue;
    const data = await file.async("nodebuffer");
    outputZip.file(name, data, {
      binary:true,
      // 元アーカイブと同じDEFLATE方式を保ち、圧縮レベルだけ上げる。
      compression:"DEFLATE",
      compressionOptions:{level:9}
    });
  }
  outputZip.file("project.json", JSON.stringify(project), {
    compression:"DEFLATE",
    compressionOptions:{level:9}
  });

  const output = await outputZip.generateAsync({
    type:"nodebuffer",
    compression:"DEFLATE",
    compressionOptions:{level:9},
    streamFiles:true
  });

  // 変換後ZIPをもう一度開き、全コスチューム・音声の参照が切れていないか確認。
  const checkZip = await JSZip.loadAsync(output);
  const checkedProject = JSON.parse(await checkZip.file("project.json").async("string"));
  for (const target of checkedProject.targets || []) {
    for (const item of [...(target.costumes || []), ...(target.sounds || [])]) {
      const name = item.md5ext || `${item.assetId}.${item.dataFormat}`;
      if (!checkZip.file(name)) throw new Error("変換後に素材が見つかりません: " + name);
    }
  }

  return {
    buffer:output,
    svgTotal:referenced.size,
    svgChecked:selected.length,
    svgConverted:replacements.size
  };
}

async function main() {
  const htmlPath = process.argv[2] || "CAT大戦争_完全版_1ファイル軽量版.html";
  const maxSvg = Number(process.argv[3] || 2000);
  const html = await fs.readFile(htmlPath, "utf8");

  const extracted = extractArchive(html);
  const optimized = await optimizeZip(extracted.zip, maxSvg);
  const outer = deflateRawSync(optimized.buffer, {level:9});

  if (outer.length >= extracted.compressedSize) {
    console.log(JSON.stringify({
      changed:false,
      reason:"安全なSVG圧縮による転送量の削減が確認できなかったため、元ファイルを維持しました。",
      originalBytes:extracted.compressedSize,
      optimizedBytes:outer.length,
      svgTotal:optimized.svgTotal,
      svgChecked:optimized.svgChecked,
      svgConverted:optimized.svgConverted
    },null,2));
    return;
  }

  const encoded = encode85(outer);
  const openingTag = html.match(/(<script\s+type="application\/x-b85"\s+id="pl">)/i)?.[1];
  if (!openingTag) throw new Error("Base85開始タグを特定できません");
  const nextPayload = openingTag + encoded + "</script>";
  let next = html.replace(extracted.payload, nextPayload);

  const sizeRegex = /(window\.__PROJECT_ZIP\s*=\s*\(\)\s*=>\s*__inflate\(plBuf\.subarray\(0,\s*)\d+(\)\))/;
  if (!sizeRegex.test(next)) throw new Error("埋め込みZIPサイズの更新位置がありません");
  next = next.replace(sizeRegex, `$1${outer.length}$2`);

  const cacheKey = crypto.createHash("sha256").update(optimized.buffer).digest("hex").slice(0,12);
  const indexPath = "index.html";
  let index = await fs.readFile(indexPath, "utf8");
  const urlRegex = /new URL\('CAT大戦争_完全版_1ファイル軽量版\.html(?:\?v=[^']*)?',window\.location\.href\)/;
  if (!urlRegex.test(index)) throw new Error("index.html のゲームURLを特定できません");
  index = index.replace(urlRegex,
    `new URL('CAT大戦争_完全版_1ファイル軽量版.html?v=${cacheKey}',window.location.href)`);

  await fs.writeFile(htmlPath+".tmp", next);
  await fs.writeFile(indexPath+".tmp", index);
  await fs.rename(htmlPath+".tmp", htmlPath);
  await fs.rename(indexPath+".tmp", indexPath);

  console.log(JSON.stringify({
    changed:true,
    originalHtmlBytes:Buffer.byteLength(html),
    optimizedHtmlBytes:Buffer.byteLength(next),
    originalProjectZipBytes:extracted.zip.length,
    optimizedProjectZipBytes:optimized.buffer.length,
    originalOuterBytes:extracted.compressedSize,
    optimizedOuterBytes:outer.length,
    savedPercent:Number((100*(1-outer.length/extracted.compressedSize)).toFixed(1)),
    svgAssets:optimized.svgTotal,
    svgChecked:optimized.svgChecked,
    svgConverted:optimized.svgConverted,
    cacheKey
  },null,2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
