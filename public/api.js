// api.js - Config Data Viewer
// 完整的配置查看器，包含归因数据和状态管理

// ============ Constants ============
const KEY = "sulan_attribution_v1";

// ============ State ============
const state = {
  ready: false,
  config: null,
  metaReady: false,
  ttReady: false,
  loading: false,
  error: null,
  lastUpdate: null
};

// ============ Attribution ============

/**
 * 从 URL 参数读取归因数据
 */
function readAttribution() {
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
}

const attribution = readAttribution();

// ============ Core Functions ============

/**
 * 从 /api/config 拉取配置数据
 */
async function fetchConfig() {
  state.loading = true;
  state.error = null;
  
  try {
    const response = await fetch("/api/config", { 
      cache: "no-store"
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    state.config = await response.json();
    state.ready = true;
    state.lastUpdate = new Date().toLocaleString();
    console.log("[OK] 配置加载成功");
    return state.config;
    
  } catch (error) {
    state.error = error.message;
    state.ready = false;
    console.error("[FAIL] 配置加载失败:", error);
    throw error;
  } finally {
    state.loading = false;
  }
}

/**
 * 获取完整状态
 */
function getState() {
  return { ...state };
}

/**
 * 获取完整配置
 */
function getConfig() {
  return state.config;
}

/**
 * 获取归因数据
 */
function getAttribution() {
  return { ...attribution };
}

/**
 * 获取本地存储的归因数据
 */
function getStoredAttribution() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch (_) {
    return {};
  }
}

/**
 * 获取所有 Meta 像素
 */
function getMetaPixels() {
  return state.config?.pixels?.meta || [];
}

/**
 * 获取所有 TikTok 像素
 */
function getTikTokPixels() {
  return state.config?.pixels?.tiktok || [];
}

/**
 * 获取所有像素
 */
function getAllPixels() {
  return {
    meta: getMetaPixels(),
    tiktok: getTikTokPixels()
  };
}

/**
 * 获取事件规则
 */
function getEventRules() {
  return state.config?.event_rules || {};
}

/**
 * 获取指定事件的规则
 */
function getEventRule(event) {
  return state.config?.event_rules?.[event] || { meta: true, tiktok: true };
}

/**
 * 统计信息
 */
function getStats() {
  const meta = getMetaPixels();
  const tiktok = getTikTokPixels();
  
  return {
    total: meta.length + tiktok.length,
    meta: meta.length,
    tiktok: tiktok.length,
    metaEnabled: meta.filter(p => p.enabled !== false).length,
    tiktokEnabled: tiktok.filter(p => p.enabled !== false).length,
    metaReady: state.metaReady,
    ttReady: state.ttReady,
    ready: state.ready
  };
}

// ============ UI Render ============

/**
 * 渲染到页面
 */
function render(container = '#app') {
  const wrapper = typeof container === 'string' 
    ? document.querySelector(container) 
    : container;
  
  if (!wrapper) {
    console.error('[ERROR] 容器未找到:', container);
    return;
  }
  
  // Loading
  if (state.loading) {
    wrapper.innerHTML = `
      <div style="padding: 40px; text-align: center; color: #666;">
        ⏳ 加载中...
      </div>
    `;
    return;
  }
  
  // Error
  if (state.error) {
    wrapper.innerHTML = `
      <div style="padding: 30px; color: #d32f2f; background: #ffebee; border-radius: 6px; text-align: center;">
        <div style="font-size: 16px; margin-bottom: 8px;">❌ 加载失败</div>
        <div style="font-size: 13px;">${state.error}</div>
        <br>
        <button onclick="window.api?.fetchConfig?.().then(() => window.api?.render())" 
                style="padding: 8px 24px; cursor: pointer; background: #1976d2; color: white; border: none; border-radius: 4px;">
          🔄 重试
        </button>
      </div>
    `;
    return;
  }
  
  // Empty
  if (!state.config) {
    wrapper.innerHTML = `
      <div style="padding: 40px; text-align: center;">
        <p style="color: #999; margin-bottom: 16px;">📭 暂无配置数据</p>
        <button onclick="window.api?.fetchConfig?.().then(() => window.api?.render())" 
                style="padding: 10px 32px; cursor: pointer; background: #1976d2; color: white; border: none; border-radius: 4px; font-size: 14px;">
          📥 加载配置
        </button>
      </div>
    `;
    return;
  }
  
  // ========== Render Data ==========
  const stats = getStats();
  const metaPixels = getMetaPixels();
  const tiktokPixels = getTikTokPixels();
  const rules = getEventRules();
  const attr = getAttribution();
  
  wrapper.innerHTML = `
    <style>
      .config-viewer {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 960px;
        margin: 0 auto;
        padding: 24px 20px;
        color: #222;
        line-height: 1.5;
      }
      .config-viewer .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 14px;
        border-bottom: 2px solid #e8e8e8;
        flex-wrap: wrap;
        gap: 8px;
      }
      .config-viewer .title {
        font-size: 20px;
        font-weight: 700;
      }
      .config-viewer .badge {
        display: inline-block;
        padding: 3px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }
      .config-viewer .badge.success { background: #e6f4ea; color: #1e7e34; }
      .config-viewer .badge.info { background: #e8f0fe; color: #1967d2; }
      .config-viewer .badge.warning { background: #fef7e0; color: #b65c00; }
      .config-viewer .badge.gray { background: #f1f3f4; color: #5f6368; }
      
      .config-viewer .status-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: 8px;
        margin-bottom: 20px;
      }
      .config-viewer .status-item {
        background: #f8f9fa;
        padding: 10px 14px;
        border-radius: 6px;
        text-align: center;
        border: 1px solid #e8e8e8;
        font-size: 13px;
      }
      .config-viewer .status-item .val {
        font-weight: 700;
        font-size: 16px;
      }
      .config-viewer .status-item .val.green { color: #1e7e34; }
      .config-viewer .status-item .val.red { color: #d93025; }
      .config-viewer .status-item .label { color: #777; font-size: 11px; margin-top: 2px; }
      
      .config-viewer .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 28px;
      }
      .config-viewer .stat-card {
        background: #f8f9fa;
        padding: 14px 16px;
        border-radius: 8px;
        text-align: center;
        border: 1px solid #e8e8e8;
      }
      .config-viewer .stat-card .number {
        font-size: 28px;
        font-weight: 700;
        color: #1967d2;
      }
      .config-viewer .stat-card .label {
        font-size: 12px;
        color: #777;
        margin-top: 3px;
      }
      .config-viewer .stat-card.meta .number { color: #1967d2; }
      .config-viewer .stat-card.tiktok .number { color: #d93025; }
      
      .config-viewer .toolbar {
        display: flex;
        gap: 8px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }
      .config-viewer .toolbar button {
        padding: 6px 16px;
        border: 1px solid #dadce0;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        font-size: 13px;
        transition: background 0.15s;
      }
      .config-viewer .toolbar button:hover { background: #f1f3f4; }
      
      .config-viewer .section {
        margin-bottom: 28px;
      }
      .config-viewer .section-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e8e8e8;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .config-viewer .section-title .count {
        font-size: 13px;
        font-weight: 400;
        color: #777;
      }
      
      .config-viewer .pixel-item {
        background: #fafafa;
        border: 1px solid #e8e8e8;
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 8px;
      }
      .config-viewer .pixel-item:hover { background: #f5f5f5; }
      .config-viewer .pixel-item .row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .config-viewer .pixel-item .name {
        font-weight: 500;
        font-size: 14px;
      }
      .config-viewer .pixel-item .id {
        font-size: 12px;
        color: #777;
        font-family: 'Courier New', monospace;
        background: #f0f0f0;
        padding: 1px 8px;
        border-radius: 3px;
      }
      .config-viewer .pixel-item .events {
        font-size: 12px;
        color: #555;
        margin-top: 4px;
      }
      .config-viewer .pixel-item .events .ev {
        display: inline-block;
        background: #e8f0fe;
        padding: 0 8px;
        border-radius: 10px;
        font-size: 11px;
        color: #1967d2;
        margin-right: 4px;
      }
      .config-viewer .pixel-item .tag {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
      }
      .config-viewer .pixel-item .tag.meta { background: #e8f0fe; color: #1967d2; }
      .config-viewer .pixel-item .tag.tiktok { background: #fce8e6; color: #d93025; }
      .config-viewer .pixel-item .tag.on { background: #e6f4ea; color: #1e7e34; }
      .config-viewer .pixel-item .tag.off { background: #fce8e6; color: #d93025; }
      
      .config-viewer .attr-box {
        background: #f8f9fa;
        border: 1px solid #e8e8e8;
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 12px;
        font-size: 13px;
      }
      .config-viewer .attr-box .key {
        color: #1967d2;
        font-weight: 500;
      }
      .config-viewer .attr-box .val {
        color: #d93025;
        font-family: 'Courier New', monospace;
        background: #f0f0f0;
        padding: 0 6px;
        border-radius: 3px;
      }
      .config-viewer .attr-box .empty {
        color: #999;
        font-style: italic;
      }
      
      .config-viewer .raw-block {
        background: #1e1e1e;
        color: #d4d4d4;
        padding: 16px 20px;
        border-radius: 6px;
        overflow: auto;
        font-size: 12px;
        font-family: 'Courier New', 'Consolas', monospace;
        max-height: 420px;
        white-space: pre-wrap;
        word-break: break-all;
        line-height: 1.6;
      }
      .config-viewer .empty {
        color: #999;
        padding: 16px;
        text-align: center;
        font-style: italic;
        font-size: 13px;
      }
      .config-viewer .footer {
        margin-top: 20px;
        padding-top: 14px;
        border-top: 1px solid #e8e8e8;
        font-size: 12px;
        color: #999;
        text-align: center;
      }
      .config-viewer .kv-info {
        font-size: 12px;
        color: #777;
        background: #f1f3f4;
        padding: 6px 12px;
        border-radius: 4px;
        display: inline-block;
      }
    </style>
    
    <div class="config-viewer">
      <!-- Header -->
      <div class="header">
        <div class="title">
          📊 配置查看器
          <span class="badge ${state.ready ? 'success' : 'warning'}">
            ${state.ready ? '● 已加载' : '● 未加载'}
          </span>
        </div>
        <div>
          <span style="font-size:12px;color:#999;">
            🕐 ${state.lastUpdate || '未更新'}
          </span>
        </div>
      </div>
      
      <!-- Status -->
      <div class="status-grid">
        <div class="status-item">
          <div class="val ${state.ready ? 'green' : 'red'}">${state.ready ? '✅' : '❌'}</div>
          <div class="label">就绪状态</div>
        </div>
        <div class="status-item">
          <div class="val ${state.metaReady ? 'green' : 'gray'}">${state.metaReady ? '✅' : '⏳'}</div>
          <div class="label">Meta 就绪</div>
        </div>
        <div class="status-item">
          <div class="val ${state.ttReady ? 'green' : 'gray'}">${state.ttReady ? '✅' : '⏳'}</div>
          <div class="label">TikTok 就绪</div>
        </div>
        <div class="status-item">
          <div class="val" style="color:#1967d2;">${stats.total}</div>
          <div class="label">像素总数</div>
        </div>
      </div>
      
      <!-- Attribution -->
      <div class="section">
        <div class="section-title">🏷️ 归因数据 (sulan_attribution_v1)</div>
        <div class="attr-box">
          ${Object.keys(attribution).length === 0 ? 
            '<span class="empty">暂无归因参数</span>' :
            Object.entries(attribution).map(([k, v]) => 
              `<span class="key">${k}</span>: <span class="val">${v}</span>&nbsp;&nbsp;`
            ).join('')
          }
          <br>
          <span style="font-size:11px;color:#999;margin-top:4px;display:inline-block;">
            📦 LocalStorage Key: <code style="background:#f0f0f0;padding:0 6px;border-radius:3px;">${KEY}</code>
          </span>
        </div>
      </div>
      
      <!-- Statistics -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="number">${stats.total}</div>
          <div class="label">像素总数</div>
        </div>
        <div class="stat-card meta">
          <div class="number">${stats.meta}</div>
          <div class="label">Meta (${stats.metaEnabled} 启用)</div>
        </div>
        <div class="stat-card tiktok">
          <div class="number">${stats.tiktok}</div>
          <div class="label">TikTok (${stats.tiktokEnabled} 启用)</div>
        </div>
      </div>
      
      <!-- Toolbar -->
      <div class="toolbar">
        <button onclick="window.api?.fetchConfig?.().then(() => window.api?.render())">🔄 刷新</button>
        <button onclick="window.api?.printToConsole()">📋 输出到控制台</button>
        <button onclick="window.api?.copyToClipboard()">📄 复制 JSON</button>
        <button onclick="window.api?.showLocalStorage()">💾 查看本地存储</button>
      </div>
      
      <!-- Event Rules -->
      ${Object.keys(rules).length > 0 ? `
      <div class="section">
        <div class="section-title">📋 事件规则</div>
        <div class="attr-box">
          ${Object.entries(rules).map(([event, rule]) => 
            `<span style="margin-right:16px;"><strong>${event}</strong>: Meta ${rule.meta ? '✅' : '❌'} / TikTok ${rule.tiktok ? '✅' : '❌'}</span>`
          ).join('')}
        </div>
      </div>
      ` : ''}
      
      <!-- Meta Pixels -->
      <div class="section">
        <div class="section-title">
          📘 Meta 像素
          <span class="count">共 ${metaPixels.length} 个</span>
        </div>
        ${metaPixels.length === 0 ? '<div class="empty">暂无 Meta 像素配置</div>' : 
          metaPixels.map((p, i) => `
            <div class="pixel-item">
              <div class="row">
                <span class="name">${p.name || p.id || '像素 ' + (i + 1)}</span>
                <span>
                  <span class="tag ${p.enabled !== false ? 'on' : 'off'}">
                    ${p.enabled !== false ? '● 启用' : '● 禁用'}
                  </span>
                  <span class="tag meta">Meta</span>
                </span>
              </div>
              <div class="row" style="margin-top:4px;">
                <span class="id">ID: ${p.pixel_id || p.id || '-'}</span>
              </div>
              ${p.events ? `<div class="events">📌 ${p.events.map(e => `<span class="ev">${e}</span>`).join('')}</div>` : ''}
              ${p.options ? `<div style="font-size:11px;color:#888;margin-top:4px;">⚙️ ${JSON.stringify(p.options)}</div>` : ''}
            </div>
          `).join('')
        }
      </div>
      
      <!-- TikTok Pixels -->
      <div class="section">
        <div class="section-title">
          📙 TikTok 像素
          <span class="count">共 ${tiktokPixels.length} 个</span>
        </div>
        ${tiktokPixels.length === 0 ? '<div class="empty">暂无 TikTok 像素配置</div>' :
          tiktokPixels.map((p, i) => `
            <div class="pixel-item">
              <div class="row">
                <span class="name">${p.name || p.id || '像素 ' + (i + 1)}</span>
                <span>
                  <span class="tag ${p.enabled !== false ? 'on' : 'off'}">
                    ${p.enabled !== false ? '● 启用' : '● 禁用'}
                  </span>
                  <span class="tag tiktok">TikTok</span>
                </span>
              </div>
              <div class="row" style="margin-top:4px;">
                <span class="id">ID: ${p.pixel_id || p.id || '-'}</span>
              </div>
              ${p.events ? `<div class="events">📌 ${p.events.map(e => `<span class="ev">${e}</span>`).join('')}</div>` : ''}
              ${p.options ? `<div style="font-size:11px;color:#888;margin-top:4px;">⚙️ ${JSON.stringify(p.options)}</div>` : ''}
            </div>
          `).join('')
        }
      </div>
      
      <!-- Raw JSON -->
      <div class="section">
        <div class="section-title">📄 原始数据 (JSON)</div>
        <div class="raw-block">${JSON.stringify(state.config, null, 2)}</div>
      </div>
      
      <div class="footer">
        sulan_attribution_v1 · 配置查看器
      </div>
    </div>
  `;
}

// ============ Utility ============

/**
 * 打印到控制台
 */
function printToConsole() {
  if (!state.config) {
    console.warn("[WARN] 暂无数据");
    return;
  }
  console.log("========== State ==========");
  console.log("ready:", state.ready);
  console.log("metaReady:", state.metaReady);
  console.log("ttReady:", state.ttReady);
  console.log("lastUpdate:", state.lastUpdate);
  console.log("========== Attribution ==========");
  console.log(attribution);
  console.log("========== Config ==========");
  console.log(JSON.stringify(state.config, null, 2));
  console.log("================================");
}

/**
 * 复制到剪贴板
 */
async function copyToClipboard() {
  if (!state.config) {
    alert("⚠️ 暂无数据");
    return;
  }
  const data = {
    state: {
      ready: state.ready,
      metaReady: state.metaReady,
      ttReady: state.ttReady,
      lastUpdate: state.lastUpdate
    },
    attribution: attribution,
    config: state.config
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    alert("✅ 已复制");
  } catch (_) {
    const textarea = document.createElement('textarea');
    textarea.value = JSON.stringify(data, null, 2);
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    alert("✅ 已复制");
  }
}

/**
 * 查看本地存储
 */
function showLocalStorage() {
  try {
    const data = localStorage.getItem(KEY);
    console.log("========== LocalStorage ==========");
    console.log("Key:", KEY);
    console.log("Value:", data);
    if (data) {
      console.log("Parsed:", JSON.parse(data));
    }
    console.log("==================================");
    alert(`LocalStorage 数据已输出到控制台\nKey: ${KEY}\nValue: ${data || '(空)'}`);
  } catch (e) {
    alert("读取失败: " + e.message);
  }
}

// ============ Export ============
export default {
  state,
  attribution,
  KEY,
  fetchConfig,
  getState,
  getConfig,
  getAttribution,
  getStoredAttribution,
  getMetaPixels,
  getTikTokPixels,
  getAllPixels,
  getEventRules,
  getEventRule,
  getStats,
  render,
  printToConsole,
  copyToClipboard,
  showLocalStorage
};
