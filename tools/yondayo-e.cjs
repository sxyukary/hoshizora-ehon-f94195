// 「よんだよ」の絵を Codex に 1枚描いてもらう：node tools/yondayo-e.cjs <id>（2026-11-26 案D）
//   生成は1回ずつ（動かす前に 枚数を確認。AGENTS.md）→ /tmp/hoshizora-yondayo-e/<id>/<id>.png
//   作風の見本は 夜の見本（かに座 p08）。星は 透明背景、夜空は 星を あとから重ねるので 星を描きこみすぎない
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), id = process.argv[2];
const STAR = (color, shape) => `ONE single star used as a button icon and a small stamp in a children's picture-book app. ${shape} It is painted in soft watercolor with a gentle glow, colored ${color}. Square 1024x1024, transparent background, the star centered and filling about 75% of the frame. No outline frame, no circle behind it, no face, no other stars, no sparkles outside it, no text.`;
const FOUR = 'It is a four-pointed sparkle star with long slim points and gently curved sides (like a twinkle).';
const FIVE = 'It is a plump five-pointed star with softly rounded tips, friendly and simple.';
const BLUE = 'pale blue-white, like the real star Castor (cool icy white with a light blue tint, clearly blue, not grey)';
const RED = 'warm orange-red, like the real star Pollux (amber orange leaning to red, clearly warm, not pink)';
const SKY = (scene) => `A very wide night-sky background band for the top of a bookshelf screen in a children's picture-book app. Landscape 1536x1024; it will be cropped to a thin horizontal strip (about 4:1) from the middle, so keep everything important inside the middle third of the height and spread across the full width. ${scene} Only a few very faint tiny background stars: brighter stars will be added on top later by the app, so leave plenty of calm empty sky. No constellation lines, no planets, no moon in the middle, no people, no animals, no text.`;
const WHAT = {
  'blue-a': STAR(BLUE, FOUR), 'blue-b': STAR(BLUE, FIVE),
  'red-a': STAR(RED, FOUR), 'red-b': STAR(RED, FIVE),
  'sky-a': SKY('Deep navy blue night with a soft hazy band of the Milky Way drifting diagonally across, purple and blue watercolor washes.'),
  'sky-b': SKY('Quiet night sky over low rolling hills: deep navy at the top fading to a slightly lighter blue near the horizon, with dark soft hill silhouettes along the very bottom edge and one or two tiny warm-lit cottage windows far away.'),
};
if (!WHAT[id]) { console.error('つかいかた: node tools/yondayo-e.cjs <' + Object.keys(WHAT).join('|') + '>'); process.exit(1); }
const work = path.join('/tmp/hoshizora-yondayo-e', id);
fs.mkdirSync(work, { recursive: true });
const sh = (cmd, a, opt = {}) => execFileSync(cmd, a, { encoding: 'utf8', ...opt });
const CODEX = process.env.CODEX || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const ref = path.join(work, 'ref-cancer-p08.png');
sh('magick', [path.join(root, 'books', 'cancer', 'p08.webp'), ref]);
const PROMPT = `Use the built-in image_gen tool (not the CLI, no API key). Generate ONE image and save the final PNG in the current working directory as ${id}.png. Do not modify anything else.
The attached image is a STYLE REFERENCE ONLY (do not edit it): a night page from the same picture book about constellations. Match its style: soft hand-painted watercolor, gentle glowing light, calm deep night colors.
${WHAT[id]}`;
const out = path.join(work, `${id}.png`); fs.rmSync(out, { force: true });
console.log(`Codex に ${id} の絵を お願い中…（数分かかります）`);
sh(CODEX, ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', work, '-i', ref, '-o', path.join(work, 'codex.txt'), '-'],
  { input: PROMPT, stdio: ['pipe', fs.openSync(path.join(work, 'codex.log'), 'w'), 'inherit'] });
if (!fs.existsSync(out)) { console.error(`絵ができなかった。${work}/codex.log を見る`); process.exit(1); }
console.log(`できた: ${out}  ${sh('magick', [out, '-format', '%wx%h 透明%[opaque]', 'info:']).trim()}`);
