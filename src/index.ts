export interface Env {
  CONFIG_KV: KVNamespace;
  ADMIN_KV: KVNamespace;
  ASSETS: Fetcher;
}

type PixelKind = "meta" | "tiktok";
type EventName = "pageview" | "view_content" | "lead" | "whatsapp_click";

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
  routing_mode: "single" | "round_robin";
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
  name: { enabled: true, required: true },
  email: { enabled: true, required: false },
  whatsapp: { enabled: true, required: true },
  company: { enabled: true, required: false },
  country: { enabled: true, required: false },
  message: { enabled: true, required: false },
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function text(body: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function noContent(status = 204) {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readJson(req: Request): Promise<Record<string, any>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const body = await req.json();
      return body && typeof body === "object" ? body : {};
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

function uniqueStrings(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((x) => String(x).trim()).filter(Boolean))];
}

function normalizeEvents(value: any): EventName[] {
  const allowed = new Set<EventName>([
    "pageview",
    "view_content",
    "lead",
    "whatsapp_click",
  ]);

  const raw = uniqueStrings(value);
  const result = raw.filter((x): x is EventName =>
    allowed.has(x as EventName)
  );

  return result.length ? result : [...DEFAULT_EVENTS];
}

function normalizePixels(value: any): PixelConfig[] {
  if (Array.isArray(value)) {
    return value
      .map((item: any, index: number) => {
        if (typeof item === "string") {
          const id = item.trim();
          return id
            ? {
                id,
                name: `Pixel ${index + 1}`,
                enabled: true,
                events: [...DEFAULT_EVENTS],
              }
            : null;
        }

        if (!item || typeof item !== "object") return null;

        const id = String(
          item.id ?? item.pixel_id ?? item.pixelId ?? ""
        ).trim();

        if (!id) return null;

        return {
          id,
          name: String(item.name ?? `Pixel ${index + 1}`),
          enabled: item.enabled !== false,
          events: normalizeEvents(item.events),
        };
      })
      .filter(Boolean) as PixelConfig[];
  }

  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([id, item]: [string, any]) => ({
        id: id.trim(),
        name: String(item?.name ?? "Pixel"),
        enabled: item?.enabled !== false,
        events: normalizeEvents(item?.events),
      }))
      .filter((x) => !!x.id);
  }

  return [];
}

function defaultConfig(): AppConfig {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    form_enabled: true,
    routing_mode: "single",
    next_index: 0,
    pixels: {
      meta: [],
      tiktok: [],
    },
    form_fields: structuredClone(DEFAULT_FORM_FIELDS),
  };
}

function normalizeFormFields(value: any): Record<string, FormField> {
  const out: Record<string, FormField> = structuredClone(DEFAULT_FORM_FIELDS);

  if (!value || typeof value !== "object") return out;

  for (const key of Object.keys(out)) {
    if (value[key] && typeof value[key] === "object") {
      if (value[key].enabled !== undefined) {
        out[key].enabled = !!value[key].enabled;
      }
      if (value[key].required !== undefined) {
        out[key].required = !!value[key].required;
      }
    }
  }

  return out;
}

async function getConfig(env: Env): Promise<AppConfig> {
  const raw = (await env.CONFIG_KV.get(CONFIG_KEY, "json")) as any;
  const base = defaultConfig();

  if (!raw || typeof raw !== "object") return base;

  return {
    version: Number(raw.version ?? base.version),
    updated_at: String(raw.updated_at ?? base.updated_at),
    form_enabled: raw.form_enabled ?? raw.formEnabled ?? true,
    routing_mode:
      raw.routing_mode === "round_robin" ||
      raw.routingMode === "round_robin"
        ? "round_robin"
        : "single",
    next_index: Math.max(0, Number(raw.next_index ?? 0)),
    pixels: {
      meta: normalizePixels(
        raw.pixels?.meta ??
          raw.meta_pixels ??
          raw.metaPixels ??
          []
      ),
      tiktok: normalizePixels(
        raw.pixels?.tiktok ??
          raw.tiktok_pixels ??
          raw.tiktokPixels ??
          []
      ),
    },
    form_fields: normalizeFormFields(raw.form_fields),
  };
}

