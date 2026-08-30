export interface Env {
  CONFIG_KV: KVNamespace;
  ADMIN_KV: KVNamespace;
  ASSETS: Fetcher;
}

const CONFIG_KEY = "config";
const WHATSAPP_KEY = "whatsapp";
const STATS_KEY = "stats";

const EVENT_PREFIX = "event:";
const LEAD_PREFIX = "lead:";

type PixelKind = "meta" | "tiktok";

type PixelConfig = {
  id: string;
  name: string;
  enabled: boolean;
  events: string[];
};

type Config = {
  form_enabled: boolean;
  routing_mode: "single" | "round_robin";
  pixels: {
    meta: PixelConfig[];
    tiktok: PixelConfig[];
  };
};

type WhatsAppNumber = {
  id: number;
  label: string;
  number: string;
  active: boolean;
  is_default: boolean;
};

type Stats = {
  page_views: number;
  whatsapp_clicks: number;
  form_submissions: number;
};


/* =========================================================
   Response helpers
========================================================= */

function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function text(
  body: string,
  status = 200,
  extra: Record<string, string> = {}
): Response {
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
  extra: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function noContent(status = 204): Response {
  return new Response(null, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}


/* =========================================================
   Request helpers
========================================================= */

async function readJson(req: Request): Promise<Record<string, any>> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const body = await req.json();

      if (body && typeof body === "object") {
        return body as Record<string, any>;
      }

      return {};
    } catch {
      return {};
    }
  }

  try {
    const form = await req.formData();
    const out: Record<string, any> = {};

    for (const [key, value] of form.entries()) {
      out[key] = typeof value === "string" ? value : "";
    }

    return out;
  } catch {
    return {};
  }
}


/* =========================================================
   Pixel helpers
========================================================= */

function normalizePixels(value: any): PixelConfig[] {
  const defaultEvents = [
    "pageview",
    "whatsapp_click",
    "form_submit",
  ];

  if (Array.isArray(value)) {
    return value
      .map((item: any) => {
        if (typeof item === "string") {
          return {
            id: item.trim(),
            name: "Primary",
            enabled: true,
            events: [...defaultEvents],
          };
        }

        if (!item || typeof item !== "object") {
          return null;
        }

        return {
          id: String(
            item.id ??
            item.pixel_id ??
            item.pixelId ??
            ""
          ).trim(),

          name: String(
            item.name ??
            "Primary"
          ).trim(),

          enabled: item.enabled !== false,

          events: Array.isArray(item.events)
            ? item.events
            : Array.isArray(item.event_rules)
              ? item.event_rules
              : [...defaultEvents],
        };
      })
      .filter(
        (item: PixelConfig | null): item is PixelConfig =>
          !!item && !!item.id
      )
      .filter(
        (item: PixelConfig, index: number, array: PixelConfig[]) =>
          array.findIndex((x) => x.id === item.id) === index
      );
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([id, item]: [string, any]) => ({
        id: String(id).trim(),

        name:
          item && typeof item === "object"
            ? String(item.name ?? "Primary")
            : "Primary",

        enabled:
          item && typeof item === "object"
            ? item.enabled !== false
            : !!item,

        events:
          item &&
          typeof item === "object" &&
          Array.isArray(item.events)
            ? item.events
            : [...defaultEvents],
      }))
      .filter((item) => !!item.id);
  }

  return [];
}


/* =========================================================
   Config
========================================================= */

async function getConfig(env: Env): Promise<Config> {
  const raw = await env.CONFIG_KV.get(
    CONFIG_KEY,
    "json"
  ) as any;

  const base: Config = {
    form_enabled: true,

    routing_mode: "single",

    pixels: {
      meta: [],
      tiktok: [],
    },
  };

  if (!raw || typeof raw !== "object") {
    return base;
  }

  const meta = normalizePixels(
    raw.pixels?.meta ??
    raw.meta_pixels ??
    raw.metaPixels ??
    []
  );

  const tiktok = normalizePixels(
    raw.pixels?.tiktok ??
    raw.tiktok_pixels ??
    raw.tiktokPixels ??
    []
  );

  return {
    form_enabled:
      raw.form_enabled ??
      raw.formEnabled ??
      true,

    routing_mode:
      raw.routing_mode === "round_robin" ||
      raw.routingMode === "round_robin"
        ? "round_robin"
        : "single",

    pixels: {
      meta,
      tiktok,
    },
  };
}

