/* ============================================================
   CENTRAL & STORES — Public Customer Reviews
   ------------------------------------------------------------
   Responsibilities
     • Load approved reviews from Supabase.
     • Render summary (avg + count) and list / empty / error.
     • Drive the review modal (open, close, focus, validation).
     • Submit new reviews as status='pending'.
     • Client-side rate limit (server-side limit must exist too).

   Dependencies
     • supabase-config.js → window.db / window.supabaseReady
     • index.html         → all #review* / #reviews* elements
     • style.css          → .review-* / .reviews-* classes

   Security
     • User-controlled strings are rendered with textContent,
       never innerHTML.
     • No raw Postgres / JWT errors are surfaced to the user.
     • Client rate limit is convenience only; RLS + a DB trigger
       (or edge function) must enforce the real limit.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- CONFIG ---------- */
  const RATE_KEY      = 'cs_review_last_submit';
  const RATE_LIMIT_MS = 60 * 1000;
  const SELECT_LIMIT  = 50;
  const BOOT_TIMEOUT  = 10000;

  /* ---------- BOOT ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  function boot() {
    /* Bail if the section is absent — nothing to do. */
    const listEl    = document.getElementById('reviewsList');
    const summaryEl = document.getElementById('reviewsSummary');
    if (!listEl || !summaryEl) return;

    /* Prefer the already-initialised public client. */
    if (window.db) {
      startReviews(window.db);
      return;
    }

    /* Otherwise wait for supabase-config.js readiness promise. */
    if (window.supabaseReady && typeof window.supabaseReady.then === 'function') {
      let settled = false;
      const timeout = setTimeout(function () {
        if (settled) return;
        settled = true;
        renderFatal('Reviews are temporarily unavailable.');
      }, BOOT_TIMEOUT);

      window.supabaseReady.then(function (client) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (client) startReviews(client);
        else renderFatal('Reviews are temporarily unavailable.');
      }).catch(function () {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        renderFatal('Reviews are temporarily unavailable.');
      });
      return;
    }

    /* Last resort — SDK absent and no readiness promise. */
    renderFatal('Reviews are temporarily unavailable.');
  }

  function renderFatal(message) {
    const summaryEl = document.getElementById('reviewsSummary');
    const listEl    = document.getElementById('reviewsList');
    if (summaryEl) {
      summaryEl.innerHTML = '';
      summaryEl.textContent = '';
    }
    if (listEl) {
      listEl.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'reviews-error';
      box.textContent = message;
      listEl.appendChild(box);
    }
  }

  /* ----------------------------------------------------------
     MAIN MODULE
  ---------------------------------------------------------- */
  function startReviews(client) {

    /* ---------- DOM REFS ---------- */
    const summaryEl   = document.getElementById('reviewsSummary');
    const listEl      = document.getElementById('reviewsList');
    const openBtn     = document.getElementById('openReviewModal');
    const modal       = document.getElementById('reviewModal');
    const overlay     = document.getElementById('reviewModalOverlay');
    const closeBtn    = document.getElementById('reviewModalClose');
    const cancelBtn   = document.getElementById('reviewCancelBtn');
    const form        = document.getElementById('reviewForm');
    const nameInput   = document.getElementById('reviewName');
    const ratingInput = document.getElementById('reviewRating');
    const textInput   = document.getElementById('reviewText');
    const charCount   = document.getElementById('reviewCharCount');
    const submitBtn   = document.getElementById('reviewSubmitBtn');
    const starButtons = Array.from(document.querySelectorAll('.review-star'));
    const toastEl     = document.getElementById('reviewToast');

    /* ---------- STATE ---------- */
    let isSubmitting = false;
    let lastFocusEl  = null;
    let savedScrollY = 0;

    /* ---------- CONSTANTS ---------- */
    const FOCUSABLE_SELECTOR = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    /* ---------- HELPERS ---------- */

    /* Trusted SVG markup — never contains user data. */
    function starSVGString() {
      return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-star"></use></svg>';
    }

    function createStars(rating, labelText) {
      const wrap = document.createElement('div');
      wrap.className = 'review-card-stars';
      if (labelText) wrap.setAttribute('aria-label', labelText);
      const safe = Math.max(1, Math.min(5, Number(rating) || 5));
      for (let i = 0; i < safe; i++) {
        const span = document.createElement('span');
        span.innerHTML = starSVGString();
        wrap.appendChild(span.firstChild);
      }
      return wrap;
    }

    function formatDate(iso) {
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-IN', {
          year: 'numeric', month: 'short', day: 'numeric'
        });
      } catch (e) {
        return '';
      }
    }

    function showToast(msg, type) {
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.className = 'review-toast ' + (type || '');
      toastEl.hidden = false;
      requestAnimationFrame(function () { toastEl.classList.add('show'); });
      clearTimeout(showToast._t);
      showToast._t = setTimeout(function () {
        toastEl.classList.remove('show');
        setTimeout(function () { toastEl.hidden = true; }, 300);
      }, 3400);
    }

    function setError(id, msg) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = msg || '';
      el.classList.toggle('show', !!msg);
    }

    function clearErrors() {
      setError('reviewNameError', '');
      setError('reviewRatingError', '');
      setError('reviewTextError', '');
    }

    /* ---------- SCROLL LOCK (iOS-safe) ---------- */
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

    /* ---------- LOAD APPROVED REVIEWS ---------- */
    async function loadReviews() {
      try {
        const { data, error } = await client
          .from('reviews')
          .select('id, customer_name, rating, review_text, created_at')
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(SELECT_LIMIT);

        if (error) throw error;

        renderSummary(Array.isArray(data) ? data : []);
        renderList(Array.isArray(data) ? data : []);
      } catch (err) {
        renderSummaryError();
        renderListError();
      }
    }

    /* ---------- SUMMARY ---------- */
    function renderSummary(items) {
      summaryEl.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'reviews-summary-empty';

        const stars = document.createElement('div');
        stars.className = 'reviews-summary-stars';
        stars.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 5; i++) {
          const s = document.createElement('span');
          s.innerHTML = starSVGString();
          s.style.color = '#cfcfcf';
          stars.appendChild(s.firstChild);
        }

        const text = document.createElement('p');
        text.style.marginTop = '8px';
        text.textContent = 'Be the first to review Central & Stores';

        empty.appendChild(stars);
        empty.appendChild(text);
        summaryEl.appendChild(empty);
        return;
      }

      const total  = items.length;
      const avg    = items.reduce(function (s, r) {
        return s + (Number(r.rating) || 0);
      }, 0) / total;
      const avgStr = avg.toFixed(1);
      const filled = Math.round(avg);

      const left = document.createElement('div');
      left.className = 'reviews-summary-left';

      const ratingRow = document.createElement('div');
      ratingRow.className = 'reviews-summary-rating';

      const num = document.createElement('span');
      num.className = 'reviews-summary-number';
      num.textContent = avgStr;

      const max = document.createElement('span');
      max.className = 'reviews-summary-max';
      max.textContent = '/ 5';

      ratingRow.appendChild(num);
      ratingRow.appendChild(max);

      const stars = document.createElement('div');
      stars.className = 'reviews-summary-stars';
      stars.setAttribute('aria-label', 'Average rating ' + avgStr + ' out of 5');
      for (let i = 1; i <= 5; i++) {
        const s = document.createElement('span');
        s.innerHTML = starSVGString();
        if (i > filled) s.style.color = '#cfcfcf';
        stars.appendChild(s.firstChild);
      }

      const meta = document.createElement('div');
      meta.className = 'reviews-summary-meta';
      meta.textContent = 'Based on ' + total + ' approved review' + (total === 1 ? '' : 's');

      left.appendChild(ratingRow);
      left.appendChild(stars);
      left.appendChild(meta);

      summaryEl.appendChild(left);
    }

    function renderSummaryError() {
      summaryEl.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'reviews-error';
      box.textContent = 'Reviews are temporarily unavailable.';
      summaryEl.appendChild(box);
    }

    /* ---------- LIST ---------- */
    function renderList(items) {
      listEl.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'reviews-empty';

        const h = document.createElement('h3');
        h.textContent = 'No reviews yet';

        const p = document.createElement('p');
        p.textContent = 'Be the first to share your experience with Central & Stores.';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reviews-empty-btn';
        btn.innerHTML = starSVGString() + '<span>Write a Review</span>';
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          openModal();
        });

        empty.appendChild(h);
        empty.appendChild(p);
        empty.appendChild(btn);
        listEl.appendChild(empty);
        return;
      }

      const fragment = document.createDocumentFragment();

      items.forEach(function (r) {
        const rating  = Math.max(1, Math.min(5, Number(r.rating) || 5));
        const name    = String(r.customer_name || 'Customer');
        const text    = String(r.review_text || '');
        const dateStr = formatDate(r.created_at);

        const card = document.createElement('article');
        card.className = 'review-card';

        card.appendChild(createStars(rating, rating + ' out of 5 stars'));

        const p = document.createElement('p');
        p.className = 'review-card-text';
        p.textContent = text;
        card.appendChild(p);

        const footer = document.createElement('div');
        footer.className = 'review-card-footer';

        const left = document.createElement('div');

        const author = document.createElement('div');
        author.className = 'review-card-author';
        author.textContent = name;

        const verified = document.createElement('div');
        verified.className = 'review-card-verified';
        const checkWrap = document.createElement('span');
        checkWrap.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="20 6 9 17 4 12"/></svg>';
        verified.appendChild(checkWrap.firstChild);
        verified.appendChild(document.createTextNode('VERIFIED CUSTOMER'));

        left.appendChild(author);
        left.appendChild(verified);

        const dateEl = document.createElement('div');
        dateEl.className = 'review-card-date';
        dateEl.textContent = dateStr;

        footer.appendChild(left);
        footer.appendChild(dateEl);
        card.appendChild(footer);

        fragment.appendChild(card);
      });

      listEl.appendChild(fragment);
    }

    function renderListError() {
      listEl.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'reviews-error';

      const msg = document.createElement('p');
      msg.textContent = 'We could not load reviews right now.';
      msg.style.marginBottom = '12px';

      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'reviews-empty-btn';
      retry.textContent = 'Retry';
      retry.addEventListener('click', function () {
        listEl.innerHTML = '';
        const loading = document.createElement('div');
        loading.className = 'reviews-error';
        loading.textContent = 'Loading reviews…';
        listEl.appendChild(loading);
        loadReviews();
      });

      box.appendChild(msg);
      box.appendChild(retry);
      listEl.appendChild(box);
    }

    /* ---------- MODAL ---------- */
    function getModalFocusables() {
      if (!modal) return [];
      const candidates = Array.from(modal.querySelectorAll(FOCUSABLE_SELECTOR));
      return candidates.filter(function (el) {
        if (el.hasAttribute('hidden')) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        return el.offsetParent !== null || el === document.activeElement;
      });
    }

    function openModal() {
      if (!modal || !overlay) return;
      lastFocusEl = document.activeElement;

      overlay.hidden = false;
      modal.hidden = false;
      lockScroll();

      /* Ensure radiogroup ARIA is coherent on open. */
      const current = Number(ratingInput && ratingInput.value) || 0;
      starButtons.forEach(function (b) {
        const bv = Number(b.dataset.value);
        const on = current > 0 && bv <= current;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', bv === current && current > 0 ? 'true' : 'false');
      });

      requestAnimationFrame(function () {
        if (nameInput) {
          try { nameInput.focus({ preventScroll: true }); } catch (e) {}
        }
      });

      document.addEventListener('keydown', onModalKeydown);
    }

    function closeModal() {
      if (!modal || !overlay) return;
      overlay.hidden = true;
      modal.hidden = true;
      unlockScroll();
      document.removeEventListener('keydown', onModalKeydown);

      if (lastFocusEl && document.contains(lastFocusEl) && typeof lastFocusEl.focus === 'function') {
        try { lastFocusEl.focus({ preventScroll: true }); } catch (e) {}
      }
    }

    function onModalKeydown(e) {
      if (!modal || modal.hidden) return;

      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        closeModal();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusables = getModalFocusables();
      if (!focusables.length) return;

      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !modal.contains(active)) {
          e.preventDefault();
          try { last.focus({ preventScroll: true }); } catch (err) {}
        }
      } else {
        if (active === last) {
          e.preventDefault();
          try { first.focus({ preventScroll: true }); } catch (err) {}
        }
      }
    }

    if (openBtn)   openBtn.addEventListener('click', openModal);
    if (closeBtn)  closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (overlay)   overlay.addEventListener('click', closeModal);

    /* ---------- STAR PICKER ---------- */
    function setRating(value) {
      const v = Math.max(1, Math.min(5, Number(value) || 0));
      if (ratingInput) ratingInput.value = String(v);
      starButtons.forEach(function (b) {
        const bv = Number(b.dataset.value);
        const on = bv <= v;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', bv === v ? 'true' : 'false');
      });
      setError('reviewRatingError', '');
    }

    starButtons.forEach(function (btn, index) {
      /* Click */
      btn.addEventListener('click', function () {
        setRating(Number(btn.dataset.value));
      });

      /* Keyboard (radiogroup) */
      btn.addEventListener('keydown', function (e) {
        const last = starButtons.length - 1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = starButtons[Math.min(index + 1, last)];
          next.focus();
          setRating(Number(next.dataset.value));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = starButtons[Math.max(index - 1, 0)];
          prev.focus();
          setRating(Number(prev.dataset.value));
        } else if (e.key === 'Home') {
          e.preventDefault();
          starButtons[0].focus();
          setRating(Number(starButtons[0].dataset.value));
        } else if (e.key === 'End') {
          e.preventDefault();
          starButtons[last].focus();
          setRating(Number(starButtons[last].dataset.value));
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setRating(Number(btn.dataset.value));
        }
      });
    });

    /* ---------- CHAR COUNT ---------- */
    if (textInput && charCount) {
      textInput.addEventListener('input', function () {
        charCount.textContent = String(textInput.value.length);
      });
    }

    /* ---------- SUBMIT ---------- */
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (isSubmitting) return;
        clearErrors();

        const name   = (nameInput.value || '').trim();
        const rating = Number(ratingInput.value) || 0;
        const text   = (textInput.value || '').trim();

        let hasError = false;

        if (!name) { setError('reviewNameError', 'Please enter your name.'); hasError = true; }
        else if (name.length > 60) { setError('reviewNameError', 'Name is too long.'); hasError = true; }

        if (!rating || rating < 1 || rating > 5) {
          setError('reviewRatingError', 'Please select a rating.');
          hasError = true;
        }

        if (!text) { setError('reviewTextError', 'Please write your review.'); hasError = true; }
        else if (text.length < 3) { setError('reviewTextError', 'Review is too short.'); hasError = true; }
        else if (text.length > 800) { setError('reviewTextError', 'Review is too long (max 800).'); hasError = true; }

        if (hasError) return;

        /* Client-side rate limit — convenience only. */
        let rateOK = true;
        let wait = 0;
        try {
          const last = Number(localStorage.getItem(RATE_KEY) || 0);
          if (last && Date.now() - last < RATE_LIMIT_MS) {
            rateOK = false;
            wait = Math.ceil((RATE_LIMIT_MS - (Date.now() - last)) / 1000);
          }
        } catch (err) {
          /* localStorage unavailable — proceed; server must enforce. */
        }

        if (!rateOK) {
          showToast('Please wait ' + wait + 's before submitting again.', 'error');
          return;
        }

        isSubmitting = true;
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;

        try {
          const { error } = await client.from('reviews').insert([{
            customer_name: name,
            rating: rating,
            review_text: text,
            status: 'pending'
          }]);

          if (error) throw error;

          try { localStorage.setItem(RATE_KEY, String(Date.now())); } catch (err) {}

          form.reset();
          if (ratingInput) ratingInput.value = '';
          if (charCount) charCount.textContent = '0';
          starButtons.forEach(function (b) {
            b.classList.remove('active');
            b.setAttribute('aria-checked', 'false');
          });

          closeModal();
          showToast('Thank you! Your review has been submitted and is waiting for approval.', 'success');
        } catch (err) {
          showToast('Something went wrong. Please try again.', 'error');
        } finally {
          isSubmitting = false;
          submitBtn.classList.remove('loading');
          submitBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
        }
      });
    }

    /* ---------- INITIAL STATE ---------- */
    /* Ensure star radiogroup is well-formed on first open. */
    starButtons.forEach(function (b) {
      if (!b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', 'false');
    });

    /* ---------- BOOT ---------- */
    loadReviews();
  }
})();