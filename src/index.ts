export interface Env {
  ADMIN_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

type Pixel = {
  id: string;
  name: string;
  enabled: boolean;
  events: string[];
};

type WhatsAppNumber = {
  id: number;
  label: string;
  number: string;
  active: boolean;
  is_default: boolean;
};

type SiteConfig = {
  version: number;
  form_enabled: boolean;
  routing_mode: "single" | "round_robin";
  next_index: number;
  whatsapp: WhatsAppNumber[];
  pixels: {
    meta: Pixel[];
    tiktok: Pixel[];
  };
  event_rules: Record<string, { meta: boolean; tiktok: boolean }>;
  form_fields: Record<string, { enabled: boolean; required: boolean }>;
};

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function sha256(value: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(buf)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function sessionToken(env: Env) {
  return sha256(`${env.ADMIN_USER}:${env.SESSION_SECRET}`);
}

async function isAuth(req: Request, env: Env) {
  const raw = req.headers.get("Cookie") || "";
  const match = raw.match(/sulan_admin=([^;]+)/);
  if (!match) return false;
  return match[1] === await sessionToken(env);
}

function defaultPixel(name: string, events: string[] = ["PageView", "Lead", "WhatsAppClick"]) : Pixel {
  return { id: "", name, enabled: false, events };
}

function defaultConfig(): SiteConfig {
  return {
    version: 5,
    form_enabled: false,
    routing_mode: "single",
    next_index: 0,
    whatsapp: [],
    pixels: {
      meta: [defaultPixel("Meta Pixel 1")],
      tiktok: [defaultPixel("TikTok Pixel 1")]
    },
    event_rules: {
      PageView: { meta: true, tiktok: true },
      ViewContent: { meta: true, tiktok: true },
      Lead: { meta: true, tiktok: true },
      WhatsAppClick: { meta: true, tiktok: true }
    },
    form_fields: {
      name: { enabled: true, required: true },
      email: { enabled: true, required: false },
      whatsapp: { enabled: true, required: true },
      company: { enabled: true, required: false },
      country: { enabled: true, required: false },
      message: { enabled: true, required: false }
    }
  };
}

function normalizePixel(p: any, i: number, platform: "meta" | "tiktok"): Pixel {
  return {
    id: String(p?.id ?? p?.pixel_id ?? "").trim(),
    name: String(p?.name ?? `${platform === "meta" ? "Meta" : "TikTok"} Pixel ${i + 1}`),
    enabled: !!p?.enabled,
    events: Array.isArray(p?.events) && p.events.length
      ? p.events.map(String)
      : ["PageView", "Lead", "WhatsAppClick"]
  };
}

function migrate(raw: any): SiteConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;

  const c: SiteConfig = {
    ...base,
    ...raw,
    version: 5,
    whatsapp: Array.isArray(raw.whatsapp) ? raw.whatsapp : [],
    pixels: {
      meta: [],
      tiktok: []
    },
    event_rules: {
      ...base.event_rules,
      ...(raw.event_rules || {})
    },
    form_fields: {
      ...base.form_fields,
      ...(raw.form_fields || {})
    }
  };

  if (Array.isArray(raw.pixels?.meta)) {
    c.pixels.meta = raw.pixels.meta.map((p: any, i: number) => normalizePixel(p, i, "meta"));
  } else if (raw.meta_id) {
    c.pixels.meta = [{
      id: String(raw.meta_id),
      name: "Meta Pixel 1",
      enabled: !!raw.meta_enabled,
      events: ["PageView", "Lead", "WhatsAppClick"]
    }];
  } else {
    c.pixels.meta = [defaultPixel("Meta Pixel 1")];
  }

  if (Array.isArray(raw.pixels?.tiktok)) {
    c.pixels.tiktok = raw.pixels.tiktok.map((p: any, i: number) => normalizePixel(p, i, "tiktok"));
  } else if (raw.tiktok_id) {
    c.pixels.tiktok = [{
      id: String(raw.tiktok_id),
      name: "TikTok Pixel 1",
      enabled: !!raw.tiktok_enabled,
      events: ["PageView", "Lead", "WhatsAppClick"]
    }];
  } else {
    c.pixels.tiktok = [defaultPixel("TikTok Pixel 1")];
  }

  return c;
}

async function getConfig(env: Env): Promise<SiteConfig> {
  const raw = await env.CONFIG_KV.get("site_config", "json");
  return migrate(raw);
}

async function saveConfig(env: Env, config: SiteConfig) {
  await env.CONFIG_KV.put("site_config", JSON.stringify(config));
}

function ua(req: Request) {
  return req.headers.get("user-agent") || "";
}

function metaFromUrl(url: URL, body: any = {}) {
  const get = (name: string, fallback = "") =>
    url.searchParams.get(name) || body?.[name] || fallback;

  return {
    utm_source: get("utm_source", "direct"),
    utm_medium: get("utm_medium"),
    utm_campaign: get("utm_campaign"),
    utm_content: get("utm_content"),
    utm_term: get("utm_term"),
    fbclid: get("fbclid"),
    ttclid: get("ttclid"),
    gclid: get("gclid"),
    source: get("utm_source", "direct"),
    campaign: get("utm_campaign"),
    adset: get("utm_content")
  };
}

async function record(env: Env, type: string, data: any) {
  const key = `event:${Date.now()}:${crypto.randomUUID()}`;
  await env.CONFIG_KV.put(
    key,
    JSON.stringify({
      type,
      ...data,
      created_at: new Date().toISOString()
    }),
    { expirationTtl: 60 * 60 * 24 * 90 }
  );
}

async function allEvents(env: Env) {
  let cursor: string | undefined;
  const keys: string[] = [];
  do {
    const page = await env.CONFIG_KV.list({
      prefix: "event:",
      cursor,
      limit: 1000
    });
    keys.push(...page.keys.map((x) => x.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const values = await Promise.all(
    keys.map((key) => env.CONFIG_KV.get(key, "json") as Promise<any>)
  );
  return values.filter(Boolean);
}

function publicConfig(c: SiteConfig) {
  return {
    version: c.version,
    form_enabled: c.form_enabled,
    routing_mode: c.routing_mode,
    pixels: {
      meta: c.pixels.meta
        .filter((p) => p.enabled && p.id)
        .map((p) => ({ id: p.id, name: p.name, events: p.events })),
      tiktok: c.pixels.tiktok
        .filter((p) => p.enabled && p.id)
        .map((p) => ({ id: p.id, name: p.name, events: p.events }))
    },
    event_rules: c.event_rules,
    form_fields: c.form_fields
  };
}

function loginHtml(error = "") {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sulan Peptide Admin</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f7f5;font:14px system-ui;color:#102033}
.box{width:min(390px,calc(100% - 40px));background:#fff;padding:30px;border-radius:18px;box-shadow:0 18px 60px #003c2d18}
.brand{font-weight:900;color:#00583f;letter-spacing:.04em}.sub{color:#687a75;margin-top:4px}h1{margin:20px 0 12px}
input{width:100%;box-sizing:border-box;padding:13px;margin:7px 0 14px;border:1px solid #cbded7;border-radius:9px}
button{width:100%;padding:13px;border:0;border-radius:9px;background:#00583f;color:#fff;font-weight:800;cursor:pointer}.err{color:#a33;background:#fff1f1;padding:9px;border-radius:8px}
</style></head><body><div class="box"><div class="brand">SULAN PEPTIDE</div><div class="sub">ADMINISTRATION</div>
<h1>Admin Login</h1>${error ? `<div class="err">${error}</div>` : ""}
<form method="post" action="/admin/login"><input name="user" placeholder="Username" required><input name="pass" type="password" placeholder="Password" required><button>Sign in / 登录</button></form>
</div></body></html>`;
}

async function adminApi(req: Request, env: Env, url: URL) {
  const c = await getConfig(env);

  if (url.pathname === "/api/admin/config" && req.method === "GET") {
    return j(c);
  }

  if (url.pathname === "/api/admin/settings" && req.method === "POST") {
    const b = await req.json();
    if (typeof b.form_enabled === "boolean") c.form_enabled = b.form_enabled;
    if (b.routing_mode === "single" || b.routing_mode === "round_robin") c.routing_mode = b.routing_mode;
    if (b.form_fields && typeof b.form_fields === "object") c.form_fields = { ...c.form_fields, ...b.form_fields };
    await saveConfig(env, c);
    return j({ ok: true, config: c });
  }

  if (url.pathname === "/api/admin/pixels" && req.method === "POST") {
    const b = await req.json();
    const clean = (list: any[], platform: "meta" | "tiktok") =>
      (Array.isArray(list) ? list : [])
        .slice(0, 20)
        .map((p: any, i: number) => normalizePixel(p, i, platform))
        .filter((p: Pixel) => p.id || p.name);
    c.pixels.meta = clean(b.meta, "meta");
    c.pixels.tiktok = clean(b.tiktok, "tiktok");
    await saveConfig(env, c);
    return j({ ok: true, pixels: c.pixels });
  }

  if (url.pathname === "/api/admin/events" && req.method === "POST") {
    const b = await req.json();
    if (!b.event) return j({ error: "event required" }, 400);
    c.event_rules[String(b.event)] = {
      meta: b.meta !== false,
      tiktok: b.tiktok !== false
    };
    await saveConfig(env, c);
    return j({ ok: true, event_rules: c.event_rules });
  }

  if (url.pathname === "/api/admin/whatsapp" && req.method === "GET") {
    const events = await allEvents(env);
    const clicks = events.filter((e) => e.type === "whatsapp_click");
    return j(c.whatsapp.map((x) => ({
      ...x,
      clicks: clicks.filter((e) => String(e.number_id) === String(x.id)).length
    })));
  }

  if (url.pathname === "/api/admin/whatsapp" && req.method === "POST") {
    const b = await req.json();
    const number = String(b.number || "").replace(/\D/g, "");
    if (!number) return j({ error: "number required" }, 400);

    if (b.id) {
      const x = c.whatsapp.find((z) => z.id === Number(b.id));
      if (!x) return j({ error: "not found" }, 404);
      x.label = String(b.label || x.label);
      x.number = number;
    } else {
      c.whatsapp.push({
        id: Date.now(),
        label: String(b.label || `WhatsApp ${c.whatsapp.length + 1}`),
        number,
        active: true,
        is_default: c.whatsapp.length === 0
      });
    }
    await saveConfig(env, c);
    return j({ ok: true });
  }

  const wm = url.pathname.match(/^\/api\/admin\/whatsapp\/(\d+)$/);
  if (wm && req.method === "PATCH") {
    const id = Number(wm[1]);
    const b = await req.json();
    const x = c.whatsapp.find((z) => z.id === id);
    if (!x) return j({ error: "not found" }, 404);

    if (b.action === "delete") c.whatsapp = c.whatsapp.filter((z) => z.id !== id);
    else if (b.action === "enable") x.active = true;
    else if (b.action === "disable") x.active = false;
    else if (b.action === "default") {
      c.whatsapp.forEach((z) => z.is_default = false);
      x.is_default = true;
    }
    await saveConfig(env, c);
    return j({ ok: true });
  }

  if (url.pathname === "/api/admin/leads" && req.method === "GET") {
    const events = await allEvents(env);
    const leads = events
      .filter((e) => e.type === "form_submit")
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 500);
    return j(leads);
  }

  if (url.pathname === "/api/admin/events" && req.method === "GET") {
    const events = await allEvents(env);
    return j(events.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 500));
  }

  if (url.pathname === "/api/admin/stats" && req.method === "GET") {
    const events = await allEvents(env);
    const views = events.filter((e) => e.type === "pageview");
    const clicks = events.filter((e) => e.type === "whatsapp_click");
    const leads = events.filter((e) => e.type === "form_submit");
    return j({
      page_views: views.length,
      whatsapp_clicks: clicks.length,
      form_submissions: leads.length,
      lead_rate: views.length ? ((leads.length / views.length) * 100).toFixed(2) : "0.00",
      whatsapp_rate: views.length ? ((clicks.length / views.length) * 100).toFixed(2) : "0.00",
      form_enabled: c.form_enabled,
      routing_mode: c.routing_mode,
      meta_pixels: c.pixels.meta.filter((p) => p.enabled && p.id).length,
      tiktok_pixels: c.pixels.tiktok.filter((p) => p.enabled && p.id).length
    });
  }

  return j({ error: "not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);

    if (url.pathname === "/admin/login" || url.pathname === "/admin/login/") {
      if (req.method === "POST") {
        const form = await req.formData();
        const user = String(form.get("user") || "");
        const pass = String(form.get("pass") || "");
        if (user === env.ADMIN_USER && pass === env.ADMIN_PASSWORD) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: "/admin/",
              "Set-Cookie": cookie("sulan_admin", await sessionToken(env), 86400)
            }
          });
        }
        return new Response(loginHtml("Invalid credentials / 用户名或密码错误"), {
          status: 401,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }
      return new Response(loginHtml(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    }

    if (url.pathname === "/admin" || url.pathname === "/admin/") {
      if (!await isAuth(req, env)) {
        return new Response(loginHtml(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }
      return env.ASSETS.fetch(new Request(new URL("/admin/index.html", url), req));
    }

    if (url.pathname.startsWith("/admin/")) {
      if (!await isAuth(req, env)) {
        return new Response(loginHtml(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
        });
      }
      return env.ASSETS.fetch(new Request(new URL("/admin/index.html", url), req));
    }

    if (url.pathname === "/api/logout") {
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": cookie("sulan_admin", "", 0) }
      });
    }

    // Public runtime configuration used by pixel.js and the landing page.
    if (url.pathname === "/api/config" && req.method === "GET") {
      return j(publicConfig(await getConfig(env)));
    }

    // Public event endpoints.
    if (url.pathname === "/api/pageview" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      await record(env, "pageview", {
        ...metaFromUrl(url, body),
        path: body.path || "/",
        landing_url: body.landing_url || "",
        user_agent: ua(req)
      });
      return j({ ok: true });
    }

    if (url.pathname === "/api/lead" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      await record(env, "form_submit", {
        ...metaFromUrl(url, body),
        metadata: body,
        user_agent: ua(req)
      });
      return j({ ok: true });
    }

    if (url.pathname === "/api/track" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const event = String(body.event || "");
      if (!event) return j({ error: "event required" }, 400);
      await record(env, event.toLowerCase(), {
        ...metaFromUrl(url, body),
        event,
        metadata: body.metadata || {},
        user_agent: ua(req)
      });
      return j({ ok: true });
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!await isAuth(req, env)) return j({ error: "unauthorized" }, 401);
      return adminApi(req, env, url);
    }

    if (url.pathname === "/go/whatsapp") {
      const c = await getConfig(env);
      const active = c.whatsapp.filter((x) => x.active);
      if (!active.length) return new Response("WhatsApp is not configured.", { status: 503 });

      let selected: WhatsAppNumber;
      if (c.routing_mode === "round_robin") {
        selected = active[(c.next_index || 0) % active.length];
        c.next_index = ((c.next_index || 0) + 1) % active.length;
        await saveConfig(env, c);
      } else {
        selected = active.find((x) => x.is_default) || active[0];
      }

      const meta = metaFromUrl(url);
      await record(env, "whatsapp_click", {
        number_id: selected.id,
        number: selected.number,
        label: selected.label,
        ...meta,
        user_agent: ua(req)
      });

      const text = url.searchParams.get("text") || "";
      return Response.redirect(
        `https://wa.me/${selected.number}${text ? `?text=${encodeURIComponent(text)}` : ""}`,
        302
      );
    }

    return env.ASSETS.fetch(req);
  }
};