async function saveConfig(
  env: Env,
  config: Config
): Promise<void> {
  await env.CONFIG_KV.put(
    CONFIG_KEY,
    JSON.stringify(config)
  );
}


/* =========================================================
   WhatsApp
========================================================= */

async function getWhatsApp(
  env: Env
): Promise<WhatsAppNumber[]> {
  const raw = await env.CONFIG_KV.get(
    WHATSAPP_KEY,
    "json"
  ) as any;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map(
    (item: any, index: number) => ({
      id: Number(
        item.id ??
        index + 1
      ),

      label: String(
        item.label ??
        "WhatsApp"
      ),

      number: String(
        item.number ??
        item.phone ??
        ""
      ),

      active:
        item.active !== false,

      is_default:
        !!(
          item.is_default ??
          item.isDefault
        ),
    })
  );
}

async function saveWhatsApp(
  env: Env,
  list: WhatsAppNumber[]
): Promise<void> {
  await env.CONFIG_KV.put(
    WHATSAPP_KEY,
    JSON.stringify(list)
  );
}


/* =========================================================
   Statistics
========================================================= */

async function getStats(
  env: Env
): Promise<Stats> {
  const raw = await env.ADMIN_KV.get(
    STATS_KEY,
    "json"
  ) as any;

  return {
    page_views: Number(
      raw?.page_views ??
      raw?.pageViews ??
      0
    ),

    whatsapp_clicks: Number(
      raw?.whatsapp_clicks ??
      raw?.whatsappClicks ??
      0
    ),

    form_submissions: Number(
      raw?.form_submissions ??
      raw?.formSubmissions ??
      0
    ),
  };
}

async function incrementStat(
  env: Env,
  key: keyof Stats
): Promise<Stats> {
  const current = await getStats(env);

  current[key] =
    Number(current[key] || 0) + 1;

  await env.ADMIN_KV.put(
    STATS_KEY,
    JSON.stringify(current)
  );

  return current;
}


/* =========================================================
   Events
========================================================= */

async function saveEvent(
  env: Env,
  event: Record<string, any>
) {
  const created_at =
    new Date().toISOString();

  const id =
    crypto.randomUUID();

  const value = {
    id,
    created_at,
    ...event,
  };

  await env.ADMIN_KV.put(
    `${EVENT_PREFIX}${created_at}:${id}`,
    JSON.stringify(value),
    {
      expirationTtl:
        60 * 60 * 24 * 180,
    }
  );

  const type = String(
    event.type ??
    event.event ??
    ""
  ).toLowerCase();

  if (
    type === "pageview" ||
    type === "page_view"
  ) {
    await incrementStat(
      env,
      "page_views"
    );
  }

  if (
    type === "whatsapp_click" ||
    type === "whatsapp-click" ||
    type === "whatsapp"
  ) {
    await incrementStat(
      env,
      "whatsapp_clicks"
    );
  }

  if (
    type === "form_submit" ||
    type === "lead"
  ) {
    await incrementStat(
      env,
      "form_submissions"
    );
  }

  return value;
}

async function listEvents(
  env: Env,
  limit = 500
) {
  const listed =
    await env.ADMIN_KV.list({
      prefix: EVENT_PREFIX,
      limit,
    });

  const rows: any[] = [];

  for (const key of listed.keys) {
    const value =
      await env.ADMIN_KV.get(
        key.name,
        "json"
      );

    if (value) {
      rows.push(value);
    }
  }

  rows.sort(
    (a, b) =>
      String(
        b.created_at ??
        b.createdAt ??
        ""
      ).localeCompare(
        String(
          a.created_at ??
          a.createdAt ??
          ""
        )
      )
  );

  return rows.slice(0, limit);
}


/* =========================================================
   Leads
========================================================= */

async function saveLead(
  env: Env,
  body: Record<string, any>
) {
  const id =
    crypto.randomUUID();

  const created_at =
    new Date().toISOString();

  const lead = {
    id,
    created_at,
    status: "new",
    ...body,
  };

  await env.ADMIN_KV.put(
    `${LEAD_PREFIX}${created_at}:${id}`,
    JSON.stringify(lead),
    {
      expirationTtl:
        60 * 60 * 24 * 365,
    }
  );

  /*
   IMPORTANT:
   Do NOT increment form_submissions
   here.

   saveEvent() already does it.
   Otherwise one form submit would
   count twice.
  */

  return lead;
}

