// Issue #57: osallistujan tulokset puhelimessa, paljastetun vaihtoehdon valintapallo, esitysikkunan ohjeen kieli
// ja sanapilven sanan piilotus näppäimistöllä.
// Ajo: scripts/e2e.sh mobile-results.mjs  (tai node tests/e2e/mobile-results.mjs <cdp-port> <app-url>)
import { tab, attach, step, lit, setupAdmin, createEvent, openParticipant, openPoll, expand, pollItem } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];
const QUIZ = 'Mikä näistä on kalasteluviestin tyypillisin tunnusmerkki?';
const OPTIONS = ['Kiireellisyys ja uhkailu', 'Yrityksen logo', 'Allekirjoitus'];
const WORDS = 'Tietoturva yhdellä sanalla?';

const admin = await tab(port);
await setupAdmin(admin, app);
// Luennon kieli englanti: projektorin ohjeen pitää olla englanniksi.
await createEvent(admin, 'E2E Mobiili', 'en');
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'M1'); await admin.fill('#set-title', 'M1 Phishing');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('M1 Phishing'), 'sarja');

const question = async (type, prompt, fill) => {
  await admin.click('Uusi kysymys', 'M1 Phishing');
  await admin.waitFor(admin.has('#poll-prompt'), 'lomake');
  await admin.fill('#poll-type', type);
  await admin.fill('#poll-prompt', prompt);
  await fill();
  await admin.submit('#poll-prompt');
  await admin.waitFor(admin.hasText(prompt), 'kysymys ' + prompt);
};
await question('single', QUIZ, async () => {
  await admin.fill('#poll-options', OPTIONS.join('\n'));
  await admin.fill('#poll-correct', '1');
  await admin.fill('#poll-explanations', 'Oikein: kiire saa toimimaan ajattelematta.\nLogon voi kopioida.\nAllekirjoituksen voi väärentää.');
});
await question('words', WORDS, async () => {});
step('Visakysymys (pitkät suomenkieliset vaihtoehdot) ja sanapilvi luotu');

const part = await openParticipant(port, admin);
await part.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
await openPoll(admin, QUIZ);
await part.waitFor(part.hasText(QUIZ), 'kysymys osallistujalle');
await part.js(`(() => { [...document.querySelectorAll('.poll-choice')].find((l) => l.innerText.trim() === ${lit(OPTIONS[0])}).querySelector('input').click(); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'kuittaus');

await admin.click('Avaa esitysnäyttö');
const stage = await attach(port, '/admin/esitys');
await stage.waitFor(`document.getElementById('presenter-hint')?.textContent.startsWith('F or double-click')`, 'englanninkielinen ohje projektorilla', 8000);
if ((await stage.js('document.documentElement.lang')) !== 'en') throw new Error('Esitysikkunan lang ei ole en');
if (await stage.js(`document.body.innerText.includes('kaksoisklikkaus')`)) throw new Error('Esitysikkunassa suomenkielinen ohje');
step('Esitysikkunan pikanäppäinohje englanniksi, kun luennon kieli on englanti (lang="en")');

await admin.click('Näytä tulokset', QUIZ);
await admin.click('Paljasta oikea vastaus', QUIZ);
await part.waitFor(`document.querySelector('.poll-results-box .res-row.correct')?.innerText.includes('✓') && !!document.querySelector('.poll-choice.correct')`, 'paljastus osallistujalla', 10000);

// Jokainen sana on yhdellä rivillä (ei katkea kesken sanan); rivitys sallitaan vain sanojen välistä.
const brokenWords = (sel) => part.js(`(() => {
  const bad = [];
  for (const el of document.querySelectorAll(${lit(sel)})) {
    const node = [...el.childNodes].find((n) => n.nodeType === 3);
    if (!node) continue;
    const re = /\\S+/g; let m;
    while ((m = re.exec(node.data))) {
      const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
      const tops = new Set([...r.getClientRects()].map((c) => Math.round(c.top)));
      if (tops.size > 1) bad.push(m[0]);
    }
  }
  return bad;
})()`);
// Valintapallo ja vaihtoehdon teksti samalla rivillä: pallon pystykeskikohta on tekstin ensimmäisen rivin kohdalla.
const ballOffRow = () => part.js(`[...document.querySelectorAll('.poll-choices .poll-choice')].filter((l) => {
  const i = l.querySelector('input').getBoundingClientRect();
  const s = l.querySelector('span').getClientRects()[0];
  const mid = i.top + i.height / 2;
  return !(mid >= s.top && mid <= s.bottom);
}).map((l) => l.querySelector('span').textContent)`);
for (const width of [360, 375, 390]) {
  await part.cdp('Emulation.setDeviceMetricsOverride', { width, height: 1400, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 200));
  const bad = [...await brokenWords('.poll-results-box .res-label'), ...await brokenWords('.poll-choices .poll-choice > span:first-of-type')];
  if (bad.length) throw new Error(width + ' px: sana katkesi kesken: ' + bad.join(', '));
  const off = await ballOffRow();
  if (off.length) throw new Error(width + ' px: valintapallo eri rivillä kuin teksti: ' + off.join(', '));
  if (await part.js('document.documentElement.scrollWidth > window.innerWidth')) throw new Error(width + ' px: vaakavieritys');
}
step('360–390 px: tulosten ja vaihtoehtojen nimet rivittyvät sanojen välistä, ei vaakavieritystä');
step('Paljastuksen jälkeen valintapallo on samalla rivillä kuin ✓ ja vaihtoehdon teksti');

// Sanapilvi: sanan piilotus hallinnassa näppäimistöllä (Tab-järjestyksessä, Enter).
await openPoll(admin, WORDS);
await part.waitFor(part.hasText(WORDS), 'sanapilvi osallistujalle');
await part.js(`(() => { const i = document.querySelector('form.poll input[type="text"]'); i.value = 'luottamus'; i.dispatchEvent(new Event('input')); document.querySelector('form.poll').requestSubmit(); return true; })()`);
await part.waitFor(`document.querySelector('form.poll .notice.ok')`, 'sanan kuittaus');
await expand(admin, WORDS);
const word = `[...${pollItem(WORDS)}.querySelectorAll('.res-word')].find((w) => w.textContent === 'luottamus')`;
await admin.waitFor(`!!${word}`, 'sana hallinnan sanapilvessä', 10000);
const a11y = await admin.js(`(() => { const w = ${word}; return [w.tabIndex, w.getAttribute('role'), w.getAttribute('aria-label')]; })()`);
if (a11y[0] !== 0 || a11y[1] !== 'button' || a11y[2] !== 'Piilota sana "luottamus"') throw new Error('Sana ei ole painike: ' + JSON.stringify(a11y));
await admin.js(`${word}.focus(); document.activeElement === ${word}`);
await admin.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await admin.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await admin.waitFor(`!${word} && [...${pollItem(WORDS)}.querySelectorAll('.poll-hidden button')].some((b) => b.textContent === 'luottamus ↺')`, 'sana piilotettu näppäimistöllä', 8000);
if (!admin.dialogs().some((d) => d.includes('luottamus'))) throw new Error('Piilotusta ei vahvistettu');
step('Sanapilven sana on painike (tabindex 0, role=button, aria-label); Enter piilottaa sen vahvistuksen jälkeen');

const errs = [...admin.logs, ...part.logs, ...stage.logs];
if (errs.length) { console.log('Selaimen virheet:\n' + errs.join('\n')); process.exit(1); }
process.exit(0);
