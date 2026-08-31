export interface Env {
  CONFIG_KV: KVNamespace;
  ADMIN_KV: KVNamespace;
  ASSETS: Fetcher;
}

/* =========================================================
   SULAN PEPTIDE WORKER
   V9 FINAL
   - Admin authentication disabled
   - No admin redirects
   - Admin routes serve /admin/index.html directly
   - Public API
   - Admin API
   - Pixel management
   - WhatsApp management
   - Form configuration
   - Events / Leads / Stats
   ========================================================= */

const CONFIG_KEY = "config";
const WHATSAPP_KEY = "whatsapp";
const PIXELS_KEY = "pixels";
const EVENTS_KEY = "events";
const LEADS_KEY = "leads";
const STATS_KEY = "stats";

const EVENT_LIMIT = 5000;
const LEAD_LIMIT = 5000;

/* =========================================================
   Default configuration
   ========================================================= */

const DEFAULT_FORM_FIELDS = {
  name: {
    enabled: true,
    required: true,
  },
  email: {
    enabled: true,
    required: false,
  },
  whatsapp: {
    enabled: true,
    required: true,
  },
  company: {
    enabled: true,
    required: false,
  },
  country: {
    enabled: true,
    required: false,
  },
  message: {
    enabled: true,
    required: false,
  },
};

const DEFAULT_CONFIG = {
  version: 1,
  form_enabled: true,
  routing_mode: "round_robin",
  next_index: 0,
  pixels: {
    meta: [],
    tiktok: [],
  },
  form_fields: DEFAULT_FORM_FIELDS,
};

const DEFAULT_WHATSAPP = {
  routing_mode: "round_robin",
  number: "",
  numbers: [],
};

const DEFAULT_STATS = {
  page_views: 0,
  whatsapp_clicks: 0,
  form_submissions: 0,
  pageViews: 0,
  whatsappClicks: 0,
  formSubmissions: 0,
  ctr: 0,
};

/* =========================================================
   Response helpers
   ========================================================= */

function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "access-control-allow-origin": "*",
      "access-control-allow-methods":
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers":
        "Content-Type, Authorization, X-Requested-With",
      ...extra,
    },
  });
}

function text(
  body: string,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function html(
  body: string,
  status = 200,
  extra: Record<string, string> = {},
) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      ...extra,
    },
  });
}

