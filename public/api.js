// api.js - Sulan 数据查看器
// 直接使用现有 API 获取所有原始数据

// ============ State ============
const state = {
  config: null,
  stats: null,
  events: [],
  leads: [],
  whatsapp: [],
  pixels: null,
  settings: null,
  publicConfig: null,
  loading: false,
  error: null,
  lastUpdate: null
};

// ============ API 请求函数 ============

/**
 * 通用 API 请求
 */
async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Accept": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof data === "string" ? data : (data?.error || data?.message || `HTTP ${response.status}`)
    );
  }

  return data;
}

// ============ 数据获取函数 ============

/**
 * 获取统计数据
 * GET /api/admin/stats
 */
async function fetchStats() {
  try {
    const data = await apiRequest("/api/admin/stats");
    state.stats = data;
    console.log("[OK] Stats loaded");
    return data;
  } catch (error) {
    console.error("[FAIL] Stats:", error);
    throw error;
  }
}

/**
 * 获取配置数据（包含 pixels、event_rules 等）
 * GET /api/admin/config
 */
async function fetchConfig() {
  try {
    const data = await apiRequest("/api/admin/config");
    state.config = data;
    console.log("[OK] Config loaded");
    return data;
  } catch (error) {
    console.error("[FAIL] Config:", error);
    throw error;
  }
}

/**
 * 获取事件列表
 * GET /api/admin/events
 */
async function fetchEvents() {
  try {
    const data = await apiRequest("/api/admin/events");
    state.events = Array.isArray(data) ? data : (data?.items || data?.data || []);
    console.log("[OK] Events loaded:", state.events.length);
    return state.events;
  } catch (error) {
    console.error("[FAIL] Events:", error);
    throw error;
  }
}

/**
 * 获取询盘列表
 * GET /api/admin/leads?limit=500
 */
async function fetchLeads(limit = 500) {
  try {
    const data = await apiRequest(`/api/admin/leads?limit=${limit}`);
    state.leads = Array.isArray(data) ? data : (data?.leads || data?.items || data?.data || []);
    console.log("[OK] Leads loaded:", state.leads.length);
    return state.leads;
  } catch (error) {
    console.error("[FAIL] Leads:", error);
    throw error;
  }
}

/**
 * 获取 WhatsApp 配置
 * GET /api/admin/whatsapp
 */
async function fetchWhatsApp() {
  try {
    const data = await apiRequest("/api/admin/whatsapp");
    state.whatsapp = Array.isArray(data) ? data : [];
    console.log("[OK] WhatsApp loaded:", state.whatsapp.length);
    return state.whatsapp;
  } catch (error) {
    console.error("[FAIL] WhatsApp:", error);
    throw error;
  }
}

/**
 * 获取像素配置
 * GET /api/admin/pixels
 */
async function fetchPixels() {
  try {
    const data = await apiRequest("/api/admin/pixels");
    state.pixels = data;
    console.log("[OK] Pixels loaded");
    return data;
  } catch (error) {
    console.error("[FAIL] Pixels:", error);
    throw error;
  }
}

/**
 * 获取系统设置
 * GET /api/admin/settings
 */
async function fetchSettings() {
  try {
    const data = await apiRequest("/api/admin/settings");
    state.settings = data;
    console.log("[OK] Settings loaded");
    return data;
  } catch (error) {
    console.error("[FAIL] Settings:", error);
    throw error;
  }
}

/**
 * 获取公共配置（公开接口）
 * GET /api/public/config
 */
async function fetchPublicConfig() {
  try {
    const data = await apiRequest("/api/public/config");
    state.publicConfig = data;
    console.log("[OK] Public config loaded");
    return data;
  } catch (error) {
    console.error("[FAIL] Public config:", error);
    throw error;
  }
}

/**
 * 一次性加载所有数据
 */
async function fetchAll() {
  state.loading = true;
  state.error = null;

  try {
    const results = await Promise.allSettled([
      fetchStats(),
      fetchConfig(),
      fetchEvents(),
      fetchLeads(500),
      fetchWhatsApp(),
      fetchPixels(),
      fetchSettings(),
      fetchPublicConfig()
    ]);

    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length > 0) {
      console.warn(`[WARN] ${errors.length} API(s) failed:`, errors);
    }

    state.lastUpdate = new Date().toLocaleString();
    console.log("[OK] All data loaded");
    return state;

  } catch (error) {
    state.error = error.message;
    console.error("[FAIL] Fetch all:", error);
    throw error;
  } finally {
    state.loading = false;
  }
}

// ============ 数据查询函数 ============

/**
 * 获取完整的配置数据（含 pixels）
 */
function getConfig() {
  return state.config;
}

/**
 * 获取 Meta 像素列表
 */