async function saveConfig(env: Env, config: AppConfig) {
  const next = {
    ...config,
    version: Number(config.version || 0) + 1,
    updated_at: new Date().toISOString(),
  };

  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(next));
  return next;
}

function normalizePhone(value: string): string {
  return String(value || "").replace(/[^\d]/g, "");
}

function waUrl(number: string, message?: string): string {
  const clean = normalizePhone(number);
  const base = `https://wa.me/${clean}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

async function getWhatsApp(env: Env): Promise<WhatsAppNumber[]> {
  const raw = (await env.CONFIG_KV.get(WHATSAPP_KEY, "json")) as any;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item: any, index: number) => ({
      id: Number(item.id ?? index + 1),
      label: String(item.label ?? `WhatsApp ${index + 1}`),
      number: normalizePhone(item.number ?? item.phone ?? ""),
      active: item.active !== false,
      is_default: !!(item.is_default ?? item.isDefault),
    }))
    .filter((x) => !!x.number);
}

async function saveWhatsApp(
  env: Env,
  list: WhatsAppNumber[]
): Promise<WhatsAppNumber[]> {
  const active = list.filter((x) => x.active && x.number);

  let defaultId =
    active.find((x) => x.is_default)?.id ??
    active[0]?.id ??
    null;

  const normalized = list.map((x) => ({
    ...x,
    number: normalizePhone(x.number),
    is_default: x.active && x.id === defaultId,
  }));

  await env.CONFIG_KV.put(WHATSAPP_KEY, JSON.stringify(normalized));
  return normalized;
}

async function getStats(env: Env): Promise<Stats> {
  const raw = (await env.ADMIN_KV.get(STATS_KEY, "json")) as any;
  return {
    page_views: Number(raw?.page_views ?? raw?.pageViews ?? 0),
    whatsapp_clicks: Number(
      raw?.whatsapp_clicks ?? raw?.whatsappClicks ?? 0
    ),
    form_submissions: Number(
      raw?.form_submissions ?? raw?.formSubmissions ?? 0
    ),
  };
}

async function incrementStat(env: Env, key: keyof Stats) {
  // KV has no atomic increment primitive. This keeps the current design
  // compatible with KV while avoiding malformed counters.
  const stats = await getStats(env);
  stats[key] = Number(stats[key] || 0) + 1;
  await env.ADMIN_KV.put(STATS_KEY, JSON.stringify(stats));
  return stats;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function saveEvent(
  env: Env,
  input: Record<string, any>
): Promise<{ event: Record<string, any>; duplicate: boolean }> {
  const suppliedId = String(input.event_id ?? input.eventId ?? "").trim();
  const eventId = suppliedId || crypto.randomUUID();

  if (suppliedId) {
    const existing = await env.ADMIN_KV.get(
      `${DEDUPE_PREFIX}${suppliedId}`
    );
    if (existing) {
      const old = await env.ADMIN_KV.get(
        `${EVENT_PREFIX}${existing}`,
        "json"
      );
      return {
        event: old || { id: suppliedId },
        duplicate: true,
      };
    }
  }

  const type = String(input.type ?? "event").toLowerCase();
  const created_at = new Date().toISOString();

  const event = {
    ...input,
    id: eventId,
    event_id: eventId,
    type,
    created_at,
  };

  await env.ADMIN_KV.put(
    `${EVENT_PREFIX}${created_at}:${eventId}`,
    JSON.stringify(event),
    { expirationTtl: 60 * 60 * 24 * 180 }
  );

  if (suppliedId) {
    await env.ADMIN_KV.put(
      `${DEDUPE_PREFIX}${suppliedId}`,
      `${created_at}:${eventId}`,
      { expirationTtl: 60 * 60 * 24 * 180 }
    );
  }

  if (type === "pageview") await incrementStat(env, "page_views");
  if (type === "whatsapp_click") {
    await incrementStat(env, "whatsapp_clicks");
  }
  if (type === "lead" || type === "form_submit") {
    await incrementStat(env, "form_submissions");
  }

  return { event, duplicate: false };
}

async function saveLead(
  env: Env,
  body: Record<string, any>,
  eventId: string
) {
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();

  const lead = {
    ...body,
    id,
    event_id: eventId,
    created_at,
    status: "new",
  };

  await env.ADMIN_KV.put(
    `${LEAD_PREFIX}${created_at}:${id}`,
    JSON.stringify(lead),
    { expirationTtl: 60 * 60 * 24 * 365 }
  );

  return lead;
}

async function listByPrefix(
  env: Env,
  prefix: string,
  limit = 500
): Promise<any[]> {
  const listed = await env.ADMIN_KV.list({
    prefix,
    limit,
  });

  const rows: any[] = [];

  for (const key of listed.keys) {
    const value = await env.ADMIN_KV.get(key.name, "json");
    if (value) rows.push(value);
  }

  rows.sort((a, b) =>
    String(b.created_at ?? "").localeCompare(
      String(a.created_at ?? "")
    )
  );

  return rows.slice(0, limit);
}

async function listEvents(env: Env, limit = 500) {
  return listByPrefix(env, EVENT_PREFIX, limit);
}

async function listLeads(env: Env, limit = 500) {
  return listByPrefix(env, LEAD_PREFIX, limit);
}

async function serveAsset(
  req: Request,
  env: Env,
  path: string
): Promise<Response> {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return text("ASSETS binding is not configured.", 500);
  }

  const incoming = new URL(req.url);
  let cleanPath = path || "/";

  if (!cleanPath.startsWith("/")) cleanPath = `/${cleanPath}`;
  if (cleanPath === "/admin") cleanPath = "/admin/";

  const target = new URL(cleanPath, incoming.origin);
  target.search = incoming.search;

  const assetRequest = new Request(target.toString(), {
    method: req.method,
    headers: req.headers,
    body:
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : req.body,
    redirect: "follow",
  });

  try {
    return await env.ASSETS.fetch(assetRequest);
  } catch (error) {
    console.error("ASSETS_FETCH_ERROR", error);
    return text("Asset fetch failed.", 500);
  }
}

async function handleHealth(env: Env) {
  let configOk = false;
  let adminOk = false;

  try {
    await env.CONFIG_KV.get(CONFIG_KEY);
    configOk = true;
  } catch (e) {
    console.error("CONFIG_KV_HEALTH_ERROR", e);
  }

  try {
    await env.ADMIN_KV.get(STATS_KEY);
    adminOk = true;
  } catch (e) {
    console.error("ADMIN_KV_HEALTH_ERROR", e);
  }

  const assetsOk =
    !!env.ASSETS &&
    typeof env.ASSETS.fetch === "function";

  const ok = configOk && adminOk && assetsOk;

  return json(
    {
      ok,
      service: "sulan-peptide-worker",
      mode: "development-no-auth",
      timestamp: new Date().toISOString(),
      bindings: {
        CONFIG_KV: configOk,
        ADMIN_KV: adminOk,
        ASSETS: assetsOk,
      },
    },
    ok ? 200 : 503
  );
}

async function handlePublicApi(
  req: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (
    url.pathname === "/api/public/config" &&
    req.method === "GET"
  ) {
    const config = await getConfig(env);
    const whatsapp = await getWhatsApp(env);

    return json({
      form_enabled: config.form_enabled,
      form_fields: config.form_fields,
      routing_mode: config.routing_mode,
      pixels: config.pixels,
      whatsapp: whatsapp.filter((x) => x.active),
      version: config.version,
      updated_at: config.updated_at,
    });
  }

  if (
    url.pathname === "/api/public/pixels" &&
    req.method === "GET"
  ) {
    const config = await getConfig(env);

    return json({
      meta: config.pixels.meta.filter((x) => x.enabled),
      tiktok: config.pixels.tiktok.filter((x) => x.enabled),
    });
  }

  if (
    url.pathname === "/api/whatsapp" &&
    req.method === "GET"
  ) {
    const config = await getConfig(env);
    const list = (await getWhatsApp(env)).filter((x) => x.active);

    return json({
      routing_mode: config.routing_mode,
      number:
        list.find((x) => x.is_default)?.number ??
        list[0]?.number ??
        null,
      numbers: list,
    });
  }

  if (
    url.pathname === "/api/whatsapp/redirect" &&
    (req.method === "GET" || req.method === "POST")
  ) {
    const config = await getConfig(env);
    const list = (await getWhatsApp(env)).filter((x) => x.active);

    if (!list.length) {
      return text("WhatsApp is not configured.", 503);
    }

    let selected: WhatsAppNumber;

    if (config.routing_mode === "round_robin") {
      const index = config.next_index % list.length;
      selected = list[index];

      // Persist the next index. KV cannot guarantee strict atomicity,
      // but this provides deterministic round-robin behavior under normal traffic.
      const next = {
        ...config,
        next_index: (index + 1) % list.length,
      };
      await saveConfig(env, next);
    } else {
      selected =
        list.find((x) => x.is_default) ??
        list[0];
    }

    const incoming = new URL(req.url);
    const message =
      incoming.searchParams.get("text") ||
      incoming.searchParams.get("message") ||
      "";

    const eventId =
      incoming.searchParams.get("event_id") ||
      crypto.randomUUID();

    await saveEvent(env, {
      event_id: eventId,
      type: "whatsapp_click",
      number: selected.number,
      label: selected.label,
      path: incoming.pathname,
      source: incoming.searchParams.get("utm_source") || "",
      campaign: incoming.searchParams.get("utm_campaign") || "",
      adset: incoming.searchParams.get("utm_adset") || "",
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: waUrl(selected.number, message),
        "cache-control": "no-store",
      },
    });
  }

  const eventPaths = new Set([
    "/api/event",
    "/api/pageview",
    "/api/whatsapp-click",
    "/api/form-submit",
    "/api/lead",
  ]);

  if (
    eventPaths.has(url.pathname) &&
    req.method === "POST"
  ) {
    const body = await readJson(req);

    let type = String(body.type ?? "event").toLowerCase();

    if (url.pathname === "/api/pageview") type = "pageview";
    if (url.pathname === "/api/whatsapp-click") {
      type = "whatsapp_click";
    }
    if (
      url.pathname === "/api/form-submit" ||
      url.pathname === "/api/lead"
    ) {
      type = "lead";
    }

    const eventId =
      String(body.event_id ?? body.eventId ?? "").trim() ||
      crypto.randomUUID();

    const result = await saveEvent(env, {
      ...body,
      event_id: eventId,
      type,
      ip: req.headers.get("CF-Connecting-IP") || "",
      country: req.headers.get("CF-IPCountry") || "",
      user_agent: req.headers.get("User-Agent") || "",
    });

    if (!result.duplicate && type === "lead") {
      await saveLead(env, body, eventId);
    }

    return json({
      ok: true,
      duplicate: result.duplicate,
      event_id: eventId,
    });
  }

  return null;
}

async function handleAdminApi(
  req: Request,
  env: Env,
  url: URL
): Promise<Response> {
  if (
    url.pathname === "/api/admin/config" &&
    req.method === "GET"
  ) {
    return json(await getConfig(env));
  }

  if (
    url.pathname === "/api/admin/settings" &&
    req.method === "GET"
  ) {
    const config = await getConfig(env);
    return json({
      form_enabled: config.form_enabled,
      routing_mode: config.routing_mode,
      form_fields: config.form_fields,
      version: config.version,
      updated_at: config.updated_at,
    });
  }

  if (
    url.pathname === "/api/admin/settings" &&
    req.method === "POST"
  ) {
    const body = await readJson(req);
    const current = await getConfig(env);

    if (body.form_enabled !== undefined) {
      current.form_enabled = !!body.form_enabled;
    }

    if (
      body.routing_mode === "single" ||
      body.routing_mode === "round_robin"
    ) {
      current.routing_mode = body.routing_mode;
    }

    if (body.form_fields && typeof body.form_fields === "object") {
      current.form_fields = normalizeFormFields(body.form_fields);
    }

    return json(await saveConfig(env, current));
  }

  if (
    url.pathname === "/api/admin/stats" &&
    req.method === "GET"
  ) {
    const stats = await getStats(env);
    const views = stats.page_views;

    return json({
      ...stats,
      pageViews: stats.page_views,
      whatsappClicks: stats.whatsapp_clicks,
      formSubmissions: stats.form_submissions,
      ctr: views
        ? Number(
            ((stats.whatsapp_clicks / views) * 100).toFixed(2)
          )
        : 0,
    });
  }

  if (
    url.pathname === "/api/admin/events" &&
    req.method === "GET"
  ) {
    const limit = Math.min(
      500,
      Math.max(
        1,
        Number(url.searchParams.get("limit") || 200)
      )
    );
    return json(await listEvents(env, limit));
  }

  if (
    url.pathname === "/api/admin/leads" &&
    req.method === "GET"
  ) {
    const limit = Math.min(
      500,
      Math.max(
        1,
        Number(url.searchParams.get("limit") || 200)
      )
    );
    return json(await listLeads(env, limit));
  }

  if (
    url.pathname.startsWith("/api/admin/leads/") &&
    req.method === "PATCH"
  ) {
    const id = decodeURIComponent(
      url.pathname.slice("/api/admin/leads/".length)
    );
    const body = await readJson(req);
    const leads = await listLeads(env, 500);
    const lead = leads.find((x) => x.id === id);

    if (!lead) {
      return json({ error: "Lead not found." }, 404);
    }

    const allowedStatuses = new Set([
      "new",
      "contacted",
      "qualified",
      "won",
      "lost",
    ]);

    if (
      body.status !== undefined &&
      allowedStatuses.has(String(body.status))
    ) {
      lead.status = String(body.status);
    }

    if (body.notes !== undefined) {
      lead.notes = String(body.notes);
    }

    await env.ADMIN_KV.put(
      `${LEAD_PREFIX}${lead.created_at}:${lead.id}`,
      JSON.stringify(lead),
      { expirationTtl: 60 * 60 * 24 * 365 }
    );

    return json(lead);
  }

  if (
    url.pathname === "/api/admin/leads.csv" &&
    req.method === "GET"
  ) {
    const leads = await listLeads(env, 500);
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

    const esc = (v: any) =>
      `"${String(v ?? "").replace(/"/g, '""')}"`;

    const lines = [
      header.join(","),
      ...leads.map((lead) =>
        header.map((key) => esc(lead[key])).join(",")
      ),
    ];

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          'attachment; filename="sulan-leads.csv"',
        "cache-control": "no-store",
      },
    });
  }

  if (
    url.pathname === "/api/admin/whatsapp" &&
    req.method === "GET"
  ) {
    return json(await getWhatsApp(env));
  }

  if (
    url.pathname === "/api/admin/whatsapp" &&
    req.method === "POST"
  ) {
    const body = await readJson(req);
    const list = await getWhatsApp(env);

    const id = body.id
      ? Number(body.id)
      : Date.now();

    const number = normalizePhone(
      body.number ?? body.phone ?? ""
    );

    if (!number) {
      return json(
        { error: "WhatsApp number is required." },
        400
      );
    }

    const item: WhatsAppNumber = {
      id,
      label: String(body.label ?? "WhatsApp"),
      number,
      active: body.active !== false,
      is_default: !!body.is_default,
    };

    const index = list.findIndex((x) => x.id === id);

    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...item,
      };
    } else {
      list.push(item);
    }

    if (item.is_default) {
      for (const x of list) {
        x.is_default = x.id === id;
      }
    }

    const saved = await saveWhatsApp(env, list);
    return json(
      saved.find((x) => x.id === id) ?? item
    );
  }

  if (
    url.pathname.startsWith("/api/admin/whatsapp/") &&
    req.method === "PATCH"
  ) {
    const id = Number(
      decodeURIComponent(
        url.pathname.slice("/api/admin/whatsapp/".length)
      )
    );

    const body = await readJson(req);
    const list = await getWhatsApp(env);
    const item = list.find((x) => x.id === id);

    if (!item) {
      return json(
        { error: "WhatsApp number not found." },
        404
      );
    }

    const action = String(body.action ?? "");

    if (action === "delete") {
      await saveWhatsApp(
        env,
        list.filter((x) => x.id !== id)
      );
      return noContent();
    }

    if (action === "enable") item.active = true;
    if (action === "disable") item.active = false;

    if (action === "default") {
      for (const x of list) {
        x.is_default = x.id === id;
      }
    }

    if (body.label !== undefined) {
      item.label = String(body.label);
    }

    if (body.number !== undefined) {
      item.number = normalizePhone(String(body.number));
    }

    if (body.active !== undefined) {
      item.active = !!body.active;
    }

    const saved = await saveWhatsApp(env, list);
    return json(
      saved.find((x) => x.id === id) ?? item
    );
  }

  if (
    url.pathname === "/api/admin/pixels" &&
    req.method === "GET"
  ) {
    const config = await getConfig(env);
    return json(config.pixels);
  }

  if (
    url.pathname === "/api/admin/pixels" &&
    req.method === "POST"
  ) {
    const body = await readJson(req);
    const kind = String(body.kind ?? "") as PixelKind;
    const pixelId = String(
      body.pixel_id ?? body.id ?? ""
    ).trim();

    if (kind !== "meta" && kind !== "tiktok") {
      return json(
        { error: "kind must be meta or tiktok." },
        400
      );
    }

    if (!pixelId) {
      return json(
        { error: "Pixel ID is required." },
        400
      );
    }

    const config = await getConfig(env);
    const list = config.pixels[kind];

    if (list.some((x) => x.id === pixelId)) {
      return json(
        { error: "This Pixel ID already exists." },
        409
      );
    }

    const item: PixelConfig = {
      id: pixelId,
      name: String(body.name ?? "Pixel"),
      enabled: body.enabled !== false,
      events: normalizeEvents(body.events),
    };

    list.push(item);
    const saved = await saveConfig(env, config);

    return json(
      saved.pixels[kind].find((x) => x.id === pixelId) ?? item
    );
  }

  if (
    url.pathname.startsWith("/api/admin/pixels/") &&
    req.method === "PATCH"
  ) {
    const pixelId = decodeURIComponent(
      url.pathname.slice("/api/admin/pixels/".length)
    );

    const body = await readJson(req);
    const kind = String(body.kind ?? "") as PixelKind;

    if (kind !== "meta" && kind !== "tiktok") {
      return json(
        { error: "kind must be meta or tiktok." },
        400
      );
    }

    const config = await getConfig(env);
    const list = config.pixels[kind];
    const index = list.findIndex((x) => x.id === pixelId);

    if (index < 0) {
      return json({ error: "Pixel not found." }, 404);
    }

    const action = String(body.action ?? "");

    if (action === "delete") {
      list.splice(index, 1);
      await saveConfig(env, config);
      return noContent();
    }

    if (action === "toggle") {
      list[index].enabled = !list[index].enabled;
    }

    if (body.enabled !== undefined) {
      list[index].enabled = !!body.enabled;
    }

    if (body.name !== undefined) {
      list[index].name = String(body.name);
    }

    if (body.events !== undefined) {
      list[index].events = normalizeEvents(body.events);
    }

    const saved = await saveConfig(env, config);
    return json(
      saved.pixels[kind].find((x) => x.id === pixelId)
    );
  }

  return json(
    { error: "Admin API route not found." },
    404
  );
}

