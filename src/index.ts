export interface Env {
  CONFIG_KV: KVNamespace;
  ADMIN_KV: KVNamespace;
  ASSETS: Fetcher;
}

type PixelKind = "meta" | "tiktok";

type EventName =
  | "pageview"
  | "view_content"
  | "lead"
  | "whatsapp_click";

type RoutingMode = "single" | "round_robin";

interface PixelConfig {
  id: string;
  name: string;
  enabled: boolean;
  events: EventName[];
}

interface WhatsAppNumber {
  id: number;
  label: string;
  number: string;
  active: boolean;
  is_default: boolean;
}

interface FormField {
  enabled: boolean;
  required: boolean;
}

interface AppConfig {
  version: number;
  updated_at: string;
  form_enabled: boolean;
  routing_mode: RoutingMode;
  next_index: number;

  pixels: {
    meta: PixelConfig[];
    tiktok: PixelConfig[];
  };

  form_fields: Record<string, FormField>;
}

interface Stats {
  page_views: number;
  whatsapp_clicks: number;
  form_submissions: number;
}

const CONFIG_KEY = "config";
const WHATSAPP_KEY = "whatsapp";
const STATS_KEY = "stats";

const EVENT_PREFIX = "event:";
const LEAD_PREFIX = "lead:";
const DEDUPE_PREFIX = "dedupe:";

const DEFAULT_EVENTS: EventName[] = [
  "pageview",
  "whatsapp_click",
  "lead",
];

const DEFAULT_FORM_FIELDS: Record<string, FormField> = {
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


/* =========================================================
   Response helpers
   ========================================================= */

function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store, no-cache, must-revalidate",

        "pragma": "no-cache",

        ...extra,
      },
    }
  );
}

function text(
  body: string,
  status = 200,
  extra: Record<string, string> = {}
): Response {
  return new Response(body, {
    status,

    headers: {
      "content-type":
        "text/plain; charset=utf-8",

      "cache-control":
        "no-store, no-cache, must-revalidate",

      "pragma": "no-cache",

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

async function readJson(
  req: Request
): Promise<Record<string, any>> {
  const contentType =
    req.headers.get("content-type") || "";

  if (
    contentType
      .toLowerCase()
      .includes("application/json")
  ) {
    try {
      const body = await req.json();

      if (
        body &&
        typeof body === "object" &&
        !Array.isArray(body)
      ) {
        return body as Record<string, any>;
      }

      return {};
    } catch {
      return {};
    }
  }

  try {
    const form = await req.formData();

    const output: Record<string, any> = {};

    for (const [key, value] of form.entries()) {
      output[key] =
        typeof value === "string"
          ? value
          : "";
    }

    return output;
  } catch {
    return {};
  }
}

function boolValue(
  value: any,
  fallback = false
): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized =
    String(value)
      .trim()
      .toLowerCase();

  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  return fallback;
}

function uniqueStrings(value: any): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => String(item).trim())
        .filter(Boolean)
    ),
  ];
}


/* =========================================================
   Pixel helpers
   ========================================================= */

function normalizeEvents(
  value: any
): EventName[] {
  const allowed = new Set<EventName>([
    "pageview",
    "view_content",
    "lead",
    "whatsapp_click",
  ]);

  const raw = uniqueStrings(value);

  const result = raw.filter(
    (item): item is EventName =>
      allowed.has(item as EventName)
  );

  if (result.length > 0) {
    return result;
  }

  return [...DEFAULT_EVENTS];
}

function normalizePixels(
  value: any
): PixelConfig[] {
  if (Array.isArray(value)) {
    return value
      .map(
        (
          item: any,
          index: number
        ) => {
          if (
            typeof item === "string"
          ) {
            const id =
              item.trim();

            if (!id) {
              return null;
            }

            return {
              id,

              name:
                `Pixel ${index + 1}`,

              enabled: true,

              events:
                [...DEFAULT_EVENTS],
            };
          }

          if (
            !item ||
            typeof item !== "object"
          ) {
            return null;
          }

          const id =
            String(
              item.id ??
              item.pixel_id ??
              item.pixelId ??
              ""
            ).trim();

          if (!id) {
            return null;
          }

          return {
            id,

            name:
              String(
                item.name ??
                `Pixel ${index + 1}`
              ),

            enabled:
              item.enabled !== false,

            events:
              normalizeEvents(
                item.events
              ),
          };
        }
      )
      .filter(Boolean) as PixelConfig[];
  }

  if (
    value &&
    typeof value === "object"
  ) {
    return Object.entries(value)
      .map(
        ([id, item]: [
          string,
          any
        ]) => ({
          id: id.trim(),

          name:
            String(
              item?.name ??
              "Pixel"
            ),

          enabled:
            item?.enabled !== false,

          events:
            normalizeEvents(
              item?.events
            ),
        })
      )
      .filter(
        (item) => !!item.id
      );
  }

  return [];
}


/* =========================================================
   Config
   ========================================================= */

function cloneDefaultFields() {
  return JSON.parse(
    JSON.stringify(
      DEFAULT_FORM_FIELDS
    )
  ) as Record<
    string,
    FormField
  >;
}

function defaultConfig(): AppConfig {
  return {
    version: 1,

    updated_at:
      new Date().toISOString(),

    form_enabled: true,

    routing_mode: "single",

    next_index: 0,

    pixels: {
      meta: [],
      tiktok: [],
    },

    form_fields:
      cloneDefaultFields(),
  };
}

function normalizeFormFields(
  value: any
): Record<string, FormField> {
  const output =
    cloneDefaultFields();

  if (
    !value ||
    typeof value !== "object"
  ) {
    return output;
  }

  for (
    const key of Object.keys(output)
  ) {
    const incoming =
      value[key];

    if (
      !incoming ||
      typeof incoming !== "object"
    ) {
      continue;
    }

    if (
      incoming.enabled !== undefined
    ) {
      output[key].enabled =
        boolValue(
          incoming.enabled,
          output[key].enabled
        );
    }

    if (
      incoming.required !== undefined
    ) {
      output[key].required =
        boolValue(
          incoming.required,
          output[key].required
        );
    }
  }

  return output;
}

