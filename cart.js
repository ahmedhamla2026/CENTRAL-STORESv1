/* ============================================================
   CENTRAL & STORES — Cart page controller (cart.html)
   ------------------------------------------------------------
   RESPONSIBILITY
     • Render the cart list from cart-common.js state.
     • Toggle empty / products / customer-details sections.
     • Handle +/− quantity and remove-item actions.
     • Validate the enquiry form and open a WhatsApp message.

   DEPENDENCIES
     • cart-common.js  → getCentralCart, saveCentralCart, ...
     • config.js       → window.storeWaLink(message), STORE_CONFIG
     • cart.html DOM   → #emptyCart, #cartProductsCard,
                          #customerDetailsCard, #cartItemsList,
                          #cartItemCount, #orderForm, etc.
     • cart.css        → expects the .cart-item structure below:
                          .cart-item
                            .cart-item-image-wrap
                              .cart-item-image
                            .cart-item-details
                              .cart-item-category
                              h4
                              .cart-item-weight
                              .cart-item-actions
                                .quantity-control
                                  .quantity-btn
                                  .quantity-value
                                  .quantity-btn
                                .remove-cart-item

   SECURITY
     • All user / product fields are rendered with textContent.
     • Image URLs are assigned to img.src, never to innerHTML.
     • WhatsApp URL is built with window.storeWaLink() and
       encodeURIComponent.
   ============================================================ */