function pixelJs(): string {
  return String.raw`
(() => {
  const state = {
    meta: [],
    tiktok: [],
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
    if (crypto.randomUUID) return crypto.randomUUID();
    return Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  async function loadConfig() {
    const r = await fetch("/api/public/config", {
      cache: "no-store"
    });
    if (!r.ok) throw new Error("config");
    return r.json();
  }

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

  async function initMeta() {
    if (!state.meta.length) return;

    window.fbq = window.fbq || function() {
      window.fbq.callMethod
        ? window.fbq.callMethod.apply(window.fbq, arguments)
        : window.fbq.queue.push(arguments);
    };

    window.fbq.push = window.fbq;
    window.fbq.loaded = true;
    window.fbq.version = "2.0";
    window.fbq.queue = [];

    await loadScript("https://connect.facebook.net/en_US/fbevents.js");

    for (const p of state.meta) {
      window.fbq("init", p.id);
    }
  }

  async function initTikTok() {
    if (!state.tiktok.length) return;

    window.TiktokAnalyticsObject = "ttq";
    window.ttq = window.ttq || [];
    window.ttq.methods = [
      "page","track","identify","instances","debug","on","off",
      "once","ready","alias","group","enableCookie","disableCookie",
      "holdConsent","revokeConsent","grantConsent"
    ];

    window.ttq.setAndDefer = function(t, e) {
      t[e] = function() {
        t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };

    for (const method of window.ttq.methods) {
      window.ttq.setAndDefer(window.ttq, method);
    }

    window.ttq.instance = function(id) {
      const inst = window.ttq._i[id] || [];
      for (const method of window.ttq.methods) {
        window.ttq.setAndDefer(inst, method);
      }
      return inst;
    };

    window.ttq.load = function(id, options) {
      window.ttq._i = window.ttq._i || {};
      window.ttq._i[id] = [];
      window.ttq._t = window.ttq._t || {};
      window.ttq._t[id] = +new Date();
      window.ttq._o = window.ttq._o || {};
      window.ttq._o[id] = options || {};

      const s = document.createElement("script");
      s.type = "text/javascript";
      s.async = true;
      s.src =
        "https://analytics.tiktok.com/i18n/pixel/events.js" +
        "?sdkid=" + encodeURIComponent(id) +
        "&lib=ttq";

      const first = document.getElementsByTagName("script")[0];
      if (first && first.parentNode) {
        first.parentNode.insertBefore(s, first);
      } else {
        document.head.appendChild(s);
      }
    };

    for (const p of state.tiktok) {
      window.ttq.load(p.id);
    }
  }

  async function track(type, extra = {}) {
    const eventId = extra.event_id || makeEventId();
    const configEvent = EVENT_MAP[type];

    if (!configEvent) return;

    for (const pixel of state.meta) {
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

    for (const pixel of state.tiktok) {
      if (
        pixel.enabled !== false &&
        Array.isArray(pixel.events) &&
        pixel.events.includes(type) &&
        window.ttq
      ) {
        try {
          const inst =
            typeof window.ttq.instance === "function"
              ? window.ttq.instance(pixel.id)
              : window.ttq;

          if (type === "pageview") {
            inst.page();
          } else {
            inst.track(configEvent.tiktok, extra);
          }
        } catch (_) {}
      }
    }

    try {
      await fetch("/api/event", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        keepalive: true,
        body: JSON.stringify({
          ...extra,
          type,
          event_id: eventId,
          path: location.pathname,
          referrer: document.referrer || "",
          source:
            new URLSearchParams(location.search).get("utm_source") || "",
          campaign:
            new URLSearchParams(location.search).get("utm_campaign") || "",
          adset:
            new URLSearchParams(location.search).get("utm_adset") || ""
        })
      });
    } catch (_) {}
  }

  function isWhatsAppLink(el) {
    if (!el || !el.closest) return false;
    return !!el.closest(
      "a[href*='wa.me'],a[href*='whatsapp'],[data-whatsapp]"
    );
  }

  function bind() {
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!isWhatsAppLink(target)) return;

      const el = target.closest(
        "a[href*='wa.me'],a[href*='whatsapp'],[data-whatsapp]"
      );

      // If the site already uses /api/whatsapp/redirect, let that
      // navigation happen. The redirect endpoint records the event.
      if (
        el &&
        el.getAttribute("href") &&
        el.getAttribute("href").includes("/api/whatsapp/redirect")
      ) {
        return;
      }

      track("whatsapp_click", {
        href: el?.href || "",
        text: (el?.textContent || "").trim().slice(0, 120)
      });
    }, true);

    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!form || !form.matches) return;

      const leadForm =
        form.matches("[data-lead-form]") ||
        form.id === "leadForm";

      if (leadForm) {
        track("lead");
      }
    }, true);
  }

  async function boot() {
    try {
      const config = await loadConfig();

      state.meta = Array.isArray(config.pixels?.meta)
        ? config.pixels.meta.filter(p => p.enabled !== false)
        : [];

      state.tiktok = Array.isArray(config.pixels?.tiktok)
        ? config.pixels.tiktok.filter(p => p.enabled !== false)
        : [];

      await Promise.all([
        initMeta(),
        initTikTok()
      ]);

      state.ready = true;

      // Send PageView once. track() handles both ad pixels and our API.
      await track("pageview");

      // The front-end form switch is controlled by the public config.
      if (config.form_enabled === false) {
        document
          .querySelectorAll(
            "[data-lead-form],#leadForm"
          )
          .forEach(form => {
            form.style.display = "none";
          });
      }

      bind();

      window.SulanPixel = {
        track
      };
    } catch (_) {
      // Tracking failure must never break the landing page.
    }
  }

  boot();
})();
`;
}