function noContent() {
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

/* =========================================================
   Request helpers
   ========================================================= */

async function readJson<T = any>(request: Request): Promise<T> {
  const type = request.headers.get("content-type") || "";

  if (!type.includes("application/json")) {
    const body = await request.text();

    if (!body) {
      return {} as T;
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      return {} as T;
    }
  }

  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

function now() {
  return new Date().toISOString();
}

function cleanString(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function makeId(prefix = "") {
  return (
    prefix +
    crypto.randomUUID().replace(/-/g, "")
  );
}

/* =========================================================
   KV helpers
   ========================================================= */

async function getKVJson<T>(
  kv: KVNamespace,
  key: string,
  fallback: T,
): Promise<T> {
  try {
    const value = await kv.get(key, "json");

    if (value === null || value === undefined) {
      return fallback;
    }

    return value as T;
  } catch {
    return fallback;
  }
}

async function putKVJson(
  kv: KVNamespace,
  key: string,
  value: unknown,
) {
  await kv.put(key, JSON.stringify(value));
}

/* =========================================================
   Config normalization
   ========================================================= */

function normalizePixel(pixel: any) {
  return {
    id: cleanString(pixel?.id),
    name: cleanString(pixel?.name),
    enabled: pixel?.enabled !== false,
    events: Array.isArray(pixel?.events)
      ? pixel.events.map((x: any) => cleanString(x)).filter(Boolean)
      : ["pageview", "whatsapp_click"],
  };
}

function normalizePixels(input: any) {
  const result = {
    meta: [] as any[],
    tiktok: [] as any[],
  };

  if (Array.isArray(input?.meta)) {
    result.meta = input.meta
      .map(normalizePixel)
      .filter((x: any) => x.id);
  }

  if (Array.isArray(input?.tiktok)) {
    result.tiktok = input.tiktok
      .map(normalizePixel)
      .filter((x: any) => x.id);
  }

  return result;
}

function normalizeFormFields(input: any) {
  const result: Record<string, any> = {};

  for (const key of Object.keys(DEFAULT_FORM_FIELDS)) {
    const source = input?.[key];

    result[key] = {
      enabled:
        source?.enabled !== undefined
          ? Boolean(source.enabled)
          : DEFAULT_FORM_FIELDS[key as keyof typeof DEFAULT_FORM_FIELDS]
              .enabled,

      required:
        source?.required !== undefined
          ? Boolean(source.required)
          : DEFAULT_FORM_FIELDS[key as keyof typeof DEFAULT_FORM_FIELDS]
              .required,
    };
  }

  return result;
}

function normalizeConfig(input: any) {
  return {
    version:
      typeof input?.version === "number"
        ? input.version
        : 1,

    updated_at:
      cleanString(input?.updated_at) || now(),

    form_enabled:
      input?.form_enabled !== false,

    routing_mode:
      input?.routing_mode === "round_robin"
        ? "round_robin"
        : "round_robin",

    next_index:
      Number.isFinite(Number(input?.next_index))
        ? Number(input.next_index)
        : 0,

    pixels: normalizePixels(input?.pixels),

    tiktok: Array.isArray(input?.tiktok)
      ? input.tiktok.map(normalizePixel)
      : [],

    form_fields:
      normalizeFormFields(input?.form_fields),
  };
}

async function loadConfig(env: Env) {
  const saved = await getKVJson<any>(
    env.CONFIG_KV,
    CONFIG_KEY,
    null,
  );

  if (!saved) {
    return {
      ...DEFAULT_CONFIG,
      updated_at: now(),
    };
  }

  const config = normalizeConfig(saved);

  /*
   * Backward compatibility:
   * If old data stores TikTok directly under "tiktok",
   * keep it.
   */
  if (
    Array.isArray(saved?.tiktok) &&
    config.pixels.tiktok.length === 0
  ) {
    config.pixels.tiktok = saved.tiktok.map(normalizePixel);
  }

  return config;
}

async function saveConfig(env: Env, input: any) {
  const current = await loadConfig(env);

  const merged = {
    ...current,
    ...input,
    updated_at: now(),
  };

  const normalized = normalizeConfig(merged);

  normalized.version =
    Number(current.version || 0) + 1;

  await putKVJson(
    env.CONFIG_KV,
    CONFIG_KEY,
    normalized,
  );

  return normalized;
}

/* =========================================================
   WhatsApp
   ========================================================= */

function normalizeWhatsApp(input: any) {
  let numbers: any[] = [];

  if (Array.isArray(input?.numbers)) {
    numbers = input.numbers;
  }

  /*
   * Backward compatibility with a single number.
   */
  if (
    numbers.length === 0 &&
    cleanString(input?.number)
  ) {
    numbers = [
      {
        id: Date.now(),
        label: "Default",
        number: cleanString(input.number),
        active: true,
        is_default: true,
      },
    ];
  }

  numbers = numbers
    .map((item: any) => ({
      id:
        item?.id ??
        Date.now() + Math.floor(Math.random() * 10000),

      label:
        cleanString(item?.label) ||
        "WhatsApp",

      number:
        cleanString(item?.number)
          .replace(/[^\d+]/g, ""),

      active:
        item?.active !== false,

      is_default:
        Boolean(item?.is_default),
    }))
    .filter((item: any) => item.number);

  let defaultNumber =
    numbers.find((x) => x.is_default && x.active) ||
    numbers.find((x) => x.active) ||
    numbers[0];

  if (defaultNumber) {
    numbers = numbers.map((item: any) => ({
      ...item,
      is_default:
        item.id === defaultNumber.id,
    }));
  }

  return {
    routing_mode:
      input?.routing_mode === "round_robin"
        ? "round_robin"
        : "round_robin",

    number:
      defaultNumber?.number || "",

    numbers,
  };
}

async function loadWhatsApp(env: Env) {
  const saved = await getKVJson<any>(
    env.ADMIN_KV,
    WHATSAPP_KEY,
    null,
  );

  if (!saved) {
    return DEFAULT_WHATSAPP;
  }

  return normalizeWhatsApp(saved);
}

async function saveWhatsApp(
  env: Env,
  input: any,
) {
  const value = normalizeWhatsApp(input);

  await putKVJson(
    env.ADMIN_KV,
    WHATSAPP_KEY,
    value,
  );

  return value;
}

/* =========================================================
   Stats
   ========================================================= */

function calculateStats(stats: any) {
  const pageViews = Number(
    stats?.page_views ??
      stats?.pageViews ??
      0,
  );

  const whatsappClicks = Number(
    stats?.whatsapp_clicks ??
      stats?.whatsappClicks ??
      0,
  );

  const formSubmissions = Number(
    stats?.form_submissions ??
      stats?.formSubmissions ??
      0,
  );

  const ctr =
    pageViews > 0
      ? Number(
          (
            (whatsappClicks / pageViews) *
            100
          ).toFixed(2),
        )
      : 0;

  return {
    page_views: pageViews,
    whatsapp_clicks: whatsappClicks,
    form_submissions: formSubmissions,

    pageViews,
    whatsappClicks,
    formSubmissions,

    ctr,
  };
}

async function loadStats(env: Env) {
  const stats = await getKVJson<any>(
    env.ADMIN_KV,
    STATS_KEY,
    DEFAULT_STATS,
  );

  return calculateStats(stats);
}

async function saveStats(
  env: Env,
  stats: any,
) {
  const normalized = calculateStats(stats);

  await putKVJson(
    env.ADMIN_KV,
    STATS_KEY,
    normalized,
  );

  return normalized;
}

async function incrementStat(
  env: Env,
  key:
    | "page_views"
    | "whatsapp_clicks"
    | "form_submissions",
) {
  const stats = await loadStats(env);

  stats[key] =
    Number(stats[key] || 0) + 1;

  return saveStats(env, stats);
}

/* =========================================================
   Events
   ========================================================= */

async function loadEvents(env: Env) {
  return getKVJson<any[]>(
    env.ADMIN_KV,
    EVENTS_KEY,
    [],
  );
}

async function saveEvents(
  env: Env,
  events: any[],
) {
  const limited = events.slice(-EVENT_LIMIT);

  await putKVJson(
    env.ADMIN_KV,
    EVENTS_KEY,
    limited,
  );

  return limited;
}

async function addEvent(
  env: Env,
  input: any,
) {
  const events = await loadEvents(env);

  const event = {
    id:
      cleanString(input?.id) ||
      makeId("event_"),

    created_at:
      cleanString(input?.created_at) ||
      now(),

    path:
      cleanString(input?.path) || "/",

    referrer:
      cleanString(input?.referrer),

    source:
      cleanString(input?.source) || "direct",

    campaign:
      cleanString(input?.campaign),

    adset:
      cleanString(input?.adset),

    event_id:
      cleanString(input?.event_id) ||
      makeId(),

    type:
      cleanString(input?.type) ||
      "pageview",

    ip:
      cleanString(input?.ip),

    country:
      cleanString(input?.country),

    user_agent:
      cleanString(input?.user_agent),
  };

  events.push(event);

  await saveEvents(env, events);

  return event;
}

/* =========================================================
   Leads
   ========================================================= */

async function loadLeads(env: Env) {
  return getKVJson<any[]>(
    env.ADMIN_KV,
    LEADS_KEY,
    [],
  );
}

async function saveLeads(
  env: Env,
  leads: any[],
) {
  const limited = leads.slice(-LEAD_LIMIT);

  await putKVJson(
    env.ADMIN_KV,
    LEADS_KEY,
    limited,
  );

  return limited;
}

async function addLead(
  env: Env,
  input: any,
) {
  const leads = await loadLeads(env);

  const lead = {
    id:
      cleanString(input?.id) ||
      makeId("lead_"),

    created_at:
      cleanString(input?.created_at) ||
      now(),

    name:
      cleanString(input?.name),

    email:
      cleanString(input?.email),

    whatsapp:
      cleanString(input?.whatsapp),

    company:
      cleanString(input?.company),

    country:
      cleanString(input?.country),

    message:
      cleanString(input?.message),

    source:
      cleanString(input?.source),

    campaign:
      cleanString(input?.campaign),

    adset:
      cleanString(input?.adset),

    path:
      cleanString(input?.path),

    referrer:
      cleanString(input?.referrer),

    user_agent:
      cleanString(input?.user_agent),
  };

  leads.push(lead);

  await saveLeads(env, leads);

  await incrementStat(
    env,
    "form_submissions",
  );

  return lead;
}

/* =========================================================
   Pixel helpers
   ========================================================= */

async function getAllPixels(env: Env) {
  const config = await loadConfig(env);

  return {
    meta:
      Array.isArray(config.pixels?.meta)
        ? config.pixels.meta
        : [],

    tiktok:
      Array.isArray(config.pixels?.tiktok)
        ? config.pixels.tiktok
        : [],
  };
}

async function saveAllPixels(
  env: Env,
  pixels: any,
) {
  const config = await loadConfig(env);

  config.pixels = normalizePixels(
    pixels,
  );

  config.updated_at = now();
  config.version =
    Number(config.version || 0) + 1;

  await putKVJson(
    env.CONFIG_KV,
    CONFIG_KEY,
    config,
  );

  return config.pixels;
}

function findPixel(
  pixels: any,
  platform: string,
  id: string,
) {
  const list =
    Array.isArray(pixels?.[platform])
      ? pixels[platform]
      : [];

  return list.find(
    (pixel: any) =>
      String(pixel.id) === String(id),
  );
}

/* =========================================================
   Public configuration
   ========================================================= */

async function publicConfig(env: Env) {
  const config = await loadConfig(env);
  const whatsapp = await loadWhatsApp(env);

  return {
    form_enabled:
      Boolean(config.form_enabled),

    form_fields:
      config.form_fields,

    routing_mode:
      config.routing_mode,

    pixels:
      config.pixels,

    tiktok:
      config.pixels.tiktok,

    whatsapp,

    version:
      config.version,

    updated_at:
      config.updated_at,
  };
}

/* =========================================================
   Pixel.js
   ========================================================= */

const PIXEL_JS = `
(function () {
  "use strict";

  const ENDPOINT = "/api/event";

  function getQuery() {
    try {
      return new URLSearchParams(window.location.search);
    } catch (_) {
      return new URLSearchParams();
    }
  }

  function send(type, extra) {
    try {
      const qs = getQuery();

      const payload = Object.assign({
        type: type,
        path: window.location.pathname || "/",
        referrer: document.referrer || "",
        source: qs.get("utm_source") || "direct",
        campaign: qs.get("utm_campaign") || "",
        adset: qs.get("utm_content") || "",
        event_id:
          (window.crypto &&
           crypto.randomUUID)
            ? crypto.randomUUID()
            : String(Date.now()) +
              Math.random()
      }, extra || {});

      const body = JSON.stringify(payload);

      if (navigator.sendBeacon) {
        try {
          navigator.sendBeacon(
            ENDPOINT,
            new Blob(
              [body],
              { type: "application/json" }
            )
          );
          return;
        } catch (_) {}
      }

      fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type":
            "application/json"
        },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  window.SulanPixel = {
    track: send
  };

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        send("pageview");
      }
    );
  } else {
    send("pageview");
  }

  document.addEventListener(
    "click",
    function (event) {
      const target =
        event.target &&
        event.target.closest
          ? event.target.closest(
              "a[href*='whatsapp'],a[href*='/go/whatsapp'],[data-whatsapp]"
            )
          : null;

      if (target) {
        send("whatsapp_click");
      }
    },
    true
  );
})();
`;

/* =========================================================
   WhatsApp routing
   ========================================================= */

async function chooseWhatsAppNumber(
  env: Env,
) {
  const whatsapp =
    await loadWhatsApp(env);

  const active =
    whatsapp.numbers.filter(
      (x: any) => x.active,
    );

  if (active.length === 0) {
    return "";
  }

  /*
   * Single active number.
   */
  if (active.length === 1) {
    return active[0].number;
  }

  /*
   * Round-robin.
   * Stored in CONFIG_KV to keep the routing
   * state separate from the WhatsApp records.
   */
  const config = await loadConfig(env);

  const index =
    Number(config.next_index || 0) %
    active.length;

  const selected =
    active[index];

  config.next_index =
    (index + 1) % active.length;

  await putKVJson(
    env.CONFIG_KV,
    CONFIG_KEY,
    {
      ...config,
      updated_at: now(),
    },
  );

  return selected.number;
}

/* =========================================================
   Admin HTML
   ========================================================= */

async function serveAdmin(
  request: Request,
  env: Env,
) {
  /*
   * IMPORTANT:
   *
   * Never redirect here.
   *
   * All these paths directly return the
   * same admin index:
   *
   * /admin
   * /admin/
   * /admin/login
   * /admin/login/
   * /admin/index.html
   */

  const url = new URL(request.url);

  const adminRequest =
    new Request(
      new URL(
        "/admin/index.html",
        url.origin,
      ),
      request,
    );

  const response =
    await env.ASSETS.fetch(
      adminRequest,
    );

  if (response.ok) {
    return response;
  }

  /*
   * Fallback for deployments where the admin
   * page was uploaded as public_admin_index_v5.html.
   */
  const fallbackRequest =
    new Request(
      new URL(
        "/admin/public_admin_index_v5.html",
        url.origin,
      ),
      request,
    );

  const fallback =
    await env.ASSETS.fetch(
      fallbackRequest,
    );

  if (fallback.ok) {
    return fallback;
  }

  return html(
    `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Sulan Peptide Admin</title>
</head>
<body>
<h1>Admin page not found</h1>
<p>Please deploy public/admin/index.html.</p>
</body>
</html>
    `,
    404,
  );
}

/* =========================================================
   Public API
   ========================================================= */

async function handlePublicApi(
  request: Request,
  pathname: string,
  env: Env,
) {
  if (
    request.method === "OPTIONS"
  ) {
    return noContent();
  }

  if (pathname === "/api/health") {
    return json({
      ok: true,
      service:
        "sulan-peptide-worker",
      mode:
        "development-no-auth",
      timestamp: now(),
      bindings: {
        CONFIG_KV: Boolean(
          env.CONFIG_KV,
        ),
        ADMIN_KV: Boolean(
          env.ADMIN_KV,
        ),
        ASSETS: Boolean(
          env.ASSETS,
        ),
      },
    });
  }

  if (
    pathname === "/api/public/config"
  ) {
    return json(
      await publicConfig(env),
    );
  }

  if (
    pathname === "/api/public/pixels"
  ) {
    const pixels =
      await getAllPixels(env);

    return json(pixels);
  }

  if (
    pathname === "/api/whatsapp"
  ) {
    return json(
      await loadWhatsApp(env),
    );
  }

  /*
   * Public event collector.
   */
  if (
    pathname === "/api/event" &&
    request.method === "POST"
  ) {
    const input =
      await readJson(request);

    const event =
      await addEvent(
        env,
        input,
      );

    const type =
      cleanString(input?.type);

    if (type === "pageview") {
      await incrementStat(
        env,
        "page_views",
      );
    }

    if (
      type === "whatsapp_click"
    ) {
      await incrementStat(
        env,
        "whatsapp_clicks",
      );
    }

    return json({
      ok: true,
      event_id: event.id,
    });
  }

  /*
   * Public lead submission.
   */
  if (
    pathname === "/api/leads" &&
    request.method === "POST"
  ) {
    const config =
      await loadConfig(env);

    if (!config.form_enabled) {
      return json(
        {
          ok: false,
          error:
            "Form is currently disabled",
        },
        403,
      );
    }

    const input =
      await readJson(request);

    const lead =
      await addLead(
        env,
        input,
      );

    return json({
      ok: true,
      id: lead.id,
    });
  }

  return json(
    {
      error: "Not Found",
      path: pathname,
    },
    404,
  );
}

/* =========================================================
   Admin API
   ========================================================= */

async function handleAdminApi(
  request: Request,
  pathname: string,
  env: Env,
) {
  if (
    request.method === "OPTIONS"
  ) {
    return noContent();
  }

  /*
   * IMPORTANT:
   *
   * Authentication is intentionally disabled
   * during development.
   */

  /* -----------------------------------------
     Config
     ----------------------------------------- */

  if (
    pathname === "/api/admin/config"
  ) {
    if (request.method === "GET") {
      return json(
        await loadConfig(env),
      );
    }

    if (
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH"
    ) {
      const input =
        await readJson(request);

      const config =
        await saveConfig(
          env,
          input,
        );

      return json({
        ok: true,
        config,
      });
    }
  }

  /* -----------------------------------------
     Pixels
     ----------------------------------------- */

  if (
    pathname === "/api/admin/pixels"
  ) {
    if (request.method === "GET") {
      return json(
        await getAllPixels(env),
      );
    }

    if (
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH"
    ) {
      const input =
        await readJson(request);

      const current =
        await getAllPixels(env);

      /*
       * Accept either:
       *
       * {
       *   "meta": [...]
       * }
       *
       * or:
       *
       * {
       *   "platform": "meta",
       *   "pixel": {...}
       * }
       */

      if (
        input?.meta ||
        input?.tiktok
      ) {
        const pixels =
          await saveAllPixels(
            env,
            {
              meta:
                input.meta ??
                current.meta,

              tiktok:
                input.tiktok ??
                current.tiktok,
            },
          );

        return json({
          ok: true,
          pixels,
        });
      }

      const platform =
        cleanString(
          input?.platform,
        );

      const pixel =
        normalizePixel(
          input?.pixel ??
          input,
        );

      if (
        platform !== "meta" &&
        platform !== "tiktok"
      ) {
        return json(
          {
            ok: false,
            error:
              "platform must be meta or tiktok",
          },
          400,
        );
      }

      if (!pixel.id) {
        return json(
          {
            ok: false,
            error:
              "Pixel ID is required",
          },
          400,
        );
      }

      const list =
        Array.isArray(
          current[platform],
        )
          ? current[platform]
          : [];

      const existing =
        list.findIndex(
          (x: any) =>
            String(x.id) ===
            String(pixel.id),
        );

      if (existing >= 0) {
        list[existing] = pixel;
      } else {
        list.push(pixel);
      }

      const pixels =
        await saveAllPixels(
          env,
          {
            ...current,
            [platform]: list,
          },
        );

      return json({
        ok: true,
        pixel,
        pixels,
      });
    }

    if (
      request.method === "DELETE"
    ) {
      const url =
        new URL(request.url);

      const platform =
        cleanString(
          url.searchParams.get(
            "platform",
          ),
        );

      const id =
        cleanString(
          url.searchParams.get("id"),
        );

      const current =
        await getAllPixels(env);

      if (
        platform !== "meta" &&
        platform !== "tiktok"
      ) {
        return json(
          {
            ok: false,
            error:
              "platform must be meta or tiktok",
          },
          400,
        );
      }

      current[platform] =
        current[platform].filter(
          (x: any) =>
            String(x.id) !==
            String(id),
        );

      const pixels =
        await saveAllPixels(
          env,
          current,
        );

      return json({
        ok: true,
        pixels,
      });
    }
  }

  /* -----------------------------------------
     WhatsApp
     ----------------------------------------- */

  if (
    pathname === "/api/admin/whatsapp"
  ) {
    if (request.method === "GET") {
      return json(
        await loadWhatsApp(env),
      );
    }

    if (
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH"
    ) {
      const input =
        await readJson(request);

      const current =
        await loadWhatsApp(env);

      /*
       * Support:
       *
       * {
       *   "numbers": [...]
       * }
       *
       * and:
       *
       * {
       *   "number": "..."
       * }
       *
       * and:
       *
       * {
       *   "action": "add",
       *   "number": {...}
       * }
       */

      if (
        input?.action === "add"
      ) {
        const numbers =
          Array.isArray(
            current.numbers,
          )
            ? [...current.numbers]
            : [];

        const item =
          normalizeWhatsApp({
            numbers: [
              input.number,
            ],
          }).numbers[0];

        if (!item) {
          return json(
            {
              ok: false,
              error:
                "Invalid WhatsApp number",
            },
            400,
          );
        }

        numbers.push(item);

        const result =
          await saveWhatsApp(
            env,
            {
              ...current,
              numbers,
            },
          );

        return json({
          ok: true,
          whatsapp: result,
        });
      }

      if (
        input?.action === "delete"
      ) {
        const id =
          input?.id;

        const numbers =
          current.numbers.filter(
            (x: any) =>
              String(x.id) !==
              String(id),
          );

        const result =
          await saveWhatsApp(
            env,
            {
              ...current,
              numbers,
            },
          );

        return json({
          ok: true,
          whatsapp: result,
        });
      }

      if (
        input?.action ===
        "toggle"
      ) {
        const id =
          input?.id;

        const numbers =
          current.numbers.map(
            (x: any) =>
              String(x.id) ===
              String(id)
                ? {
                    ...x,
                    active:
                      input.active !==
                      undefined
                        ? Boolean(
                            input.active,
                          )
                        : !x.active,
                  }
                : x,
          );

        const result =
          await saveWhatsApp(
            env,
            {
              ...current,
              numbers,
            },
          );

        return json({
          ok: true,
          whatsapp: result,
        });
      }

      if (
        input?.action ===
        "default"
      ) {
        const id =
          input?.id;

        const numbers =
          current.numbers.map(
            (x: any) => ({
              ...x,
              is_default:
                String(x.id) ===
                String(id),
            }),
          );

        const result =
          await saveWhatsApp(
            env,
            {
              ...current,
              numbers,
            },
          );

        return json({
          ok: true,
          whatsapp: result,
        });
      }

      const result =
        await saveWhatsApp(
          env,
          {
            ...current,
            ...input,
          },
        );

      return json({
        ok: true,
        whatsapp: result,
      });
    }

    if (
      request.method === "DELETE"
    ) {
      const url =
        new URL(request.url);

      const id =
        cleanString(
          url.searchParams.get(
            "id",
          ),
        );

      const current =
        await loadWhatsApp(env);

      const result =
        await saveWhatsApp(
          env,
          {
            ...current,
            numbers:
              current.numbers.filter(
                (x: any) =>
                  String(x.id) !==
                  String(id),
              ),
          },
        );

      return json({
        ok: true,
        whatsapp: result,
      });
    }
  }

  /* -----------------------------------------
     Stats
     ----------------------------------------- */

  if (
    pathname === "/api/admin/stats"
  ) {
    if (request.method === "GET") {
      return json(
        await loadStats(env),
      );
    }

    if (
      request.method === "POST" ||
      request.method === "PUT" ||
      request.method === "PATCH"
    ) {
      const input =
        await readJson(request);

      const stats =
        await saveStats(
          env,
          input,
        );

      return json({
        ok: true,
        stats,
      });
    }
  }

  /* -----------------------------------------
     Events
     ----------------------------------------- */

  if (
    pathname === "/api/admin/events"
  ) {
    if (request.method === "GET") {
      const events =
        await loadEvents(env);

      const url =
        new URL(request.url);

      const limit =
        Math.min(
          Math.max(
            Number(
              url.searchParams.get(
                "limit",
              ) || 100,
            ),
            1,
          ),
          1000,
        );

      return json(
        events.slice(-limit).reverse(),
      );
    }

    if (
      request.method === "DELETE"
    ) {
      await putKVJson(
        env.ADMIN_KV,
        EVENTS_KEY,
        [],
      );

      return json({
        ok: true,
        events: [],
      });
    }

    if (
      request.method === "POST"
    ) {
      const input =
        await readJson(request);

      const event =
        await addEvent(
          env,
          input,
        );

      return json({
        ok: true,
        event,
      });
    }
  }

  /* -----------------------------------------
     Leads
     ----------------------------------------- */

  if (
    pathname === "/api/admin/leads"
  ) {
    if (request.method === "GET") {
      const leads =
        await loadLeads(env);

      const url =
        new URL(request.url);

      const limit =
        Math.min(
          Math.max(
            Number(
              url.searchParams.get(
                "limit",
              ) || 100,
            ),
            1,
          ),
          1000,
        );

      return json(
        leads.slice(-limit).reverse(),
      );
    }

    if (
      request.method === "POST"
    ) {
      const input =
        await readJson(request);

      const lead =
        await addLead(
          env,
          input,
        );

      return json({
        ok: true,
        lead,
      });
    }

    if (
      request.method === "DELETE"
    ) {
      await putKVJson(
        env.ADMIN_KV,
        LEADS_KEY,
        [],
      );

      return json({
        ok: true,
        leads: [],
      });
    }
  }

  return json(
    {
      error: "Admin API Not Found",
      path: pathname,
    },
    404,
  );
}

/* =========================================================
   Static asset handling
   ========================================================= */

async function serveAsset(
  request: Request,
  env: Env,
) {
  const url =
    new URL(request.url);

  /*
   * favicon:
   *
   * Prevent favicon requests from reaching
   * application routing and creating noisy errors.
   */
  if (
    url.pathname === "/favicon.ico"
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control":
          "public, max-age=86400",
      },
    });
  }

  const response =
    await env.ASSETS.fetch(
      request,
    );

  if (response.status !== 404) {
    return response;
  }

  return text(
    "Not Found",
    404,
  );
}

