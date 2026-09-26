/* ============================================================
   CENTRAL & STORES — Side Menu (drawer) controller
   ------------------------------------------------------------
   Responsibilities
     • Open / close the slide-in drawer via button, overlay,
       close button, Escape key, or link click.
     • Keep ARIA state in sync (aria-expanded, aria-hidden,
       inert).
     • Trap focus inside the drawer while open.
     • Move focus into the drawer on open and back to the
       trigger on close.
     • Lock body scroll (iOS-safe — preserves scrollY).

   Contract with index.html (upgraded)
     #openMenu        → button, aria-controls="sideMenu"
     #sideMenu        → aside[role="dialog"][aria-modal]
                        starts with aria-hidden="true" + inert
     #menuOverlay     → background scrim
     #menuClose       → close button inside drawer

   Contract with style.css
     .side-menu.open / .menu-overlay.open toggle the visuals.
     Under prefers-reduced-motion the transitions are disabled
     by CSS; this file does not depend on transitionend.

   No business data. No DOM injection. No innerHTML.
   ============================================================ */

document.addEventListener("DOMContentLoaded", function () {
  const openMenuBtn = document.getElementById("openMenu");
  const sideMenu    = document.getElementById("sideMenu");
  const menuOverlay = document.getElementById("menuOverlay");
  const menuClose   = document.getElementById("menuClose");

  /* Silent no-op on pages without a drawer. */
  if (!openMenuBtn || !sideMenu || !menuOverlay) return;

  /* Focusable selector — kept small and explicit so we don't
     trap on elements that are hidden (e.g. disabled buttons). */
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  let isOpen = false;
  let savedScrollY = 0;
  let lastFocused = null;

  /* ----------------------------------------------------------
     Helpers
  ---------------------------------------------------------- */

  function getFocusable() {
    /* Filter out anything inside a hidden ancestor. */
    const candidates = Array.from(sideMenu.querySelectorAll(FOCUSABLE_SELECTOR));
    return candidates.filter(function (el) {
      if (el.hasAttribute('hidden')) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      /* offsetParent is null for display:none ancestors. */
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  function setInert(el, on) {
    if (!el) return;
    if (on) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.removeAttribute('inert');
      el.setAttribute('aria-hidden', 'false');
    }
  }

  function lockScroll() {
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = '-' + savedScrollY + 'px';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollY);
  }

  /* ----------------------------------------------------------
     Open / close
  ---------------------------------------------------------- */

  function openSideMenu() {
    if (isOpen) return;
    isOpen = true;

    lastFocused = document.activeElement;

    /* Remove inert BEFORE focusing anything inside. */
    setInert(sideMenu, false);
    sideMenu.classList.add("open");
    menuOverlay.classList.add("open");

    openMenuBtn.setAttribute("aria-expanded", "true");

    lockScroll();

    /* Move focus into the drawer. Prefer the close button if
       present, otherwise the first focusable element. */
    const target = menuClose || getFocusable()[0];
    if (target) {
      /* rAF so the drawer is technically visible before focus
         moves into it — avoids a rare focus() rejection in
         some browsers when the element is still transitioning. */
      requestAnimationFrame(function () {
        try { target.focus({ preventScroll: true }); } catch (e) {}
      });
    }

    document.addEventListener("keydown", onKeydown);
  }

  function closeSideMenu(options) {
    if (!isOpen) return;
    isOpen = false;

    sideMenu.classList.remove("open");
    menuOverlay.classList.remove("open");

    openMenuBtn.setAttribute("aria-expanded", "false");

    unlockScroll();

    document.removeEventListener("keydown", onKeydown);

    /* Return focus to whatever opened the drawer. */
    const returnTo = (lastFocused && document.contains(lastFocused))
      ? lastFocused
      : openMenuBtn;
    try { returnTo.focus({ preventScroll: true }); } catch (e) {}

    /* Restore inert AFTER focus has left the drawer, so AT
       doesn't lose the focus event on an inert node. */
    setInert(sideMenu, true);
  }

  /* ----------------------------------------------------------
     Keyboard: Escape closes, Tab cycles within drawer
  ---------------------------------------------------------- */

  function onKeydown(event) {
    if (!isOpen) return;

    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      closeSideMenu();
      return;
    }

    if (event.key !== "Tab") return;

    const focusables = getFocusable();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      /* Shift+Tab from first → wrap to last */
      if (active === first || !sideMenu.contains(active)) {
        event.preventDefault();
        try { last.focus({ preventScroll: true }); } catch (e) {}
      }
    } else {
      /* Tab from last → wrap to first */
      if (active === last) {
        event.preventDefault();
        try { first.focus({ preventScroll: true }); } catch (e) {}
      }
    }
  }

  /* ----------------------------------------------------------
     Wire events
  ---------------------------------------------------------- */

  openMenuBtn.addEventListener("click", openSideMenu);

  if (menuClose) {
    menuClose.addEventListener("click", closeSideMenu);
  }

  menuOverlay.addEventListener("click", closeSideMenu);

  /* Clicking a link inside the drawer closes it, then lets the
     browser's default anchor navigation continue. rAF defers
     the close by one frame so the anchor scroll is not
     cancelled by the focus-return in closeSideMenu. */
  sideMenu.addEventListener("click", function (event) {
    const link = event.target.closest("a[href]");
    if (!link) return;
    if (!sideMenu.contains(link)) return;

    requestAnimationFrame(function () {
      closeSideMenu();
    });
  });

  /* If the viewport crosses the desktop breakpoint while the
     drawer is open, close it so the layout does not remain
     scroll-locked on a view where the drawer is normally
     hidden. Adjust breakpoint if your CSS changes it. */
  const mq = window.matchMedia("(min-width: 768px)");
  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", function (e) {
      if (e.matches && isOpen) closeSideMenu();
    });
  }

  /* Safety: if the user navigates back to this page with the
     drawer's open class already present (bfcache restore),
     reset to a clean closed state. */
  if (sideMenu.classList.contains("open")) {
    sideMenu.classList.remove("open");
    menuOverlay.classList.remove("open");
    setInert(sideMenu, true);
    openMenuBtn.setAttribute("aria-expanded", "false");
  } else {
    /* Ensure initial ARIA state is coherent even if the HTML
       has slightly different attributes. */
    if (!sideMenu.hasAttribute("aria-hidden")) {
      sideMenu.setAttribute("aria-hidden", "true");
    }
    if (!sideMenu.hasAttribute("inert")) {
      sideMenu.setAttribute("inert", "");
    }
    if (!openMenuBtn.hasAttribute("aria-expanded")) {
      openMenuBtn.setAttribute("aria-expanded", "false");
    }
  }

  /* Expose for other scripts that may want to close the drawer
     programmatically (e.g. from search.js after a navigation). */
  window.centralStoresMenu = {
    open: openSideMenu,
    close: closeSideMenu,
    isOpen: function () { return isOpen; }
  };
});