async function listLeads(
  env: Env,
  limit = 500
) {
  const listed =
    await env.ADMIN_KV.list({
      prefix: LEAD_PREFIX,
      limit,
    });

  const rows: any[] = [];

  for (const key of listed.keys) {
    const value =
      await env.ADMIN_KV.get(
        key.name,
        "json"
      );

    if (value) {
      rows.push(value);
    }
  }

  rows.sort(
    (a, b) =>
      String(
        b.created_at ??
        b.createdAt ??
        ""
      ).localeCompare(
        String(
          a.created_at ??
          a.createdAt ??
          ""
        )
      )
  );

  return rows.slice(0, limit);
}


/* =========================================================
   STATIC ASSETS
========================================================= */

async function serveAsset(
  req: Request,
  env: Env,
  path: string
): Promise<Response> {
  if (
    !env ||
    !env.ASSETS ||
    typeof env.ASSETS.fetch !== "function"
  ) {
    return text(
      "ASSETS binding is not configured.",
      500
    );
  }

  const requestUrl =
    new URL(req.url);

  let cleanPath =
    path || "/";

  /*
   Never allow an accidental
   undefined/null path.
  */

  if (
    cleanPath === "undefined" ||
    cleanPath === "null"
  ) {
    cleanPath = "/";
  }

  if (!cleanPath.startsWith("/")) {
    cleanPath = "/" + cleanPath;
  }

  const assetUrl =
    new URL(
      cleanPath,
      requestUrl.origin
    );

  /*
   Preserve query string only when
   it actually exists on the request.
  */

  assetUrl.search =
    requestUrl.search;

  const assetRequest =
    new Request(
      assetUrl.toString(),
      {
        method: req.method,
        headers: req.headers,
        body:
          req.method === "GET" ||
          req.method === "HEAD"
            ? undefined
            : req.body,
        redirect: "follow",
      }
    );

  try {
    return await env.ASSETS.fetch(
      assetRequest
    );
  } catch (error) {
    console.error(
      "ASSETS_FETCH_ERROR",
      error
    );

    return text(
      "Asset fetch failed.",
      500
    );
  }
}


/* =========================================================
   HEALTH CHECK
========================================================= */

async function handleHealth(
  env: Env
): Promise<Response> {
  let configOk = false;
  let adminKvOk = false;
  let assetsOk = false;

  try {
    await env.CONFIG_KV.get(
      CONFIG_KEY
    );

    configOk = true;
  } catch (error) {
    console.error(
      "CONFIG_KV_HEALTH_ERROR",
      error
    );
  }

  try {
    await env.ADMIN_KV.get(
      STATS_KEY
    );

    adminKvOk = true;
  } catch (error) {
    console.error(
      "ADMIN_KV_HEALTH_ERROR",
      error
    );
  }

  assetsOk =
    !!env.ASSETS &&
    typeof env.ASSETS.fetch === "function";

  const ok =
    configOk &&
    adminKvOk &&
    assetsOk;

  return json(
    {
      ok,

      service:
        "sulan-peptide-worker",

      mode:
        "development-no-auth",

      timestamp:
        new Date().toISOString(),

      bindings: {
        CONFIG_KV:
          configOk,

        ADMIN_KV:
          adminKvOk,

        ASSETS:
          assetsOk,
      },
    },
    ok ? 200 : 503
  );
}


/* =========================================================
   PUBLIC PIXEL API
========================================================= */

