/* ============================================================
   CENTRAL & STORES — Cart state (localStorage backed)
   ------------------------------------------------------------
   RESPONSIBILITY
     • Read / write cart in localStorage under CART_KEY.
     • Update all cart badges on the page.
     • Expose cart mutation helpers (add / change / remove / clear).
     • Emit `centralCartUpdated` on every mutation and on
       cross-tab storage events.

   CART ITEM SHAPE (stable contract — do not break)
     {
       id:       string | number   (compared as string)
       name:     string
       category: string
       weight:   string
       price:    number            (snapshot at add-time)
       image:    string            (URL; accepts `image_url` on input)
       quantity: integer 1..MAX_QTY_PER_ITEM
     }

   GLOBAL API (preserved — do not rename)
     getCentralCart()
     saveCentralCart(cart)
     getCartTotalQuantity()
     updateAllCartBadges()
     addProductToCart(product)
     changeCartQuantity(productId, change)
     removeProductFromCart(productId)
     clearCentralCart()

   EVENTS
     document: 'centralCartUpdated'  detail: { cart }

   SECURITY
     • No HTML parsing, no network requests.
     • Cart contents are snapshots; consumers must render them
       with textContent, never innerHTML.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONSTANTS ---------- */
  const CART_KEY          = "centralStoresCart";
  const MAX_QTY_PER_ITEM  = 99;

  /* Badge selector — one place, one truth.
     Covers every existing badge class / attribute used in the
     project. Adding a new badge is a one-line change here. */
  const BADGE_SELECTOR = [
    ".cart-count",
    ".cart-badge",
    ".bottom-cart-count",
    ".nav-cart-count",
    "[data-cart-count]",
    "#bottomCartCount"
  ].join(",");

  /* ---------- LOW-LEVEL STORAGE ---------- */

  /**
   * Read + normalise cart from localStorage.
   * Drops malformed entries silently and coerces quantities.
   * @returns {Array}
   */
  function getCentralCart() {
    let raw;
    try {
      raw = localStorage.getItem(CART_KEY);
    } catch (e) {
      return [];
    }
    if (!raw) return [];

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const clean = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || item.id == null) continue;

      const qty = clampQty(item.quantity);
      if (qty <= 0) continue;

      const price = Number(item.price);
      clean.push({
        id:       item.id,
        name:     String(item.name || ''),
        category: String(item.category || ''),
        weight:   String(item.weight || ''),
        price:    isFinite(price) ? price : 0,
        /* Accept `image` or `image_url` on input; store as `image`. */
        image:    String(item.image || item.image_url || ''),
        quantity: qty
      });
    }
    return clean;
  }

  function clampQty(value) {
    let n = Number(value);
    if (!isFinite(n)) n = 1;
    n = Math.floor(n);
    if (n < 1) return 0;
    if (n > MAX_QTY_PER_ITEM) return MAX_QTY_PER_ITEM;
    return n;
  }

  /**
   * Persist cart and refresh badges. Emits nothing — callers
   * are responsible for dispatching `centralCartUpdated` after
   * they have finished their own mutation.
   * @param {Array} cart
   */
  function saveCentralCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) {
      /* Quota exceeded / private mode / disabled storage.
         The in-memory cart passed in is still usable by the
         caller, but the badge update and event dispatch below
         will reflect only what was actually persisted. */
    }
    updateAllCartBadges();
  }

  /* ---------- BADGES ---------- */

  function getCartTotalQuantity() {
    const cart = getCentralCart();
    let total = 0;
    for (let i = 0; i < cart.length; i++) {
      total += Number(cart[i].quantity) || 0;
    }
    return total;
  }

  function updateAllCartBadges() {
    const total = getCartTotalQuantity();
    const badges = document.querySelectorAll(BADGE_SELECTOR);
    badges.forEach(function (badge) {
      badge.textContent = String(total);
      badge.style.display = total > 0 ? "flex" : "none";
    });
  }

  /* ---------- DISPATCH ---------- */

  function emitCartUpdated(cart) {
    document.dispatchEvent(
      new CustomEvent("centralCartUpdated", { detail: { cart: cart } })
    );
  }

  /* ---------- HELPERS ---------- */

  function findItem(cart, productId) {
    const target = String(productId);
    for (let i = 0; i < cart.length; i++) {
      if (String(cart[i].id) === target) return cart[i];
    }
    return null;
  }

  /* ---------- PUBLIC MUTATIONS ---------- */

  /**
   * Add one unit of a product to the cart, or increment quantity.
   * @param {Object} product — must include `id`. Optional: name,
   *   category, weight, price, image/image_url, is_available.
   */
  function addProductToCart(product) {
    if (!product || product.id == null) {
      throw new Error("addProductToCart requires a product with an id.");
    }
    if (product.is_available === false) {
      /* Caller should not surface unavailable products, but
         guard here so no path can silently add one. */
      return;
    }

    const cart = getCentralCart();
    const existing = findItem(cart, product.id);

    /* Normalise the incoming image field. Callers may pass
       either `image` (legacy) or `image_url` (DB shape). */
    const incomingImage = product.image || product.image_url || '';

    if (existing) {
      existing.quantity = clampQty((Number(existing.quantity) || 0) + 1);
      /* Refresh snapshot fields with the latest known values. */
      existing.name     = product.name     || existing.name;
      existing.category = product.category || existing.category;
      existing.weight   = product.weight   || existing.weight;
      if (product.price != null) existing.price = Number(product.price) || 0;
      if (incomingImage) existing.image = String(incomingImage);
    } else {
      cart.push({
        id:       product.id,
        name:     String(product.name     || ''),
        category: String(product.category || ''),
        weight:   String(product.weight   || ''),
        price:    Number(product.price) || 0,
        image:    String(incomingImage),
        quantity: 1
      });
    }

    saveCentralCart(cart);
    emitCartUpdated(getCentralCart());
  }

  /**
   * Apply a positive or negative delta to a cart item's quantity.
   * Removes the item when quantity drops to 0 or below.
   * @param {string|number} productId
   * @param {number} change  — integer, e.g. +1 or -1
   */
  function changeCartQuantity(productId, change) {
    const delta = Number(change);
    if (!isFinite(delta) || Math.floor(delta) !== delta || delta === 0) {
      return;
    }

    let cart = getCentralCart();
    const item = findItem(cart, productId);
    if (!item) return;

    const next = (Number(item.quantity) || 0) + delta;

    if (next <= 0) {
      cart = cart.filter(function (i) {
        return String(i.id) !== String(productId);
      });
    } else {
      item.quantity = clampQty(next);
    }

    saveCentralCart(cart);
    emitCartUpdated(getCentralCart());
  }

  /**
   * Remove an item entirely.
   * @param {string|number} productId
   */
  function removeProductFromCart(productId) {
    const target = String(productId);
    const cart = getCentralCart().filter(function (i) {
      return String(i.id) !== target;
    });

    saveCentralCart(cart);
    emitCartUpdated(getCentralCart());
  }

  /**
   * Remove everything.
   */
  function clearCentralCart() {
    try {
      localStorage.removeItem(CART_KEY);
    } catch (e) { /* ignored — same as failure to write */ }

    updateAllCartBadges();
    emitCartUpdated([]);
  }

  /* ---------- READ HELPERS (small, additive) ---------- */

  /**
   * Get a single cart item by id.
   * @param {string|number} productId
   * @returns {Object|null}
   */
  function getCartItem(productId) {
    return findItem(getCentralCart(), productId);
  }

  /**
   * Subscribe to cart updates. The callback is invoked
   * immediately with the current cart, then again on every
   * `centralCartUpdated` event.
   * @param {(cart: Array) => void} cb
   * @returns {() => void} unsubscribe
   */
  function onCartUpdated(cb) {
    if (typeof cb !== 'function') return function () {};
    const handler = function (e) {
      cb(e && e.detail ? e.detail.cart : getCentralCart());
    };
    document.addEventListener('centralCartUpdated', handler);
    /* Immediate call with current state. */
    cb(getCentralCart());
    return function () {
      document.removeEventListener('centralCartUpdated', handler);
    };
  }

  /* ---------- INIT ---------- */

  document.addEventListener("DOMContentLoaded", function () {
    updateAllCartBadges();
  });

  /* Cross-tab sync: refresh badges AND notify listeners. */
  window.addEventListener("storage", function (event) {
    if (event.key !== CART_KEY) return;
    updateAllCartBadges();
    emitCartUpdated(getCentralCart());
  });

  /* ---------- GLOBAL EXPORTS (preserve existing names) ---------- */

  window.getCentralCart         = getCentralCart;
  window.saveCentralCart        = saveCentralCart;
  window.getCartTotalQuantity   = getCartTotalQuantity;
  window.updateAllCartBadges    = updateAllCartBadges;
  window.addProductToCart       = addProductToCart;
  window.changeCartQuantity     = changeCartQuantity;
  window.removeProductFromCart  = removeProductFromCart;
  window.clearCentralCart       = clearCentralCart;

  /* Additive helpers for future pages (cart.html etc.). */
  window.getCartItem            = getCartItem;
  window.onCartUpdated          = onCartUpdated;

  /* Namespaced constants — optional for future files. */
  window.CentralCart = Object.freeze({
    KEY:              CART_KEY,
    MAX_QTY_PER_ITEM: MAX_QTY_PER_ITEM,
    BADGE_SELECTOR:   BADGE_SELECTOR,
    onUpdated:        onCartUpdated,
    getItem:          getCartItem
  });
})();