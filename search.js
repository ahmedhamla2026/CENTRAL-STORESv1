/* ============================================================
   CENTRAL & STORES — Site-wide product search
   ------------------------------------------------------------
   Responsibilities
     • Live-filter published products as the user types.
     • Render a dropdown of matches (loading / empty / error).
     • Keyboard navigation + ARIA combobox/listbox semantics.
     • Click on a result → navigate (homepage) or scroll+flash
       (products.html, where the product card exists).

   Data source
     • Supabase `products` table. No productsData global.
     • Falls back to a soft "starting up" state until
       window.db / window.supabaseReady is ready.

   Security
     • User query is stripped of SQL wildcards (% _ \) before
       it is used in the ILIKE filter.
     • Product fields are rendered with textContent, never
       innerHTML, so DB-supplied strings cannot inject markup.

   Contract
     #homeSearch  or  #productSearch  → input (either one)
     #searchResults                   → dropdown container
     .search-item / .search-info / .search-empty  → existing CSS
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONFIG ---------- */
  const DEBOUNCE_MS    = 200;
  const MIN_QUERY_LEN  = 2;
  const RESULT_LIMIT   = 8;
  const CACHE_MAX      = 20;

  /* ---------- ELEMENTS ---------- */
  const searchInput =
    document.getElementById('homeSearch') ||
    document.getElementById('productSearch');

  const searchResults = document.getElementById('searchResults');

  if (!searchInput || !searchResults) return;

  /* ---------- STATE ---------- */
  let debounceTimer = null;
  let currentQuery  = '';
  let inFlight      = null;               /* AbortController */
  let activeIndex   = -1;                 /* keyboard selection */
  let currentItems  = [];                 /* last rendered items */
  const queryCache  = new Map();          /* query → items[] */

  /* ---------- ARIA WIRING (idempotent) ---------- */
  if (!searchResults.id) searchResults.id = 'searchResults';
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', searchResults.id);
  searchInput.setAttribute('aria-expanded', 'false');
  searchResults.setAttribute('role', 'listbox');

  /* ---------- HELPERS ---------- */

  /* Trusted SVG markup for the search icon in the empty/loading rows. */
  function searchIconString() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
           '<circle cx="11" cy="11" r="7"></circle>' +
           '<path d="m20 20-4-4"></path></svg>';
  }

  /* Strip ILIKE wildcards and PostgREST filter metacharacters. */
  function sanitizeQuery(raw) {
    return String(raw || '')
      .replace(/[%_\\]/g, ' ')          /* SQL wildcards */
      .replace(/[,()]/g, ' ')            /* PostgREST filter delimiters */
      .trim();
  }

  function cacheGet(key) {
    if (!queryCache.has(key)) return null;
    const items = queryCache.get(key);
    /* refresh LRU order */
    queryCache.delete(key);
    queryCache.set(key, items);
    return items;
  }

  function cacheSet(key, items) {
    if (queryCache.has(key)) queryCache.delete(key);
    queryCache.set(key, items);
    while (queryCache.size > CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      queryCache.delete(oldest);
    }
  }

  function openDropdown() {
    searchResults.style.display = 'block';
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    searchResults.style.display = 'none';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function clearDropdown() {
    while (searchResults.firstChild) {
      searchResults.removeChild(searchResults.firstChild);
    }
    currentItems = [];
    activeIndex = -1;
    searchInput.removeAttribute('aria-activedescendant');
  }

  function renderMessage(text, extraClass) {
    clearDropdown();
    const row = document.createElement('div');
    row.className = 'search-empty' + (extraClass ? ' ' + extraClass : '');
    row.textContent = text;
    searchResults.appendChild(row);
    openDropdown();
  }

  /* ---------- SUPABASE QUERY ---------- */

  function isDbReady() {
    return !!(window.db && typeof window.db.from === 'function');
  }

  async function fetchProducts(query, signal) {
    /* Only published products. Excludes availability= false. */
    const like = '%' + query + '%';

    const request = window.db
      .from('products')
      .select('id, name, category, weight, price, image_url, is_available, is_published, is_featured')
      .eq('is_published', true)
      .or([
        'name.ilike.' + like,
        'category.ilike.' + like,
        'weight.ilike.' + like
      ].join(','))
      .order('is_featured', { ascending: false })
      .order('name',       { ascending: true })
      .limit(RESULT_LIMIT);

    /* Supabase JS v2 supports abortSignal on .select() via
       postgrest-js. If the version you use does not, the
       signal is ignored — behaviour is still correct, just
       without request cancellation. */
    if (signal) {
      try { request.abortSignal(signal); } catch (e) { /* no-op */ }
    }

    const { data, error } = await request;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  /* ---------- RENDER ---------- */

  function renderItems(items) {
    clearDropdown();
    currentItems = items;
    activeIndex = -1;

    if (!items.length) {
      renderMessage('No products found');
      return;
    }

    const fragment = document.createDocumentFragment();

    items.forEach(function (product, index) {
      const row = document.createElement('div');
      row.className = 'search-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.dataset.id    = String(product.id);
      row.dataset.index = String(index);
      row.id = 'search-item-' + index;

      const info = document.createElement('div');
      info.className = 'search-info';

      const h4 = document.createElement('h4');
      h4.textContent = String(product.name || '');

      const p = document.createElement('p');
      const cat = String(product.category || '');
      const wt  = String(product.weight || '');
      const sep = cat && wt ? ' • ' : '';
      p.textContent = cat + sep + wt;

      info.appendChild(h4);
      info.appendChild(p);
      row.appendChild(info);

      fragment.appendChild(row);
    });

    searchResults.appendChild(fragment);
    openDropdown();
  }

  function setActiveIndex(next) {
    const items = searchResults.querySelectorAll('.search-item');
    if (!items.length) return;

    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].classList.remove('is-active');
      items[activeIndex].setAttribute('aria-selected', 'false');
    }

    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    activeIndex = next;

    const el = items[activeIndex];
    el.classList.add('is-active');
    el.setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', el.id);

    /* Keep the active row in view. */
    if (typeof el.scrollIntoView === 'function') {
      try {
        el.scrollIntoView({ block: 'nearest' });
      } catch (e) { /* ignore */ }
    }
  }

  /* ---------- ACTION ON SELECT ---------- */

  function selectProduct(product) {
    const id = product && product.id;
    if (id == null) return;

    closeDropdown();
    searchInput.value = '';

    /* If a matching card exists on this page (products.html),
       scroll to it and flash it. Otherwise navigate to the
       product details page. */
    const card = document.getElementById('product-' + id);

    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prevOutline = card.style.outline;
      card.style.outline = '3px solid #f5b400';
      setTimeout(function () {
        card.style.outline = prevOutline || 'none';
      }, 2000);
      return;
    }

    window.location.href = 'product-details.html?id=' + encodeURIComponent(id);
  }

  /* ---------- CORE SEARCH ---------- */

  async function runSearch(rawQuery) {
    const query = sanitizeQuery(rawQuery);

    if (!query || query.length < MIN_QUERY_LEN) {
      closeDropdown();
      clearDropdown();
      currentQuery = '';
      return;
    }

    currentQuery = query;

    const cached = cacheGet(query);
    if (cached) {
      renderItems(cached);
      return;
    }

    /* Cancel any pending request. */
    if (inFlight) {
      try { inFlight.abort(); } catch (e) { /* ignore */ }
      inFlight = null;
    }

    /* If the DB is not ready yet, show a soft placeholder. */
    if (!isDbReady()) {
      renderMessage('Search is starting up…');

      if (window.supabaseReady && typeof window.supabaseReady.then === 'function') {
        window.supabaseReady
          .then(function () { runSearch(query); })
          .catch(function () { renderMessage('Search is unavailable right now.'); });
      }
      return;
    }

    renderMessage('Searching…', 'search-loading');

    const controller = (typeof AbortController !== 'undefined')
      ? new AbortController()
      : null;
    inFlight = controller;

    try {
      const items = await fetchProducts(query, controller ? controller.signal : null);

      /* If the query changed while we were waiting, drop the result. */
      if (query !== currentQuery) return;

      cacheSet(query, items);
      renderItems(items);
    } catch (err) {
      /* Abort is expected — do not surface it. */
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) return;
      renderMessage('Search is unavailable right now. Please try again.');
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  /* ---------- EVENT: INPUT (debounced) ---------- */

  searchInput.addEventListener('input', function () {
    const value = searchInput.value;

    if (debounceTimer) clearTimeout(debounceTimer);

    /* Immediate feedback when the box is emptied. */
    if (!value || value.trim().length < MIN_QUERY_LEN) {
      closeDropdown();
      clearDropdown();
      currentQuery = '';
      return;
    }

    debounceTimer = setTimeout(function () {
      runSearch(value);
    }, DEBOUNCE_MS);
  });

  /* ---------- EVENT: KEYBOARD ---------- */

  searchInput.addEventListener('keydown', function (e) {
    const dropdownOpen = searchResults.style.display === 'block';

    if (e.key === 'Escape') {
      if (dropdownOpen) {
        e.preventDefault();
        closeDropdown();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      if (!dropdownOpen || !currentItems.length) return;
      e.preventDefault();
      setActiveIndex(activeIndex + 1);
      return;
    }

    if (e.key === 'ArrowUp') {
      if (!dropdownOpen || !currentItems.length) return;
      e.preventDefault();
      setActiveIndex(activeIndex - 1);
      return;
    }

    if (e.key === 'Enter') {
      if (activeIndex >= 0 && currentItems[activeIndex]) {
        e.preventDefault();
        selectProduct(currentItems[activeIndex]);
      }
      return;
    }
  });

  /* ---------- EVENT: DELEGATED CLICK ON DROPDOWN ---------- */

  searchResults.addEventListener('click', function (e) {
    const row = e.target.closest('.search-item');
    if (!row) return;
    const idx = Number(row.dataset.index);
    const product = currentItems[idx];
    if (product) selectProduct(product);
  });

  searchResults.addEventListener('mousemove', function (e) {
    const row = e.target.closest('.search-item');
    if (!row) return;
    const idx = Number(row.dataset.index);
    if (!isNaN(idx) && idx !== activeIndex) setActiveIndex(idx);
  });

  /* ---------- EVENT: CLICK OUTSIDE ---------- */

  document.addEventListener('click', function (e) {
    if (e.target === searchInput) return;
    if (searchResults.contains(e.target)) return;
    closeDropdown();
  });

  /* ---------- INITIAL STATE ---------- */
  closeDropdown();
})();