# DSH-maohao 联合版 SDK 集成实施评估

> 产品名：DeepSeek harness-贸号版；内部代号：DSH-maohao
> 日期：2026-10-26；状态：实施评估 / 尚未完成集成与真机验收

## 版本边界

- 基于 `baicai/deepseek-harness` 原版 `master`，新开发分支 `dsh-maohao`。
- 旧定制版保存在 `archive/imaohao-branding-test-20261026`；禁止在新分支合并整条旧品牌分支。
- 保留 DSH 原有品牌、Logo、账户登录、模型、Session、Agent、Workspace、Tools。
- 仅为 Windows x64 添加鼠标硬件适配与必要交互；不实施原 iMaoHao Mock 登录/LLM、品牌定制、About 页及客服二维码。
- 客户 SDK 唯一版本：`baicai/mouse-sdk@b2a7355bb117d77a3c72c7d090f3852d947bd47c`（uMouse SDK v0.4.20）。

## 已核实资产（旧定制分支，可选择性复用）

- `apps/desktop/native/umouse-bridge.cpp`：独立 C++ helper，动态加载 uMouseSdk.dll；连接、断开、JSON 事件与 16 kHz / 16 bit / 单声道 PCM 数据。
- `apps/desktop/src/umouse-bridge.ts`：Electron 子进程生命周期、事件验证、连接列表。
- `apps/desktop/scripts/prepare-imaohao-mouse-sdk.ps1`：锁定 SDK 压缩包 Git blob，MSVC 编译 helper，ABI 版本检查；应重命名去品牌、保持锁定机制。
- 原 `main.ts` 能实现 AI 键 click 唤起工作区；PCM 转发默认关闭，语音转文字及 DSH 会话输入尚未打通。
- 原鼠标事件观察窗、托盘可作为测试工具参考；不要复用旧版独立自动弹窗（曾出现双窗口体验）。
- DSH 原版已有可选实验性 Voice Input 本地 SenseVoice ASR，随默认发行包提供但默认未启用；`speechController.transcribe` 接收 canonical base64 WAV，最大默认 4 MiB / 120 秒，`InputActions.insertText` 写入当前草稿并校验会话版本。

## 推荐数据流

```text
贸号鼠标 USB 2.4G / BLE
    → uMouseSdk v0.4.20（FULL 模式）
    → umouse-bridge.exe（独立进程）
    → 安全 IPC / Electron 主进程（状态/按键/受控 PCM）
    → 贸号鼠标交互适配器
        ├─ AI click → 聚焦 DSH Workspace
        └─ speech down/up → 限时收集 PCM → 规范 WAV → DSH speechController.transcribe
                                             → 当前会话 InputActions.insertText
                                             → 用户确认后用 DSH 原有发送逻辑提交
```

## 分阶段实施

### G0：先确保原版纯净

1. 在 `dsh-maohao` 从 DSH master 开发。绝不引入原 iMaoHao 品牌、Mock 账号或模型代码。
2. 创建可与旧贸号定制版并存的 Windows 安装身份及数据目录，避免同名升级覆盖或用户配置污染；界面仍沿用原 DSH。
3. 增加显式联动开关。无鼠标、SDK 缺失、DLL 加载失败时 DSH 正常可用。

### G1：最小硬件联动（首个可演示 Gate）

1. 精准移植 helper、构建脚本与主进程桥；校验 `um_sdk_version() == 0.4.20`。
2. USB/BLE 设备连接、断线恢复、状态查询（内部 SN 不应泄露到日志/UI）。
3. AI 键 `keyEvent: {key:'ai', action:'click'}` 聚焦已有 DSH 主界面，不自动创建额外窗口。
4. 保留按键诊断视图供验收；未定义键仅可观察，不向系统注入按键。
5. 设备无关的自动化回归与安装包检查；真机 USB/BLE 验证必须单独执行。

### G2：语音输入闭环（推荐联合版价值核心）

1. `speech/down` 进入录音、`speech/up` 完成；只在显式录音时转发/缓存 PCM，不在后台持续留存。
2. PCM 16 kHz/16bit/mono 封装为 DSH 接口要求的 PCM16 WAV；受 DSH 默认 4 MiB / 120s 限制，首版建议更短超时，处理短按、无音频、丢包、断开、重复按键与同时多个鼠标。
3. 复用内建的 `speechController.transcribe` 和 SenseVoice；语音插件未启用、模型未准备时给出入口提示；不新建 ASR API、账户系统或 LLM Provider。
4. 转写写入当前 Session 输入草稿而非直接 Agent 命令；若 Session 改变或当前输入失效，则不误插别的会话；默认用户确认后发送。
5. 双向独立验证：SDK→PCM、PCM→转写、转写→DSH 草稿、实际 DSH 模型回复。软件模拟音频的测试不能冒充鼠标真机通过。

### G3：发布门禁

- Windows 10/11 x64 USB 2.4G + BLE 真实鼠标；连接、AI 键、speech 上下键、语音输入、失联、重新连接、重启、无设备、系统休眠唤醒。
- 无鼠标不拖慢启动或破坏原 DSH 账号登录、Agent、Session、文件工作区、模型。
- 不默认打开设备管理独立窗口；测试面板可通过菜单按需打开，优先集成最小状态入口。
- 新旧两个客户端可并存安装，且配置、更新地址、卸载行为互不干扰。
- 安装包内完整 DLL 依赖及 LGPL/BSD NOTICE；确认声云 SDK 二进制商业再分发授权。签名与 Windows 风险提示单独处理。
- 发布 GitHub Releases 稳定链接而非 Actions 的短期 artifact；未完成真机与发行审核时标明 Evaluation，不宣称量产可用。

## 风险与不做项

- **硬件型号匹配风险（关键阻塞）**：SDK 预设生产设备标识/协议并不能证明所有贸号鼠标型号可识别，客户须提供实体及对应固件/连接方式核验。
- **语音模型准备**：原 DSH Voice Input 默认关闭，SenseVoice INT8 权重约 239 MB，加上运行时及 VAD；首次启动需准备模型，不允许静默下载，模型许可、下载镜像及安装体验需要验证。
- **数据隐私**：PCM 仅为明确的按键录音捕获，不保存音频或设备完整 SN 日志，不自动向 Agent 提交高风险命令。
- **本版不做**：贸号独立身份认证、iMaoHao-V6.1-Astra、Logo 替换、客户模型网关、系统范围任意鼠标宏、通用多厂商设备协议、翻译 Agent 和截图联动；这些是后续独立需求。
- **发布权利**：DSH 原版许可和商标使用、声云 SDK 商业分发许可需要分别核对。

## 目前真实状态

已创建封存分支与新开发分支；本文件为可落地的集成计划，**尚未将 SDK 代码移植到新分支，尚无新联合版 EXE，未完成鼠标真机测试**。