async function handlePublicApi(
  req: Request,
  env: Env,
  url: URL
): Promise<Response | null> {

  /*
   GET /api/public/pixels
  */

  if (
    url.pathname ===
      "/api/public/pixels" &&
    req.method === "GET"
  ) {
    const config =
      await getConfig(env);

    return json({
      meta:
        config.pixels.meta.filter(
          (pixel) =>
            pixel.enabled !== false
        ),

      tiktok:
        config.pixels.tiktok.filter(
          (pixel) =>
            pixel.enabled !== false
        ),
    });
  }


  /*
   POST event
  */

  const eventPaths = [
    "/api/event",
    "/api/pageview",
    "/api/whatsapp-click",
    "/api/form-submit",
    "/api/lead",
  ];

  if (
    eventPaths.includes(
      url.pathname
    ) &&
    req.method === "POST"
  ) {
    const body =
      await readJson(req);

    let type =
      String(
        body.type ||
        "event"
      );

    if (
      url.pathname ===
      "/api/pageview"
    ) {
      type = "pageview";
    }

    if (
      url.pathname ===
      "/api/whatsapp-click"
    ) {
      type = "whatsapp_click";
    }

    if (
      url.pathname ===
        "/api/form-submit" ||
      url.pathname ===
        "/api/lead"
    ) {
      type = "form_submit";
    }

    const event =
      await saveEvent(
        env,
        {
          ...body,

          type,

          ip:
            req.headers.get(
              "CF-Connecting-IP"
            ) || "",

          country:
            req.headers.get(
              "CF-IPCountry"
            ) || "",

          user_agent:
            req.headers.get(
              "User-Agent"
            ) || "",
        }
      );

    if (
      type === "form_submit" ||
      type === "lead"
    ) {
      await saveLead(
        env,
        body
      );
    }

    return json({
      ok: true,
      event_id: event.id,
    });
  }


  /*
   GET WhatsApp numbers
  */

  if (
    url.pathname ===
      "/api/whatsapp" &&
    req.method === "GET"
  ) {
    const list =
      (
        await getWhatsApp(env)
      ).filter(
        (item) =>
          item.active !== false
      );

    if (!list.length) {
      return json({
        number: null,
        numbers: [],
      });
    }

    const defaultItem =
      list.find(
        (item) =>
          item.is_default
      ) || list[0];

    return json({
      number:
        defaultItem.number,

      numbers:
        list,
    });
  }

  return null;
}


/* =========================================================
   ADMIN API
========================================================= */