async function getConfig(
  env: Env
): Promise<AppConfig> {
  const raw =
    (await env.CONFIG_KV.get(
      CONFIG_KEY,
      "json"
    )) as any;

  const base =
    defaultConfig();

  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return base;
  }

  const routingMode =
    raw.routing_mode ??
    raw.routingMode;

  return {
    version:
      Number(
        raw.version ??
        base.version
      ),

    updated_at:
      String(
        raw.updated_at ??
        raw.updatedAt ??
        base.updated_at
      ),

    form_enabled:
      boolValue(
        raw.form_enabled ??
          raw.formEnabled,
        true
      ),

    routing_mode:
      routingMode ===
        "round_robin"
        ? "round_robin"
        : "single",

    next_index:
      Math.max(
        0,
        Number(
          raw.next_index ??
          raw.nextIndex ??
          0
        )
      ),

    pixels: {
      meta:
        normalizePixels(
          raw.pixels?.meta ??
            raw.meta_pixels ??
            raw.metaPixels ??
            []
        ),

      tiktok:
        normalizePixels(
          raw.pixels?.tiktok ??
            raw.tiktok_pixels ??
            raw.tiktokPixels ??
            []
        ),
    },

    form_fields:
      normalizeFormFields(
        raw.form_fields ??
          raw.formFields
      ),
  };
}

async function saveConfig(
  env: Env,
  config: AppConfig
): Promise<AppConfig> {
  const next: AppConfig = {
    ...config,

    version:
      Number(config.version || 0) +
      1,

    updated_at:
      new Date().toISOString(),
  };

  await env.CONFIG_KV.put(
    CONFIG_KEY,
    JSON.stringify(next)
  );

  return next;
}


/* =========================================================
   WhatsApp
   ========================================================= */

function normalizePhone(
  value: any
): string {
  return String(
    value ?? ""
  ).replace(/[^\d]/g, "");
}

function waUrl(
  number: string,
  message = ""
): string {
  const clean =
    normalizePhone(number);

  const base =
    `https://wa.me/${clean}`;

  if (!message) {
    return base;
  }

  return (
    `${base}?text=` +
    encodeURIComponent(message)
  );
}

async function getWhatsApp(
  env: Env
): Promise<WhatsAppNumber[]> {
  const raw =
    (await env.CONFIG_KV.get(
      WHATSAPP_KEY,
      "json"
    )) as any;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map(
      (
        item: any,
        index: number
      ) => ({
        id:
          Number(
            item.id ??
            index + 1
          ),

        label:
          String(
            item.label ??
            `WhatsApp ${index + 1}`
          ),

        number:
          normalizePhone(
            item.number ??
              item.phone ??
              ""
          ),

        active:
          item.active !== false,

        is_default:
          boolValue(
            item.is_default ??
              item.isDefault,
            false
          ),
      })
    )
    .filter(
      (item) =>
        !!item.number
    );
}

async function saveWhatsApp(
  env: Env,
  list: WhatsAppNumber[]
): Promise<WhatsAppNumber[]> {
  const cleaned =
    list
      .map(
        (item, index) => ({
          id:
            Number(
              item.id ??
              Date.now() +
                index
            ),

          label:
            String(
              item.label ??
              `WhatsApp ${index + 1}`
            ),

          number:
            normalizePhone(
              item.number
            ),

          active:
            item.active !== false,

          is_default:
            !!item.is_default,
        })
      )
      .filter(
        (item) =>
          !!item.number
      );

  const active =
    cleaned.filter(
      (item) =>
        item.active
    );

  let defaultId:
    number | null = null;

  const existingDefault =
    active.find(
      (item) =>
        item.is_default
    );

  if (existingDefault) {
    defaultId =
      existingDefault.id;
  } else if (active[0]) {
    defaultId =
      active[0].id;
  }

  const normalized =
    cleaned.map(
      (item) => ({
        ...item,

        is_default:
          item.active &&
          item.id === defaultId,
      })
    );

  await env.CONFIG_KV.put(
    WHATSAPP_KEY,
    JSON.stringify(normalized)
  );

  return normalized;
}


/* =========================================================
   Stats
   ========================================================= */

async function getStats(
  env: Env
): Promise<Stats> {
  const raw =
    (await env.ADMIN_KV.get(
      STATS_KEY,
      "json"
    )) as any;

  return {
    page_views:
      Number(
        raw?.page_views ??
          raw?.pageViews ??
          0
      ),

    whatsapp_clicks:
      Number(
        raw?.whatsapp_clicks ??
          raw?.whatsappClicks ??
          0
      ),

    form_submissions:
      Number(
        raw?.form_submissions ??
          raw?.formSubmissions ??
          0
      ),
  };
}

async function incrementStat(
  env: Env,
  key: keyof Stats
) {
  const stats =
    await getStats(env);

  stats[key] =
    Number(stats[key] || 0) +
    1;

  await env.ADMIN_KV.put(
    STATS_KEY,
    JSON.stringify(stats)
  );

  return stats;
}


/* =========================================================
   Event / Lead storage
   ========================================================= */

