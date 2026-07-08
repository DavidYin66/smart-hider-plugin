// ============================================================
// SmartHider — CSS 选择器生成器
//
// 为页面上任意一个 DOM 元素生成一个「唯一」的 CSS 选择器字符串。
// 下次可以用 document.querySelector(selector) 重新找到这个元素。
//
// 本文件作为 content script 加载，在 content.js 之前执行，
// 所以 content.js 可以直接使用 SmartHiderSelector 这个全局对象。
// ============================================================

// 使用 IIFE（立即执行函数）+ const 的方式创建模块，
// 返回值赋给全局常量 SmartHiderSelector，暴露 generate 和 describe 两个方法。
const SmartHiderSelector = (() => {

  /**
   * 核心方法：为指定的 DOM 元素生成一个唯一的 CSS 选择器。
   *
   * 使用三层递进策略，优先选择最简短、最稳定的方案：
   *   策略 1：如果元素有 id 属性且页面唯一 → 直接返回 #myId
   *   策略 2：从元素向上爬 DOM 树，拼接 tag + class + nth-child → 生成智能路径
   *   策略 3：纯 nth-child 路径（保底方案，一定唯一但不够稳定）
   *
   * @param {HTMLElement} element - 要生成选择器的 DOM 元素
   * @returns {string|null} CSS 选择器字符串，或 null（不可选择的元素）
   */
  function generate(element) {
    // 安全检查：body 和 html 元素不应该被隐藏
    if (
      !element ||
      element === document.body ||
      element === document.documentElement
    ) {
      return null;
    }

    // ── 策略 1：ID 选择器 ──
    // 如果元素有 id，用 CSS.escape() 转义特殊字符（如 id 中含有 . 或 :）
    // 然后检查这个 ID 在页面上是否真的唯一
    if (element.id) {
      const sel = `#${CSS.escape(element.id)}`;
      if (_isUnique(sel)) return sel;
    }

    // ── 策略 2：智能路径 ──
    // 沿 DOM 树向上爬，拼接每一层的 tag + class，遇到唯一 ID 就停下来
    const smartPath = _buildSmartPath(element);
    if (_isUnique(smartPath)) return smartPath;

    // ── 策略 3：完整 nth-child 路径（保底，一定唯一） ──
    // 每一层都用 tag:nth-child(n) 标识位置，类似门牌号
    return _buildNthChildPath(element);
  }

  /**
   * 为元素生成一个人类可读的描述文本。
   * 在选择模式的 tooltip 和 Popup 的规则列表中显示。
   *
   * 格式示例：<div#banner.ad-box> "立即注册获取优惠…"
   *
   * @param {HTMLElement} element - 要描述的 DOM 元素
   * @returns {string} 人类可读的描述
   */
  function describe(element) {
    const tag = element.tagName.toLowerCase();                    // 标签名，如 div, p, span
    const id = element.id ? `#${element.id}` : '';               // ID 部分
    const cls = Array.from(element.classList)
      .filter((c) => !c.startsWith('smarthider-'))               // 过滤掉我们自己添加的 class
      .slice(0, 2)                                                // 最多取 2 个 class
      .map((c) => `.${c}`)                                       // 加上 . 前缀
      .join('');

    // 截取元素的文本内容前 30 个字符作为参考
    let text = (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (text.length === 30) text += '…';  // 超过 30 字符加省略号

    let desc = `<${tag}${id}${cls}>`;     // 拼接标签描述
    if (text) desc += ` "${text}"`;       // 如果有文本内容，附加显示
    return desc;
  }

  // ── 内部辅助函数 ──────────────────────────────────────────

  /**
   * 策略 2 的实现：构建一条利用 ID 和 class 的「智能路径」。
   *
   * 从目标元素开始，沿 DOM 树一层层往上爬（向 body 方向），
   * 每一层记录 "tag.class1.class2" 的格式。
   * 如果某个祖先有唯一 ID，就以它为锚点停止攀爬（路径更短更稳定）。
   * 如果同级兄弟元素的 tag+class 完全相同，追加 :nth-child(n) 加以区分。
   *
   * @param {HTMLElement} element - 起始元素
   * @returns {string} CSS 选择器路径，如 "#main > div.card > p.title:nth-child(2)"
   */
  function _buildSmartPath(element) {
    const parts = [];        // 收集每一层的选择器片段
    let cur = element;       // 当前正在处理的元素，从目标元素开始向上

    // 循环条件：还没到 body / html
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();   // 先记录标签名

      // 如果当前层有唯一 ID → 以此为锚点，不再继续往上爬
      if (cur.id) {
        const idSel = `#${CSS.escape(cur.id)}`;
        if (_isUnique(idSel)) {
          parts.unshift(idSel);             // unshift = 插入到数组最前面
          return parts.join(' > ');          // 提前返回
        }
      }

      // 收集有意义的 class（过滤掉两类无用 class）
      const classes = Array.from(cur.classList)
        .filter(
          (c) =>
            !c.startsWith('smarthider-') &&                     // 排除我们自己的 class
            !/^[a-z]{1,2}[A-Za-z0-9]{5,}$/.test(c)             // 排除 CSS Module 生成的哈希 class
                                                                // 例如 "cZ4k8x2"，这种每次构建都会变
        )
        .slice(0, 3);   // 最多取 3 个 class，避免选择器过长

      // 将 class 拼接到 tag 后面，如 div.card.active
      if (classes.length) {
        part += classes.map((c) => `.${CSS.escape(c)}`).join('');
      }

      // 检查是否需要加 :nth-child —— 当有兄弟元素和当前元素的 tag+class 完全相同时
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);                        // 所有兄弟元素
        const samePart = siblings.filter((s) => _partOf(s) === part);       // 与当前 tag+class 相同的兄弟
        if (samePart.length > 1) {
          // 有多个相同的兄弟 → 必须加 :nth-child 区分
          // nth-child 是从 1 开始计数的（不是从 0）
          const idx = siblings.indexOf(cur) + 1;
          part += `:nth-child(${idx})`;
        }
      }

      parts.unshift(part);              // 插入到路径最前面（因为是从下往上爬的）
      cur = cur.parentElement;          // 继续往上一层
    }

    // 用 " > " 连接所有层级，表示直接子元素关系
    return parts.join(' > ');
  }

  /**
   * 辅助函数：为兄弟元素比较生成 tag+class 的「签名」。
   * 用于 _buildSmartPath 中判断两个兄弟元素是否"长得一样"。
   *
   * @param {HTMLElement} el
   * @returns {string} 如 "div.card.active"
   */
  function _partOf(el) {
    let p = el.tagName.toLowerCase();
    const cls = Array.from(el.classList)
      .filter(
        (c) =>
          !c.startsWith('smarthider-') &&
          !/^[a-z]{1,2}[A-Za-z0-9]{5,}$/.test(c)
      )
      .slice(0, 3);
    if (cls.length) p += cls.map((c) => `.${CSS.escape(c)}`).join('');
    return p;
  }

  /**
   * 策略 3 的实现：构建纯粹基于位置的 nth-child 路径。
   *
   * 这是保底方案——不依赖 ID 和 class，纯粹用每层的
   * "在父元素中排第几个" 来定位。一定唯一，但如果页面结构变化就会失效。
   *
   * 生成的路径类似：div:nth-child(1) > section:nth-child(2) > p:nth-child(3)
   *
   * @param {HTMLElement} element
   * @returns {string} CSS 选择器路径
   */
  function _buildNthChildPath(element) {
    const parts = [];
    let cur = element;

    while (cur && cur !== document.body && cur !== document.documentElement) {
      const parent = cur.parentElement;
      if (parent) {
        // 找到当前元素在父元素的子元素列表中的位置（从 1 开始）
        const idx = Array.from(parent.children).indexOf(cur) + 1;
        parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
      } else {
        parts.unshift(cur.tagName.toLowerCase());
      }
      cur = cur.parentElement;
    }

    return parts.join(' > ');
  }

  /**
   * 检验一个 CSS 选择器在当前页面上是否只匹配到唯一一个元素。
   *
   * @param {string} selector - CSS 选择器
   * @returns {boolean} 是否唯一
   */
  function _isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;    // 选择器语法错误时返回 false
    }
  }

  // 公开 API：只暴露 generate 和 describe 两个方法
  return { generate, describe };
})();