async function handleAdminApi(
  req: Request,
  env: Env,
  url: URL
): Promise<Response> {

  /*
   CONFIG
  */

  if (
    url.pathname ===
      "/api/admin/config" &&
    req.method === "GET"
  ) {
    return json(
      await getConfig(env)
    );
  }


  /*
   STATS
  */

  if (
    url.pathname ===
      "/api/admin/stats" &&
    req.method === "GET"
  ) {
    const stats =
      await getStats(env);

    const views =
      stats.page_views;

    return json({
      ...stats,

      pageViews:
        stats.page_views,

      whatsappClicks:
        stats.whatsapp_clicks,

      formSubmissions:
        stats.form_submissions,

      ctr:
        views
          ? Number(
              (
                stats.whatsapp_clicks /
                views *
                100
              ).toFixed(2)
            )
          : 0,
    });
  }


  /*
   EVENTS
  */

  if (
    url.pathname ===
      "/api/admin/events" &&
    req.method === "GET"
  ) {
    return json(
      await listEvents(
        env,
        500
      )
    );
  }


  /*
   LEADS
  */

  if (
    url.pathname ===
      "/api/admin/leads" &&
    req.method === "GET"
  ) {
    return json(
      await listLeads(
        env,
        500
      )
    );
  }


  /* =======================================================
     WHATSAPP
  ======================================================= */

  if (
    url.pathname ===
      "/api/admin/whatsapp" &&
    req.method === "GET"
  ) {
    return json(
      await getWhatsApp(env)
    );
  }


  if (
    url.pathname ===
      "/api/admin/whatsapp" &&
    req.method === "POST"
  ) {
    const body =
      await readJson(req);

    const list =
      await getWhatsApp(env);

    const id =
      body.id
        ? Number(body.id)
        : Date.now();

    const item:
      WhatsAppNumber = {
        id,

        label:
          String(
            body.label ||
            "WhatsApp"
          ),

        number:
          String(
            body.number ||
            body.phone ||
            ""
          ),

        active:
          body.active !== false,

        is_default:
          !!body.is_default,
      };

    if (!item.number) {
      return json(
        {
          error:
            "WhatsApp number is required.",
        },
        400
      );
    }

    const existingIndex =
      list.findIndex(
        (x) => x.id === id
      );

    if (
      existingIndex >= 0
    ) {
      list[existingIndex] = {
        ...list[existingIndex],
        ...item,
      };
    } else {
      list.push(item);
    }

    if (
      item.is_default
    ) {
      list.forEach(
        (x) => {
          x.is_default =
            x.id === id;
        }
      );
    }

    await saveWhatsApp(
      env,
      list
    );

    return json(
      item
    );
  }


  if (
    url.pathname.startsWith(
      "/api/admin/whatsapp/"
    ) &&
    req.method === "PATCH"
  ) {
    const id =
      Number(
        decodeURIComponent(
          url.pathname.split("/").pop() || ""
        )
      );

    const body =
      await readJson(req);

    const list =
      await getWhatsApp(env);

    const item =
      list.find(
        (x) => x.id === id
      );

    if (!item) {
      return json(
        {
          error:
            "WhatsApp number not found.",
        },
        404
      );
    }

    const action =
      String(
        body.action || ""
      );


    if (
      action === "delete"
    ) {
      await saveWhatsApp(
        env,
        list.filter(
          (x) => x.id !== id
        )
      );

      return noContent();
    }


    if (
      action === "enable"
    ) {
      item.active = true;
    }


    if (
      action === "disable"
    ) {
      item.active = false;
    }


    if (
      action === "default"
    ) {
      list.forEach(
        (x) => {
          x.is_default =
            x.id === id;
        }
      );
    }


    if (
      body.label !== undefined
    ) {
      item.label =
        String(body.label);
    }


    if (
      body.number !== undefined
    ) {
      item.number =
        String(body.number);
    }


    if (
      body.active !== undefined
    ) {
      item.active =
        !!body.active;
    }


    await saveWhatsApp(
      env,
      list
    );

    return json(
      item
    );
  }


  /* =======================================================
     PIXELS
  ======================================================= */

  if (
    url.pathname ===
      "/api/admin/pixels" &&
    req.method === "GET"
  ) {
    const config =
      await getConfig(env);

    return json(
      config.pixels
    );
  }


  if (
    url.pathname ===
      "/api/admin/pixels" &&
    req.method === "POST"
  ) {
    const body =
      await readJson(req);

    const kind =
      String(
        body.kind || ""
      ) as PixelKind;

    const pixelId =
      String(
        body.pixel_id ||
        body.id ||
        ""
      ).trim();

    if (
      kind !== "meta" &&
      kind !== "tiktok"
    ) {
      return json(
        {
          error:
            "kind must be meta or tiktok.",
        },
        400
      );
    }

    if (!pixelId) {
      return json(
        {
          error:
            "Pixel ID is required.",
        },
        400
      );
    }

    const config =
      await getConfig(env);

    const list =
      config.pixels[kind];

    if (
      list.some(
        (pixel) =>
          pixel.id === pixelId
      )
    ) {
      return json(
        {
          error:
            "This Pixel ID already exists.",
        },
        409
      );
    }

    const item:
      PixelConfig = {
        id: pixelId,

        name:
          String(
            body.name ||
            "Primary"
          ),

        enabled:
          body.enabled !== false,

        events:
          Array.isArray(
            body.events
          )
            ? body.events
            : [
                "pageview",
                "whatsapp_click",
                "form_submit",
              ],
      };

    list.push(item);

    await saveConfig(
      env,
      config
    );

    return json(
      item
    );
  }


  if (
    url.pathname.startsWith(
      "/api/admin/pixels/"
    ) &&
    req.method === "PATCH"
  ) {
    const pixelId =
      decodeURIComponent(
        url.pathname.slice(
          "/api/admin/pixels/".length
        )
      );

    const body =
      await readJson(req);

    const kind =
      String(
        body.kind || ""
      ) as PixelKind;

    if (
      kind !== "meta" &&
      kind !== "tiktok"
    ) {
      return json(
        {
          error:
            "kind must be meta or tiktok.",
        },
        400
      );
    }

    const config =
      await getConfig(env);

    const list =
      config.pixels[kind];

    const index =
      list.findIndex(
        (pixel) =>
          pixel.id === pixelId
      );

    if (index < 0) {
      return json(
        {
          error:
            "Pixel not found.",
        },
        404
      );
    }

    const action =
      String(
        body.action || ""
      );


    if (
      action === "delete"
    ) {
      list.splice(
        index,
        1
      );

      await saveConfig(
        env,
        config
      );

      return noContent();
    }


    if (
      action === "toggle"
    ) {
      list[index].enabled =
        list[index].enabled === false;
    }


    if (
      body.name !== undefined
    ) {
      list[index].name =
        String(body.name);
    }


    if (
      Array.isArray(
        body.events
      )
    ) {
      list[index].events =
        body.events;
    }


    if (
      body.enabled !== undefined
    ) {
      list[index].enabled =
        !!body.enabled;
    }


    await saveConfig(
      env,
      config
    );

    return json(
      list[index]
    );
  }


  /* =======================================================
     SETTINGS
  ======================================================= */

  if (
    url.pathname ===
      "/api/admin/settings" &&
    req.method === "POST"
  ) {
    const body =
      await readJson(req);

    const config =
      await getConfig(env);


    if (
      body.form_enabled !==
      undefined
    ) {
      config.form_enabled =
        !!body.form_enabled;
    }


    if (
      body.routing_mode ===
        "round_robin" ||
      body.routing_mode ===
        "single"
    ) {
      config.routing_mode =
        body.routing_mode;
    }


    await saveConfig(
      env,
      config
    );

    return json(
      config
    );
  }


  return json(
    {
      error:
        "Admin API route not found.",
    },
    404
  );
}


