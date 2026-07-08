<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="SmartHider Logo">
</p>

<h1 align="center">SmartHider</h1>

<p align="center">
  <strong>🎯 智能隐藏网页元素，记住你的选择</strong>
</p>

<p align="center">
  <a href="#-功能特性">功能特性</a> •
  <a href="#-安装方式">安装方式</a> •
  <a href="#-使用指南">使用指南</a> •
  <a href="#-技术架构">技术架构</a> •
  <a href="#-项目结构">项目结构</a> •
  <a href="#-许可证">许可证</a>
</p>

---

## ✨ 功能特性

- **🎯 可视化选择** — 进入选择模式后，鼠标悬停即可高亮元素，点击一下即可隐藏
- **💾 规则持久化** — 隐藏规则按域名自动保存，刷新页面或重新打开后依然生效
- **🌐 按域名管理** — 每个网站独立维护自己的隐藏规则，互不干扰
- **↩️ 一键恢复** — 在弹窗面板中可以恢复单条规则或一次性清空所有规则
- **🔄 动态内容支持** — 通过 MutationObserver 监听 DOM 变化，自动隐藏 SPA 动态加载的新元素
- **🎨 暗色毛玻璃 UI** — 采用 Glassmorphism 设计风格，深色主题，美观不刺眼
- **⚡ 零依赖** — 纯原生 JavaScript 实现，无需任何框架或第三方库

## 📦 安装方式

### 从源码加载（开发者模式）

1. **克隆仓库**

   ```bash
   git clone https://github.com/DavidYin66/smart-hider-plugin.git
   ```

2. **打开 Chrome 扩展管理页面**

   在地址栏输入 `chrome://extensions/` 并回车

3. **启用开发者模式**

   打开页面右上角的 **"开发者模式"** 开关

4. **加载扩展**

   点击 **"加载已解压的扩展程序"**，选择克隆下来的 `smart-hider-plugin` 文件夹

5. **开始使用**

   工具栏中会出现 SmartHider 图标，点击即可打开控制面板 🎉

## 📖 使用指南

### 隐藏元素

1. 点击工具栏中的 SmartHider 图标，打开弹窗面板
2. 点击 **「🎯 开始选择元素」** 按钮（弹窗会自动关闭以便操作页面）
3. 鼠标移到想要隐藏的元素上，元素会被紫色边框高亮
4. **点击** 即可隐藏该元素
5. 按 **ESC** 退出选择模式

### 管理规则

| 操作 | 说明 |
|------|------|
| **查看规则** | 打开弹窗面板，当前网站的隐藏规则会自动列出 |
| **恢复单个** | 点击规则右侧的 ↩️ 按钮恢复该元素 |
| **清空全部** | 点击底部 **「🗑️ 清空全部规则」** 删除当前网站的所有规则 |
| **全局开关** | 使用面板右上角的开关可临时启用/禁用所有隐藏效果 |

## 🏗 技术架构

SmartHider 基于 Chrome Extension **Manifest V3** 构建，采用三层架构：

```
┌─────────────────────────────────────────────────┐
│                   Popup (UI)                     │
│           popup.html / popup.js / popup.css      │
│         用户交互面板，管理规则与设置               │
└──────────┬──────────────────────┬────────────────┘
           │ chrome.runtime       │ chrome.tabs
           │ .sendMessage         │ .sendMessage
           ▼                      ▼
┌──────────────────┐   ┌──────────────────────────┐
│  Service Worker  │   │    Content Script         │
│  background.js   │   │    content.js + CSS       │
│                  │   │                           │
│  • 数据持久化     │   │  • 选择模式交互            │
│  • 规则 CRUD     │◄──│  • DOM 元素高亮/隐藏       │
│  • 消息路由       │   │  • MutationObserver       │
│  • chrome.storage│   │  • Toast / Tooltip        │
└──────────────────┘   └──────────────────────────┘
```

### 核心机制

- **CSS 选择器生成器** (`utils/selector.js`) — 三层递进策略：ID 选择器 → 智能路径（tag + class + 锚点 ID）→ nth-child 保底路径
- **MutationObserver** — 监听 DOM 变化，确保 SPA 动态加载的内容也会被隐藏规则覆盖
- **消息通信** — Popup ↔ Service Worker ↔ Content Script 通过 `chrome.runtime.sendMessage` 进行异步通信

## 📁 项目结构

```
smart-hider-plugin/
├── manifest.json              # 扩展清单文件（Manifest V3）
├── background/
│   └── background.js          # Service Worker — 数据存储与消息路由
├── content/
│   ├── content.js             # 内容脚本 — 选择模式与元素隐藏
│   └── content.css            # 注入样式 — 高亮、隐藏、Tooltip、Toast
├── popup/
│   ├── popup.html             # 弹窗面板 HTML
│   ├── popup.js               # 弹窗逻辑 — 规则管理与交互
│   └── popup.css              # 弹窗样式 — 暗色毛玻璃主题
├── utils/
│   └── selector.js            # CSS 选择器生成与元素描述
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 🔒 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 持久化保存隐藏规则和用户设置 |
| `activeTab` | 获取当前标签页的 URL 和 ID，与 Content Script 通信 |

SmartHider **不收集任何用户数据**，所有数据仅存储在本地 `chrome.storage.local` 中。

## 📄 许可证

[MIT](LICENSE) © DavidYin66