function getMetaPixels() {
  // 尝试从多个来源获取
  const fromConfig = state.config?.pixels?.meta || [];
  if (fromConfig.length > 0) return fromConfig;

  const fromPixels = state.pixels?.meta || [];
  if (fromPixels.length > 0) return fromPixels;

  return [];
}

/**
 * 获取 TikTok 像素列表
 */
function getTikTokPixels() {
  const fromConfig = state.config?.pixels?.tiktok || [];
  if (fromConfig.length > 0) return fromConfig;

  const fromPixels = state.pixels?.tiktok || [];
  if (fromPixels.length > 0) return fromPixels;

  return [];
}

/**
 * 获取事件规则
 */
function getEventRules() {
  return state.config?.event_rules || state.settings?.event_rules || {};
}

/**
 * 获取统计数据
 */
function getStats() {
  return state.stats;
}

/**
 * 获取所有事件
 */
function getEvents() {
  return state.events;
}

/**
 * 获取所有询盘
 */
function getLeads() {
  return state.leads;
}

/**
 * 获取 WhatsApp 配置
 */
function getWhatsApp() {
  return state.whatsapp;
}

/**
 * 获取系统设置
 */
function getSettings() {
  return state.settings;
}

/**
 * 获取公共配置
 */
function getPublicConfig() {
  return state.publicConfig;
}

/**
 * 获取原始状态对象
 */
function getState() {
  return { ...state };
}

/**
 * 获取所有数据的统计信息
 */
function getDataStats() {
  const meta = getMetaPixels();
  const tiktok = getTikTokPixels();

  return {
    config: state.config ? '✅' : '❌',
    stats: state.stats ? '✅' : '❌',
    events: state.events.length,
    leads: state.leads.length,
    whatsapp: state.whatsapp.length,
    pixels: {
      meta: meta.length,
      tiktok: tiktok.length,
      metaEnabled: meta.filter(p => p.enabled !== false).length,
      tiktokEnabled: tiktok.filter(p => p.enabled !== false).length
    },
    settings: state.settings ? '✅' : '❌',
    publicConfig: state.publicConfig ? '✅' : '❌',
    lastUpdate: state.lastUpdate
  };
}

// ============ 打印函数 ============

/**
 * 打印所有数据到控制台
 */
function printAll() {
  console.group('📊 Sulan Data Viewer');
  console.log('Last Update:', state.lastUpdate);
  console.log('');

  console.group('📈 Stats');
  console.log(state.stats);
  console.groupEnd();

  console.group('⚙️ Config');
  console.log(state.config);
  console.groupEnd();

  console.group('📋 Events (' + state.events.length + ')');
  console.log(state.events);
  console.groupEnd();

  console.group('📝 Leads (' + state.leads.length + ')');
  console.log(state.leads);
  console.groupEnd();

  console.group('📱 WhatsApp (' + state.whatsapp.length + ')');
  console.log(state.whatsapp);
  console.groupEnd();

  console.group('🖼️ Pixels');
  console.log(state.pixels);
  console.groupEnd();

  console.group('🔧 Settings');
  console.log(state.settings);
  console.groupEnd();

  console.group('🌐 Public Config');
  console.log(state.publicConfig);
  console.groupEnd();

  console.groupEnd();
}

/**
 * 打印配置到控制台（简短版）
 */
function printConfig() {
  if (!state.config) {
    console.warn('[WARN] Config not loaded');
    return;
  }
  console.log('========== Config ==========');
  console.log(JSON.stringify(state.config, null, 2));
}

/**
 * 打印事件到控制台
 */
function printEvents() {
  if (!state.events.length) {
    console.warn('[WARN] No events');
    return;
  }
  console.log('========== Events (' + state.events.length + ') ==========');
  console.log(JSON.stringify(state.events, null, 2));
}

/**
 * 打印询盘到控制台
 */
function printLeads() {
  if (!state.leads.length) {
    console.warn('[WARN] No leads');
    return;
  }
  console.log('========== Leads (' + state.leads.length + ') ==========');
  console.log(JSON.stringify(state.leads, null, 2));
}

// ============ 导出 ============
export default {
  // 状态
  state,

  // 数据获取
  fetchAll,
  fetchStats,
  fetchConfig,
  fetchEvents,
  fetchLeads,
  fetchWhatsApp,
  fetchPixels,
  fetchSettings,
  fetchPublicConfig,

  // 数据查询
  getState,
  getConfig,
  getStats,
  getEvents,
  getLeads,
  getWhatsApp,
  getMetaPixels,
  getTikTokPixels,
  getEventRules,
  getSettings,
  getPublicConfig,
  getDataStats,

  // 打印
  printAll,
  printConfig,
  printEvents,
  printLeads,

  // 通用请求（可用于自定义）
  apiRequest
};
