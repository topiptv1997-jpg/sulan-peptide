export interface Env {
  ADMIN_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

type PixelKind = "meta" | "tiktok";

interface PixelConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  events?: string[];
}

interface WhatsAppConfig {
  id: number;
  label: string;
  number: string;
  active?: boolean;
  is_default?: boolean;
}

interface AppConfig {
  form_enabled: boolean;
  routing_mode: "single" | "round_robin";
  pixels: {
    meta: PixelConfig[];
    tiktok: PixelConfig[];
  };
}

const CONFIG_KEY = "config";
const WHATSAPP_KEY = "whatsapp";
const STATS_KEY = "stats";
const EVENT_PREFIX = "event:";
const LEAD_PREFIX = "lead:";
const SESSION_PREFIX = "session:";

const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

const text = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });

const noContent = (status = 204) =>
  new Response(null, {
    status,
    headers: { "cache-control": "no-store" },
  });

const getCookie = (req: Request, name: string) => {
  const value = req.headers.get("cookie") || "";
  const m = value.match(new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
};

const makeCookie = (name: string, value: string, maxAge = 60 * 60 * 12) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const clearCookie = (name: string) =>
  `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function hmacSign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64url(new Uint8Array(signature));
}

async function hmacVerify(value: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64url(signature),
      new TextEncoder().encode(value),
    );
  } catch {
    return false;
  }
}

/*
 * Authentication deliberately does NOT use ADMIN_KV for the session itself.
 * This prevents an unavailable/empty session KV from causing /admin redirect
 * loops or turning the admin page into a 500 error.
 */
async function createSession(env: Env, username: string) {
  const secret = env.SESSION_SECRET || "";
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short. Set a long random SESSION_SECRET.");
  }

  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const payload = `${username}.${exp}`;
  const signature = await hmacSign(payload, secret);
  return `${base64url(new TextEncoder().encode(payload))}.${signature}`;
}

async function isAuthenticated(req: Request, env: Env) {
  const token = getCookie(req, "sulan_admin");
  const secret = env.SESSION_SECRET || "";
  if (!token || !secret) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  try {
    const payload = new TextDecoder().decode(fromBase64url(parts[0]));
    const dot = payload.lastIndexOf(".");
    if (dot <= 0) return false;

    const username = payload.slice(0, dot);
    const exp = Number(payload.slice(dot + 1));

    if (!username || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }

    if (username !== (env.ADMIN_USER || "admin")) return false;

    return await hmacVerify(payload, parts[1], secret);
  } catch {
    return false;
  }
}

async function destroySession(_req: Request, _env: Env) {
  // Stateless signed cookie: clearing the cookie is sufficient.
}

async function readJson(req: Request): Promise<any> {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return {};
    }
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

async function getConfig(env: Env): Promise<AppConfig> {
  const raw = await env.CONFIG_KV.get(CONFIG_KEY, "json") as any;
  const base: AppConfig = {
    form_enabled: true,
    routing_mode: "single",
    pixels: { meta: [], tiktok: [] },
  };

  if (!raw || typeof raw !== "object") return base;

  const meta = normalizePixels(raw.pixels?.meta ?? raw.meta_pixels ?? raw.metaPixels ?? []);
  const tiktok = normalizePixels(raw.pixels?.tiktok ?? raw.tiktok_pixels ?? raw.tiktokPixels ?? []);

  return {
    form_enabled: raw.form_enabled ?? raw.formEnabled ?? true,
    routing_mode:
      raw.routing_mode === "round_robin" || raw.routingMode === "round_robin"
        ? "round_robin"
        : "single",
    pixels: { meta, tiktok },
  };
}

function normalizePixels(value: any): PixelConfig[] {
  if (Array.isArray(value)) {
    return value
      .map((x) => {
        if (typeof x === "string") return { id: x, name: "Primary", enabled: true };
        if (!x || typeof x !== "object") return null;
        return {
          id: String(x.id ?? x.pixel_id ?? x.pixelId ?? "").trim(),
          name: String(x.name ?? "").trim(),
          enabled: x.enabled !== false,
          events: Array.isArray(x.events)
            ? x.events
            : Array.isArray(x.event_rules)
              ? x.event_rules
              : ["pageview", "whatsapp_click", "form_submit"],
        };
      })
      .filter((x): x is PixelConfig => !!x?.id)
      .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([id, v]: [string, any]) => ({
        id,
        name: typeof v === "object" ? String(v.name ?? "") : "Primary",
        enabled: typeof v === "object" ? v.enabled !== false : !!v,
        events:
          typeof v === "object" && Array.isArray(v.events)
            ? v.events
            : ["pageview", "whatsapp_click", "form_submit"],
      }))
      .filter((x) => x.id);
  }

  return [];
}

async function saveConfig(env: Env, config: AppConfig) {
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(config));
}

async function getWhatsApp(env: Env): Promise<WhatsAppConfig[]> {
  const raw = await env.CONFIG_KV.get(WHATSAPP_KEY, "json") as any;
  if (!Array.isArray(raw)) return [];

  return raw.map((x: any, i: number) => ({
    id: Number(x.id ?? i + 1),
    label: String(x.label ?? "WhatsApp"),
    number: String(x.number ?? x.phone ?? ""),
    active: x.active !== false,
    is_default: !!(x.is_default ?? x.isDefault),
  }));
}

async function saveWhatsApp(env: Env, list: WhatsAppConfig[]) {
  await env.CONFIG_KV.put(WHATSAPP_KEY, JSON.stringify(list));
}

async function getStats(env: Env) {
  const raw = await env.ADMIN_KV.get(STATS_KEY, "json") as any;
  return {
    page_views: Number(raw?.page_views ?? raw?.pageViews ?? 0),
    whatsapp_clicks: Number(raw?.whatsapp_clicks ?? raw?.whatsappClicks ?? 0),
    form_submissions: Number(raw?.form_submissions ?? raw?.formSubmissions ?? 0),
  };
}

async function incrementStat(env: Env, key: "page_views" | "whatsapp_clicks" | "form_submissions") {
  const current = await getStats(env);
  current[key] = Number(current[key] || 0) + 1;
  await env.ADMIN_KV.put(STATS_KEY, JSON.stringify(current));
  return current;
}

async function listEvents(env: Env, limit = 500) {
  const listed = await env.ADMIN_KV.list({ prefix: EVENT_PREFIX, limit });
  const rows: any[] = [];

  for (const key of listed.keys) {
    const value = await env.ADMIN_KV.get(key.name, "json") as any;
    if (value) rows.push(value);
  }

  rows.sort((a, b) =>
    String(b.created_at || b.createdAt || "").localeCompare(
      String(a.created_at || a.createdAt || ""),
    ),
  );

  return rows.slice(0, limit);
}

async function listLeads(env: Env, limit = 500) {
  const listed = await env.ADMIN_KV.list({ prefix: LEAD_PREFIX, limit });
  const rows: any[] = [];

  for (const key of listed.keys) {
    const value = await env.ADMIN_KV.get(key.name, "json") as any;
    if (value) rows.push(value);
  }

  rows.sort((a, b) =>
    String(b.created_at || b.createdAt || "").localeCompare(
      String(a.created_at || a.createdAt || ""),
    ),
  );

  return rows.slice(0, limit);
}

async function saveEvent(env: Env, event: Record<string, any>) {
  const created_at = new Date().toISOString();
  const id = crypto.randomUUID();
  const value = {
    id,
    created_at,
    ...event,
  };

  await env.ADMIN_KV.put(`${EVENT_PREFIX}${created_at}:${id}`, JSON.stringify(value), {
    expirationTtl: 60 * 60 * 24 * 180,
  });

  const type = String(event.type || event.event || "").toLowerCase();
  if (type === "pageview" || type === "page_view") {
    await incrementStat(env, "page_views");
  } else if (
    type === "whatsapp_click" ||
    type === "whatsapp-click" ||
    type === "whatsapp"
  ) {
    await incrementStat(env, "whatsapp_clicks");
  } else if (type === "form_submit" || type === "lead") {
    await incrementStat(env, "form_submissions");
  }

  return value;
}

async function saveLead(env: Env, body: any) {
  const id = crypto.randomUUID();
  const lead = {
    id,
    created_at: new Date().toISOString(),
    status: "new",
    ...body,
  };

  await env.ADMIN_KV.put(`${LEAD_PREFIX}${lead.created_at}:${id}`, JSON.stringify(lead), {
    expirationTtl: 60 * 60 * 24 * 365,
  });

  await incrementStat(env, "form_submissions");
  return lead;
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401, {
    "WWW-Authenticate": "Session",
  });
}

async function requireAuth(req: Request, env: Env) {
  return isAuthenticated(req, env);
}

async function serveAsset(req: Request, env: Env, path: string) {
  const url = new URL(req.url);
  const assetUrl = new URL(path || "/", url);
  return env.ASSETS.fetch(new Request(assetUrl.toString(), req));
}

function loginPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sulan Peptide — Admin Login</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f7f5;color:#102033;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.card{width:min(430px,calc(100% - 32px));background:#fff;border:1px solid #dce7e2;border-radius:18px;padding:34px;box-shadow:0 20px 60px rgba(0,65,48,.10)}
.brand{color:#00583f;font-weight:900;letter-spacing:1px;font-size:16px}
.sub{color:#6d7b86;font-size:12px;letter-spacing:1.2px;margin-top:2px}
h1{margin:24px 0 18px;font-size:28px}
label{display:block;font-weight:800;font-size:12px;margin:0 0 7px}
input{display:block;width:100%;padding:12px;border:1px solid #cfdcd7;border-radius:9px;margin-bottom:14px}
button{width:100%;border:0;border-radius:9px;padding:12px;background:#00583f;color:#fff;font-weight:900;cursor:pointer}
button:hover{background:#087a59}
.err{display:none;background:#fff0ef;color:#b42318;padding:10px;border-radius:8px;margin-bottom:14px}
</style>
</head>
<body>
<div class="card">
<div class="brand">SULAN PEPTIDE</div>
<div class="sub">ADMINISTRATION / 管理后台</div>
<h1>Admin Login / 管理员登录</h1>
<div class="err" id="err"></div>
<form method="post" action="/api/login">
<label>Username / 用户名</label>
<input name="username" autocomplete="username" required>
<label>Password / 密码</label>
<input name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in / 登录</button>
</form>
</div>
</body>
</html>`;
}

