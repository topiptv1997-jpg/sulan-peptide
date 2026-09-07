// api.js - 配置数据查看器

// ============ 状态管理 ============
const state = {
    config: null,
    loading: false,
    error: null,
    lastUpdate: null
};

// ============ 核心方法 ============

/**
 * 获取配置数据
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
        state.lastUpdate = new Date().toLocaleString();
        console.log('✅ Config loaded');
        return state.config;

    } catch (error) {
        state.error = error.message;
        console.error('❌ Load failed:', error);
        throw error;
    } finally {
        state.loading = false;
    }
}

/**
 * 获取完整配置
 */
function getConfig() {
    return state.config;
}

/**
 * 获取 Meta 像素列表
 */
function getMetaPixels() {
    return state.config?.pixels?.meta || [];
}

/**
 * 获取 TikTok 像素列表
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
 * 获取统计信息
 */
function getStats() {
    const meta = getMetaPixels();
    const tiktok = getTikTokPixels();

    return {
        total: meta.length + tiktok.length,
        meta: meta.length,
        tiktok: tiktok.length,
        metaEnabled: meta.filter(p => p.enabled !== false).length,
        tiktokEnabled: tiktok.filter(p => p.enabled !== false).length
    };
}

// ============ 界面渲染 ============

/**
 * 渲染配置数据到页面
 * @param {string|HTMLElement} container - 容器选择器或元素
 */
