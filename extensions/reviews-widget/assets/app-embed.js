/* =============================================================
   Reviews — auto-injection script
   File: /extensions/reviews-widget/assets/app-embed.js
   Loaded by app-embed.liquid on every product page.
   ============================================================= */
(function () {
  var cfg = window.__EVO_REVIEWS__;
  if (!cfg || !cfg.productId || !cfg.apiBase) return;

  var apiBase = cfg.apiBase.replace(/\/$/, "");

  function findFirst(selectors) {
    if (!selectors) return null;
    var list = selectors.split(",");
    for (var i = 0; i < list.length; i++) {
      var el = document.querySelector(list[i].trim());
      if (el) return el;
    }
    return null;
  }

  // ---------- Star badge ----------
  function injectBadge() {
    if (!cfg.showBadge) return;
    if (document.querySelector("[data-evo-star-badge]")) return;

    var target = findFirst(cfg.badgeTarget);
    if (!target) return;

    var wrap = document.createElement("div");
    wrap.setAttribute("data-evo-star-badge", "");
    wrap.className = "evo-star-badge";
    wrap.dataset.shop = cfg.shop;
    wrap.dataset.productId = cfg.productId;
    wrap.dataset.api = apiBase;

    wrap.innerHTML = '' +
      '<div class="evo-sb__row">' +
        '<span class="evo-sb__star"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 2.5l2.95 6.4 7.05.7-5.3 4.85 1.55 6.95L12 17.9l-6.25 3.5L7.3 14.45 2 9.6l7.05-.7L12 2.5z" fill="#FFC107"/></svg></span>' +
        '<span class="evo-sb__avg" data-evo-avg>—</span>' +
        '<span class="evo-sb__divider">|</span>' +
        '<span class="evo-sb__verified"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 1.5l2.6 2.1 3.3-.5.7 3.3 2.9 1.7-1.4 3.05 1.4 3.05-2.9 1.7-.7 3.3-3.3-.5L12 22.5l-2.6-2.1-3.3.5-.7-3.3L2.5 15.9l1.4-3.05L2.5 9.8l2.9-1.7.7-3.3 3.3.5L12 1.5z" fill="#1877F2"/><path d="M9.55 14.7l-2.3-2.3 1.4-1.4 1 1 4.4-4.4 1.4 1.4-5.9 5.7z" fill="#fff"/></svg></span>' +
        '<span class="evo-sb__count" data-evo-count>(0 Reviews)</span>' +
      '</div>' +
      '<div class="evo-sb__viewers">' +
        '<span class="evo-sb__eye"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5C6.5 5 2.2 9.1 1 12c1.2 2.9 5.5 7 11 7s9.8-4.1 11-7c-1.2-2.9-5.5-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-2.2a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z" fill="#6B7280"/></svg></span>' +
        '<span data-evo-viewers>—</span> people are viewing this right now' +
      '</div>';

    target.parentNode.insertBefore(wrap, target.nextSibling);

    // Live aggregate
    fetch(apiBase + "/api/reviews?shop=" + encodeURIComponent(cfg.shop) +
          "&productId=" + encodeURIComponent(cfg.productId) + "&page=1&limit=1")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        wrap.querySelector("[data-evo-avg]").textContent   = (d.average || 0).toFixed(1);
        wrap.querySelector("[data-evo-count]").textContent = "(" + (d.totalRatings || 0) + " Reviews)";
      })
      .catch(function () {});

    // Live viewers
    function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
    var current = rand(40, 120);
    var v = wrap.querySelector("[data-evo-viewers]");
    v.textContent = current;
    setInterval(function () {
      current = Math.min(120, Math.max(40, current + rand(-3, 3)));
      v.textContent = current;
    }, rand(10000, 15000));
  }

  // ---------- Review grid ----------
  function injectGrid() {
    if (!cfg.showGrid) return;
    if (document.querySelector("[data-evo-review-widget]")) return;

    var target = findFirst(cfg.gridTarget);
    if (!target) target = document.querySelector("main") || document.body;

    var section = document.createElement("section");
    section.className = "evo-rw";
    section.setAttribute("data-evo-review-widget", "");
    section.dataset.shop = cfg.shop;
    section.dataset.productId = cfg.productId;
    section.dataset.api = apiBase;
    section.dataset.page = "1";
    section.dataset.limit = "12";

    section.innerHTML = '' +
      '<header class="evo-rw__header">' +
        '<div class="evo-rw__summary">' +
          '<div class="evo-rw__avg" data-evo-rw-avg>0.0</div>' +
          '<div class="evo-rw__sumright">' +
            '<div class="evo-rw__stars" data-evo-rw-stars></div>' +
            '<div class="evo-rw__total" data-evo-rw-total>0 reviews</div>' +
          '</div>' +
        '</div>' +
        '<div class="evo-rw__actions">' +
          '<button class="evo-rw__btn" type="button" data-evo-write>Write a review</button>' +
          '<button class="evo-rw__icon-btn" type="button" aria-label="Filter">' +
            '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 6h16M7 12h10M10 18h4" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg>' +
          '</button>' +
        '</div>' +
      '</header>' +
      '<hr class="evo-rw__divider"/>' +
      '<div class="evo-rw__grid" data-evo-rw-grid></div>' +
      '<nav class="evo-rw__pager" data-evo-rw-pager></nav>' +
      '<div class="evo-rw__modal" data-evo-modal hidden>' +
        '<div class="evo-rw__modal-card" role="dialog" aria-modal="true">' +
          '<button class="evo-rw__modal-close" type="button" data-evo-modal-close>&times;</button>' +
          '<h3>Write a review</h3>' +
          '<form data-evo-form>' +
            '<label>Your name<input type="text" name="author_name" required maxlength="80"/></label>' +
            '<label>Rating<select name="rating" required>' +
              '<option value="5">5 — Excellent</option><option value="4">4 — Good</option>' +
              '<option value="3">3 — Okay</option><option value="2">2 — Poor</option>' +
              '<option value="1">1 — Terrible</option>' +
            '</select></label>' +
            '<label>Review<textarea name="content" rows="4" required maxlength="4000"></textarea></label>' +
            '<button class="evo-rw__btn evo-rw__btn--primary" type="submit">Submit review</button>' +
            '<p class="evo-rw__form-msg" data-evo-form-msg></p>' +
          '</form>' +
        '</div>' +
      '</div>';

    if (target.tagName === "MAIN" || target.tagName === "BODY") {
      target.appendChild(section);
    } else {
      target.parentNode.insertBefore(section, target.nextSibling);
    }

    bindGridLogic(section);
  }

  // -------- Grid behaviour --------
  function bindGridLogic(root) {
    var apiBase = root.dataset.api;
    var shop = root.dataset.shop;
    var productId = root.dataset.productId;
    var limit = parseInt(root.dataset.limit || "12", 10);

    var grid = root.querySelector("[data-evo-rw-grid]");
    var pager = root.querySelector("[data-evo-rw-pager]");
    var avgEl = root.querySelector("[data-evo-rw-avg]");
    var totalEl = root.querySelector("[data-evo-rw-total]");
    var starsEl = root.querySelector("[data-evo-rw-stars]");

    function star(filled) {
      return '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.95 6.4 7.05.7-5.3 4.85 1.55 6.95L12 17.9l-6.25 3.5L7.3 14.45 2 9.6l7.05-.7L12 2.5z" fill="' + (filled ? '#FFC107' : '#E5E7EB') + '"/></svg>';
    }
    function starsHTML(rating) {
      var h = ""; for (var i = 1; i <= 5; i++) h += star(i <= Math.round(rating)); return h;
    }
    function timeAgo(iso) {
      var t = new Date(iso).getTime();
      if (isNaN(t)) return "";
      var s = Math.max(1, Math.floor((Date.now() - t) / 1000));
      var u = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
      for (var i = 0; i < u.length; i++) { var n = Math.floor(s / u[i][1]); if (n >= 1) return n + " " + u[i][0] + (n > 1 ? "s" : "") + " ago"; }
      return s + " seconds ago";
    }
    function esc(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
    function verified() {
      return '<span class="evo-rw__verified"><svg viewBox="0 0 24 24"><path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19l11-11-1.4-1.4z" fill="#374151"/></svg>Verified purchase</span>';
    }
    function imagesHTML(arr) {
      if (!arr || !arr.length) return "";
      return '<div class="evo-rw__imgs">' + arr.map(function (u) {
        return '<a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" loading="lazy" alt=""/></a>';
      }).join("") + '</div>';
    }
    function renderCards(reviews) {
      if (!reviews.length) { grid.innerHTML = '<div class="evo-rw__empty">No reviews yet — be the first!</div>'; return; }
      grid.innerHTML = reviews.map(function (r) {
        return '<article class="evo-rw__card">' +
          '<div class="evo-rw__card-top">' +
            '<div class="evo-rw__card-stars">' + starsHTML(r.rating) + '</div>' +
            '<div class="evo-rw__card-date">' + timeAgo(r.created_at) + '</div>' +
          '</div>' +
          '<div class="evo-rw__card-author">' +
            '<div class="evo-rw__avatar">' + esc(r.author_initials || "??") + '</div>' +
            '<div><div class="evo-rw__author-name">' + esc(r.author_name) + '</div>' +
              (r.is_verified ? verified() : "") + '</div>' +
          '</div>' +
          '<p class="evo-rw__card-content">' + esc(r.content) + '</p>' +
          imagesHTML(r.image_urls) +
        '</article>';
      }).join("");
    }
    function renderPager(page, totalPages) {
      if (totalPages <= 1) { pager.innerHTML = ""; return; }
      var h = '<button data-page="' + (page - 1) + '" ' + (page <= 1 ? "disabled" : "") + '>Prev</button>';
      var s = Math.max(1, page - 2), e = Math.min(totalPages, s + 4); s = Math.max(1, e - 4);
      for (var i = s; i <= e; i++) h += '<button data-page="' + i + '" ' + (i === page ? 'aria-current="true"' : "") + '>' + i + '</button>';
      h += '<button data-page="' + (page + 1) + '" ' + (page >= totalPages ? "disabled" : "") + '>Next</button>';
      pager.innerHTML = h;
    }
    function load(page) {
      grid.innerHTML = '<div class="evo-rw__empty">Loading reviews…</div>';
      fetch(apiBase + "/api/reviews?shop=" + encodeURIComponent(shop) + "&productId=" + encodeURIComponent(productId) + "&page=" + page + "&limit=" + limit)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.error) { grid.innerHTML = '<div class="evo-rw__empty">Could not load reviews.</div>'; return; }
          root.dataset.page = String(d.page);
          avgEl.textContent = (d.average || 0).toFixed(1);
          totalEl.textContent = (d.totalRatings || 0) + " reviews";
          starsEl.innerHTML = starsHTML(d.average || 0);
          renderCards(d.reviews || []);
          renderPager(d.page, d.totalPages);
        })
        .catch(function () { grid.innerHTML = '<div class="evo-rw__empty">Could not load reviews.</div>'; });
    }
    pager.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-page]"); if (!b || b.disabled) return;
      load(parseInt(b.dataset.page, 10));
      root.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Modal
    var modal = root.querySelector("[data-evo-modal]");
    var openBtn = root.querySelector("[data-evo-write]");
    var closeBtn = root.querySelector("[data-evo-modal-close]");
    var form = root.querySelector("[data-evo-form]");
    var formMsg = root.querySelector("[data-evo-form-msg]");
    openBtn.addEventListener("click", function () { modal.hidden = false; });
    closeBtn.addEventListener("click", function () { modal.hidden = true; form.reset(); formMsg.textContent = ""; });
    modal.addEventListener("click", function (e) { if (e.target === modal) { modal.hidden = true; form.reset(); formMsg.textContent = ""; } });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      formMsg.textContent = "Submitting…";
      var fd = new FormData(form);
      fetch(apiBase + "/api/reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_domain: shop, product_id: productId,
          author_name: fd.get("author_name"), rating: parseInt(fd.get("rating"), 10),
          content: fd.get("content"), is_verified: false,
        }),
      })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { formMsg.textContent = res.d.error || "Could not submit."; return; }
        formMsg.textContent = "Thanks! Your review is pending approval.";
        setTimeout(function () { modal.hidden = true; form.reset(); formMsg.textContent = ""; }, 1400);
      })
      .catch(function () { formMsg.textContent = "Network error."; });
    });

    load(1);
  }

  // ---------- Run after DOM ready ----------
  function init() { try { injectBadge(); } catch(e){} try { injectGrid(); } catch(e){} }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
