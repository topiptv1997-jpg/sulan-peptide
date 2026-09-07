export async function onRequest(context) {
  const req = context.request;
  const kv = context.env.DB || context.env.db;
  
  // 【API 机器密令】这是供你外部工具请求时核对的独立通信密钥，可随意修改
  const API_SECRET_KEY = "CN_123456_Cloudflare";

  // 1. 全局跨域放行条：允许任何外部 Python、Excel、LoT 设备或第三方网站跨域抓取
  const corsHeaders = {
    "Content-Type": "application/json;charset=UTF-8",
    "Access-Control-Allow-Origin": "*", 
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // 处理浏览器的 OPTIONS 预检请求，直接亮绿灯放行
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 2. 限制外部工具只能通过标准的 GET 请求来抽取数据
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed", msg: "安全防御：该接口仅支持 GET 数据抓取" }), { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    const url = new URL(req.url);
    const urlKey = url.searchParams.get("key");

    // 3. 【机器鉴权核心】外部工具必须在网址后面带上正确的 ?key=... 否则直接轰走
    if (urlKey !== API_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Access Denied", msg: "鉴权失败：密钥不匹配，请求已被 Cloudflare 节点强行拦截！" }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // 4. 鉴权通过：深入 Workers KV 数据库提取所有报名数据
    const list = await kv.list({ prefix: "signup:" });
    const users = [];
    
    for (const key of list.keys) {
      const val = await kv.get(key.name);
      if (val) {
        const parsed = JSON.parse(val);
        // 自动把 KV 内部冗长的 key 还原成干净的简短 ID 传给外部工具
        parsed.id = key.name.replace("signup:", "");
        users.push(parsed);
      }
    }
    
    // 按时间倒序排列（最新报名的排在最前面）
    users.sort((a, b) => b.time - a.time);

    // 5. 吐出 100% 纯净、标准、无多余 HTML 干扰的 JSON 数据流
    return new Response(JSON.stringify({
      status: "success",
      engine: "Cloudflare Edge V8",
      total: users.length,
      data: users
    }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Server Error", msg: err.message }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