/* =========================================================
   ADMIN PAGE
   AUTHENTICATION TEMPORARILY DISABLED
========================================================= */

async function handleAdminPage(
  req: Request,
  env: Env,
  url: URL
): Promise<Response | null> {

  /*
   IMPORTANT:
   Authentication is intentionally
   disabled during development.

   /admin
   /admin/
   /admin/login

   all go directly to the dashboard.
  */

  if (
    url.pathname ===
      "/admin" ||
    url.pathname ===
      "/admin/" ||
    url.pathname ===
      "/admin/login"
  ) {
    return serveAsset(
      req,
      env,
      "/admin/index.html"
    );
  }


  /*
   Other /admin/* assets
  */

  if (
    url.pathname.startsWith(
      "/admin/"
    )
  ) {
    return serveAsset(
      req,
      env,
      url.pathname
    );
  }

  return null;
}


/* =========================================================
   PIXEL.JS
========================================================= */

function pixelJs(): string {
  return `
(() => {
  const state = {
    meta: [],
    tiktok: [],
    loaded: {
      meta: false,
      tiktok: false
    }
  };

  function postEvent(type, extra = {}) {
    try {
      const params =
        new URLSearchParams(
          location.search
        );

      const payload = {
        type,

        path:
          location.pathname,

        referrer:
          document.referrer || "",

        source:
          params.get("utm_source") || "",

        campaign:
          params.get("utm_campaign") || "",

        adset:
          params.get("utm_adset") || "",

        ...extra
      };

      fetch(
        "/api/event",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify(payload),

          keepalive: true
        }
      ).catch(() => {});
    } catch (_) {}
  }


  function loadScript(src) {
    return new Promise(
      (resolve, reject) => {
        const script =
          document.createElement(
            "script"
          );

        script.src = src;
        script.async = true;

        script.onload =
          resolve;

        script.onerror =
          reject;

        document.head.appendChild(
          script
        );
      }
    );
  }


  async function initMeta() {
    if (
      !state.meta.length ||
      state.loaded.meta
    ) {
      return;
    }

    try {
      await loadScript(
        "https://connect.facebook.net/en_US/fbevents.js"
      );

      window.fbq =
        window.fbq ||
        function() {
          window.fbq.callMethod
            ? window.fbq.callMethod.apply(
                window.fbq,
                arguments
              )
            : window.fbq.queue.push(
                arguments
              );
        };

      window.fbq.push =
        window.fbq;

      window.fbq.loaded = true;
      window.fbq.version = "2.0";
      window.fbq.queue = [];


      const pixels =
        state.meta.filter(
          p =>
            p.enabled !== false
        );


      pixels.forEach(
        pixel => {
          window.fbq(
            "init",
            pixel.id
          );
        }
      );


      pixels.forEach(
        pixel => {
          const events =
            pixel.events ||
            [
              "pageview",
              "whatsapp_click",
              "form_submit"
            ];

          if (
            events.includes(
              "pageview"
            )
          ) {
            window.fbq(
              "track",
              "PageView"
            );
          }
        }
      );


      state.loaded.meta =
        true;

    } catch (_) {}
  }


  async function initTikTok() {
    if (
      !state.tiktok.length ||
      state.loaded.tiktok
    ) {
      return;
    }

    try {
      window.TiktokAnalyticsObject =
        "ttq";

      window.ttq =
        window.ttq || [];

      window.ttq.methods = [
        "page",
        "track",
        "identify",
        "instances",
        "debug",
        "on",
        "off",
        "once",
        "ready",
        "alias",
        "group",
        "enableCookie",
        "disableCookie",
        "holdConsent",
        "revokeConsent",
        "grantConsent"
      ];


      window.ttq.setAndDefer =
        function(t, e) {
          t[e] =
            function() {
              t.push(
                [
                  e,
                  ...Array.prototype.slice.call(
                    arguments
                  )
                ]
              );
            };
        };


      for (
        const method
        of window.ttq.methods
      ) {
        window.ttq.setAndDefer(
          window.ttq,
          method
        );
      }


      window.ttq.instance =
        function(id) {
          const instance =
            window.ttq._i[id] ||
            [];

          for (
            let i = 0;
            i <
            window.ttq.methods.length;
            i++
          ) {
            window.ttq.setAndDefer(
              instance,
              window.ttq.methods[i]
            );
          }

          return instance;
        };


      window.ttq.load =
        function(id, options) {
          const src =
            "https://analytics.tiktok.com/i18n/pixel/events.js";

          window.ttq._i =
            window.ttq._i || {};

          window.ttq._i[id] =
            [];

          window.ttq._i[id]._u =
            src;

          window.ttq._t =
            window.ttq._t || {};

          window.ttq._t[id] =
            +new Date();

          window.ttq._o =
            window.ttq._o || {};

          window.ttq._o[id] =
            options || {};


          const script =
            document.createElement(
              "script"
            );

          script.type =
            "text/javascript";

          script.async = true;

          script.src =
            src +
            "?sdkid=" +
            encodeURIComponent(id) +
            "&lib=ttq";


          const firstScript =
            document.getElementsByTagName(
              "script"
            )[0];


          if (firstScript) {
            firstScript.parentNode.insertBefore(
              script,
              firstScript
            );
          } else {
            document.head.appendChild(
              script
            );
          }
        };


      state.tiktok
        .filter(
          p =>
            p.enabled !== false
        )
        .forEach(
          p =>
            window.ttq.load(
              p.id
            )
        );


      state.loaded.tiktok =
        true;

    } catch (_) {}
  }


  function track(
    type,
    extra = {}
  ) {

    const metaEvent =
      type === "whatsapp_click"
        ? "Contact"
        : type === "form_submit"
          ? "Lead"
          : "PageView";


    state.meta
      .filter(
        p =>
          p.enabled !== false
      )
      .forEach(
        pixel => {

          const events =
            pixel.events ||
            [
              "pageview",
              "whatsapp_click",
              "form_submit"
            ];

          if (
            !events.includes(
              type
            )
          ) {
            return;
          }

          try {
            if (
              window.fbq
            ) {
              window.fbq(
                "track",
                metaEvent,
                extra
              );
            }
          } catch (_) {}
        }
      );


    state.tiktok
      .filter(
        p =>
          p.enabled !== false
      )
      .forEach(
        pixel => {

          const events =
            pixel.events ||
            [
              "pageview",
              "whatsapp_click",
              "form_submit"
            ];

          if (
            !events.includes(
              type
            )
          ) {
            return;
          }

          try {
            if (
              !window.ttq
            ) {
              return;
            }

            if (
              type === "pageview"
            ) {
              window.ttq.page();
            }

            else if (
              type ===
              "whatsapp_click"
            ) {
              window.ttq.track(
                "ClickButton",
                extra
              );
            }

            else if (
              type ===
              "form_submit"
            ) {
              window.ttq.track(
                "SubmitForm",
                extra
              );
            }

          } catch (_) {}
        }
      );


    postEvent(
      type,
      extra
    );
  }


  async function boot() {
    try {

      const response =
        await fetch(
          "/api/public/pixels",
          {
            cache:
              "no-store"
          }
        );


      if (
        !response.ok
      ) {
        return;
      }


      const config =
        await response.json();


      state.meta =
        Array.isArray(
          config.meta
        )
          ? config.meta
          : [];


      state.tiktok =
        Array.isArray(
          config.tiktok
        )
          ? config.tiktok
          : [];


      await Promise.all(
        [
          initMeta(),
          initTikTok()
        ]
      );


      /*
       IMPORTANT:
       Only send our own event here.
       Pixel initialization already sends
       the PageView to each enabled pixel.
      */

      postEvent(
        "pageview"
      );


      window.SulanPixel = {
        track
      };


      document.addEventListener(
        "click",
        event => {

          const target =
            event.target;

          if (
            !target ||
            !target.closest
          ) {
            return;
          }


          const element =
            target.closest(
              "a[href*='wa.me'],a[href*='whatsapp'],[data-whatsapp]"
            );


          if (!element) {
            return;
          }


          track(
            "whatsapp_click",
            {
              href:
                element.href ||
                "",

              text:
                (
                  element.textContent ||
                  ""
                )
                  .trim()
                  .slice(
                    0,
                    120
                  )
            }
          );
        },
        true
      );


      document.addEventListener(
        "submit",
        event => {

          const form =
            event.target;

          if (
            !form
          ) {
            return;
          }


          const isLeadForm =
            form.matches &&
            (
              form.matches(
                "[data-lead-form]"
              ) ||

              form.id ===
                "leadForm" ||

              form.querySelector &&
              form.querySelector(
                "input[name='email'],input[name='phone'],textarea"
              )
            );


          if (
            isLeadForm
          ) {
            track(
              "form_submit"
            );
          }
        },
        true
      );

    } catch (_) {}
  }


  boot();

})();
`;
}


