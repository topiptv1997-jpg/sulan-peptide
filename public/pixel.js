(() => {
  const KEY = "sulan_attribution_v1";
  const state = {
    ready: false,
    config: null,
    metaReady: false,
    ttReady: false
  };

  const readAttr = () => {
    const p = new URLSearchParams(location.search);
    const keys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid","ttclid","gclid"];
    const data = {};
    for (const k of keys) {
      const v = p.get(k);
      if (v) data[k] = v;
    }
    try {
      if (Object.keys(data).length) localStorage.setItem(KEY, JSON.stringify(data));
      return { ...(JSON.parse(localStorage.getItem(KEY) || "{}")), ...data };
    } catch (_) {
      return data;
    }
  };

  const attr = readAttr();

  const api = (path, body) => fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({ ...attr, ...body })
  }).catch(() => {});

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.async = true;
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function initMeta(ids) {
    if (!ids.length) return;
    window.fbq = window.fbq || function() {
      window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments) : window.fbq.queue.push(arguments);
    };
    if (!window.fbq.loaded) {
      window.fbq.loaded = true;
      window.fbq.queue = [];
      window.fbq.version = "2.0";
      await loadScript("https://connect.facebook.net/en_US/fbevents.js");
    }
    ids.forEach(p => window.fbq("init", p.id));
    ids.filter(p => p.events.includes("PageView")).forEach(() => window.fbq("track", "PageView"));
    state.metaReady = true;
  }

  async function initTikTok(ids) {
    if (!ids.length) return;
    window.TiktokAnalyticsObject = "ttq";
    window.ttq = window.ttq || [];
    window.ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
    window.ttq.setAndDefer = function(t, e) {
      t[e] = function() { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); };
    };
    for (const m of window.ttq.methods) window.ttq.setAndDefer(window.ttq, m);
    window.ttq.instance = function(t) {
      const e = window.ttq._i[t] || [];
      for (const n of window.ttq.methods) window.ttq.setAndDefer(e, n);
      return e;
    };
    window.ttq.load = function(e, n) {
      window.ttq._i = window.ttq._i || {};
      window.ttq._i[e] = [];
      window.ttq._i[e]._u = "https://analytics.tiktok.com/i18n/pixel/events.js";
      window.ttq._t = window.ttq._t || {};
      window.ttq._t[e] = +new Date;
      window.ttq._o = window.ttq._o || {};
      window.ttq._o[e] = n || {};
      const s = document.createElement("script");
      s.type = "text/javascript";
      s.async = true;
      s.src = window.ttq._i[e]._u + "?sdkid=" + e + "&lib=" + window.TiktokAnalyticsObject;
      const first = document.getElementsByTagName("script")[0];
      first.parentNode.insertBefore(s, first);
      return window.ttq.instance(e);
    };
    ids.forEach(p => window.ttq.load(p.id));
    ids.filter(p => p.events.includes("PageView")).forEach(p => {
      try { window.ttq.instance(p.id).page(); } catch (_) {}
    });
    state.ttReady = true;
  }

  async function init() {
    try {
      state.config = await fetch("/api/config", { cache: "no-store" }).then(r => r.json());
      const meta = state.config?.pixels?.meta || [];
      const tt = state.config?.pixels?.tiktok || [];
      await Promise.all([initMeta(meta), initTikTok(tt)]);
      state.ready = true;
      api("/api/pageview", { path: location.pathname, landing_url: location.href });
    } catch (_) {}
  }

  const track = (event, metadata = {}) => {
    const rules = state.config?.event_rules?.[event] || { meta: true, tiktok: true };
    const meta = (state.config?.pixels?.meta || []).filter(p => p.events.includes(event) && rules.meta);
    const tt = (state.config?.pixels?.tiktok || []).filter(p => p.events.includes(event) && rules.tiktok);

    if (event === "Lead") {
      meta.forEach(p => { try { window.fbq?.("track", "Lead"); } catch (_) {} });
      tt.forEach(p => { try { window.ttq?.instance(p.id).track("SubmitForm"); } catch (_) {} });
    } else if (event === "WhatsAppClick") {
      meta.forEach(p => { try { window.fbq?.("track", "Contact"); } catch (_) {} });
      tt.forEach(p => { try { window.ttq?.instance(p.id).track("Contact"); } catch (_) {} });
    } else if (event === "ViewContent") {
      meta.forEach(p => { try { window.fbq?.("track", "ViewContent"); } catch (_) {} });
      tt.forEach(p => { try { window.ttq?.instance(p.id).track("ViewContent"); } catch (_) {} });
    }

    api("/api/track", { event, metadata });
  };

  window.SulanTrack = { track, attribution: () => ({ ...attr }), config: () => state.config };

  // Catch existing form submissions that call /api/lead via fetch.
  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const promise = nativeFetch.apply(this, arguments);
    if (String(url).includes("/api/lead")) {
      promise.then(res => {
        if (res.ok) track("Lead");
      }).catch(() => {});
    }
    return promise;
  };

  // Catch WhatsApp clicks before navigation.
  document.addEventListener("click", e => {
    const el = e.target?.closest?.("a,button");
    if (!el) return;
    const href = el.getAttribute("href") || "";
    const text = (el.textContent || "").toLowerCase();
    if (href.includes("/go/whatsapp") || href.includes("wa.me") || text.includes("whatsapp")) {
      track("WhatsAppClick");
    }
  }, true);

  init();
})();