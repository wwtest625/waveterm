<p align="center">
  <a href="https://www.waveterm.dev">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="./assets/wave-dark.png">
		<source media="(prefers-color-scheme: light)" srcset="./assets/wave-light.png">
		<img alt="Wave Terminal Logo" src="./assets/wave-light.png" width="240">
	</picture>
  </a>
  <br/>
</p>

# Wave Terminal

<div align="center">

[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2Fwavetermdev%2Fwaveterm?ref=badge_shield)

</div>

Wave 是一个开源的 AI 集成终端，支持 macOS、Linux 和 Windows。可以使用任何 AI 模型，支持使用自己的 OpenAI、Claude 或 Gemini API Key，或通过 Ollama 和 LM Studio 运行本地模型。无需注册账号。

Wave 还支持持久化 SSH 会话，即使网络中断或应用重启也能保持连接。内置图形化编辑器可以直接编辑远程文件，无需离开终端即可预览文件。

![WaveTerm Screenshot](./assets/wave-screenshot.webp)

## 核心功能

### AI 赋能

- **Wave AI** - 可感知上下文的终端助手，能读取终端输出、分析组件并执行文件操作
- **多模型支持** - OpenAI、Claude、Google Gemini、Azure、Perplexity、Groq、NanoGPT 及 OpenAI 兼容端点
- **本地模型** - 支持通过 Ollama、LM Studio、vLLM 等 OpenAI 兼容服务器运行本地模型
- **自备密钥 (BYOK)** - 使用自己的 API Key 连接任何支持的模型
- **视觉支持** - 支持兼容 AI 模型的图像分析功能

### 持久化 SSH 会话

- **会话保持** - SSH 会话在连接中断、网络变化、电脑休眠和 Wave 重启后依然保持
- **自动重连** - 连接恢复时自动重新连接
- **状态指示** - 盾牌图标显示会话状态（标准模式、持久化已连接、持久化已断开、持久化等待中）
- **灵活配置** - 支持全局、单个连接或单个模块级别的配置

### 终端与编辑器

- **内置编辑器** - 使用 Monaco 编辑器编辑远程文件，支持语法高亮和现代编辑功能
- **丰富预览** - 支持预览 Markdown、图片、视频、PDF、CSV、目录
- **OSC 52 剪贴板** - 终端应用可直接复制到系统剪贴板
- **光标自定义** - 可配置光标样式（块/竖线/下划线）和闪烁
- **Vim 风格导航** - 使用 Ctrl+Shift+H/J/K/L 在模块间导航

### 界面与自定义

- **灵活布局** - 拖放界面，可组织终端模块、编辑器、浏览器和 AI 助手
- **全屏切换** - 展开任意模块以获得更好的可视效果，快速返回多模块视图
- **焦点选项** - 支持鼠标悬停焦点跟随设置
- **丰富自定义** - 标签主题、终端样式、背景图片
- **工作区级组件** - 按工作区显示/隐藏组件

### 高效生产力

- **命令模块** - 隔离和监控单个命令
- **密钥库** - 本地安全存储 API Key 和凭据，SSH 会话间共享
- **连接式文件管理** - 使用 `wsh file` 在本地和远程 SSH 主机间复制和同步文件
- **原生 WSL 支持** - 原生连接 Windows WSL2 发行版
- **统一配置** - 通过专用配置组件浏览和编辑设置

## 安装

Wave Terminal 支持 macOS、Linux 和 Windows。

平台特定的安装说明请参阅[这里](https://docs.waveterm.dev/gettingstarted)。

也可以直接从 [www.waveterm.dev/download](https://www.waveterm.dev/download) 下载安装。

### 最低要求

Wave Terminal 支持以下平台：

- macOS 11 或更高版本 (arm64, x64)
- Windows 10 1809 或更高版本 (x64)
- 基于 glibc-2.28 或更高版本的 Linux（Debian 10、RHEL 8、Ubuntu 20.04 等）(arm64, x64)

WSH 辅助程序支持以下平台：

- macOS 11 或更高版本 (arm64, x64)
- Windows 10 或更高版本 (x64)
- Linux Kernel 2.6.32 或更高版本 (x64)、Linux Kernel 3.1 或更高版本 (arm64)

## 文档

更多信息请访问 [https://docs.waveterm.dev](https://docs.waveterm.dev)。

## 链接

- 主页 — https://www.waveterm.dev
- 下载页面 — https://www.waveterm.dev/download
- 文档 — https://docs.waveterm.dev
- X — https://x.com/wavetermdev
- Discord 社区 — https://discord.gg/XfvZ334gwU

## 许可证

Wave Terminal 采用 Apache-2.0 许可证。
