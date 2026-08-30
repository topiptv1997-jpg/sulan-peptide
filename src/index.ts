export interface Env {
  ADMIN_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_USER: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

const j = (
  d: unknown,
  s = 200
) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const ck = (
  n: string,
  v: string,
  age: number
) =>
  `${n}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

async function hash(s: string) {
  const b = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s)
  );

  return [...new Uint8Array(b)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

async function token(env: Env) {
  return hash(
    `${env.ADMIN_USER}:${env.SESSION_SECRET}`
  );
}

async function auth(
  req: Request,
  env: Env
) {
  const c =
    req.headers.get("Cookie") || "";

  const m =
    c.match(/sulan_admin=([^;]+)/);

  if (!m) return false;

  return (
    m[1] ===
    await token(env)
  );
}

async function config(env: Env) {
  const raw =
    await env.CONFIG_KV.get(
      "site_config"
    );

  return raw
    ? JSON.parse(raw)
    : {
        form_enabled: false,
        routing_mode: "single",
        next_index: 0,
        whatsapp: [],
        meta_id: "",
        meta_enabled: false,
        tiktok_id: "",
        tiktok_enabled: false
      };
}

async function saveConfig(
  env: Env,
  c: any
) {
  await env.CONFIG_KV.put(
    "site_config",
    JSON.stringify(c)
  );
}

function ua(req: Request) {
  return (
    req.headers.get(
      "user-agent"
    ) || ""
  );
}

function queryMeta(url: URL) {
  return {
    source:
      url.searchParams.get(
        "utm_source"
      ) || "direct",

    campaign:
      url.searchParams.get(
        "utm_campaign"
      ) || "",

    adset:
      url.searchParams.get(
        "utm_content"
      ) || ""
  };
}

async function record(
  env: Env,
  type: string,
  data: any
) {
  const key =
    `event:${Date.now()}:${crypto.randomUUID()}`;

  await env.CONFIG_KV.put(
    key,
    JSON.stringify({
      type,
      ...data,
      created_at:
        new Date().toISOString()
    }),
    {
      expirationTtl:
        60 * 60 * 24 * 90
    }
  );
}

async function allEvents(
  env: Env
) {
  let cur: any = undefined;
  const out: any[] = [];

  do {
    const r =
      await env.CONFIG_KV.list({
        prefix: "event:",
        cursor: cur,
        limit: 1000
      });

    out.push(
      ...r.keys.map(
        k => k.name
      )
    );

    cur = r.list_complete
      ? undefined
      : r.cursor;

  } while (cur);

  const vals =
    await Promise.all(
      out.map(
        k =>
          env.CONFIG_KV.get(
            k,
            "json"
          ) as Promise<any>
      )
    );

  return vals.filter(Boolean);
}

export default {
  async fetch(
    req: Request,
    env: Env
  ) {
    const u =
      new URL(req.url);

    /*
     * =====================================================
     * ADMIN LOGIN
     * =====================================================
     */

    if (
      u.pathname ===
        "/admin/login" ||
      u.pathname ===
        "/admin/login/"
    ) {
      /*
       * Login POST
       */
      if (
        req.method === "POST"
      ) {
        const f =
          await req.formData();

        const user =
          String(
            f.get("user") || ""
          );

        const pass =
          String(
            f.get("pass") || ""
          );

        /*
         * Correct credentials
         */
        if (
          user ===
            env.ADMIN_USER &&
          pass ===
            env.ADMIN_PASSWORD
        ) {
          return new Response(
            null,
            {
              status: 302,
              headers: {
                Location:
                  "/admin/",
                "Set-Cookie":
                  ck(
                    "sulan_admin",
                    await token(
                      env
                    ),
                    86400
                  )
              }
            }
          );
        }

        /*
         * Wrong credentials
         */
        return new Response(
          login_html(
            "Invalid credentials."
          ),
          {
            status: 401,
            headers: {
              "content-type":
                "text/html; charset=utf-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }

      /*
       * Login page
       */
      return new Response(
        login_html(),
        {
          headers: {
            "content-type":
              "text/html; charset=utf-8",
            "cache-control":
              "no-store"
          }
        }
      );
    }

    /*
     * =====================================================
     * ADMIN ROOT
     * =====================================================
     *
     * IMPORTANT:
     *
     * We do NOT redirect unauthenticated users here.
     * We directly return the login page.
     *
     * This prevents redirect loops such as:
     *
     * /admin/
     *   ↓
     * /admin/login
     *   ↓
     * /admin/
     *   ↓
     * /admin/login
     *
     */

    if (
      u.pathname ===
        "/admin" ||
      u.pathname ===
        "/admin/"
    ) {
      const loggedIn =
        await auth(
          req,
          env
        );

      /*
       * Not logged in:
       * show login directly.
       */
      if (!loggedIn) {
        return new Response(
          login_html(),
          {
            status: 200,
            headers: {
              "content-type":
                "text/html; charset=utf-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }

      /*
       * Logged in:
       * serve admin application.
       */
      return env.ASSETS.fetch(
        new Request(
          new URL(
            "/admin/index.html",
            u
          ),
          req
        )
      );
    }

    /*
     * =====================================================
     * ADMIN SUB-PATHS
     * =====================================================
     */

    if (
      u.pathname.startsWith(
        "/admin/"
      )
    ) {
      const loggedIn =
        await auth(
          req,
          env
        );

      if (!loggedIn) {
        return new Response(
          login_html(),
          {
            status: 200,
            headers: {
              "content-type":
                "text/html; charset=utf-8",
              "cache-control":
                "no-store"
            }
          }
        );
      }

      return env.ASSETS.fetch(
        new Request(
          new URL(
            "/admin/index.html",
            u
          ),
          req
        )
      );
    }

    /*
     * =====================================================
     * LOGOUT
     * =====================================================
     */

    if (
      u.pathname ===
      "/api/logout"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: {
            "Set-Cookie":
              ck(
                "sulan_admin",
                "",
                0
              )
          }
        }
      );
    }

    /*
     * =====================================================
     * PUBLIC CONFIG
     * =====================================================
     */

    if (
      u.pathname ===
        "/api/config" &&
      req.method === "GET"
    ) {
      const c =
        await config(env);

      return j({
        form_enabled:
          c.form_enabled,

        routing_mode:
          c.routing_mode,

        meta_id:
          c.meta_id,

        meta_enabled:
          c.meta_enabled,

        tiktok_id:
          c.tiktok_id,

        tiktok_enabled:
          c.tiktok_enabled
      });
    }

    /*
     * =====================================================
     * PAGEVIEW
     * =====================================================
     */

    if (
      req.method ===
        "POST" &&
      u.pathname ===
        "/api/pageview"
    ) {
      const body =
        await req
          .json()
          .catch(
            () => ({})
          );

      const meta = {
        source:
          body.source ||
          "direct",

        campaign:
          body.campaign ||
          "",

        adset:
          body.adset ||
          ""
      };

      await record(
        env,
        "pageview",
        {
          ...meta,

          path:
            body.path ||
            "/",

          user_agent:
            ua(req)
        }
      );

      return j({
        ok: true
      });
    }

    /*
     * =====================================================
     * LEAD / FORM SUBMISSION
     * =====================================================
     */

    if (
      req.method ===
        "POST" &&
      u.pathname ===
        "/api/lead"
    ) {
      const body =
        await req.json();

      const meta =
        queryMeta(u);

      await record(
        env,
        "form_submit",
        {
          ...meta,

          metadata:
            body,

          user_agent:
            ua(req)
        }
      );

      return j({
        ok: true
      });
    }

    /*
     * =====================================================
     * PROTECTED API
     * =====================================================
     */

    if (
      u.pathname.startsWith(
        "/api/"
      )
    ) {
      if (
        !(await auth(
          req,
          env
        ))
      ) {
        return j(
          {
            error:
              "unauthorized"
          },
          401
        );
      }

      return api(
        req,
        env,
        u
      );
    }

    /*
     * =====================================================
     * WHATSAPP ROUTING
     * =====================================================
     */

    if (
      u.pathname ===
      "/go/whatsapp"
    ) {
      const c =
        await config(env);

      const active =
        c.whatsapp.filter(
          (x: any) =>
            x.active
        );

      if (
        !active.length
      ) {
        return new Response(
          "WhatsApp is not configured.",
          {
            status: 503
          }
        );
      }

      let n: any;

      /*
       * Round-robin
       */
      if (
        c.routing_mode ===
        "round_robin"
      ) {
        n =
          active[
            (c.next_index ||
              0) %
              active.length
          ];

        c.next_index =
          (
            (c.next_index ||
              0) +
            1
          ) %
          active.length;

        await saveConfig(
          env,
          c
        );
      }

      /*
       * Single/default
       */
      else {
        n =
          active.find(
            (x: any) =>
              x.is_default
          ) ||
          active[0];
      }

      const meta =
        queryMeta(u);

      const text =
        u.searchParams.get(
          "text"
        ) || "";

      /*
       * Record click
       */
      await record(
        env,
        "whatsapp_click",
        {
          number_id:
            n.id,

          number:
            n.number,

          label:
            n.label,

          ...meta,

          user_agent:
            ua(req)
        }
      );

      /*
       * Redirect to WhatsApp
       */
      return Response.redirect(
        `https://wa.me/${n.number}${
          text
            ? `?text=${encodeURIComponent(
                text
              )}`
            : ""
        }`,
        302
      );
    }

    /*
     * =====================================================
     * STATIC ASSETS / WEBSITE
     * =====================================================
     */

    return env.ASSETS.fetch(
      req
    );
  }
};


/*
 * =========================================================
 * LOGIN HTML
 * =========================================================
 */

function login_html(
  err = ""
) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sulan Admin Login</title>

<style>
body{
  margin:0;
  min-height:100vh;
  display:grid;
  place-items:center;
  background:#f3f7f5;
  font:14px system-ui;
  color:#102033;
}

.box{
  width:min(370px,calc(100% - 40px));
  background:#fff;
  padding:28px;
  border-radius:14px;
  box-shadow:0 16px 50px #003c2d18;
}

h1{
  color:#00583f;
}

input{
  width:100%;
  box-sizing:border-box;
  padding:12px;
  margin:7px 0 14px;
  border:1px solid #cbded7;
  border-radius:8px;
}

.btn{
  width:100%;
  padding:12px;
  border:0;
  border-radius:8px;
  background:#00583f;
  color:#fff;
  font-weight:800;
  cursor:pointer;
}

.err{
  color:#a33;
}
</style>
</head>

<body>

<div class="box">

<div style="font-weight:900;color:#00583f">
SULAN PEPTIDE
</div>

<h1>Admin Login</h1>

${
  err
    ? `<p class="err">${err}</p>`
    : ""
}

<form method="post">

<input
  name="user"
  placeholder="Username"
  required
>

<input
  name="pass"
  type="password"
  placeholder="Password"
  required
>

<button
  class="btn"
  type="submit"
>
Sign in
</button>

</form>

</div>

</body>
</html>`;
}


