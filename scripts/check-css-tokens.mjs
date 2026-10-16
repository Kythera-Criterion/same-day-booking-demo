// 画面の CSS（CSS Modules と base.css）に、色や数値が直接書かれていないかを確かめる
//   ・色：#xxx・rgb()・hsl()・色の名前（white・black など）は書かない（tokens.css の意味の値を使う）
//   ・基本の値（--teal-600 などの段）を直接使わない（意味の値だけを使う）
//   ・長さ：px は線の太さ（1px・2px）と、メディアクエリの境目だけ。rem は clamp を使うトークンの中だけ
//   例外の行は、行末に「/* 数値の例外：理由 */」と書く
//   使い方：node scripts/check-css-tokens.mjs

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.module.css')) files.push(p);
  }
}
walk(join(ROOT, 'components'));
walk(join(ROOT, 'app'));
files.push(join(ROOT, 'app/styles/base.css'));

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|blue|green|gray|grey)\b(?![-\w])/;
const PRIMITIVE = /var\(--(teal|amber|gray|red|green|blue|indigo|violet|size|space-half)-?\d*\)/;
const PX = /(?<![\w-])(\d+(?:\.\d+)?)px\b/g;
const problems = [];

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inMedia = false;
  let inComment = false;
  lines.forEach((line, i) => {
    // コメントは読み飛ばす（複数行のコメントも）
    let code = line;
    if (inComment) {
      const end = code.indexOf('*/');
      if (end < 0) return;
      code = code.slice(end + 2);
      inComment = false;
    }
    code = code.replace(/\/\*.*?\*\//g, '');
    const open = code.indexOf('/*');
    if (open >= 0) {
      inComment = true;
      code = code.slice(0, open);
    }
    if (/^\s*@media/.test(line)) inMedia = true;
    if (/数値の例外/.test(line)) return;
    const where = `${relative(ROOT, file)}:${i + 1}`;
    if (COLOR.test(code) && !/currentColor/.test(code)) problems.push(`${where} 色の値：${line.trim()}`);
    if (/var\(--(teal|amber|gray|red|green|blue|indigo|violet)-\d+\)/.test(code)) problems.push(`${where} 基本の値：${line.trim()}`);
    for (const m of code.matchAll(PX)) {
      const n = Number(m[1]);
      const isMediaLine = /^\s*@media/.test(line);
      if (isMediaLine) continue;
      if (n <= 2) continue;
      problems.push(`${where} 数値：${line.trim()}`);
      break;
    }
    if (inMedia && /^\s*}\s*$/.test(line) && !/^\s{2,}/.test(line)) inMedia = false;
  });
}

if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\n${problems.length} か所`);
  process.exitCode = 1;
} else {
  console.log(`${files.length} ファイル：色や数値の直書きはありません`);
}