/* =========================================================
   Main request handler
   ========================================================= */

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      const url =
        new URL(request.url);

      const pathname =
        url.pathname;

      /*
       * OPTIONS
       */
      if (
        request.method === "OPTIONS"
      ) {
        return noContent();
      }

      /* ===================================================
         ADMIN PAGES
         =================================================== */

      if (
        pathname === "/admin" ||
        pathname === "/admin/" ||
        pathname === "/admin/login" ||
        pathname === "/admin/login/" ||
        pathname === "/admin/index.html"
      ) {
        return serveAdmin(
          request,
          env,
        );
      }

      /* ===================================================
         API
         =================================================== */

      if (
        pathname.startsWith("/api/")
      ) {
        /*
         * Admin API first.
         */
        if (
          pathname.startsWith(
            "/api/admin/",
          )
        ) {
          return await handleAdminApi(
            request,
            pathname,
            env,
          );
        }

        /*
         * Public API.
         */
        return await handlePublicApi(
          request,
          pathname,
          env,
        );
      }

      /* ===================================================
         WHATSAPP REDIRECT
         =================================================== */

      if (
        pathname ===
        "/go/whatsapp"
      ) {
        const number =
          await chooseWhatsAppNumber(
            env,
          );

        if (!number) {
          return html(
            `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>WhatsApp unavailable</title>
</head>
<body>
<h2>WhatsApp is currently unavailable.</h2>
</body>
</html>
            `,
            503,
          );
        }

        await incrementStat(
          env,
          "whatsapp_clicks",
        );

        /*
         * wa.me requires digits only.
         */
        const cleanNumber =
          number.replace(
            /[^\d]/g,
            "",
          );

        const target =
          "https://wa.me/" +
          cleanNumber;

        /*
         * This is the ONLY redirect
         * intentionally kept in V9.
         *
         * Admin has ZERO redirects.
         */
        return new Response(null, {
          status: 302,
          headers: {
            Location: target,
            "Cache-Control":
              "no-store",
          },
        });
      }

      /* ===================================================
         PIXEL JS
         =================================================== */

      if (
        pathname === "/pixel.js"
      ) {
        return new Response(
          PIXEL_JS,
          {
            status: 200,
            headers: {
              "content-type":
                "application/javascript; charset=utf-8",

              "cache-control":
                "public, max-age=300",
            },
          },
        );
      }

      /* ===================================================
         EVERYTHING ELSE = ASSETS
         =================================================== */

      return await serveAsset(
        request,
        env,
      );
    } catch (error: any) {
      console.error(
        "Worker error:",
        error,
      );

      return json(
        {
          error:
            error?.message ||
            "Internal server error",
        },
        500,
      );
    }
  },
};