function pixelJs() {
  return `(() => {
  const state = { meta: [], tiktok: [], loaded: { meta: false, tiktok: false } };

  function postEvent(type, extra = {}) {
    try {
      const payload = {
        type,
        path: location.pathname,
        referrer: document.referrer || "",
        source: new URLSearchParams(location.search).get("utm_source") || "",
        campaign: new URLSearchParams(location.search).get("utm_campaign") || "",
        adset: new URLSearchParams(location.search).get("utm_adset") || "",
        ...extra
      };
      fetch("/api/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function initMeta() {
    if (!state.meta.length || state.loaded.meta) return;
    try {
      await loadScript("https://connect.facebook.net/en_US/fbevents.js");
      window.fbq = window.fbq || function() {
        window.fbq.callMethod ? window.fbq.callMethod.apply(window.fbq, arguments)
          : window.fbq.queue.push(arguments);
      };
      window.fbq.push = window.fbq;
      window.fbq.loaded = true;
      window.fbq.version = "2.0";
      window.fbq.queue = [];
      state.meta.filter(p => p.enabled !== false).forEach(p => {
        window.fbq("init", p.id);
      });
      state.meta.filter(p => p.enabled !== false).forEach(p => {
        const evs = p.events || ["pageview","whatsapp_click","form_submit"];
        if (evs.includes("pageview")) window.fbq("track", "PageView");
      });
      state.loaded.meta = true;
    } catch (_) {}
  }

  async function initTikTok() {
    if (!state.tiktok.length || state.loaded.tiktok) return;
    try {
      window.TiktokAnalyticsObject = "ttq";
      window.ttq = window.ttq || [];
      window.ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"];
      window.ttq.setAndDefer = function(t, e) {
        t[e] = function() { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); };
      };
      for (const method of window.ttq.methods) window.ttq.setAndDefer(window.ttq, method);
      window.ttq.instance = function(t) {
        const e = window.ttq._i[t] || [];
        for (let n = 0; n < window.ttq.methods.length; n++) window.ttq.setAndDefer(e, window.ttq.methods[n]);
        return e;
      };
      window.ttq.load = function(t, e) {
        const n = "https://analytics.tiktok.com/i18n/pixel/events.js";
        window.ttq._i = window.ttq._i || {};
        window.ttq._i[t] = [];
        window.ttq._i[t]._u = n;
        window.ttq._t = window.ttq._t || {};
        window.ttq._t[t] = +new Date();
        window.ttq._o = window.ttq._o || {};
        window.ttq._o[t] = e || {};
        const s = document.createElement("script");
        s.type = "text/javascript";
        s.async = true;
        s.src = n + "?sdkid=" + t + "&lib=ttq";
        const f = document.getElementsByTagName("script")[0];
        f.parentNode.insertBefore(s, f);
      };
      state.tiktok.filter(p => p.enabled !== false).forEach(p => window.ttq.load(p.id));
      state.tiktok.filter(p => p.enabled !== false).forEach(p => {
        const evs = p.events || ["pageview","whatsapp_click","form_submit"];
        if (evs.includes("pageview")) window.ttq.page();
      });
      state.loaded.tiktok = true;
    } catch (_) {}
  }

  function track(type, extra = {}) {
    const metaName = type === "whatsapp_click" ? "Contact" : type === "form_submit" ? "Lead" : "PageView";
    state.meta.filter(p => p.enabled !== false).forEach(p => {
      const evs = p.events || ["pageview","whatsapp_click","form_submit"];
      if (!evs.includes(type)) return;
      try {
        if (window.fbq) window.fbq("track", metaName, extra);
      } catch (_) {}
    });

    state.tiktok.filter(p => p.enabled !== false).forEach(p => {
      const evs = p.events || ["pageview","whatsapp_click","form_submit"];
      if (!evs.includes(type)) return;
      try {
        if (window.ttq) {
          if (type === "pageview") window.ttq.page();
          else if (type === "whatsapp_click") window.ttq.track("ClickButton", extra);
          else if (type === "form_submit") window.ttq.track("SubmitForm", extra);
        }
      } catch (_) {}
    });

    postEvent(type, extra);
  }

  async function boot() {
    try {
      const r = await fetch("/api/public/pixels", { cache: "no-store" });
      const cfg = await r.json();
      state.meta = Array.isArray(cfg.meta) ? cfg.meta : [];
      state.tiktok = Array.isArray(cfg.tiktok) ? cfg.tiktok : [];
      await Promise.all([initMeta(), initTikTok()]);
      track("pageview");
      window.SulanPixel = { track };
      document.addEventListener("click", e => {
        const el = e.target.closest("a[href*='wa.me'],a[href*='whatsapp'],[data-whatsapp]");
        if (el) {
          track("whatsapp_click", {
            href: el.href || "",
            text: (el.textContent || "").trim().slice(0, 120)
          });
        }
      }, true);
      document.addEventListener("submit", e => {
        const form = e.target;
        if (form && (form.matches("[data-lead-form]") || form.id === "leadForm" || form.querySelector("input[name='email'],input[name='phone'],textarea"))) {
          track("form_submit");
        }
      }, true);
    } catch (_) {}
  }

  boot();
})();`;
}