document.addEventListener("DOMContentLoaded", function () {
  'use strict';

  /* ---------- DOM ---------- */
  var emptyCart           = document.getElementById("emptyCart");
  var cartProductsCard    = document.getElementById("cartProductsCard");
  var customerDetailsCard = document.getElementById("customerDetailsCard");
  var cartItemsList       = document.getElementById("cartItemsList");
  var cartItemCount       = document.getElementById("cartItemCount");
  var orderForm           = document.getElementById("orderForm");
  var sendOrderBtn        = document.getElementById("sendOrderBtn");

  var nameInput    = document.getElementById("customerName");
  var phoneInput   = document.getElementById("customerPhone");
  var addressInput = document.getElementById("customerAddress");
  var noteInput    = document.getElementById("customerNote");

  /* If the page is missing required nodes, do nothing. */
  if (!cartItemsList) return;

  /* ---------- CONSTANTS ---------- */
  var COOLDOWN_KEY = 'cs_last_enquiry_ms';
  var COOLDOWN_MS  = 30 * 1000;

  var isSubmitting = false;

  /* ---------- STATE ADAPTERS ---------- */
  function getCart() {
    return (typeof window.getCentralCart === 'function')
      ? window.getCentralCart()
      : [];
  }

  function saveCart(cart) {
    if (typeof window.saveCentralCart === 'function') {
      window.saveCentralCart(cart);
    }
  }

  function getCartKey() {
    return (window.CentralCart && window.CentralCart.KEY) || 'centralStoresCart';
  }

  /* ---------- UTILITIES ---------- */

  function formatINR(n) {
    var value = Number(n) || 0;
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
      }).format(value);
    } catch (e) {
      return '₹' + value;
    }
  }

  function showToast(msg, type) {
    var toast = document.getElementById('reviewToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'reviewToast';
      toast.className = 'review-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.hidden = true;
      document.body.appendChild(toast);
      /* Minimal styling in case the shared stylesheet isn't loaded. */
      toast.style.position = 'fixed';
      toast.style.left = '50%';
      toast.style.bottom = '90px';
      toast.style.transform = 'translateX(-50%)';
      toast.style.maxWidth = '90vw';
      toast.style.padding = '12px 18px';
      toast.style.borderRadius = '12px';
      toast.style.background = '#111111';
      toast.style.color = '#ffffff';
      toast.style.fontSize = '12px';
      toast.style.fontWeight = '700';
      toast.style.zIndex = '10000';
      toast.style.boxShadow = '0 12px 30px rgba(0,0,0,0.25)';
      toast.style.transition = 'opacity 0.25s, transform 0.25s';
    }
    toast.textContent = msg;
    toast.className = 'review-toast ' + (type || '');
    toast.hidden = false;
    toast.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.hidden = true; }, 300);
    }, 3400);
  }

  /* ---------- RENDER ---------- */

  function buildItemNode(product) {
    var article = document.createElement('article');
    article.className = 'cart-item';
    article.dataset.id = String(product.id);

    /* --- image --- */
    var imgWrap = document.createElement('div');
    imgWrap.className = 'cart-item-image-wrap';

    var img = document.createElement('img');
    img.className = 'cart-item-image';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = String(product.name || 'Product');
    img.addEventListener('error', function () {
      /* Replace broken image with the cart icon. */
      imgWrap.innerHTML = '';
      var fallback = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#icon-cart');
      fallback.appendChild(use);
      fallback.setAttribute('style', 'width:32px;height:32px;color:#bd8500;');
      imgWrap.appendChild(fallback);
    });

    /* Only assign src if it looks like a string; textContent-safe for URL. */
    if (typeof product.image === 'string' && product.image.trim()) {
      img.src = product.image;
    } else {
      img.style.display = 'none';
    }

    imgWrap.appendChild(img);
    article.appendChild(imgWrap);

    /* --- details --- */
    var details = document.createElement('div');
    details.className = 'cart-item-details';

    var cat = document.createElement('span');
    cat.className = 'cart-item-category';
    cat.textContent = String(product.category || '');
    if (!cat.textContent) cat.style.display = 'none';
    details.appendChild(cat);

    var name = document.createElement('h4');
    name.textContent = String(product.name || 'Product');
    details.appendChild(name);

    var weight = document.createElement('span');
    weight.className = 'cart-item-weight';
    weight.textContent = String(product.weight || '');
    if (!weight.textContent) weight.style.display = 'none';
    details.appendChild(weight);

    /* Price line — only when a price is set. */
    if (Number(product.price) > 0) {
      var price = document.createElement('span');
      price.className = 'cart-item-price';
      price.textContent = formatINR(product.price);
      details.appendChild(price);
    }

    /* --- actions --- */
    var actions = document.createElement('div');
    actions.className = 'cart-item-actions';

    var qtyCtrl = document.createElement('div');
    qtyCtrl.className = 'quantity-control';
    qtyCtrl.setAttribute('role', 'group');
    qtyCtrl.setAttribute('aria-label', 'Quantity for ' + (product.name || 'product'));

    var minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'quantity-btn';
    minus.dataset.action = 'minus';
    minus.dataset.id = String(product.id);
    minus.setAttribute('aria-label', 'Decrease quantity');
    minus.textContent = '−';

    var value = document.createElement('span');
    value.className = 'quantity-value';
    value.setAttribute('aria-live', 'polite');
    value.textContent = String(Number(product.quantity) || 0);

    var plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'quantity-btn';
    plus.dataset.action = 'plus';
    plus.dataset.id = String(product.id);
    plus.setAttribute('aria-label', 'Increase quantity');
    plus.textContent = '+';

    qtyCtrl.appendChild(minus);
    qtyCtrl.appendChild(value);
    qtyCtrl.appendChild(plus);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-cart-item';
    removeBtn.dataset.id = String(product.id);
    removeBtn.setAttribute('aria-label', 'Remove ' + (product.name || 'product') + ' from cart');
    removeBtn.textContent = 'Remove';

    actions.appendChild(qtyCtrl);
    actions.appendChild(removeBtn);

    details.appendChild(actions);
    article.appendChild(details);

    return article;
  }

  function renderCart() {
    var cart = getCart();

    if (!cart.length) {
      if (emptyCart) emptyCart.hidden = false;
      if (cartProductsCard) cartProductsCard.hidden = true;
      if (customerDetailsCard) customerDetailsCard.hidden = true;
      if (cartItemCount) cartItemCount.textContent = '0';
      if (cartItemsList) cartItemsList.innerHTML = '';
      return;
    }

    if (emptyCart) emptyCart.hidden = true;
    if (cartProductsCard) cartProductsCard.hidden = false;
    if (customerDetailsCard) customerDetailsCard.hidden = false;

    /* Total quantity across items. */
    var totalQty = cart.reduce(function (t, p) {
      return t + (Number(p.quantity) || 0);
    }, 0);

    if (cartItemCount) cartItemCount.textContent = String(totalQty);

    /* Rebuild list. */
    var fragment = document.createDocumentFragment();
    cart.forEach(function (product) {
      fragment.appendChild(buildItemNode(product));
    });

    cartItemsList.innerHTML = '';
    cartItemsList.appendChild(fragment);
  }

  /* ---------- EVENT DELEGATION ---------- */

  document.addEventListener("click", function (event) {
    var quantityBtn = event.target.closest(".quantity-btn");
    var removeBtn   = event.target.closest(".remove-cart-item");

    if (!quantityBtn && !removeBtn) return;

    var cart = getCart();

    if (removeBtn) {
      var removeId = String(removeBtn.dataset.id);
      cart = cart.filter(function (item) {
        return String(item.id) !== removeId;
      });
      saveCart(cart);
      renderCart();
      return;
    }

    var itemId = String(quantityBtn.dataset.id);
    var product = cart.find(function (item) {
      return String(item.id) === itemId;
    });
    if (!product) return;

    if (quantityBtn.dataset.action === "plus") {
      product.quantity = (Number(product.quantity) || 0) + 1;
    } else {
      product.quantity = (Number(product.quantity) || 0) - 1;
      if (product.quantity <= 0) {
        cart = cart.filter(function (item) {
          return String(item.id) !== itemId;
        });
      }
    }

    saveCart(cart);
    renderCart();
  });

  document.addEventListener("centralCartUpdated", function () {
    renderCart();
  });

  window.addEventListener("storage", function (event) {
    if (event.key && event.key !== getCartKey()) return;
    renderCart();
  });

  /* ---------- FORM ---------- */

  if (!orderForm) {
    renderCart();
    return;
  }

  function markFieldInvalid(el) {
    if (!el) return;
    var group = el.closest('.form-group');
    if (!group) return;
    group.classList.add('has-error');
    el.setAttribute('aria-invalid', 'true');
  }

  function clearFieldInvalid(el) {
    if (!el) return;
    var group = el.closest('.form-group');
    if (!group) return;
    group.classList.remove('has-error');
    el.removeAttribute('aria-invalid');
  }

  [nameInput, phoneInput, addressInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', function () {
      clearFieldInvalid(el);
    });
  });

  function validateForm() {
    var name    = nameInput    ? String(nameInput.value || '').trim()    : '';
    var phone   = phoneInput   ? String(phoneInput.value || '').trim()   : '';
    var address = addressInput ? String(addressInput.value || '').trim() : '';

    var firstInvalid = null;

    if (!name) { markFieldInvalid(nameInput); firstInvalid = firstInvalid || nameInput; }
    else if (name.length > 60) { markFieldInvalid(nameInput); firstInvalid = firstInvalid || nameInput; }

    if (!/^[0-9]{10}$/.test(phone)) { markFieldInvalid(phoneInput); firstInvalid = firstInvalid || phoneInput; }

    if (!address) { markFieldInvalid(addressInput); firstInvalid = firstInvalid || addressInput; }
    else if (address.length > 300) { markFieldInvalid(addressInput); firstInvalid = firstInvalid || addressInput; }

    if (firstInvalid) {
      try { firstInvalid.focus({ preventScroll: false }); } catch (e) {}
      return null;
    }

    return { name: name, phone: phone, address: address };
  }

  function buildMessage(payload) {
    var cart = getCart();
    var storeName = (window.STORE_CONFIG && window.STORE_CONFIG.name) || 'Central & Stores';
    var note = noteInput ? String(noteInput.value || '').trim() : '';

    var lines = [];
    var totalQty = 0;
    var subtotal = 0;
    var hasPrices = false;

    cart.forEach(function (item) {
      var qty = Number(item.quantity) || 0;
      var price = Number(item.price) || 0;
      totalQty += qty;

      var line = '• ' + String(item.name || 'Product') + ' × ' + qty;
      if (item.weight) line += '  (' + String(item.weight) + ')';

      if (price > 0) {
        hasPrices = true;
        subtotal += price * qty;
        line += '  —  ' + formatINR(price * qty);
      }

      lines.push(line);
    });

    var msg = '';
    msg += '🛒 *' + storeName + '*\n';
    msg += '━━━━━━━━━━━━━━━━━━\n\n';
    msg += '👤 *Customer Details*\n';
    msg += 'Name    : ' + payload.name + '\n';
    msg += 'Phone   : ' + payload.phone + '\n';
    msg += 'Address : ' + payload.address + '\n';

    if (note) {
      msg += '\n📝 *Additional Note*\n' + note + '\n';
    }

    msg += '\n🛍️ *Order Items*\n';
    msg += '━━━━━━━━━━━━━━━━━━\n\n';
    msg += lines.join('\n') + '\n';

    msg += '\n━━━━━━━━━━━━━━━━━━\n';
    msg += '📦 Total Items : ' + totalQty + '\n';
    if (hasPrices && subtotal > 0) {
      msg += '💰 Estimated Total : ' + formatINR(subtotal) + '\n';
      msg += '(Final price confirmed on call)\n';
    }
    msg += '\n📞 Please confirm availability, final price and delivery time.\n\n';
    msg += 'Thank you ❤️\n' + storeName;

    return msg;
  }

  function cooldownRemainingMs() {
    var last = 0;
    try { last = Number(localStorage.getItem(COOLDOWN_KEY) || 0); } catch (e) {}
    if (!last) return 0;
    var remain = COOLDOWN_MS - (Date.now() - last);
    return remain > 0 ? remain : 0;
  }

  function setCooldown() {
    try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch (e) {}
  }

  function openWhatsApp(url) {
    var win = null;
    try { win = window.open(url, '_blank'); } catch (e) {}
    if (!win) {
      /* Popup blocked — fall back to same-tab navigation. */
      window.location.href = url;
    }
  }

  function submitOrder() {
    if (isSubmitting) return;

    var cart = getCart();
    if (!cart.length) {
      showToast('Your cart is empty.', 'error');
      return;
    }

    var payload = validateForm();
    if (!payload) {
      showToast('Please complete the required fields.', 'error');
      return;
    }

    var wait = cooldownRemainingMs();
    if (wait > 0) {
      showToast('Please wait ' + Math.ceil(wait / 1000) + 's before sending again.', 'error');
      return;
    }

    var message = buildMessage(payload);

    /* Prefer the config helper; fall back to a hard-coded URL only
       if config.js is missing (should not happen). */
    var url;
    if (typeof window.storeWaLink === 'function') {
      url = window.storeWaLink(message);
    } else {
      url = 'https://wa.me/919344621645?text=' + encodeURIComponent(message);
    }

    isSubmitting = true;
    if (sendOrderBtn) {
      sendOrderBtn.disabled = true;
      sendOrderBtn.setAttribute('aria-busy', 'true');
    }

    setCooldown();
    openWhatsApp(url);

    /* Re-enable after a short delay. The enquiry is confirmed by the
       store owner on WhatsApp; no success toast is shown here because
       WhatsApp itself is the confirmation surface. */
    setTimeout(function () {
      isSubmitting = false;
      if (sendOrderBtn) {
        sendOrderBtn.disabled = false;
        sendOrderBtn.removeAttribute('aria-busy');
      }
    }, 1500);
  }

  orderForm.addEventListener('submit', function (e) {
    e.preventDefault();
    submitOrder();
  });

  if (sendOrderBtn) {
    sendOrderBtn.addEventListener('click', function (e) {
      /* If the button isn't inside a <form>, handle the click directly. */
      if (!orderForm) {
        e.preventDefault();
        submitOrder();
      }
    });
  }

  /* ---------- INIT ---------- */
  renderCart();
});