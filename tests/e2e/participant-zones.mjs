// Osallistujan sivun osiot: luennoitsijan kysymykset, nimimerkki ja omat viestit erillisinä kokonaisuuksina
// (Hessun palaute 29.10.). Puhelimen leveydellä (390 px) osiot ovat allekkain eikä sivu vieritä sivuttain.
// SCREENSHOT=<hakemisto> tallentaa kuvat (fi ja en) tarkastelua varten.
// Ajo: scripts/e2e.sh participant-zones.mjs  (tai node tests/e2e/participant-zones.mjs <cdp-port> <app-url>)
import { writeFileSync } from 'node:fs';
import { tab, step, setupAdmin, createEvent, openParticipant, openPoll, mode } from './lib.mjs';

const [port, app] = [process.argv[2], process.argv[3]];

const admin = await tab(port);
await setupAdmin(admin, app);
await createEvent(admin, 'E2E Zones', null);
const part = await openParticipant(port, admin);
await part.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 1400, deviceScaleFactor: 2, mobile: true });
await part.waitFor(`!document.getElementById('polls-zone').hidden && !document.getElementById('ask-form').hidden`, 'osiot näkyvissä');
await part.waitFor(part.hasText('Odotetaan seuraavaa kysymystä'), 'odotusnäkymä');

const layout = () => part.js(`(() => {
  const zones = [...document.querySelectorAll('section.zone')];
  return {
    titles: zones.map((z) => z.querySelector('.zone-title').textContent),
    tops: zones.map((z) => Math.round(z.getBoundingClientRect().top)),
    colors: zones.map((z) => getComputedStyle(z).borderTopColor),
    labelled: zones.every((z) => document.getElementById(z.getAttribute('aria-labelledby')) === z.querySelector('.zone-title')),
    waitingInLive: !!document.querySelector('#polls-zone .poll-waiting'),
    nickInNick: !!document.querySelector('.zone-nick #nickname'),
    textInAsk: !!document.querySelector('.zone-ask #text') && !!document.querySelector('.zone-ask #send'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`);

let l = await layout();
if (l.titles.join(' | ') !== 'Luennon kysymykset | Nimimerkkisi | Kysy tai anna palautetta') throw new Error('Osiot: ' + l.titles);
if (!(l.tops[0] < l.tops[1] && l.tops[1] < l.tops[2])) throw new Error('Järjestys: ' + l.tops);
if (new Set(l.colors).size !== 3) throw new Error('Osioilla pitää olla eri värit: ' + l.colors);
if (!l.labelled || !l.waitingInLive || !l.nickInNick || !l.textInAsk) throw new Error('Rakenne: ' + JSON.stringify(l));
if (l.overflow > 0) throw new Error(`Sivu vierittää sivuttain ${l.overflow} px puhelimen leveydellä`);
if (!(await part.js(part.hasText('Nimimerkki näkyy vain omien kysymystesi ja palautteesi yhteydessä.')))) throw new Error('Nimimerkin selite puuttuu');
step('Kolme osiota järjestyksessä (kysymykset, nimimerkki, oma viesti), eri värit, otsikot ja ARIA; ei vaakavieritystä 390 px:llä');

const shot = async (name) => {
  if (!process.env.SCREENSHOT) return;
  const { data } = await part.cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(`${process.env.SCREENSHOT}/${name}.png`, Buffer.from(data, 'base64'));
};
await shot('osallistuja-fi');

// Englanniksi ja aktiivisen kysymyksen kanssa: kysymys on luennon kysymysten osiossa.
await part.js(`document.querySelector('.lang-switch a[hreflang=en]').click()`);
await part.waitFor(`document.getElementById('zone-live-title')?.textContent === 'Lecture questions' && !document.getElementById('polls-zone').hidden`, 'englanti');
l = await layout();
if (l.titles.join(' | ') !== 'Lecture questions | Your nickname | Ask a question or give feedback') throw new Error('EN: ' + l.titles);
await admin.click('Uusi sarja');
await admin.waitFor(admin.has('#set-slug'), 'sarjalomake');
await admin.fill('#set-slug', 'L1'); await admin.fill('#set-title', 'L1 Layers');
await admin.submit('#set-slug');
await admin.waitFor(admin.hasText('L1 Layers'), 'sarja');
await admin.click('Uusi kysymys', 'L1 Layers');
await admin.waitFor(admin.has('#poll-prompt'), 'kysymyslomake');
await admin.fill('#poll-type', 'single');
await admin.fill('#poll-prompt', 'Which goal of the CIA triad failed?');
await admin.fill('#poll-options', 'Confidentiality\nIntegrity\nAvailability');
await admin.submit('#poll-prompt');
await admin.waitFor(admin.hasText('Which goal of the CIA triad failed?'), 'kysymys');
await openPoll(admin, 'Which goal of the CIA triad failed?');
await part.waitFor(`!!document.querySelector('#polls-zone form.poll')`, 'kysymys osiossa', 8000);
if ((await layout()).overflow > 0) throw new Error('Vaakavieritys kysymyksen kanssa');
await shot('osallistuja-en-kysymys');
step('Englanniksi: Lecture questions / Your nickname / Ask a question or give feedback; avattu kysymys osiossa');
process.exit(0);
