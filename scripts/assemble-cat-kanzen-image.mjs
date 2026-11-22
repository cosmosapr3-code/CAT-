import fs from "node:fs";

const partDirectory = "scripts/cat-kanzen-image-parts";
const parts = [];
for (let index = 0; index < 5; index++) {
  const path = `${partDirectory}/part${index}.bin`;
  if (!fs.existsSync(path)) throw new Error(`CAT完全体画像の分割ファイルがありません: ${path}`);
  parts.push(fs.readFileSync(path));
}
const image = Buffer.concat(parts);
if (
  image.length !== 24062 ||
  image.subarray(0, 4).toString("ascii") !== "RIFF" ||
  image.subarray(8, 12).toString("ascii") !== "WEBP"
) {
  throw new Error(`CAT完全体画像データが不正です: ${image.length} bytes`);
}
fs.mkdirSync("assets/cards", { recursive: true });
fs.writeFileSync("assets/cards/cat-kanzen-hd.webp", image);
console.log(`Assembled high-resolution CAT完全体 artwork (${image.length} bytes).`);