async function saveEvent(
  env: Env,
  input: Record<string, any>
): Promise<{
  event: Record<string, any>;
  duplicate: boolean;
}> {
  const suppliedId =
    String(
      input.event_id ??
        input.eventId ??
        ""
    ).trim();

  const eventId =
    suppliedId ||
    crypto.randomUUID();

  if (suppliedId) {
    const dedupeKey =
      `${DEDUPE_PREFIX}${suppliedId}`;

    const existing =
      await env.ADMIN_KV.get(
        dedupeKey
      );

    if (existing) {
      const old =
        await env.ADMIN_KV.get(
          `${EVENT_PREFIX}${existing}`,
          "json"
        );

      return {
        event:
          old ||
          {
            id: suppliedId,
            event_id:
              suppliedId,
          },

        duplicate: true,
      };
    }
  }

  const type =
    String(
      input.type ??
        "event"
    ).toLowerCase();

  const createdAt =
    new Date().toISOString();

  const event = {
    ...input,

    id: eventId,

    event_id:
      eventId,

    type,

    created_at:
      createdAt,
  };

  const eventKey =
    `${EVENT_PREFIX}${createdAt}:${eventId}`;

  await env.ADMIN_KV.put(
    eventKey,
    JSON.stringify(event),
    {
      expirationTtl:
        60 * 60 * 24 * 180,
    }
  );

  if (suppliedId) {
    await env.ADMIN_KV.put(
      `${DEDUPE_PREFIX}${suppliedId}`,
      `${createdAt}:${eventId}`,
      {
        expirationTtl:
          60 * 60 * 24 * 180,
      }
    );
  }

  if (
    type === "pageview"
  ) {
    await incrementStat(
      env,
      "page_views"
    );
  }

  if (
    type ===
    "whatsapp_click"
  ) {
    await incrementStat(
      env,
      "whatsapp_clicks"
    );
  }

  if (
    type === "lead" ||
    type === "form_submit"
  ) {
    await incrementStat(
      env,
      "form_submissions"
    );
  }

  return {
    event,
    duplicate: false,
  };
}

async function saveLead(
  env: Env,
  body: Record<string, any>,
  eventId: string
) {
  const id =
    crypto.randomUUID();

  const createdAt =
    new Date().toISOString();

  const lead = {
    ...body,

    id,

    event_id:
      eventId,

    created_at:
      createdAt,

    status:
      "new",
  };

  await env.ADMIN_KV.put(
    `${LEAD_PREFIX}${createdAt}:${id}`,
    JSON.stringify(lead),
    {
      expirationTtl:
        60 * 60 * 24 * 365,
    }
  );

  return lead;
}

async function listByPrefix(
  env: Env,
  prefix: string,
  limit = 500
): Promise<any[]> {
  const listed =
    await env.ADMIN_KV.list({
      prefix,
      limit,
    });

  const rows: any[] = [];

  for (
    const key of listed.keys
  ) {
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
        b.created_at ?? ""
      ).localeCompare(
        String(
          a.created_at ?? ""
        )
      )
  );

  return rows.slice(
    0,
    limit
  );
}

async function listEvents(
  env: Env,
  limit = 500
) {
  return listByPrefix(
    env,
    EVENT_PREFIX,
    limit
  );
}

async function listLeads(
  env: Env,
  limit = 500
) {
  return listByPrefix(
    env,
    LEAD_PREFIX,
    limit
  );
}


/* =========================================================
   Asset routing
   ========================================================= */

async function serveAsset(
  req: Request,
  env: Env,
  requestedPath: string
): Promise<Response> {
  if (
    !env.ASSETS ||
    typeof env.ASSETS.fetch !==
      "function"
  ) {
    return text(
      "ASSETS binding is not configured.",
      500
    );
  }

  const incoming =
    new URL(req.url);

  let cleanPath =
    requestedPath || "/";

  if (
    !cleanPath.startsWith("/")
  ) {
    cleanPath =
      "/" + cleanPath;
  }

  /*
   * Admin entry points.
   *
   * There is intentionally NO authentication
   * during the current development stage.
   */
  if (
  cleanPath === "/admin" ||
  cleanPath === "/admin/" ||
  cleanPath === "/admin/login"
) {
  cleanPath = "/admin/";
}

  /*
   * Some deployments keep the admin file directly
   * under /public/admin/.
   */

  /*
   * Prevent accidental asset routing errors
   * caused by malformed paths.
   */
  if (
    cleanPath === "" ||
    cleanPath === "//"
  ) {
    cleanPath = "/";
  }

  const target =
    new URL(
      cleanPath,
      incoming.origin
    );

  target.search =
    incoming.search;

  const isBodyMethod =
    req.method !== "GET" &&
    req.method !== "HEAD";

  const assetRequest =
    new Request(
      target.toString(),
      {
        method:
          req.method,

        headers:
          req.headers,

        body:
          isBodyMethod
            ? req.body
            : undefined,

        redirect:
          "manual",
      }
    );

  try {
    const response =
      await env.ASSETS.fetch(
        assetRequest
      );

    /*
     * If an admin entry asset is not found,
     * provide a useful response instead of
     * allowing confusing routing behavior.
     */
    if (
      response.status === 404 &&
      cleanPath ===
        "/admin/index.html"
    ) {
      return text(
        "Admin asset not found: /admin/index.html",
        404
      );
    }

    return response;
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
   Health
   ========================================================= */

async function handleHealth(
  env: Env
) {
  let configOk = false;
  let adminOk = false;

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

    adminOk = true;
  } catch (error) {
    console.error(
      "ADMIN_KV_HEALTH_ERROR",
      error
    );
  }

  const assetsOk =
    !!env.ASSETS &&
    typeof env.ASSETS.fetch ===
      "function";

  const ok =
    configOk &&
    adminOk &&
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
          adminOk,

        ASSETS:
          assetsOk,
      },
    },

    ok
      ? 200
      : 503
  );
}


/* =========================================================
   Public API
   ========================================================= */

