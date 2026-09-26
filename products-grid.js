/* ============================================================
   CENTRAL & STORES — Product Grid
   ------------------------------------------------------------
   Renders the catalogue from window.productsData (Supabase),
   handles category filtering, and wires "Add to cart".

   CONTRACT WITH products-live.js
     • window.productsData is an array of product objects:
         { id, name, category, weight, price,
           image_url, image, description,
           is_available, is_published, is_featured }
     • document fires:
         'productsLoaded'  detail: products[]
         'productsError'   detail: { message }

   CONTRACT WITH cart-common.js
     • addProductToCart(product) accepts
         { id, name, category, weight, price, image|image_url }

   CONTRACT WITH search.js
     • Each product card has id="product-{id}" so search can
       scroll to it after selection.

   SECURITY
     All user / product fields are rendered with textContent.
     Image URLs are assigned to img.src, never to innerHTML.
   ============================================================ */

document.addEventListener("DOMContentLoaded", function () {
  'use strict';

  /* ---------- DOM ---------- */
  var productsGrid = document.getElementById("productsGrid");
  var productCount = document.getElementById("productCount");

  if (!productsGrid) {
    if (window.console && console.warn) {
      console.warn("[products-grid] #productsGrid not found.");
    }
    return;
  }

  /* ARIA — announce count changes to screen readers. */
  if (productCount && !productCount.hasAttribute("aria-live")) {
    productCount.setAttribute("aria-live", "polite");
  }

  /* ---------- STATE ---------- */
  var productsLoadedFlag = false;
  var pendingCategory = null;
  var activeCategory = "All";

  if (!Array.isArray(window.productsData)) {
    window.productsData = [];
  }

  /* ---------- HELPERS ---------- */

  function normaliseCategory(v) {
    return String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function productMatchesCategory(product, category) {
    if (category === "All") return true;
    return normaliseCategory(product.category) === normaliseCategory(category);
  }

  function formatPrice(price) {
    var n = Number(price);
    if (!n || n <= 0) return { text: "Price on call", isCall: true };
    try {
      return {
        text: new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
          maximumFractionDigits: 0
        }).format(n),
        isCall: false
      };
    } catch (e) {
      return { text: "₹" + n, isCall: false };
    }
  }

  /* SVG fragments — trusted markup, no user data. */
  function svgHeart() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-heart");
    svg.appendChild(use);
    return svg;
  }

  function svgSearch() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#icon-search");
    svg.appendChild(use);
    return svg;
  }

  function svgCheck() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m5 12 5 5L20 7");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  /* ---------- CARD BUILDER ---------- */

  function buildCard(product) {
    var card = document.createElement("article");
    card.className = "product-card";
    if (product.id != null) card.id = "product-" + String(product.id);

    /* --- image / placeholder --- */
    var imageWrap = document.createElement("div");
    imageWrap.className = "product-image-wrap";

    var imgSrc = (typeof product.image_url === "string" && product.image_url) ||
                 (typeof product.image === "string" && product.image) ||
                 "";

    if (imgSrc) {
      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = String(product.name || "Product");
      img.addEventListener("error", function () {
        /* Swap broken image for placeholder without inline handlers. */
        imageWrap.removeChild(img);
        imageWrap.appendChild(buildImagePlaceholder());
      });
      img.src = imgSrc;
      imageWrap.appendChild(img);
    } else {
      imageWrap.appendChild(buildImagePlaceholder());
    }

    /* Wishlist button — visual only; feature not implemented yet. */
    var wishlistBtn = document.createElement("button");
    wishlistBtn.type = "button";
    wishlistBtn.className = "product-wishlist-btn";
    wishlistBtn.setAttribute(
      "aria-label",
      "Save " + (product.name || "product") + " to wishlist (coming soon)"
    );
    wishlistBtn.appendChild(svgHeart());
    imageWrap.appendChild(wishlistBtn);

    card.appendChild(imageWrap);

    /* --- details --- */
    var details = document.createElement("div");
    details.className = "product-details";

    var catSpan = document.createElement("span");
    catSpan.className = "product-category";
    catSpan.textContent = String(product.category || "");
    details.appendChild(catSpan);

    var nameEl = document.createElement("h3");
    nameEl.className = "product-name";
    nameEl.textContent = String(product.name || "Product");
    details.appendChild(nameEl);

    var weightSpan = document.createElement("span");
    weightSpan.className = "product-weight";
    weightSpan.textContent = String(product.weight || "");
    details.appendChild(weightSpan);

    var footer = document.createElement("div");
    footer.className = "product-footer";

    var priceInfo = formatPrice(product.price);
    var priceEl = document.createElement("strong");
    priceEl.className = "product-price" + (priceInfo.isCall ? " price-on-call" : "");
    priceEl.textContent = priceInfo.text;
    footer.appendChild(priceEl);

    var addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-cart-btn";
    addBtn.dataset.id = String(product.id);
    addBtn.setAttribute(
      "aria-label",
      "Add " + (product.name || "product") + " to cart"
    );
    addBtn.textContent = "+ Add";
    footer.appendChild(addBtn);

    details.appendChild(footer);
    card.appendChild(details);

    return card;
  }

  function buildImagePlaceholder() {
    var ph = document.createElement("div");
    ph.className = "product-image-placeholder";
    var span = document.createElement("span");
    span.textContent = "NO IMAGE";
    ph.appendChild(span);
    return ph;
  }

  /* ---------- STATE RENDERERS ---------- */

  function renderSkeleton() {
    productsGrid.innerHTML = "";
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 6; i++) {
      var card = document.createElement("article");
      card.className = "product-card product-card--skeleton";
      card.setAttribute("aria-hidden", "true");
      for (var j = 0; j < 3; j++) {
        var line = document.createElement("div");
        line.className = "skeleton-line";
        card.appendChild(line);
      }
      frag.appendChild(card);
    }
    productsGrid.appendChild(frag);
  }

  function renderEmpty() {
    productsGrid.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "products-empty-state show";

    var icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.appendChild(svgSearch());

    var h = document.createElement("h3");
    h.textContent = "No products found";

    var p = document.createElement("p");
    p.textContent = "Try another category or search word.";

    wrap.appendChild(icon);
    wrap.appendChild(h);
    wrap.appendChild(p);
    productsGrid.appendChild(wrap);
  }

  function renderError() {
    productsGrid.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "products-empty-state show";

    var h = document.createElement("h3");
    h.textContent = "We couldn't load products";

    var p = document.createElement("p");
    p.textContent = "Please check your connection and try again.";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-cart-btn"; /* reuse the button style */
    btn.textContent = "Retry";
    btn.addEventListener("click", function () {
      if (typeof window.reloadLiveProducts === "function") {
        renderSkeleton();
        window.reloadLiveProducts();
      } else {
        window.location.reload();
      }
    });

    wrap.appendChild(h);
    wrap.appendChild(p);
    wrap.appendChild(btn);
    productsGrid.appendChild(wrap);
  }

  /* ---------- MAIN RENDER ---------- */

  function renderProducts(items) {
    productsGrid.innerHTML = "";

    if (!Array.isArray(items) || !items.length) {
      renderEmpty();
      if (productCount) productCount.textContent = "0";
      return;
    }

    var frag = document.createDocumentFragment();
    items.forEach(function (product) {
      frag.appendChild(buildCard(product));
    });
    productsGrid.appendChild(frag);

    if (productCount) productCount.textContent = String(items.length);
  }

  /* ---------- FILTER ---------- */

  function applyCategory(category, sourceItems) {
    activeCategory = category || "All";
    var items = sourceItems || window.productsData;

    if (!Array.isArray(items)) items = [];

    var filtered = activeCategory === "All"
      ? items
      : items.filter(function (p) { return productMatchesCategory(p, activeCategory); });

    /* Update pills. */
    var pills = document.querySelectorAll(".category-pill");
    pills.forEach(function (btn) {
      var isActive = (btn.dataset.category || "All") === activeCategory;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    renderProducts(filtered);
  }

  /* ---------- EVENTS ---------- */

  /* Category pills */
  document.querySelectorAll(".category-pill").forEach(function (button) {
    /* Ensure aria-pressed initial state is well-formed. */
    if (!button.hasAttribute("aria-pressed")) {
      button.setAttribute(
        "aria-pressed",
        button.classList.contains("active") ? "true" : "false"
      );
    }

    button.addEventListener("click", function () {
      var selectedCategory = button.dataset.category || "All";

      /* If products haven't arrived yet, remember the choice. */
      if (!productsLoadedFlag) {
        pendingCategory = selectedCategory;
        return;
      }

      applyCategory(selectedCategory, window.productsData);
    });
  });

  /* Add to cart (delegated) */
  document.addEventListener("click", function (event) {
    var button = event.target.closest(".add-cart-btn");
    if (!button) return;

    var id = button.dataset.id;
    if (id == null) return;

    var product = (window.productsData || []).find(function (item) {
      return String(item.id) === String(id);
    });
    if (!product) return;

    if (typeof window.addProductToCart !== "function") {
      if (window.console && console.warn) {
        console.warn("[products-grid] cart-common.js is not loaded.");
      }
      return;
    }

    window.addProductToCart({
      id: product.id,
      name: product.name,
      category: product.category,
      weight: product.weight,
      price: product.price,
      image_url: product.image_url || "",
      image: product.image || product.image_url || ""
    });

    /* Visual feedback. */
    var originalText = button.textContent;
    button.classList.add("added");
    button.textContent = "";

    var check = svgCheck();
    check.classList.add("add-cart-btn__icon");
    button.appendChild(check);
    button.appendChild(document.createTextNode(" Added"));

    clearTimeout(button._addedTimer);
    button._addedTimer = setTimeout(function () {
      button.classList.remove("added");
      button.innerHTML = "";
      button.textContent = originalText;
    }, 900);
  });

  /* Products loaded from Supabase. */
  document.addEventListener("productsLoaded", function () {
    productsLoadedFlag = true;

    /* Prefer any pending category the user clicked while we were loading. */
    var category = pendingCategory || "All";
    pendingCategory = null;

    applyCategory(category, window.productsData);
  });

  /* Products failed to load. */
  document.addEventListener("productsError", function () {
    productsLoadedFlag = true;
    renderError();
    if (productCount) productCount.textContent = "0";
  });

  /* ---------- INITIAL RENDER ---------- */

  if (window.productsData && window.productsData.length) {
    /* Products were already populated before this script ran. */
    productsLoadedFlag = true;
    applyCategory("All", window.productsData);
  } else {
    /* Show a skeleton until `productsLoaded` or `productsError` fires. */
    renderSkeleton();
    if (productCount) productCount.textContent = "0";
  }
});