async function handleLogin(req: Request, env: Env) {
  const body = await readJson(req);
  const username = String(body.username ?? body.user ?? "").trim();
  const password = String(body.password ?? "").trim();

  if (!username || !password) {
    return json({ error: "Username and password are required." }, 400);
  }

  const expectedUser = env.ADMIN_USER || "admin";
  const expectedPassword = env.ADMIN_PASSWORD || "";

  if (username !== expectedUser || password !== expectedPassword) {
    return json({ error: "Invalid username or password." }, 401);
  }

  const sid = await createSession(env, username);

  return new Response(null, {
    status: 303,
    headers: {
      "Location": "/admin/",
      "Set-Cookie": makeCookie("sulan_admin", sid),
      "cache-control": "no-store",
    },
  });
}

async function handleAdminApi(req: Request, env: Env, url: URL) {
  if (!(await requireAuth(req, env))) return unauthorized();

  const path = url.pathname;

  if (path === "/api/admin/config" && req.method === "GET") {
    return json(await getConfig(env));
  }

  if (path === "/api/admin/stats" && req.method === "GET") {
    const s = await getStats(env);
    const views = s.page_views;
    return json({
      ...s,
      pageViews: views,
      whatsappClicks: s.whatsapp_clicks,
      formSubmissions: s.form_submissions,
      ctr: views ? Number(((s.whatsapp_clicks / views) * 100).toFixed(2)) : 0,
    });
  }

  if (path === "/api/admin/events" && req.method === "GET") {
    return json(await listEvents(env, 500));
  }

  if (path === "/api/admin/leads" && req.method === "GET") {
    return json(await listLeads(env, 500));
  }

  if (path === "/api/admin/whatsapp" && req.method === "GET") {
    return json(await getWhatsApp(env));
  }

  if (path === "/api/admin/whatsapp" && req.method === "POST") {
    const body = await readJson(req);
    const list = await getWhatsApp(env);
    const id = body.id ? Number(body.id) : Date.now();

    const item: WhatsAppConfig = {
      id,
      label: String(body.label || "WhatsApp"),
      number: String(body.number || body.phone || ""),
      active: body.active !== false,
      is_default: !!body.is_default,
    };

    if (!item.number) return json({ error: "WhatsApp number is required." }, 400);

    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx] = { ...list[idx], ...item };
    else list.push(item);

    if (item.is_default) {
      list.forEach(x => {
        x.is_default = x.id === id;
      });
    }

    await saveWhatsApp(env, list);
    return json(item, 200);
  }

  if (path.startsWith("/api/admin/whatsapp/") && req.method === "PATCH") {
    const id = Number(decodeURIComponent(path.split("/").pop() || ""));
    const body = await readJson(req);
    const list = await getWhatsApp(env);
    const item = list.find(x => x.id === id);

    if (!item) return json({ error: "WhatsApp number not found." }, 404);

    const action = String(body.action || "");

    if (action === "delete") {
      await saveWhatsApp(env, list.filter(x => x.id !== id));
      return noContent();
    }

    if (action === "enable" || action === "disable") {
      item.active = action === "enable";
    }

    if (action === "default") {
      list.forEach(x => x.is_default = x.id === id);
    }

    if (body.label !== undefined) item.label = String(body.label);
    if (body.number !== undefined) item.number = String(body.number);
    if (body.active !== undefined) item.active = !!body.active;

    await saveWhatsApp(env, list);
    return json(item);
  }

  if (path === "/api/admin/pixels" && req.method === "GET") {
    const c = await getConfig(env);
    return json(c.pixels);
  }

  if (path === "/api/admin/pixels" && req.method === "POST") {
    const body = await readJson(req);
    const kind = String(body.kind || "") as PixelKind;
    const pixelId = String(body.pixel_id || body.id || "").trim();

    if (kind !== "meta" && kind !== "tiktok") {
      return json({ error: "kind must be meta or tiktok." }, 400);
    }
    if (!pixelId) return json({ error: "Pixel ID is required." }, 400);

    const c = await getConfig(env);
    const list = c.pixels[kind];

    if (list.some(x => x.id === pixelId)) {
      return json({ error: "This Pixel ID already exists." }, 409);
    }

    const item: PixelConfig = {
      id: pixelId,
      name: String(body.name || "Primary"),
      enabled: body.enabled !== false,
      events: Array.isArray(body.events)
        ? body.events
        : ["pageview", "whatsapp_click", "form_submit"],
    };

    list.push(item);
    await saveConfig(env, c);
    return json(item);
  }

  if (path.startsWith("/api/admin/pixels/") && req.method === "PATCH") {
    const pixelId = decodeURIComponent(path.slice("/api/admin/pixels/".length));
    const body = await readJson(req);
    const kind = String(body.kind || "") as PixelKind;

    if (kind !== "meta" && kind !== "tiktok") {
      return json({ error: "kind must be meta or tiktok." }, 400);
    }

    const c = await getConfig(env);
    const list = c.pixels[kind];
    const idx = list.findIndex(x => x.id === pixelId);

    if (idx < 0) return json({ error: "Pixel not found." }, 404);

    const action = String(body.action || "");

    if (action === "delete") {
      list.splice(idx, 1);
      await saveConfig(env, c);
      return noContent();
    }

    if (action === "toggle") {
      list[idx].enabled = list[idx].enabled === false;
    }

    if (body.name !== undefined) list[idx].name = String(body.name);
    if (Array.isArray(body.events)) list[idx].events = body.events;
    if (body.enabled !== undefined) list[idx].enabled = !!body.enabled;

    await saveConfig(env, c);
    return json(list[idx]);
  }

  if (path === "/api/admin/settings" && req.method === "POST") {
    const body = await readJson(req);
    const c = await getConfig(env);

    if (body.form_enabled !== undefined) {
      c.form_enabled = !!body.form_enabled;
    }

    if (body.routing_mode === "round_robin" || body.routing_mode === "single") {
      c.routing_mode = body.routing_mode;
    }

    await saveConfig(env, c);
    return json(c);
  }

  return json({ error: "Admin API route not found." }, 404);
}

