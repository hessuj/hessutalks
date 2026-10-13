/*
 * HessuTalks – osallistujan kielivalinnan muistaminen.
 *
 * Ei evästeitä: valinta tallennetaan vain tämän selaimen localStorageen.
 *  - Jos osoitteessa on ?lang=fi|en (käyttäjä valitsi kielen), valinta tallennetaan.
 *  - Muuten, jos tallennettu kieli poikkeaa sivun kielestä (esim. QR-koodin linkki
 *    ja selaimen kieli), sivu ladataan uudelleen tallennetulla kielellä.
 */
(function () {
  'use strict';

  var KEY = 'hessutalks.lang';
  var LANGS = ['fi', 'en'];
  var params = new URLSearchParams(window.location.search);
  var chosen = params.get('lang');

  try {
    if (LANGS.indexOf(chosen) !== -1) {
      window.localStorage.setItem(KEY, chosen);
      return;
    }
    var saved = window.localStorage.getItem(KEY);
    if (LANGS.indexOf(saved) !== -1 && saved !== document.documentElement.lang) {
      params.set('lang', saved);
      window.location.replace(window.location.pathname + '?' + params.toString() + window.location.hash);
    }
  } catch (e) {
    // localStorage ei käytettävissä (esim. yksityinen selaus): kieli tulee selaimen asetuksista.
  }
})();
