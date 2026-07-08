// ============================================================
// SmartHider — Content Script（内容脚本）
//
// 这个文件会被 Chrome 自动注入到用户打开的【每一个网页】中。
// 它是整个扩展最核心的部分，负责：
//   1. 选择模式：让用户 hover 高亮、点击隐藏网页元素
//   2. 规则应用：页面加载时自动隐藏已保存的元素
//   3. 消息通信：接收来自 Popup 和 Service Worker 的指令
//
// 与 Service Worker 通信用 chrome.runtime.sendMessage()
// 接收 Popup 的消息用 chrome.runtime.onMessage.addListener()
// ============================================================

// 整个文件用 IIFE（立即执行函数表达式）包裹
// 目的：所有变量都在函数作用域内，不会污染网页的全局 window 对象
// 如果不包裹，我们定义的 isPicking 等变量会变成 window.isPicking，
// 可能和网页自己的变量冲突
(() => {
  'use strict';   // 启用严格模式，帮助捕获常见编码错误

  // ── 状态变量 ──────────────────────────────────────────────
  let isPicking = false;      // 当前是否处于「选择模式」
  let highlightedEl = null;   // 当前被高亮的元素（鼠标悬停时）
  let tooltipEl = null;       // 浮动提示框 DOM 元素（显示元素信息）
  let toastEl = null;         // Toast 通知 DOM 元素（显示操作反馈）
  let toastTimer = null;      // Toast 自动消失的定时器 ID

  // ── 初始化（页面加载时执行一次） ──────────────────────────

  function init() {
    createTooltip();          // 创建浮动提示框并挂到页面 DOM 上
    createToast();            // 创建 Toast 通知并挂到页面 DOM 上
    applyStoredRules();       // ★ 向 Service Worker 请求已保存的规则，自动隐藏元素
    listenForMessages();      // ★ 注册消息监听器，接收 Popup 发来的指令
    observeDom();             // ★ 启动 MutationObserver，监听 DOM 变化（处理 SPA 动态内容）
  }

  // ── UI 辅助元素的创建 ─────────────────────────────────────
  // tooltip 和 toast 是我们动态创建并插入到网页中的 <div> 元素，
  // 用 CSS fixed 定位悬浮在网页上方，不影响网页本身的布局。

  /**
   * 创建浮动提示框（tooltip）
   * 在选择模式下跟随鼠标，显示当前 hover 元素的描述信息
   */
  function createTooltip() {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'smarthider-tooltip';    // 对应 content.css 中的样式
    document.body.appendChild(tooltipEl);   // 挂到 body 末尾
  }

  /**
   * 创建 Toast 通知框
   * 固定在页面右下角，显示操作反馈（如 "元素已隐藏"）
   */
  function createToast() {
    toastEl = document.createElement('div');
    toastEl.id = 'smarthider-toast';        // 对应 content.css 中的样式
    document.body.appendChild(toastEl);
  }

  /**
   * 显示 Toast 通知
   * @param {string} msg  - 显示的文字
   * @param {string} icon - 前置图标（emoji）
   */
  function showToast(msg, icon = '👻') {
    if (!toastEl) return;
    // 设置 HTML 内容（icon + 文字）
    toastEl.innerHTML = `<span class="toast-icon">${icon}</span>${msg}`;
    toastEl.classList.add('visible');        // 添加 visible class 触发 CSS 淡入动画
    // 清除上一个定时器（防止多次快速操作导致动画冲突）
    clearTimeout(toastTimer);
    // 2.2 秒后自动淡出
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2200);
  }

  /**
   * 移动浮动提示框到鼠标附近
   * @param {HTMLElement} el  - 当前 hover 的元素
   * @param {MouseEvent}  evt - 鼠标事件（用于获取鼠标坐标）
   */
  function moveTooltip(el, evt) {
    if (!el || !tooltipEl) return;
    // 调用 selector.js 的 describe() 生成人类可读的描述
    tooltipEl.textContent = SmartHiderSelector.describe(el);
    tooltipEl.classList.add('visible');

    // ── 计算位置：默认放在鼠标右下方，如果超出视口则翻转到另一侧
    const pad = 14;    // 与鼠标的间距
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    const rect = tooltipEl.getBoundingClientRect();
    // 右侧超出视口 → 翻到鼠标左侧
    if (x + rect.width > window.innerWidth) x = evt.clientX - rect.width - 8;
    // 底部超出视口 → 翻到鼠标上方
    if (y + rect.height > window.innerHeight) y = evt.clientY - rect.height - 8;
    tooltipEl.style.left = `${x}px`;
    tooltipEl.style.top = `${y}px`;
  }

  /**
   * 隐藏浮动提示框
   * ?. 是可选链操作符：如果 tooltipEl 为 null 不会报错
   */
  function hideTooltip() {
    tooltipEl?.classList.remove('visible');
  }

  // ── 选择模式的开启与关闭 ──────────────────────────────────

  /**
   * 进入选择模式
   * 添加鼠标和键盘事件监听器，让用户可以 hover 高亮、点击隐藏
   */
  function startPicking() {
    if (isPicking) return;     // 已经在选择模式中，不重复开启
    isPicking = true;
    // 给 body 加一个 class，触发 content.css 中的 cursor: crosshair 样式
    document.body.classList.add('smarthider-picking');

    // 注册事件监听——注意第三个参数 true 表示「捕获阶段」
    // 捕获阶段比冒泡阶段更早执行，确保我们的处理器先于网页自己的 click 处理器
    // 这样 stopPropagation() 可以阻止事件到达网页，避免误触发网页的按钮/链接
    document.addEventListener('mouseover', onMouseOver, true);   // 鼠标移入元素
    document.addEventListener('mouseout', onMouseOut, true);     // 鼠标移出元素
    document.addEventListener('click', onClick, true);           // 点击元素
    document.addEventListener('keydown', onKeyDown, true);       // 键盘按键（用于 ESC 退出）
    showToast('选择模式已开启 · 点击元素隐藏 · ESC 退出', '🎯');
  }

  /**
   * 退出选择模式
   * 移除所有事件监听器，清理高亮和提示
   */
  function stopPicking() {
    if (!isPicking) return;    // 没在选择模式中，无需关闭
    isPicking = false;
    document.body.classList.remove('smarthider-picking');

    // 移除事件监听——必须传入完全相同的函数引用和 true 参数才能正确移除
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('mouseout', onMouseOut, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    clearHighlight();   // 清除残留的高亮
    hideTooltip();      // 隐藏提示框
    showToast('选择模式已关闭', '✅');
  }

  /**
   * 清除当前高亮的元素
   */
  function clearHighlight() {
    if (highlightedEl) {
      highlightedEl.classList.remove('smarthider-highlight');  // 移除高亮样式
      highlightedEl = null;
    }
  }

  // ── 选择模式下的 DOM 事件处理函数 ─────────────────────────

  /**
   * 判断一个元素是否是我们自己创建的 UI 元素
   * 避免用户选中/隐藏我们的 tooltip 或 toast
   */
  function isOwnElement(el) {
    return (
      el.id === 'smarthider-tooltip' ||
      el.id === 'smarthider-toast' ||
      el === document.body ||             // body 不应该被隐藏
      el === document.documentElement     // html 不应该被隐藏
    );
  }

  /**
   * 鼠标移入元素时的处理：高亮该元素 + 显示提示
   *
   * evt.stopPropagation() 阻止事件继续传播，
   * 避免网页自己的 hover 效果干扰我们的选择
   */
  function onMouseOver(evt) {
    evt.stopPropagation();
    const target = evt.target;
    if (isOwnElement(target)) return;     // 跳过我们自己的元素

    clearHighlight();                      // 清除上一个元素的高亮
    highlightedEl = target;               // 记录当前高亮的元素
    target.classList.add('smarthider-highlight');   // 添加高亮样式（紫色 outline）
    moveTooltip(target, evt);             // 移动提示框到鼠标附近
  }

  /**
   * 鼠标移出元素时的处理：清除高亮 + 隐藏提示
   */
  function onMouseOut(evt) {
    evt.stopPropagation();
    if (evt.target === highlightedEl) {
      clearHighlight();
      hideTooltip();
    }
  }

  /**
   * ★ 核心逻辑：点击元素时的处理
   *
   * 流程：
   * 1. 阻止默认行为（如点击链接跳转）和事件传播（避免触发网页功能）
   * 2. 调用 selector.js 的 generate() 生成唯一 CSS 选择器
   * 3. 调用 selector.js 的 describe() 生成人类可读描述
   * 4. 立即隐藏元素（添加 smarthider-hidden class → display: none）
   * 5. 通过 chrome.runtime.sendMessage 发消息给 Service Worker 保存规则
   */
  function onClick(evt) {
    evt.preventDefault();              // 阻止默认行为（如链接跳转、表单提交）
    evt.stopPropagation();             // 阻止事件向父元素冒泡
    evt.stopImmediatePropagation();    // 阻止同一元素上其他同类型监听器执行

    const target = evt.target;
    if (isOwnElement(target)) return;

    // 生成唯一的 CSS 选择器（用于下次定位这个元素）
    const selector = SmartHiderSelector.generate(target);
    if (!selector) return;             // 无法生成选择器（如 body 元素），跳过

    // 生成人类可读的描述（用于在 Popup 中展示）
    const description = SmartHiderSelector.describe(target);

    // 立即在页面上隐藏这个元素
    target.classList.remove('smarthider-highlight');   // 先移除高亮
    target.classList.add('smarthider-hidden');          // 添加隐藏 class（display: none）
    highlightedEl = null;
    hideTooltip();

    // 发消息给 Service Worker（background.js），让它把规则存到 chrome.storage
    // location.hostname 获取当前页面的域名，如 "www.example.com"
    chrome.runtime.sendMessage({
      type: 'SAVE_RULE',                // 消息类型标识
      hostname: location.hostname,      // 域名（存储的 key）
      selector,                         // CSS 选择器（存储的 value）
      description,                      // 人类可读的描述
    });

    showToast('元素已隐藏', '👻');
  }

  /**
   * 按下 ESC 键时退出选择模式
   */
  function onKeyDown(evt) {
    if (evt.key === 'Escape') stopPicking();
  }

  // ── 规则的加载与应用 ──────────────────────────────────────

  /**
   * 从 Service Worker 获取当前域名已保存的隐藏规则，然后应用它们。
   *
   * 这个函数在两个时机被调用：
   * 1. 页面首次加载时（init 中调用）
   * 2. MutationObserver 检测到有新 DOM 节点被添加时
   */
  function applyStoredRules() {
    // 向 Service Worker 发消息请求规则
    chrome.runtime.sendMessage(
      { type: 'GET_RULES', hostname: location.hostname },
      (res) => {
        // chrome.runtime.lastError 检查：如果扩展上下文失效
        //（比如扩展被禁用或更新了），直接返回，避免报错
        if (chrome.runtime.lastError) return;
        // 只有全局开关打开时才应用规则
        if (res?.rules && res.enabled !== false) {
          applyRules(res.rules);
        }
      },
    );
  }

  /**
   * 遍历规则数组，对每个选择器执行 querySelectorAll 找到匹配的元素并隐藏。
   *
   * @param {Array<{selector: string}>} rules - 规则数组
   */
  function applyRules(rules) {
    for (const rule of rules) {
      try {
        // querySelectorAll 可能匹配到多个元素（比如同域名多个页面的相同元素）
        document.querySelectorAll(rule.selector).forEach((el) => {
          el.classList.add('smarthider-hidden');   // 隐藏匹配的元素
        });
      } catch (e) {
        // 选择器可能因为页面更新而变得无效，打印警告但不中断
        console.warn(`[SmartHider] invalid selector: ${rule.selector}`, e);
      }
    }
  }

  /**
   * 恢复单条规则对应的元素（取消隐藏）
   * 当用户在 Popup 中点击 ↩ 恢复按钮时触发
   *
   * @param {string} selector - 要恢复的元素的 CSS 选择器
   */
  function restoreRule(selector) {
    try {
      document.querySelectorAll(selector).forEach((el) => {
        el.classList.remove('smarthider-hidden');   // 移除隐藏 class → 元素重新显示
      });
    } catch (e) {
      /* 忽略无效选择器 */
    }
  }

  /**
   * 恢复所有被隐藏的元素
   * 当用户点击"清空全部"或关闭全局开关时触发
   */
  function restoreAll() {
    // 找到所有带有 smarthider-hidden class 的元素并移除该 class
    document.querySelectorAll('.smarthider-hidden').forEach((el) => {
      el.classList.remove('smarthider-hidden');
    });
  }

  // ── MutationObserver（DOM 变化监听器）─────────────────────
  //
  // 很多现代网页是 SPA（单页应用），内容是 JavaScript 动态加载的。
  // 比如你滚动到页面底部，新的帖子/广告会动态插入。
  // MutationObserver 可以监听这些 DOM 变化，确保新出现的元素
  // 也会被我们的隐藏规则覆盖到。

  function observeDom() {
    let pending = false;  // 防抖标志，避免短时间内重复调用

    const observer = new MutationObserver((mutations) => {
      // ── 防抖逻辑 ──
      // DOM 变化可能在极短时间内触发几十甚至上百次（比如列表渲染）
      // 我们用 requestAnimationFrame 确保每个动画帧只执行一次
      if (pending) return;

      for (const m of mutations) {
        if (m.addedNodes.length > 0) {     // 有新节点被添加到 DOM 中
          pending = true;
          requestAnimationFrame(() => {
            pending = false;
            applyStoredRules();             // 重新应用规则，隐藏新出现的匹配元素
          });
          return;   // 找到第一个有新节点的 mutation 就够了，无需继续遍历
        }
      }
    });

    // 开始监听 body 及其所有后代的子节点变化
    // childList: true  → 监听直接子节点的增删
    // subtree: true    → 递归监听所有后代节点
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── 消息监听器（接收来自 Popup 和 Service Worker 的消息） ──
  //
  // Chrome 扩展的三个组件通过「消息」通信。
  // 当 Popup 发来 { type: 'START_PICKING' } 消息时，
  // 这个监听器会收到并调用 startPicking()。

  function listenForMessages() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg.type) {
        // ── Popup 发来的选择模式指令 ──
        case 'START_PICKING':                     // 用户点击了"开始选择元素"
          startPicking();
          sendResponse({ ok: true });
          break;
        case 'STOP_PICKING':                      // 用户点击了"停止选择"
          stopPicking();
          sendResponse({ ok: true });
          break;
        case 'GET_STATUS':                        // Popup 打开时查询当前是否在选择模式
          sendResponse({ isPicking });
          break;

        // ── Popup 发来的规则管理指令 ──
        case 'REMOVE_RULE':                       // 恢复单条规则对应的元素
          restoreRule(msg.selector);
          sendResponse({ ok: true });
          break;
        case 'REMOVE_ALL_RULES':                  // 恢复所有被隐藏的元素
          restoreAll();
          sendResponse({ ok: true });
          break;
        case 'RULES_UPDATED':                     // 规则列表有变更，重新应用
          restoreAll();                            // 先全部恢复
          if (msg.rules) applyRules(msg.rules);   // 再应用新的规则列表
          sendResponse({ ok: true });
          break;

        // ── 全局开关 ──
        case 'TOGGLE_ENABLED':                    // 用户切换了全局开关
          if (msg.enabled) {
            applyStoredRules();                    // 开启 → 重新应用所有规则
          } else {
            restoreAll();                          // 关闭 → 恢复所有元素
          }
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ error: 'unknown type' });
      }
      // ★ 关键：return true 告诉 Chrome "保持消息通道打开"
      // 如果不返回 true，Chrome 会在这个回调同步执行完后立即关闭通道，
      // 那么异步操作中的 sendResponse 就无法送达了
      return true;
    });
  }

  // ── 启动入口 ──────────────────────────────────────────────
  //
  // manifest.json 中设置了 run_at: "document_idle"，
  // 即在 DOM 和所有同步脚本加载完后注入。
  // 但为了保险，这里还是做了 readyState 检查。

  if (document.readyState === 'loading') {
    // DOM 还没加载完 → 等 DOMContentLoaded 事件后再初始化
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM 已经加载完（大部分情况走这条路径）→ 直接初始化
    init();
  }
})();