/*
 * =========================================================
 * ADMIN API
 * =========================================================
 */

async function api(
  req: Request,
  env: Env,
  u: URL
) {
  const c =
    await config(env);

  /*
   * SETTINGS
   */
  if (
    u.pathname ===
      "/api/settings" &&
    req.method ===
      "POST"
  ) {
    const b =
      await req.json();

    if (
      typeof b.form_enabled ===
      "boolean"
    ) {
      c.form_enabled =
        b.form_enabled;
    }

    if (
      b.routing_mode
    ) {
      c.routing_mode =
        b.routing_mode;
    }

    await saveConfig(
      env,
      c
    );

    return j({
      ok: true
    });
  }

  /*
   * PIXELS GET
   */
  if (
    u.pathname ===
      "/api/pixels" &&
    req.method ===
      "GET"
  ) {
    return j({
      meta_id:
        c.meta_id,

      meta_enabled:
        c.meta_enabled,

      tiktok_id:
        c.tiktok_id,

      tiktok_enabled:
        c.tiktok_enabled
    });
  }

  /*
   * PIXELS POST
   */
  if (
    u.pathname ===
      "/api/pixels" &&
    req.method ===
      "POST"
  ) {
    const b =
      await req.json();

    c.meta_id =
      String(
        b.meta_id || ""
      );

    c.meta_enabled =
      !!b.meta_enabled;

    c.tiktok_id =
      String(
        b.tiktok_id || ""
      );

    c.tiktok_enabled =
      !!b.tiktok_enabled;

    await saveConfig(
      env,
      c
    );

    return j({
      ok: true
    });
  }

  /*
   * WHATSAPP GET
   */
  if (
    u.pathname ===
      "/api/whatsapp" &&
    req.method ===
      "GET"
  ) {
    return j(
      c.whatsapp.map(
        (x: any) => ({
          ...x,
          clicks: 0
        })
      )
    );
  }

  /*
   * WHATSAPP ADD / EDIT
   */
  if (
    u.pathname ===
      "/api/whatsapp" &&
    req.method ===
      "POST"
  ) {
    const b =
      await req.json();

    const num =
      String(
        b.number || ""
      ).replace(
        /\D/g,
        ""
      );

    if (!num) {
      return j(
        {
          error:
            "number required"
        },
        400
      );
    }

    /*
     * Edit
     */
    if (b.id) {
      const x =
        c.whatsapp.find(
          (z: any) =>
            z.id ===
            Number(b.id)
        );

      if (x) {
        x.label =
          b.label ||
          x.label;

        x.number =
          num;
      }
    }

    /*
     * Add
     */
    else {
      c.whatsapp.push({
        id:
          Date.now(),

        label:
          b.label ||
          "WhatsApp",

        number:
          num,

        active:
          true,

        is_default:
          c.whatsapp.length ===
          0
      });
    }

    await saveConfig(
      env,
      c
    );

    return j({
      ok: true
    });
  }

  /*
   * WHATSAPP PATCH
   */
  const m =
    u.pathname.match(
      /^\/api\/whatsapp\/(\d+)$/
    );

  if (
    m &&
    req.method ===
      "PATCH"
  ) {
    const id =
      Number(m[1]);

    const b =
      await req.json();

    const x =
      c.whatsapp.find(
        (z: any) =>
          z.id === id
      );

    if (!x) {
      return j(
        {
          error:
            "not found"
        },
        404
      );
    }

    /*
     * Delete
     */
    if (
      b.action ===
      "delete"
    ) {
      c.whatsapp =
        c.whatsapp.filter(
          (z: any) =>
            z.id !== id
        );
    }

    /*
     * Enable
     */
    else if (
      b.action ===
      "enable"
    ) {
      x.active = true;
    }

    /*
     * Disable
     */
    else if (
      b.action ===
      "disable"
    ) {
      x.active = false;
    }

    /*
     * Default
     */
    else if (
      b.action ===
      "default"
    ) {
      c.whatsapp.forEach(
        (z: any) => {
          z.is_default =
            false;
        }
      );

      x.is_default =
        true;
    }

    await saveConfig(
      env,
      c
    );

    return j({
      ok: true
    });
  }

  /*
   * CLICK LOGS
   */
  if (
    u.pathname ===
    "/api/clicks"
  ) {
    const ev =
      await allEvents(
        env
      );

    return j(
      ev
        .filter(
          x =>
            x.type ===
            "whatsapp_click"
        )
        .sort(
          (a, b) =>
            b.created_at.localeCompare(
              a.created_at
            )
        )
        .slice(0, 100)
    );
  }

  /*
   * STATISTICS
   */
  if (
    u.pathname ===
    "/api/stats"
  ) {
    const ev =
      await allEvents(
        env
      );

    const cks =
      ev.filter(
        x =>
          x.type ===
          "whatsapp_click"
      );

    const leads =
      ev.filter(
        x =>
          x.type ===
          "form_submit"
      );

    const views =
      ev.filter(
        x =>
          x.type ===
          "pageview"
      );

    return j({
      page_views:
        views.length,

      whatsapp_clicks:
        cks.length,

      form_submissions:
        leads.length,

      ctr:
        views.length
          ? (
              (cks.length /
                views.length) *
              100
            ).toFixed(2)
          : "0.00",

      form_enabled:
        c.form_enabled,

      routing_mode:
        c.routing_mode
    });
  }

  return j(
    {
      error:
        "not found"
    },
    404
  );
}