function render(container = '#app') {
    const wrapper = typeof container === 'string'
        ? document.querySelector(container)
        : container;

    if (!wrapper) {
        console.error('Container not found:', container);
        return;
    }

    // 如果正在加载
    if (state.loading) {
        wrapper.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #666;">
        ⏳ 加载中...
      </div>
    `;
        return;
    }

    // 如果有错误
    if (state.error) {
        wrapper.innerHTML = `
      <div style="padding: 20px; color: #d32f2f; background: #ffebee; border-radius: 4px;">
        ❌ 加载失败: ${state.error}
        <br><br>
        <button onclick="window.api?.fetchConfig?.().then(() => window.api?.render())" 
                style="padding: 8px 16px; cursor: pointer;">
          重试
        </button>
      </div>
    `;
        return;
    }

    // 如果没有数据
    if (!state.config) {
        wrapper.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <p style="color: #666;">暂无数据，点击加载</p>
        <button onclick="window.api?.fetchConfig?.().then(() => window.api?.render())" 
                style="padding: 8px 24px; cursor: pointer; background: #1976d2; color: white; border: none; border-radius: 4px;">
          📥 加载配置
        </button>
      </div>
    `;
        return;
    }

    // 渲染数据
    const stats = getStats();
    const metaPixels = getMetaPixels();
    const tiktokPixels = getTikTokPixels();

    wrapper.innerHTML = `
    <style>
      .config-viewer {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 900px;
        margin: 0 auto;
        padding: 20px;
        color: #333;
      }
      .config-viewer .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 2px solid #e0e0e0;
      }
      .config-viewer .title {
        font-size: 20px;
        font-weight: 600;
      }
      .config-viewer .badge {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 500;
      }
      .config-viewer .badge.success { background: #e8f5e9; color: #2e7d32; }
      .config-viewer .badge.info { background: #e3f2fd; color: #0d47a1; }
      .config-viewer .stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
        margin-bottom: 24px;
      }
      .config-viewer .stat-card {
        background: #f5f5f5;
        padding: 14px 16px;
        border-radius: 8px;
        text-align: center;
      }
      .config-viewer .stat-card .number {
        font-size: 28px;
        font-weight: 700;
        color: #1976d2;
      }
      .config-viewer .stat-card .label {
        font-size: 12px;
        color: #666;
        margin-top: 4px;
      }
      .config-viewer .section {
        margin-bottom: 24px;
      }
      .config-viewer .section-title {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e0e0e0;
      }
      .config-viewer .pixel-item {
        background: #fafafa;
        border: 1px solid #e8e8e8;
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 8px;
      }
      .config-viewer .pixel-item .pixel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }
      .config-viewer .pixel-item .pixel-name {
        font-weight: 500;
      }
      .config-viewer .pixel-item .pixel-id {
        font-size: 12px;
        color: #666;
        font-family: monospace;
      }
      .config-viewer .pixel-item .pixel-events {
        font-size: 12px;
        color: #666;
      }
      .config-viewer .pixel-item .tag {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        background: #e3f2fd;
        color: #0d47a1;
        margin-right: 4px;
      }
      .config-viewer .pixel-item .tag.meta { background: #e3f2fd; color: #0d47a1; }
      .config-viewer .pixel-item .tag.tiktok { background: #fce4ec; color: #880e4f; }
      .config-viewer .pixel-item .tag.enabled { background: #e8f5e9; color: #2e7d32; }
      .config-viewer .pixel-item .tag.disabled { background: #ffebee; color: #c62828; }
      .config-viewer .raw-data {
        background: #263238;
        color: #aabfc9;
        padding: 16px;
        border-radius: 6px;
        overflow: auto;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        max-height: 400px;
        white-space: pre-wrap;
        word-break: break-all;
      }
      .config-viewer .actions {
        display: flex;
        gap: 8px;
        margin-bottom: 20px;
        flex-wrap: wrap;
      }
      .config-viewer .actions button {
        padding: 6px 16px;
        border: 1px solid #d0d0d0;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 13px;
      }
      .config-viewer .actions button:hover {
        background: #f0f0f0;
      }
      .config-viewer .empty {
        color: #999;
        padding: 12px;
        text-align: center;
        font-style: italic;
      }
    </style>
    
    <div class="config-viewer">
      <div class="header">
        <span class="title">📊 配置查看器</span>
        <div>
          <span class="badge success">● 已加载</span>
          <span style="font-size:12px;color:#999;margin-left:12px;">
            更新: ${state.lastUpdate || '刚刚'}
          </span>
        </div>
      </div>
      
      <div class="actions">
        <button onclick="window.api?.fetchConfig?.().then(() => window.api?.render())">🔄 刷新</button>
        <button onclick="window.api?.printToConsole()">📋 打印到控制台</button>
        <button onclick="window.api?.copyToClipboard()">📄 复制 JSON</button>
      </div>
      
      <div class="stats">
        <div class="stat-card">
          <div class="number">${stats.total}</div>
          <div class="label">总像素数</div>
        </div>
        <div class="stat-card">
          <div class="number" style="color:#0d47a1;">${stats.meta}</div>
          <div class="label">Meta (${stats.metaEnabled} 启用)</div>
        </div>
        <div class="stat-card">
          <div class="number" style="color:#880e4f;">${stats.tiktok}</div>
          <div class="label">TikTok (${stats.tiktokEnabled} 启用)</div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">📘 Meta 像素 (${metaPixels.length})</div>
        ${metaPixels.length === 0 ? '<div class="empty">暂无 Meta 像素配置</div>' :
            metaPixels.map((p, i) => `
            <div class="pixel-item">
              <div class="pixel-header">
                <span class="pixel-name">${p.name || p.id || `像素 ${i + 1}`}</span>
                <span>
                  <span class="tag ${p.enabled !== false ? 'enabled' : 'disabled'}">
                    ${p.enabled !== false ? '✅ 启用' : '❌ 禁用'}
                  </span>
                  <span class="tag meta">Meta</span>
                </span>
              </div>
              <div class="pixel-id">ID: ${p.pixel_id || p.id || '-'}</div>
              ${p.events ? `<div class="pixel-events">事件: ${p.events.join(', ')}</div>` : ''}
              ${p.options ? `<div style="font-size:11px;color:#999;margin-top:4px;">options: ${JSON.stringify(p.options)}</div>` : ''}
            </div>
          `).join('')
        }
      </div>
      
      <div class="section">
        <div class="section-title">📙 TikTok 像素 (${tiktokPixels.length})</div>
        ${tiktokPixels.length === 0 ? '<div class="empty">暂无 TikTok 像素配置</div>' :
            tiktokPixels.map((p, i) => `
            <div class="pixel-item">
              <div class="pixel-header">
                <span class="pixel-name">${p.name || p.id || `像素 ${i + 1}`}</span>
                <span>
                  <span class="tag ${p.enabled !== false ? 'enabled' : 'disabled'}">
                    ${p.enabled !== false ? '✅ 启用' : '❌ 禁用'}
                  </span>
                  <span class="tag tiktok">TikTok</span>
                </span>
              </div>
              <div class="pixel-id">ID: ${p.pixel_id || p.id || '-'}</div>
              ${p.events ? `<div class="pixel-events">事件: ${p.events.join(', ')}</div>` : ''}
              ${p.options ? `<div style="font-size:11px;color:#999;margin-top:4px;">options: ${JSON.stringify(p.options)}</div>` : ''}
            </div>
          `).join('')
        }
      </div>
      
      <div class="section">
        <div class="section-title">📄 原始数据</div>
        <div class="raw-data">${JSON.stringify(state.config, null, 2)}</div>
      </div>
    </div>
  `;
}

// ============ 工具方法 ============

/**
 * 打印到控制台
 */
function printToConsole() {
    if (!state.config) {
        console.warn('⚠️ 暂无数据，请先加载配置');
        return;
    }
    console.log('📋 Config Data:');
    console.log(JSON.stringify(state.config, null, 2));
}

/**
 * 复制到剪贴板
 */
async function copyToClipboard() {
    if (!state.config) {
        alert('⚠️ 暂无数据，请先加载配置');
        return;
    }
    try {
        await navigator.clipboard.writeText(JSON.stringify(state.config, null, 2));
        alert('✅ 已复制到剪贴板');
    } catch (_) {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = JSON.stringify(state.config, null, 2);
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('✅ 已复制到剪贴板');
    }
}

// ============ 导出 ============
export default {
    state,
    fetchConfig,
    getConfig,
    getMetaPixels,
    getTikTokPixels,
    getAllPixels,
    getStats,
    render,
    printToConsole,
    copyToClipboard
};