async function handlePublicApi(
  req: Request,
  env: Env,
  url: URL
): Promise<Response | null> {

  /*
   * Public config
   */
  if (
    url.pathname ===
      "/api/public/config" &&
    req.method === "GET"
  ) {
    const config =
      await getConfig(env);

    const whatsapp =
      await getWhatsApp(env);

    return json({
      form_enabled:
        config.form_enabled,

      form_fields:
        config.form_fields,

      routing_mode:
        config.routing_mode,

      pixels:
        config.pixels,

      whatsapp:
        whatsapp.filter(
          (item) =>
            item.active
        ),

      version:
        config.version,

      updated_at:
        config.updated_at,
    });
  }


  /*
   * Public pixels
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
          (item) =>
            item.enabled
        ),

      tiktok:
        config.pixels.tiktok.filter(
          (item) =>
            item.enabled
        ),
    });
  }


  /*
   * Public WhatsApp
   */
  if (
    url.pathname ===
      "/api/whatsapp" &&
    req.method === "GET"
  ) {
    const config =
      await getConfig(env);

    const numbers =
      (
        await getWhatsApp(env)
      ).filter(
        (item) =>
          item.active
      );

    const selected =
      numbers.find(
        (item) =>
          item.is_default
      ) ??
      numbers[0] ??
      null;

    return json({
      routing_mode:
        config.routing_mode,

      number:
        selected?.number ??
        null,

      numbers,
    });
  }


  /*
   * =======================================================
   * IMPORTANT:
   *
   * /go/whatsapp is the real public navigation endpoint.
   *
   * This fixes the previous 404 problem.
   * =======================================================
   */
  if (
    url.pathname ===
      "/go/whatsapp" &&
    (
      req.method === "GET" ||
      req.method === "HEAD"
    )
  ) {
    const config =
      await getConfig(env);

    const active =
      (
        await getWhatsApp(env)
      ).filter(
        (item) =>
          item.active &&
          !!item.number
      );

    if (!active.length) {
      return text(
        "WhatsApp is not configured.",
        503
      );
    }

    let selected:
      WhatsAppNumber;

    if (
      config.routing_mode ===
      "round_robin"
    ) {
      const currentIndex =
        Math.max(
          0,
          Number(
            config.next_index || 0
          )
        );

      const index =
        currentIndex %
        active.length;

      selected =
        active[index];

      const nextConfig:
        AppConfig = {
        ...config,

        next_index:
          (index + 1) %
          active.length,
      };

      /*
       * Persist the next index.
       *
       * KV is not an atomic counter, but this is
       * deterministic for normal traffic.
       */
      await saveConfig(
        env,
        nextConfig
      );
    } else {
      selected =
        active.find(
          (item) =>
            item.is_default
        ) ??
        active[0];
    }

    const message =
      url.searchParams.get(
        "text"
      ) ??
      url.searchParams.get(
        "message"
      ) ??
      "";

    const eventId =
      url.searchParams.get(
        "event_id"
      ) ??
      crypto.randomUUID();

    await saveEvent(
      env,
      {
        event_id:
          eventId,

        type:
          "whatsapp_click",

        number:
          selected.number,

        label:
          selected.label,

        path:
          url.pathname,

        referrer:
          req.headers.get(
            "Referer"
          ) || "",

        source:
          url.searchParams.get(
            "utm_source"
          ) || "",

        campaign:
          url.searchParams.get(
            "utm_campaign"
          ) || "",

        adset:
          url.searchParams.get(
            "utm_adset"
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

    /*
     * HEAD does not need a body,
     * but browsers normally use GET.
     */
    if (
      req.method === "HEAD"
    ) {
      return new Response(
        null,
        {
          status: 302,

          headers: {
            Location:
              waUrl(
                selected.number,
                message
              ),

            "cache-control":
              "no-store",
          },
        }
      );
    }

    return new Response(
      null,
      {
        status: 302,

        headers: {
          Location:
            waUrl(
              selected.number,
              message
            ),

          "cache-control":
            "no-store",

          "Referrer-Policy":
            "no-referrer-when-downgrade",
        },
      }
    );
  }


  /*
   * Backward-compatible redirect endpoint.
   */
  if (
    url.pathname ===
      "/api/whatsapp/redirect" &&
    (
      req.method === "GET" ||
      req.method === "POST"
    )
  ) {
    const redirectUrl =
      new URL(url.toString());

    redirectUrl.pathname =
      "/go/whatsapp";

    return new Response(
      null,
      {
        status: 302,

        headers: {
          Location:
            redirectUrl.toString(),

          "cache-control":
            "no-store",
        },
      }
    );
  }


  /*
   * Event endpoints
   */
  const eventPaths =
    new Set([
      "/api/event",
      "/api/pageview",
      "/api/whatsapp-click",
      "/api/form-submit",
      "/api/lead",
    ]);

  if (
    eventPaths.has(
      url.pathname
    ) &&
    req.method === "POST"
  ) {
    const body =
      await readJson(req);

    let type =
      String(
        body.type ??
          "event"
      ).toLowerCase();

    if (
      url.pathname ===
      "/api/pageview"
    ) {
      type =
        "pageview";
    }

    if (
      url.pathname ===
      "/api/whatsapp-click"
    ) {
      type =
        "whatsapp_click";
    }

    if (
      url.pathname ===
        "/api/form-submit" ||
      url.pathname ===
        "/api/lead"
    ) {
      type =
        "lead";
    }

    /*
     * FORM SWITCH:
     *
     * This is now enforced server-side.
     *
     * Even if somebody manually POSTs /api/lead,
     * disabled form means no lead will be created.
     */
    if (
      type === "lead"
    ) {
      const config =
        await getConfig(env);

      if (
        config.form_enabled ===
        false
      ) {
        return json(
          {
            ok: false,

            error:
              "Form is currently disabled.",
          },

          403
        );
      }
    }

    const eventId =
      String(
        body.event_id ??
          body.eventId ??
          ""
      ).trim() ||
      crypto.randomUUID();

    const result =
      await saveEvent(
        env,
        {
          ...body,

          event_id:
            eventId,

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
      !result.duplicate &&
      type === "lead"
    ) {
      await saveLead(
        env,
        body,
        eventId
      );
    }

    return json({
      ok: true,

      duplicate:
        result.duplicate,

      event_id:
        eventId,
    });
  }

  return null;
}


/* =========================================================
   Admin config update helpers
   ========================================================= */

function applySettings(
  config: AppConfig,
  body: Record<string, any>
): AppConfig {
  const formEnabled =
    body.form_enabled ??
    body.formEnabled ??
    body.enabled;

  if (
    formEnabled !== undefined
  ) {
    config.form_enabled =
      boolValue(
        formEnabled,
        config.form_enabled
      );
  }

  const routing =
    body.routing_mode ??
    body.routingMode;

  if (
    routing === "single" ||
    routing === "round_robin"
  ) {
    config.routing_mode =
      routing;
  }

  const fields =
    body.form_fields ??
    body.formFields;

  if (
    fields &&
    typeof fields === "object"
  ) {
    config.form_fields =
      normalizeFormFields(
        fields
      );
  }

  return config;
}


/* =========================================================
   Admin API
   ========================================================= */

async function handleAdminApi(
  req: Request,
  env: Env,
  url: URL
): Promise<Response> {

  /*
   * =======================================================
   * CONFIG GET
   * =======================================================
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
   * CONFIG POST/PATCH
   *
   * Added for compatibility with
   * different versions of admin UI.
   */
  if (
    url.pathname ===
      "/api/admin/config" &&
    (
      req.method === "POST" ||
      req.method === "PATCH"
    )
  ) {
    const body =
      await readJson(req);

    const current =
      await getConfig(env);

    applySettings(
      current,
      body
    );

    /*
     * Optional complete pixel replacement.
     */
    if (
      body.pixels &&
      typeof body.pixels ===
        "object"
    ) {
      if (
        body.pixels.meta !==
        undefined
      ) {
        current.pixels.meta =
          normalizePixels(
            body.pixels.meta
          );
      }

      if (
        body.pixels.tiktok !==
        undefined
      ) {
        current.pixels.tiktok =
          normalizePixels(
            body.pixels.tiktok
          );
      }
    }

    return json(
      await saveConfig(
        env,
        current
      )
    );
  }


  /*
   * SETTINGS GET
   */
  if (
    url.pathname ===
      "/api/admin/settings" &&
    req.method === "GET"
  ) {
    const config =
      await getConfig(env);

    return json({
      form_enabled:
        config.form_enabled,

      formEnabled:
        config.form_enabled,

      routing_mode:
        config.routing_mode,

      routingMode:
        config.routing_mode,

      form_fields:
        config.form_fields,

      formFields:
        config.form_fields,

      version:
        config.version,

      updated_at:
        config.updated_at,
    });
  }


  /*
   * SETTINGS POST/PATCH
   */
  if (
    url.pathname ===
      "/api/admin/settings" &&
    (
      req.method === "POST" ||
      req.method === "PATCH"
    )
  ) {
    const body =
      await readJson(req);

    const current =
      await getConfig(env);

    applySettings(
      current,
      body
    );

    return json(
      await saveConfig(
        env,
        current
      )
    );
  }


  /*
   * STATS
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
        views > 0
          ? Number(
              (
                (stats.whatsapp_clicks /
                  views) *
                100
              ).toFixed(2)
            )
          : 0,
    });
  }


  /*
   * EVENTS
   */
  if (
    url.pathname ===
      "/api/admin/events" &&
    req.method === "GET"
  ) {
    const limit =
      Math.min(
        500,

        Math.max(
          1,

          Number(
            url.searchParams.get(
              "limit"
            ) || 200
          )
        )
      );

    return json(
      await listEvents(
        env,
        limit
      )
    );
  }


  /*
   * LEADS
   */
  if (
    url.pathname ===
      "/api/admin/leads" &&
    req.method === "GET"
  ) {
    const limit =
      Math.min(
        500,

        Math.max(
          1,

          Number(
            url.searchParams.get(
              "limit"
            ) || 200
          )
        )
      );

    return json(
      await listLeads(
        env,
        limit
      )
    );
  }


  /*
   * UPDATE LEAD
   */
  if (
    url.pathname.startsWith(
      "/api/admin/leads/"
    ) &&
    req.method === "PATCH"
  ) {
    const id =
      decodeURIComponent(
        url.pathname.slice(
          "/api/admin/leads/"
            .length
        )
      );

    const body =
      await readJson(req);

    const leads =
      await listLeads(
        env,
        500
      );

    const lead =
      leads.find(
        (item) =>
          String(item.id) ===
          id
      );

    if (!lead) {
      return json(
        {
          error:
            "Lead not found.",
        },
        404
      );
    }

    const statuses =
      new Set([
        "new",
        "contacted",
        "qualified",
        "won",
        "lost",
      ]);

    if (
      body.status !==
        undefined &&
      statuses.has(
        String(body.status)
      )
    ) {
      lead.status =
        String(
          body.status
        );
    }

    if (
      body.notes !==
        undefined
    ) {
      lead.notes =
        String(
          body.notes
        );
    }

    await env.ADMIN_KV.put(
      `${LEAD_PREFIX}${lead.created_at}:${lead.id}`,
      JSON.stringify(lead),
      {
        expirationTtl:
          60 * 60 * 24 * 365,
      }
    );

    return json(lead);
  }


  /*
   * CSV
   */
  if (
    url.pathname ===
      "/api/admin/leads.csv" &&
    req.method === "GET"
  ) {
    const leads =
      await listLeads(
        env,
        500
      );

    const header = [
      "id",
      "created_at",
      "status",
      "name",
      "email",
      "whatsapp",
      "company",
      "country",
      "message",
      "source",
      "campaign",
      "adset",
    ];

    const escapeCsv =
      (value: any) =>
        `"${String(
          value ?? ""
        ).replace(
          /"/g,
          '""'
        )}"`;

    const lines = [
      header.join(","),
    ];

    for (
      const lead of leads
    ) {
      lines.push(
        header
          .map(
            (key) =>
              escapeCsv(
                lead[key]
              )
          )
          .join(",")
      );
    }

    return new Response(
      lines.join("\n"),
      {
        status: 200,

        headers: {
          "content-type":
            "text/csv; charset=utf-8",

          "content-disposition":
            'attachment; filename="sulan-leads.csv"',

          "cache-control":
            "no-store",
        },
      }
    );
  }


  /* =======================================================
     WHATSAPP ADMIN
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


  /*
   * Add / update WhatsApp
   */
  if (
    url.pathname ===
      "/api/admin/whatsapp" &&
    (
      req.method === "POST" ||
      req.method === "PUT"
    )
  ) {
    const body =
      await readJson(req);

    const list =
      await getWhatsApp(env);

    const rawId =
      body.id ??
      body.whatsapp_id;

    const id =
      rawId !== undefined &&
      rawId !== null &&
      String(rawId).trim()
        ? Number(rawId)
        : Date.now();

    const number =
      normalizePhone(
        body.number ??
          body.phone ??
          body.whatsapp
      );

    if (!number) {
      return json(
        {
          error:
            "WhatsApp number is required.",
        },
        400
      );
    }

    const item:
      WhatsAppNumber = {
      id,

      label:
        String(
          body.label ??
            body.name ??
            "WhatsApp"
        ),

      number,

      active:
        body.active ===
        undefined
          ? true
          : boolValue(
              body.active,
              true
            ),

      is_default:
        boolValue(
          body.is_default ??
            body.isDefault ??
            false
        ),
    };

    const index =
      list.findIndex(
        (x) =>
          x.id === id
      );

    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...item,
      };
    } else {
      list.push(item);
    }

    if (
      item.is_default
    ) {
      for (
        const x of list
      ) {
        x.is_default =
          x.id === id;
      }
    }

    const saved =
      await saveWhatsApp(
        env,
        list
      );

    return json(
      saved.find(
        (x) =>
          x.id === id
      ) ?? item
    );
  }


  /*
   * PATCH WhatsApp
   */
  if (
    url.pathname.startsWith(
      "/api/admin/whatsapp/"
    ) &&
    req.method === "PATCH"
  ) {
    const id =
      Number(
        decodeURIComponent(
          url.pathname.slice(
            "/api/admin/whatsapp/"
              .length
          )
        )
      );

    const body =
      await readJson(req);

    const list =
      await getWhatsApp(env);

    const item =
      list.find(
        (x) =>
          x.id === id
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
        body.action ??
          ""
      ).trim();

    if (
      action === "delete"
    ) {
      await saveWhatsApp(
        env,
        list.filter(
          (x) =>
            x.id !== id
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
      for (
        const x of list
      ) {
        x.is_default =
          x.id === id;
      }

      item.active = true;
    }

    if (
      body.label !==
        undefined
    ) {
      item.label =
        String(
          body.label
        );
    }

    if (
      body.number !==
        undefined
    ) {
      item.number =
        normalizePhone(
          body.number
        );
    }

    if (
      body.phone !==
        undefined
    ) {
      item.number =
        normalizePhone(
          body.phone
        );
    }

    if (
      body.active !==
        undefined
    ) {
      item.active =
        boolValue(
          body.active,
          item.active
        );
    }

    if (
      body.is_default !==
        undefined ||
      body.isDefault !==
        undefined
    ) {
      item.is_default =
        boolValue(
          body.is_default ??
            body.isDefault,
          item.is_default
        );

      if (
        item.is_default
      ) {
        for (
          const x of list
        ) {
          x.is_default =
            x.id === id;
        }

        item.active = true;
      }
    }

    const saved =
      await saveWhatsApp(
        env,
        list
      );

    return json(
      saved.find(
        (x) =>
          x.id === id
      ) ?? item
    );
  }


  /* =======================================================
     PIXELS ADMIN
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


  /*
   * Add Pixel
   */
  if (
    url.pathname ===
      "/api/admin/pixels" &&
    (
      req.method === "POST" ||
      req.method === "PUT"
    )
  ) {
    const body =
      await readJson(req);

    const kind =
      String(
        body.kind ??
          body.type ??
          body.platform ??
          ""
      ).toLowerCase() as PixelKind;

    const pixelId =
      String(
        body.pixel_id ??
          body.pixelId ??
          body.id ??
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
        (item) =>
          item.id === pixelId
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
          body.name ??
            body.label ??
            "Pixel"
        ),

      enabled:
        body.enabled ===
        undefined
          ? true
          : boolValue(
              body.enabled,
              true
            ),

      events:
        normalizeEvents(
          body.events
        ),
    };

    list.push(item);

    const saved =
      await saveConfig(
        env,
        config
      );

    return json(
      saved.pixels[
        kind
      ].find(
        (x) =>
          x.id ===
          pixelId
      ) ?? item
    );
  }


  /*
   * Update / delete Pixel
   *
   * Supports:
   * PATCH /api/admin/pixels/:id
   *
   * body.kind = meta/tiktok
   */
  if (
    url.pathname.startsWith(
      "/api/admin/pixels/"
    ) &&
    req.method === "PATCH"
  ) {
    const pixelId =
      decodeURIComponent(
        url.pathname.slice(
          "/api/admin/pixels/"
            .length
        )
      );

    const body =
      await readJson(req);

    let kind =
      String(
        body.kind ??
          body.type ??
          ""
      ).toLowerCase() as PixelKind;

    const config =
      await getConfig(env);

    /*
     * If kind wasn't supplied,
     * search both platforms.
     */
    if (
      kind !== "meta" &&
      kind !== "tiktok"
    ) {
      if (
        config.pixels.meta.some(
          (x) =>
            x.id === pixelId
        )
      ) {
        kind = "meta";
      } else if (
        config.pixels.tiktok.some(
          (x) =>
            x.id === pixelId
        )
      ) {
        kind = "tiktok";
      } else {
        return json(
          {
            error:
              "Pixel not found.",
          },
          404
        );
      }
    }

    const list =
      config.pixels[kind];

    const index =
      list.findIndex(
        (x) =>
          x.id === pixelId
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
        body.action ??
          ""
      ).trim();

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
        !list[index].enabled;
    }

    if (
      action === "enable"
    ) {
      list[index].enabled =
        true;
    }

    if (
      action === "disable"
    ) {
      list[index].enabled =
        false;
    }

    if (
      body.enabled !==
        undefined
    ) {
      list[index].enabled =
        boolValue(
          body.enabled,
          list[index].enabled
        );
    }

    if (
      body.name !==
        undefined
    ) {
      list[index].name =
        String(
          body.name
        );
    }

    if (
      body.label !==
        undefined
    ) {
      list[index].name =
        String(
          body.label
        );
    }

    if (
      body.events !==
        undefined
    ) {
      list[index].events =
        normalizeEvents(
          body.events
        );
    }

    const saved =
      await saveConfig(
        env,
        config
      );

    return json(
      saved.pixels[
        kind
      ].find(
        (x) =>
          x.id ===
          pixelId
      )
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
   Pixel tracking JS
   ========================================================= */

function pixelJs(): string {
  return String.raw`
(() => {
  "use strict";

  const state = {
    meta: [],
    tiktok: [],
    config: null,
    ready: false
  };

  const EVENT_MAP = {
    pageview: {
      meta: "PageView",
      tiktok: "PageView"
    },

    view_content: {
      meta: "ViewContent",
      tiktok: "ViewContent"
    },

    lead: {
      meta: "Lead",
      tiktok: "SubmitForm"
    },

    whatsapp_click: {
      meta: "Contact",
      tiktok: "ClickButton"
    }
  };


  function makeEventId() {
    try {
      if (
        window.crypto &&
        typeof window.crypto.randomUUID === "function"
      ) {
        return window.crypto.randomUUID();
      }
    } catch (_) {}

    return (
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2)
    );
  }


  async function loadConfig() {
    const response =
      await fetch(
        "/api/public/config",
        {
          method: "GET",
          cache: "no-store"
        }
      );

    if (!response.ok) {
      throw new Error(
        "Unable to load public config."
      );
    }

    return response.json();
  }


  function loadScript(src) {
    return new Promise(
      (resolve, reject) => {
        const script =
          document.createElement(
            "script"
          );

        script.async = true;
        script.src = src;

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
      !state.meta.length
    ) {
      return;
    }

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

    window.fbq.loaded =
      true;

    window.fbq.version =
      "2.0";

    window.fbq.queue =
      [];

    try {
      await loadScript(
        "https://connect.facebook.net/en_US/fbevents.js"
      );
    } catch (_) {
      return;
    }

    for (
      const pixel of state.meta
    ) {
      try {
        window.fbq(
          "init",
          pixel.id
        );
      } catch (_) {}
    }
  }


  async function initTikTok() {
    if (
      !state.tiktok.length
    ) {
      return;
    }

    window.TiktokAnalyticsObject =
      "ttq";

    window.ttq =
      window.ttq ||
      [];

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
      function(
        target,
        method
      ) {
        target[method] =
          function() {
            target.push(
              [method].concat(
                Array.prototype.slice.call(
                  arguments,
                  0
                )
              )
            );
          };
      };

    for (
      const method of
        window.ttq.methods
    ) {
      window.ttq.setAndDefer(
        window.ttq,
        method
      );
    }

    window.ttq.instance =
      function(id) {
        window.ttq._i =
          window.ttq._i ||
          {};

        const instance =
          window.ttq._i[id] ||
          [];

        for (
          const method of
            window.ttq.methods
        ) {
          window.ttq.setAndDefer(
            instance,
            method
          );
        }

        return instance;
      };

    window.ttq.load =
      function(
        id,
        options
      ) {
        window.ttq._i =
          window.ttq._i ||
          {};

        window.ttq._i[id] =
          [];

        window.ttq._t =
          window.ttq._t ||
          {};

        window.ttq._t[id] =
          +new Date();

        window.ttq._o =
          window.ttq._o ||
          {};

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
          "https://analytics.tiktok.com/i18n/pixel/events.js" +
          "?sdkid=" +
          encodeURIComponent(id) +
          "&lib=ttq";

        const first =
          document.getElementsByTagName(
            "script"
          )[0];

        if (
          first &&
          first.parentNode
        ) {
          first.parentNode.insertBefore(
            script,
            first
          );
        } else {
          document.head.appendChild(
            script
          );
        }
      };

    for (
      const pixel of state.tiktok
    ) {
      try {
        window.ttq.load(
          pixel.id
        );
      } catch (_) {}
    }
  }


  async function track(
    type,
    extra = {}
  ) {
    const configEvent =
      EVENT_MAP[type];

    if (!configEvent) {
      return;
    }

    const eventId =
      extra.event_id ||
      makeEventId();

    /*
     * Meta
     */
    for (
      const pixel of state.meta
    ) {
      if (
        pixel.enabled !== false &&
        Array.isArray(pixel.events) &&
        pixel.events.includes(type) &&
        window.fbq
      ) {
        try {
          window.fbq(
            "trackSingle",
            pixel.id,
            configEvent.meta,
            extra
          );
        } catch (_) {}
      }
    }


    /*
     * TikTok
     */
    for (
      const pixel of state.tiktok
    ) {
      if (
        pixel.enabled !== false &&
        Array.isArray(pixel.events) &&
        pixel.events.includes(type) &&
        window.ttq
      ) {
        try {
          const instance =
            typeof window.ttq.instance ===
            "function"
              ? window.ttq.instance(
                  pixel.id
                )
              : window.ttq;

          if (
            type === "pageview"
          ) {
            instance.page();
          } else {
            instance.track(
              configEvent.tiktok,
              extra
            );
          }
        } catch (_) {}
      }
    }


    /*
     * Own event API
     */
    try {
      const params =
        new URLSearchParams(
          location.search
        );

      await fetch(
        "/api/event",
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          keepalive: true,

          body:
            JSON.stringify({
              ...extra,

              type,

              event_id:
                eventId,

              path:
                location.pathname,

              referrer:
                document.referrer ||
                "",

              source:
                params.get(
                  "utm_source"
                ) || "",

              campaign:
                params.get(
                  "utm_campaign"
                ) || "",

              adset:
                params.get(
                  "utm_adset"
                ) || ""
            })
        }
      );
    } catch (_) {}
  }


  function isWhatsAppLink(
    element
  ) {
    if (
      !element ||
      !element.closest
    ) {
      return false;
    }

    return !!element.closest(
      "a[href*='wa.me'],a[href*='whatsapp'],a[href*='/go/whatsapp'],a[href*='/api/whatsapp/redirect'],[data-whatsapp]"
    );
  }


  function bind() {
    /*
     * WhatsApp click tracking
     */
    document.addEventListener(
      "click",
      (event) => {
        const target =
          event.target;

        if (
          !isWhatsAppLink(
            target
          )
        ) {
          return;
        }

        const element =
          target.closest(
            "a[href*='wa.me'],a[href*='whatsapp'],a[href*='/go/whatsapp'],a[href*='/api/whatsapp/redirect'],[data-whatsapp]"
          );

        if (!element) {
          return;
        }

        /*
         * If navigation already goes through
         * our Worker, do not double-count here.
         */
        const href =
          element.getAttribute(
            "href"
          ) || "";

        if (
          href.includes(
            "/go/whatsapp"
          ) ||
          href.includes(
            "/api/whatsapp/redirect"
          )
        ) {
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


    /*
     * Lead form tracking
     */
    document.addEventListener(
      "submit",
      (event) => {
        const form =
          event.target;

        if (
          !form ||
          !form.matches
        ) {
          return;
        }

        const isLeadForm =
          form.matches(
            "[data-lead-form]"
          ) ||
          form.id ===
            "leadForm";

        if (
          !isLeadForm
        ) {
          return;
        }

        track(
          "lead"
        );
      },
      true
    );
  }


  function applyFormState(
    config
  ) {
    const forms =
      document.querySelectorAll(
        "[data-lead-form],#leadForm"
      );

    if (
      config.form_enabled ===
      false
    ) {
      forms.forEach(
        (form) => {
          form.style.display =
            "none";

          form.setAttribute(
            "data-sulan-form-disabled",
            "true"
          );
        }
      );

      return;
    }

    forms.forEach(
      (form) => {
        if (
          form.getAttribute(
            "data-sulan-form-disabled"
          ) === "true"
        ) {
          form.style.display =
            "";

          form.removeAttribute(
            "data-sulan-form-disabled"
          );
        }
      }
    );
  }


  async function boot() {
    try {
      const config =
        await loadConfig();

      state.config =
        config;

      state.meta =
        Array.isArray(
          config.pixels?.meta
        )
          ? config.pixels.meta.filter(
              (pixel) =>
                pixel.enabled !==
                false
            )
          : [];

      state.tiktok =
        Array.isArray(
          config.pixels?.tiktok
        )
          ? config.pixels.tiktok.filter(
              (pixel) =>
                pixel.enabled !==
                false
            )
          : [];


      await Promise.all([
        initMeta(),
        initTikTok()
      ]);


      state.ready =
        true;


      /*
       * Apply form switch BEFORE
       * sending pageview.
       */
      applyFormState(
        config
      );


      await track(
        "pageview"
      );


      bind();


      window.SulanPixel = {
        track,

        refresh: async function() {
          try {
            const next =
              await loadConfig();

            state.config =
              next;

            state.meta =
              Array.isArray(
                next.pixels?.meta
              )
                ? next.pixels.meta.filter(
                    (pixel) =>
                      pixel.enabled !==
                      false
                  )
                : [];

            state.tiktok =
              Array.isArray(
                next.pixels?.tiktok
              )
                ? next.pixels.tiktok.filter(
                    (pixel) =>
                      pixel.enabled !==
                      false
                  )
                : [];

            applyFormState(
              next
            );

            return next;
          } catch (_) {
            return null;
          }
        }
      };

    } catch (_) {
      /*
       * Tracking must NEVER break
       * the landing page.
       */
    }
  }


  /*
   * If the DOM is already ready,
   * start immediately.
   */
  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      {
        once: true
      }
    );
  } else {
    boot();
  }
})();
`;
}


/* =========================================================
   Admin page routing
   ========================================================= */

async function handleAdminPage(
  req: Request,
  env: Env,
  url: URL
): Promise<Response | null> {

  /*
   * Authentication is intentionally disabled.
   *
   * /admin
   * /admin/
   * /admin/login
   *
   * all point to the same dashboard.
   */
if (
  url.pathname === "/admin" ||
  url.pathname === "/admin/" ||
  url.pathname === "/admin/login"
) {
  return serveAsset(
    req,
    env,
    "/admin/"
  );
}

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
   Worker
   ========================================================= */

const worker:
  ExportedHandler<Env> = {

  async fetch(
    req: Request,
    env: Env
  ): Promise<Response> {

    const url =
      new URL(req.url);

    try {

      /*
       * -----------------------------------------------------
       * Health
       * -----------------------------------------------------
       */
      if (
        url.pathname ===
          "/api/health" &&
        req.method === "GET"
      ) {
        return handleHealth(
          env
        );
      }


      /*
       * -----------------------------------------------------
       * Pixel JS
       * -----------------------------------------------------
       */
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
                "no-store, no-cache, must-revalidate",

              "pragma":
                "no-cache",
            },
          }
        );
      }


      /*
       * -----------------------------------------------------
       * Logout compatibility
       *
       * No authentication exists now.
       * -----------------------------------------------------
       */
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


      /*
       * -----------------------------------------------------
       * Public API
       * -----------------------------------------------------
       */
      const publicResponse =
        await handlePublicApi(
          req,
          env,
          url
        );

      if (
        publicResponse
      ) {
        return publicResponse;
      }


      /*
       * -----------------------------------------------------
       * Admin API
       * -----------------------------------------------------
       */
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


      /*
       * -----------------------------------------------------
       * Admin pages
       * -----------------------------------------------------
       */
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


      /*
       * -----------------------------------------------------
       * Static assets / landing page
       * -----------------------------------------------------
       */
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