async function handlePublicApi(req: Request, env: Env, url: URL) {
  if (url.pathname === "/api/public/pixels" && req.method === "GET") {
    const c = await getConfig(env);
    return json({
      meta: c.pixels.meta.filter(x => x.enabled !== false),
      tiktok: c.pixels.tiktok.filter(x => x.enabled !== false),
    });
  }

  if (
    (url.pathname === "/api/event" ||
      url.pathname === "/api/pageview" ||
      url.pathname === "/api/whatsapp-click" ||
      url.pathname === "/api/form-submit" ||
      url.pathname === "/api/lead") &&
    req.method === "POST"
  ) {
    const body = await readJson(req);

    let type = String(body.type || "event");
    if (url.pathname === "/api/pageview") type = "pageview";
    if (url.pathname === "/api/whatsapp-click") type = "whatsapp_click";
    if (url.pathname === "/api/form-submit" || url.pathname === "/api/lead") type = "form_submit";

    const event = await saveEvent(env, {
      ...body,
      type,
      ip: req.headers.get("CF-Connecting-IP") || "",
      country: req.headers.get("CF-IPCountry") || "",
      user_agent: req.headers.get("User-Agent") || "",
    });

    if (type === "form_submit" || type === "lead") {
      await saveLead(env, body);
    }

    return json({ ok: true, event_id: event.id });
  }

  if (url.pathname === "/api/whatsapp" && req.method === "GET") {
    const list = (await getWhatsApp(env)).filter(x => x.active !== false);
    if (!list.length) return json({ number: null, numbers: [] });

    const defaultItem = list.find(x => x.is_default) || list[0];
    return json({
      number: defaultItem.number,
      numbers: list,
    });
  }

  return null;
}

