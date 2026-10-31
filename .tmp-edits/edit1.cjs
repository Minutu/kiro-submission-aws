const fs = require('fs');
const path = 'src/engine/scenes/MainMenuScene.ts';
let s = fs.readFileSync(path, 'utf8');
function replace(find, repl, label) {
  const parts = s.split(find);
  if (parts.length !== 2) { throw new Error('EXPECTED 1 MATCH FOR [' + label + '] GOT ' + (parts.length - 1)); }
  s = parts.join(repl);
  console.log('ok:', label);
}

// 1) Map center low so worlds scroll up under Kino.
replace(
  '    this.mapCenterY = height / 2;',
  '    // Map centers LOW so the worlds sit beneath Kino and scroll UP under it.\n    this.mapCenterY = height * 0.64;',
  'mapCenterY'
);

// 2) Replace the Kino + play + primary block (anchor on ASCII-only substrings).
const oldBlock = `    // --- Player's Kino + flanking Cosmetics/Skills controls (Req 20.7, 20.26)
    const kinoY = height * 0.4;
    this.drawKino(cx, kinoY, ctx);`;
const newBlock = `    // --- Player's Kino, big and high, over a grey backing (bug #3, #5)
    const kinoY = height * 0.30;
    this.buildKinoBacking(cx, kinoY, width, height);
    this.drawKino(cx, kinoY, ctx);`;
replace(oldBlock, newBlock, 'kino backing');

replace(
  '    this.buildCosmeticsControl(cx - 150, kinoY);\n    this.buildSkillsControl(cx + 150, kinoY);',
  '    this.buildCosmeticsControl(cx - 170, kinoY);\n    this.buildSkillsControl(cx + 170, kinoY);',
  'flank offsets'
);

// 3) Remove the large Play control block entirely (bug #4).
const playBlock = `    // --- Play control (large; Req 20.32) -------------------------
    // Play launches the Locked_In_World and is disabled when a silhouette is
    // centered (Req 34.2-34.3). The color-fill grow transition is task 9.8.
    this.buildPlayControl(cx, height * 0.86, ctx.config.labels.play);

`;
replace(playBlock, '', 'remove play control');

replace(
  '    this.buildPrimaryButton(cx, height * 0.95);',
  '    this.buildPrimaryButton(cx, height * 0.92);',
  'primary y position'
);

fs.writeFileSync(path, s);
console.log('LAYOUT EDITS DONE');