async function handleAdminPage(
  req: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  // Authentication intentionally disabled during development.
  if (
    url.pathname === "/admin" ||
    url.pathname === "/admin/" ||
    url.pathname === "/admin/login"
  ) {
    return serveAsset(req, env, "/admin/index.html");
  }

  if (url.pathname.startsWith("/admin/")) {
    return serveAsset(req, env, url.pathname);
  }

  return null;
}

const worker: ExportedHandler<Env> = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    try {
      if (
        url.pathname === "/api/health" &&
        req.method === "GET"
      ) {
        return handleHealth(env);
      }

      if (
        url.pathname === "/pixel.js" &&
        req.method === "GET"
      ) {
        return new Response(pixelJs(), {
          status: 200,
          headers: {
            "content-type":
              "application/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (url.pathname === "/api/logout") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/admin/",
            "cache-control": "no-store",
          },
        });
      }

      const publicApi = await handlePublicApi(req, env, url);
      if (publicApi) return publicApi;

      if (url.pathname.startsWith("/api/admin/")) {
        return handleAdminApi(req, env, url);
      }

      const adminPage = await handleAdminPage(req, env, url);
      if (adminPage) return adminPage;

      return serveAsset(req, env, url.pathname || "/");
    } catch (error) {
      console.error("WORKER_ERROR", error);

      const message =
        error instanceof Error
          ? error.message
          : "Internal server error";

      if (url.pathname.startsWith("/api/")) {
        return json({ error: message }, 500);
      }

      return text("Internal server error", 500);
    }
  },
};

export default worker;
