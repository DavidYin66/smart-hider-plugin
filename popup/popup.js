// ============================================================
// SmartHider — Popup 脚本
//
// 这是用户点击扩展图标后弹出的面板的逻辑代码。
//
// ⚠️ Popup 的特殊性：
//    - 每次打开都是全新的（上一次的所有状态都丢失了）
//    - 点击 Popup 外的任何地方就会关闭
//    - 因此每次打开都需要重新加载规则、查询选择模式状态
//
// 本脚本通过两种方式与其他组件通信：
//    - chrome.runtime.sendMessage → Service Worker（存储操作）
//    - chrome.tabs.sendMessage    → Content Script（选择模式控制）
// ============================================================

// 等待 DOM 加载完成后再执行所有逻辑
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  // ── 获取页面中的 DOM 元素引用 ──────────────────────────────
  const globalToggle = document.getElementById('globalToggle');   // 全局开关 checkbox
  const pickBtn      = document.getElementById('pickBtn');       // "开始选择元素" 按钮
  const pickText     = document.getElementById('pickText');      // 按钮文字（开始/停止）
  const rulesList    = document.getElementById('rulesList');     // 规则列表容器
  const rulesCount   = document.getElementById('rulesCount');    // 规则数量徽章
  const domainLabel  = document.getElementById('currentDomain'); // 当前域名显示
  const clearBtn     = document.getElementById('clearBtn');      // "清空全部规则" 按钮

  // ── 状态变量 ──────────────────────────────────────────────
  let hostname  = '';       // 当前标签页的域名（如 "www.example.com"）
  let tabId     = null;     // 当前标签页的 ID（用于 sendMessage 时指定发送目标）
  let isPicking = false;    // Content Script 当前是否在选择模式中

  // ── 初始化流程 ────────────────────────────────────────────

  // 1. 获取当前活动标签页的信息
  //    chrome.tabs.query 返回匹配条件的标签页数组
  //    active: true  → 只要当前活动的
  //    currentWindow → 只要当前窗口的
  //    解构 [tab] 取第一个（也是唯一一个）
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.url) {
    try {
      hostname = new URL(tab.url).hostname;   // 从完整 URL 中提取域名
      tabId    = tab.id;                       // 记录 tab ID
      domainLabel.textContent = hostname;      // 在 UI 中显示域名
    } catch {
      // URL 解析失败（比如 about:blank）
      disableUI('不支持的页面');
      return;
    }
  }

  // 2. 检查是否是不支持的页面
  //    chrome:// 和 chrome-extension:// 页面不允许注入 Content Script
  //    在这些页面上，我们的扩展功能不可用
  if (
    !hostname ||
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('chrome-extension://')
  ) {
    disableUI('不支持的页面');
    return;
  }

  // 3. 从 Service Worker 加载全局开关状态
  const settings = await sendBg({ type: 'GET_SETTINGS' });
  globalToggle.checked = settings?.enabled !== false;   // 默认开启

  // 4. 向 Content Script 查询当前是否在选择模式中
  //    因为 Popup 每次打开都是全新的，不知道上一次的状态
  try {
    const status = await sendTab({ type: 'GET_STATUS' });
    isPicking = status?.isPicking ?? false;    // ?? 是空值合并：null/undefined 时用 false
    refreshPickBtn();                          // 根据状态更新按钮文字和样式
  } catch {
    // Content Script 可能还没注入（比如刚安装扩展后没刷新页面）
    // 这种情况下忽略错误，保持默认状态即可
  }

  // 5. 从 Service Worker 加载当前域名的隐藏规则，渲染到列表中
  await renderRules();

  // ── 事件绑定 ──────────────────────────────────────────────

  /**
   * 全局开关切换
   * 1. 通知 Service Worker 更新设置
   * 2. 通知 Content Script 立即应用/撤销隐藏
   */
  globalToggle.addEventListener('change', async () => {
    const enabled = globalToggle.checked;
    await sendBg({ type: 'SET_ENABLED', enabled });
    // try-catch 因为 Content Script 可能不可用
    try { await sendTab({ type: 'TOGGLE_ENABLED', enabled }); } catch {}
  });

  /**
   * 选择按钮点击
   * 切换选择模式，并通知 Content Script
   */
  pickBtn.addEventListener('click', async () => {
    isPicking = !isPicking;          // 切换状态
    refreshPickBtn();                // 立即更新按钮 UI
    try {
      // 根据新状态发送 START_PICKING 或 STOP_PICKING 消息
      await sendTab({ type: isPicking ? 'START_PICKING' : 'STOP_PICKING' });
      // 如果进入选择模式 → 关闭 Popup，让用户可以操作页面
      // （Popup 打开时会遮挡页面，用户无法 hover 选择元素）
      if (isPicking) window.close();
    } catch {
      // 发送失败（Content Script 不可用）→ 回退状态
      isPicking = false;
      refreshPickBtn();
    }
  });

  /**
   * 清空按钮点击
   * 1. 通知 Service Worker 删除该域名所有规则
   * 2. 通知 Content Script 恢复所有元素
   * 3. 重新渲染规则列表（变为空状态）
   */
  clearBtn.addEventListener('click', async () => {
    if (!hostname) return;
    await sendBg({ type: 'CLEAR_RULES', hostname });
    try { await sendTab({ type: 'REMOVE_ALL_RULES' }); } catch {}
    await renderRules();    // 重新渲染 → 显示空状态
  });

  // ── 辅助函数 ──────────────────────────────────────────────

  /**
   * 禁用 UI（用于不支持的页面）
   * 显示提示文字，禁用选择按钮
   */
  function disableUI(text) {
    domainLabel.textContent = text;
    pickBtn.disabled = true;
    pickBtn.style.opacity = '0.4';
  }

  /**
   * 根据 isPicking 状态更新选择按钮的外观
   * active class 会触发 CSS 中的脉冲发光动画
   */
  function refreshPickBtn() {
    pickBtn.classList.toggle('active', isPicking);   // toggle(class, force): true=添加, false=移除
    pickText.textContent = isPicking ? '停止选择' : '开始选择元素';
  }

  /**
   * 从 Service Worker 获取规则并渲染到列表中
   */
  async function renderRules() {
    // 向 Service Worker 请求当前域名的规则
    const res = await sendBg({ type: 'GET_RULES', hostname });
    const rules = res?.rules || [];

    // 更新规则数量徽章
    rulesCount.textContent = rules.length;
    // 没有规则时禁用清空按钮
    clearBtn.disabled = rules.length === 0;

    // ── 空状态：显示引导文字和幽灵 emoji ──
    if (rules.length === 0) {
      rulesList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">👻</span>
          <p class="empty-text">还没有隐藏任何元素<br>点击上方按钮开始选择</p>
        </div>`;
      return;
    }

    // ── 有规则：逐条渲染 ──
    rulesList.innerHTML = '';    // 清空容器
    rules.forEach((rule, i) => {
      const item = document.createElement('div');
      item.className = 'rule-item';
      // 给每条规则设置递增的动画延迟，实现依次入场效果
      item.style.animationDelay = `${i * 40}ms`;
      item.innerHTML = `
        <div class="rule-info">
          <div class="rule-description" title="${esc(rule.description)}">${esc(rule.description)}</div>
          <div class="rule-selector" title="${esc(rule.selector)}">${esc(rule.selector)}</div>
        </div>
        <button class="rule-restore-btn" title="恢复此元素">↩</button>`;

      // 给恢复按钮绑定点击事件
      item.querySelector('.rule-restore-btn').addEventListener('click', async () => {
        // 1. 通知 Service Worker 删除这条规则
        await sendBg({ type: 'DELETE_RULE', hostname, selector: rule.selector });
        // 2. 通知 Content Script 恢复这个元素
        try { await sendTab({ type: 'REMOVE_RULE', selector: rule.selector }); } catch {}
        // 3. 播放滑出动画，然后重新渲染列表
        item.style.opacity = '0';
        item.style.transform = 'translateX(16px)';
        item.style.transition = 'all 0.22s ease';
        setTimeout(() => renderRules(), 230);   // 等动画播完再重新渲染
      });

      rulesList.appendChild(item);
    });
  }

  // ── 消息发送封装 ──────────────────────────────────────────
  //
  // 把 chrome 的消息 API 封装成简单的函数调用，提高可读性

  /**
   * 发消息给 Service Worker (background.js)
   * 使用 chrome.runtime.sendMessage（不需要指定目标，自动发给 SW）
   */
  function sendBg(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  /**
   * 发消息给当前标签页的 Content Script
   * 使用 chrome.tabs.sendMessage（需要指定 tabId）
   */
  function sendTab(msg) {
    return chrome.tabs.sendMessage(tabId, msg);
  }

  // ── 工具函数 ──────────────────────────────────────────────

  /**
   * HTML 转义函数
   * 防止 XSS：将用户内容中的 < > & " 等特殊字符转义为 HTML 实体
   *
   * 原理：利用浏览器的 textContent → innerHTML 自动转义机制
   * 例如：'<script>' → textContent 设置后 → innerHTML 读出 '&lt;script&gt;'
   *
   * @param {string} str - 要转义的字符串
   * @returns {string} 转义后的安全 HTML 字符串
   */
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
});