async function handlePixelJs() {
  return new Response(pixelJs(), {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function handleAdminPage(req: Request, env: Env, url: URL) {
  const loggedIn = await isAuthenticated(req, env);

  if (url.pathname === "/admin/login") {
    if (loggedIn) {
      return new Response(null, {
        status: 303,
        headers: { Location: "/admin/" },
      });
    }

    if (req.method === "GET") {
      return html(loginPage());
    }
  }

  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    if (!loggedIn) {
      // Do not redirect. Returning the login HTML directly prevents redirect loops.
      return html(loginPage(), 401);
    }

    return serveAsset(req, env, "/admin/index.html");
  }

  if (url.pathname.startsWith("/admin/")) {
    if (!loggedIn) return html(loginPage(), 401);

    const assetPath =
      url.pathname === "/admin/" ? "/admin/index.html" : url.pathname;
    return serveAsset(req, env, assetPath);
  }

  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    try {
      // Public/static special endpoint.
      if (url.pathname === "/pixel.js" && req.method === "GET") {
        return handlePixelJs();
      }

      // Login endpoints. Support both paths so old/new login.html files work.
      if (
        (url.pathname === "/api/login" || url.pathname === "/api/admin/login") &&
        req.method === "POST"
      ) {
        return handleLogin(req, env);
      }

      if (url.pathname === "/api/logout") {
        await destroySession(req, env);
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/admin/login",
            "Set-Cookie": clearCookie("sulan_admin"),
            "cache-control": "no-store",
          },
        });
      }

      const publicApi = await handlePublicApi(req, env);
      if (publicApi) return publicApi;

      if (url.pathname.startsWith("/api/admin/")) {
        return handleAdminApi(req, env, url);
      }

      const adminPage = await handleAdminPage(req, env, url);
      if (adminPage) return adminPage;

      // Everything else is the existing landing page/assets.
      return serveAsset(req, env, url.pathname);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Internal server error";
      if (url.pathname.startsWith("/api/")) {
        return json({ error: message }, 500);
      }
      return text("Internal server error", 500);
    }
  },
};
