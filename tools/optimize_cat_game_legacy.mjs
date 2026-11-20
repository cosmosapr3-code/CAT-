#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import {deflateRawSync, inflateRawSync} from "node:zlib";

const alphabet = Array.from({length:85},(_,i)=>i===18?"(":i===20?")":String.fromCharCode(i+42));
const reverse = new Map(alphabet.map((c,i)=>[c.charCodeAt(0),i]));

function decode85(input){
  const s=input.replace(/\\s+/g,"");
  if(s.length%5) throw new Error("Base85 length is invalid");
  const out=Buffer.allocUnsafe(s.length/5*4);
  let at=0;
  for(let i=0;i<s.length;i+=5){
    let v=0;
    for(let j=0;j<5;j++){
      const d=reverse.get(s.charCodeAt(i+j));
      if(d===undefined) throw new Error("Invalid Base85 character");
      v+=d*85**j;
    }
    out.writeUInt32LE(v>>>0,at); at+=4;
  }
  return out;
}
function encode85(input){
  const padded=Buffer.alloc(Math.ceil(input.length/4)*4); input.copy(padded);
  let out="";
  for(let i=0;i<padded.length;i+=4){
    let v=padded.readUInt32LE(i);
    for(let j=0;j<5;j++){const d=v%85;v=Math.floor(v/85);out+=alphabet[d];}
  }
  return out;
}
function extractArchive(html){
  const payload=html.match(/<script\\s+type="application\\/x-b85"\\s+id="pl">([\\s\\S]*?)<\\/script>/i);
  const size=html.match(/window\\.__PROJECT_ZIP\\s*=\\s*\\(\\)\\s*=>\\s*__inflate\\(plBuf\\.subarray\\(0,\\s*(\\d+)\\)\\)/);
  if(!payload||!size) throw new Error("元HTMLのBase85プロジェクトデータが見つかりません");
  const compressed=decode85(payload[1]).subarray(0,Number(size[1]));
  const zip=inflateRawSync(compressed);
  if(zip[0]!==0x50||zip[1]!==0x4b) throw new Error("プロジェクトZIPの展開に失敗しました");
  return {zip,compressedSize:Number(size[1]),payload:payload[0]};
}
async function optimizeZip(buffer,maxSvg){
  const src=await JSZip.loadAsync(buffer);
  const projectFile=src.file("project.json");
  if(!projectFile) throw new Error("project.json がありません");
  const project=JSON.parse(await projectFile.async("string"));
  const refs=new Map();
  for(const t of project.targets||[]) for(const c of t.costumes||[]){
    if(c.dataFormat!=="svg") continue;
    const name=c.md5ext||`${c.assetId}.svg`;
    if(!refs.has(name)&&src.file(name)) refs.set(name,src.file(name));
  }
  const items=await Promise.all([...refs].map(async([name,file])=>({name,data:await file.async("nodebuffer")})));
  items.sort((a,b)=>b.data.length-a.data.length);
  const selected=items.slice(0,maxSvg), replacements=new Map();
  let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(true){
      const index=cursor++; if(index>=selected.length)return;
      const item=selected[index];
      try{
        const meta=await sharp(item.data,{density:144,limitInputPixels:40000000}).metadata();
        const width=Math.max(1,meta.width||960),height=Math.max(1,meta.height||720);
        const scale=Math.min(1,2048/Math.max(width,height));
        const webp=await sharp(item.data,{density:144,limitInputPixels:40000000})
          .resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),fit:"fill",kernel:sharp.kernel.lanczos3})
          .webp({quality:88,alphaQuality:100,effort:5}).toBuffer();
        if(webp.length<deflateRawSync(item.data,{level:6}).length){
          const hash=crypto.createHash("md5").update(webp).digest("hex");
          replacements.set(item.name,{name:hash+".webp",hash,data:webp});
        }
      }catch(e){console.warn("SVGは元のまま保持:",item.name,String(e).slice(0,100));}
    }
  }));
  for(const t of project.targets||[]) for(const c of t.costumes||[]){
    if(c.dataFormat!=="svg")continue;
    const name=c.md5ext||`${c.assetId}.svg`,r=replacements.get(name);
    if(!r)continue;
    c.assetId=r.hash;c.md5ext=r.name;c.dataFormat="webp";c.bitmapResolution=2;
  }
  const out=new JSZip();
  for(const r of replacements.values())out.file(r.name,r.data,{binary:true,compression:"STORE"});
  for(const name of Object.keys(src.files)){
    const f=src.files[name];if(f.dir||name==="project.json"||replacements.has(name))continue;
    const data=await f.async("nodebuffer"),ext=path.extname(name).toLowerCase();
    const comp=[".mp3",".png",".jpg",".jpeg",".webp",".gif"].includes(ext)?"STORE":"DEFLATE";
    out.file(name,data,{binary:true,compression:comp,compressionOptions:{level:6}});
  }
  out.file("project.json",JSON.stringify(project),{compression:"DEFLATE",compressionOptions:{level:6}});
  const result=await out.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6},streamFiles:true});
  const check=await JSZip.loadAsync(result),p=JSON.parse(await check.file("project.json").async("string"));
  for(const t of p.targets||[])for(const c of t.costumes||[]){
    const name=c.md5ext||`${c.assetId}.${c.dataFormat}`;
    if(!check.file(name))throw new Error("変換後の画像がありません: "+name);
  }
  return {buffer:result,svgTotal:refs.size,svgConverted:replacements.size};
}
async function main(){
  const htmlPath=process.argv[2]||"CAT大戦争_完全版_1ファイル軽量版.html";
  const maxSvg=Number(process.argv[3]||200);
  const html=await fs.readFile(htmlPath,"utf8");
  if(!html.includes('id="pl"')&&!html.includes('id=\'pl\'')){
    if(html.includes("__PROJECT_ZIP")===false){console.log("このHTMLは既に軽量化済みです。");return;}
    throw new Error("旧TurboWarp Base85形式ではありません");
  }
  const extracted=extractArchive(html),optimized=await optimizeZip(extracted.zip,maxSvg);
  const outer=deflateRawSync(optimized.buffer,{level:9}),encoded=encode85(outer);
  let next=html.replace(extracted.payload,html.match(/(<script\\s+type="application\\/x-b85"\\s+id="pl">)[\\s\\S]*?(<\\/script>)/i)[1]+encoded+"</script>");
  const sizeRe=/(window\\.__PROJECT_ZIP\\s*=\\s*\\(\\)\\s*=>\\s*__inflate\\(plBuf\\.subarray\\(0,\\s*)\\d+(\\)\\))/;
  if(!sizeRe.test(next))throw new Error("埋め込みZIPサイズの更新位置がありません");
  next=next.replace(sizeRe,`$1${outer.length}$2`);
  const cacheKey=crypto.createHash("sha256").update(optimized.buffer).digest("hex").slice(0,12);
  const indexPath="index.html";
  let index=await fs.readFile(indexPath,"utf8");
  index=index.replace(/new URL\\('CAT大戦争_完全版_1ファイル軽量版\\.html(?:\\?v=[^']*)?',window\\.location\\.href\\)/,
    `new URL('CAT大戦争_完全版_1ファイル軽量版.html?v=${cacheKey}',window.location.href)`);
  await fs.writeFile(htmlPath+".tmp",next);
  await fs.writeFile(indexPath+".tmp",index);
  await fs.rename(htmlPath+".tmp",htmlPath);
  await fs.rename(indexPath+".tmp",indexPath);
  console.log(JSON.stringify({
    originalHtmlBytes:Buffer.byteLength(html),optimizedHtmlBytes:Buffer.byteLength(next),
    originalProjectZipBytes:extracted.zip.length,optimizedProjectZipBytes:optimized.buffer.length,
    originalOuterBytes:extracted.compressedSize,optimizedOuterBytes:outer.length,
    svgAssets:optimized.svgTotal,svgConverted:optimized.svgConverted,
    savedPercent:Number((100*(1-Buffer.byteLength(next)/Buffer.byteLength(html))).toFixed(1)),
    cacheKey
  },null,2));
}
main().catch(e=>{console.error(e);process.exit(1);});
