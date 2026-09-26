/* ============================================================
   CENTRAL & STORES — Store Configuration
   ------------------------------------------------------------
   Single source of truth for business identity and contact
   facts. No product data, no prices, no Supabase keys.

   CONTRACT
     window.STORE_CONFIG      → frozen config object
     window.storeTelLink()    → "tel:+919344621645"
     window.storeWaLink(msg)  → "https://wa.me/919344621645?text=..."

   Every public page must read phone / WhatsApp / address /
   hours from here. Nothing is hard-coded in HTML.

   HOW TO UPDATE THE PHONE NUMBER
     1. Change store.phone.e164 below.
     2. Every "Call" / "WhatsApp" link on every page follows.
     3. No HTML file needs to be touched.
   ============================================================ */

(function () {
  'use strict';

  const STORE_CONFIG = {
    /* ----------------------------------------------------
       Identity
    ---------------------------------------------------- */
    name:        'Central & Stores',
    shortName:   'Central & Stores',
    tagline:     'Premium Grocery Store',
    category:    'Grocery & Department Store',
    description:
      'Trusted grocery and department store in Mangalam, Tiruppur. ' +
      'Quality products, honest prices and reliable service — every day.',

    /* ----------------------------------------------------
       Contact — one source for the whole site
       e164 is the format used by tel: and wa.me links.
       display is the human-readable version.
    ---------------------------------------------------- */
    phone: {
      e164:    '+919344621645',
      display: '+91 93446 21645'
    },
    whatsapp: {
      e164:    '+919344621645',
      display: '+91 93446 21645'
    },

    /* ----------------------------------------------------
       Address
       street is currently a Plus Code. Replace with the
       real street line when available.
    ---------------------------------------------------- */
    address: {
      street:      '473C+3W6',
      locality:    'Mangalam',
      region:      'Tamil Nadu',
      postalCode:  '641663',
      country:     'IN',
      countryName: 'India'
    },

    /* ----------------------------------------------------
       Map — leave empty until a real link exists.
       Nothing in the UI will render a "View map" button
       while this is empty.
    ---------------------------------------------------- */
    mapsUrl: '',

    /* ----------------------------------------------------
       Hours
       Format follows schema.org openingHours.
       Friday intentionally not listed (matches existing
       structured data). Add ',Fr 08:00-22:00' to include.
    ---------------------------------------------------- */
    openingHours: {
      schema:    'Mo-Th,Sa-Su 08:00-22:00',
      display:   'Mon–Thu, Sat–Sun · 8:00 AM – 10:00 PM',
      timezone:  'Asia/Kolkata'
    },

    /* ----------------------------------------------------
       Locale / currency — used by price and date formatters
    ---------------------------------------------------- */
    locale:   'en-IN',
    currency: 'INR',
    currencySymbol: '₹',

    /* ----------------------------------------------------
       Canonical / SEO
    ---------------------------------------------------- */
    siteUrl: 'https://www.central-and-stores.ct.ws/',
    logoUrl: 'https://www.central-and-stores.ct.ws/logo.png'
  };

  /* Freeze top-level to prevent accidental mutation at runtime. */
  Object.freeze(STORE_CONFIG);
  Object.freeze(STORE_CONFIG.phone);
  Object.freeze(STORE_CONFIG.whatsapp);
  Object.freeze(STORE_CONFIG.address);
  Object.freeze(STORE_CONFIG.openingHours);

  window.STORE_CONFIG = STORE_CONFIG;

  /* ----------------------------------------------------
     Link builders — every page uses these, never string
     concatenation. Guarantees consistent URL encoding.
  ---------------------------------------------------- */

  /**
   * Build a tel: link from STORE_CONFIG.phone.e164.
   * @returns {string}
   */
  window.storeTelLink = function () {
    return 'tel:' + STORE_CONFIG.phone.e164;
  };

  /**
   * Build a wa.me link with an optional pre-filled message.
   * @param {string} [message] - plain text; will be URL-encoded
   * @returns {string}
   */
  window.storeWaLink = function (message) {
    const base = 'https://wa.me/' + STORE_CONFIG.whatsapp.e164.replace(/^\+/, '');
    if (!message) return base;
    return base + '?text=' + encodeURIComponent(message);
  };

  /* ----------------------------------------------------
     Optional: auto-hydrate any element that opts in via
     data attributes, so plain HTML stays declarative.

       <a data-tel-link>Call Store</a>
       <a data-wa-link>WhatsApp Store</a>
       <a data-wa-link data-wa-message="Hello...">Contact</a>

     This runs once on DOMContentLoaded and is idempotent.
  ---------------------------------------------------- */

  function hydrateLinks() {
    document.querySelectorAll('a[data-tel-link]').forEach(function (el) {
      el.setAttribute('href', window.storeTelLink());
    });

    document.querySelectorAll('a[data-wa-link]').forEach(function (el) {
      const msg = el.getAttribute('data-wa-message') || undefined;
      el.setAttribute('href', window.storeWaLink(msg));
      if (!el.hasAttribute('target')) {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateLinks, { once: true });
  } else {
    hydrateLinks();
  }
})();