/* =========================================================
   MAIN WORKER
========================================================= */

const worker: ExportedHandler<Env> = {

  async fetch(
    req: Request,
    env: Env
  ): Promise<Response> {

    const url =
      new URL(req.url);


    try {

      /* ===================================================
         HEALTH
      =================================================== */

      if (
        url.pathname ===
          "/api/health" &&
        req.method === "GET"
      ) {
        return handleHealth(
          env
        );
      }


      /* ===================================================
         PIXEL.JS
      =================================================== */

      if (
        url.pathname ===
          "/pixel.js" &&
        req.method === "GET"
      ) {
        return new Response(
          pixelJs(),
          {
            status: 200,

            headers: {
              "content-type":
                "application/javascript; charset=utf-8",

              "cache-control":
                "no-store",
            },
          }
        );
      }


      /* ===================================================
         LOGOUT
         Login is disabled, so logout simply returns
         to the dashboard.
      =================================================== */

      if (
        url.pathname ===
          "/api/logout"
      ) {
        return new Response(
          null,
          {
            status: 302,

            headers: {
              Location:
                "/admin/",

              "cache-control":
                "no-store",
            },
          }
        );
      }


      /* ===================================================
         PUBLIC API
      =================================================== */

      const publicApi =
        await handlePublicApi(
          req,
          env,
          url
        );

      if (
        publicApi
      ) {
        return publicApi;
      }


      /* ===================================================
         ADMIN API

         NO AUTHENTICATION
      =================================================== */

      if (
        url.pathname.startsWith(
          "/api/admin/"
        )
      ) {
        return handleAdminApi(
          req,
          env,
          url
        );
      }


      /* ===================================================
         ADMIN PAGES
      =================================================== */

      const adminPage =
        await handleAdminPage(
          req,
          env,
          url
        );

      if (
        adminPage
      ) {
        return adminPage;
      }


      /* ===================================================
         STATIC WEBSITE
      =================================================== */

      return serveAsset(
        req,
        env,
        url.pathname || "/"
      );

    } catch (error) {

      console.error(
        "WORKER_ERROR",
        error
      );


      const message =
        error instanceof Error
          ? error.message
          : "Internal server error";


      if (
        url.pathname.startsWith(
          "/api/"
        )
      ) {
        return json(
          {
            error:
              message,
          },
          500
        );
      }


      return text(
        "Internal server error",
        500
      );
    }
  },
};

export default worker;
