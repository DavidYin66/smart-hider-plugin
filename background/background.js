// ============================================================
// SmartHider — Service Worker（后台服务脚本）
//
// 这是 Chrome 扩展的「后端」，运行在浏览器后台的独立线程中。
// 它没有 DOM，不能操作任何页面，只负责：
//   1. 管理 chrome.storage.local 中的持久化数据（隐藏规则和设置）
//   2. 接收并路由来自 Content Script 和 Popup 的消息
//
// ⚠️ 重要：Service Worker 会在空闲约 30 秒后被 Chrome 自动回收，
//    下次收到消息时重新启动。因此：
//    ❌ 不能用全局变量存数据（每次重启都会丢失）
//    ✅ 必须用 chrome.storage 做持久化
// ============================================================

'use strict';

// ── 存储操作函数 ──────────────────────────────────────────
//
// 所有函数都是 async 的，因为 chrome.storage API 返回 Promise。
//
// 数据存储结构（在 chrome.storage.local 中）：
// {
//   "rules": {
//     "www.example.com": [                 ← 按域名分组
//       {
//         "selector": "#ad-banner",        ← CSS 选择器（用于定位元素）
//         "description": "<div#ad-banner>",← 人类可读描述（Popup 中显示）
//         "timestamp": 1719849600000       ← 创建时间戳
//       },
//       ...
//     ]
//   },
//   "settings": {
//     "enabled": true                      ← 全局开关
//   }
// }

/**
 * 获取指定域名的所有隐藏规则，以及全局开关状态。
 *
 * @param {string} hostname - 域名，如 "www.example.com"
 * @returns {Promise<{rules: Array, enabled: boolean}>}
 */
async function getRules(hostname) {
  // chrome.storage.local.get() 接受一个 key 数组，返回对应的值
  const data = await chrome.storage.local.get(['rules', 'settings']);
  const rules = data.rules?.[hostname] || [];             // 该域名的规则，不存在则为空数组
  const enabled = data.settings?.enabled !== false;        // 全局开关，默认为 true
  return { rules, enabled };
}

/**
 * 保存一条新的隐藏规则。
 * 如果同一个 selector 已经存在，则跳过（去重）。
 *
 * @param {string} hostname    - 域名
 * @param {string} selector    - CSS 选择器
 * @param {string} description - 人类可读描述
 * @returns {Promise<Array>}   - 该域名当前的所有规则
 */
async function saveRule(hostname, selector, description) {
  const data = await chrome.storage.local.get('rules');
  const rules = data.rules || {};   // 如果首次使用，rules 为空对象

  // 如果该域名还没有任何规则，初始化为空数组
  if (!rules[hostname]) rules[hostname] = [];

  // 去重检查：如果相同的 selector 已经存在，直接返回（不重复添加）
  if (rules[hostname].some((r) => r.selector === selector)) {
    return rules[hostname];
  }

  // 添加新规则
  rules[hostname].push({
    selector,
    description: description || selector,   // 如果没有描述，用 selector 本身
    timestamp: Date.now(),                  // 记录添加时间
  });

  // 写回 chrome.storage
  await chrome.storage.local.set({ rules });
  return rules[hostname];
}

/**
 * 删除指定域名下的某一条规则。
 * 如果删除后该域名没有任何规则了，直接从存储中移除该域名的 key。
 *
 * @param {string} hostname - 域名
 * @param {string} selector - 要删除的 CSS 选择器
 * @returns {Promise<Array>} - 删除后该域名剩余的规则
 */
async function deleteRule(hostname, selector) {
  const data = await chrome.storage.local.get('rules');
  const rules = data.rules || {};

  if (rules[hostname]) {
    // filter 保留所有 selector 不等于目标的规则（即移除目标）
    rules[hostname] = rules[hostname].filter((r) => r.selector !== selector);
    // 如果规则数组变空了，清理掉这个域名的 key
    if (rules[hostname].length === 0) delete rules[hostname];
    await chrome.storage.local.set({ rules });
  }

  return rules[hostname] || [];
}

/**
 * 清空指定域名下的所有规则。
 *
 * @param {string} hostname - 域名
 */
async function clearRules(hostname) {
  const data = await chrome.storage.local.get('rules');
  const rules = data.rules || {};
  delete rules[hostname];                  // 直接删除该域名的 key
  await chrome.storage.local.set({ rules });
}

/**
 * 获取全局设置（目前只有 enabled 开关）。
 * @returns {Promise<{enabled: boolean}>}
 */
async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || { enabled: true };   // 默认开启
}

/**
 * 设置全局开关。
 * @param {boolean} enabled - 是否启用隐藏功能
 */
async function setEnabled(enabled) {
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  settings.enabled = enabled;
  await chrome.storage.local.set({ settings });
}

// ── 消息路由器 ──────────────────────────────────────────────
//
// chrome.runtime.onMessage.addListener 注册一个全局消息监听器。
// Content Script 和 Popup 发来的所有消息都会到达这里。
//
// 每条消息都有一个 type 字段标识类型，在 switch 中分发处理。

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // ★ 使用 async IIFE 包裹，因为 addListener 的回调本身不能是 async 的
  //    （如果直接用 async，return true 会被 Promise 覆盖，导致通道提前关闭）
  (async () => {
    try {
      switch (msg.type) {
        // ── 规则 CRUD 操作 ──
        case 'GET_RULES': {                                    // 获取规则（Content Script 和 Popup 都会用）
          const result = await getRules(msg.hostname);
          sendResponse(result);
          break;
        }
        case 'SAVE_RULE': {                                    // 保存新规则（Content Script 点击隐藏时发来）
          const rules = await saveRule(
            msg.hostname,
            msg.selector,
            msg.description,
          );
          sendResponse({ ok: true, rules });
          break;
        }
        case 'DELETE_RULE': {                                  // 删除单条规则（Popup 恢复按钮）
          const rules = await deleteRule(msg.hostname, msg.selector);
          sendResponse({ ok: true, rules });
          break;
        }
        case 'CLEAR_RULES': {                                  // 清空域名下所有规则（Popup 清空按钮）
          await clearRules(msg.hostname);
          sendResponse({ ok: true });
          break;
        }

        // ── 设置操作 ──
        case 'GET_SETTINGS': {                                 // 获取全局设置（Popup 打开时）
          const settings = await getSettings();
          sendResponse(settings);
          break;
        }
        case 'SET_ENABLED': {                                  // 切换全局开关（Popup toggle）
          await setEnabled(msg.enabled);
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ error: 'unknown message type' });
      }
    } catch (err) {
      console.error('[SmartHider bg]', err);
      sendResponse({ error: err.message });
    }
  })();

  // ★ 关键：return true 保持消息通道打开
  // 因为上面的 async IIFE 中有 await，sendResponse 是在异步完成后才调用的。
  // 如果不 return true，Chrome 会在回调同步执行完后立即关闭通道，
  // 导致 sendResponse 调用时通道已关闭，消息发不出去。
  return true;
});
