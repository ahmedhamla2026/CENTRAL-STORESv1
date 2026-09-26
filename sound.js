/* ============================================================
   CENTRAL & STORES — Add-to-cart sound feedback
   ------------------------------------------------------------
   RESPONSIBILITY
     • Play a short confirmation sound when the customer adds
       an item to the cart (.add-cart-btn).

   WHY EVENT DELEGATION
     products-grid.js renders product cards AFTER the page
     loads (when Supabase resolves). A DOMContentLoaded-time
     querySelectorAll(".add-cart-btn") finds nothing. We listen
     on the document instead, so future buttons work.

   PREFERENCES RESPECTED
     • prefers-reduced-motion: reduce → no sound
     • localStorage['cs_sound_muted'] === '1' → no sound

   PUBLIC API
     window.playAddCartSound()    — play now (respects prefs)
     window.toggleStoreSound()    — flip mute, returns new state
     window.isStoreSoundMuted()   — boolean
   ============================================================ */

(function () {
  'use strict';

  var SOUND_FILE    = "add-cart.mp3";
  var VOLUME        = 0.6;
  var COOLDOWN_MS   = 150;
  var MUTE_KEY      = "cs_sound_muted";

  var audio         = null;   /* lazily created on first play */
  var lastPlayedAt  = 0;

  /* ---------- PREFERENCES ---------- */

  function prefersReducedMotion() {
    try {
      return window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  function isMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setMuted(value) {
    try {
      if (value) localStorage.setItem(MUTE_KEY, "1");
      else       localStorage.removeItem(MUTE_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ---------- AUDIO ---------- */

  function ensureAudio() {
    if (audio) return audio;
    try {
      audio = new Audio(SOUND_FILE);
      audio.volume = VOLUME;
      audio.preload = "none";
    } catch (e) {
      audio = null;
    }
    return audio;
  }

  function playNow() {
    if (prefersReducedMotion()) return;
    if (isMuted()) return;

    var now = Date.now();
    if (now - lastPlayedAt < COOLDOWN_MS) return;
    lastPlayedAt = now;

    var a = ensureAudio();
    if (!a) return;

    try {
      a.currentTime = 0;
      var p = a.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) { /* silent — sound is a nicety, not a requirement */ }
  }

  /* ---------- EVENT DELEGATION ---------- */

  document.addEventListener("click", function (event) {
    var button = event.target.closest(".add-cart-btn");
    if (!button) return;
    playNow();
  }, true /* capture — fire even if another handler stops propagation */);

  /* ---------- PUBLIC API ---------- */

  window.playAddCartSound = playNow;

  window.toggleStoreSound = function () {
    var next = !isMuted();
    setMuted(next);
    return !next; /* true = sound on, false = muted */
  };

  window.isStoreSoundMuted = function () {
    return isMuted();
  };

})();