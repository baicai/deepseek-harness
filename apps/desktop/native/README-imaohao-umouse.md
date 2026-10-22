# 贸号 DSH × 声云智能鼠标 SDK — Windows 集成

## 已实现代码（非 Mock）

- 固定使用 baicai/mouse-sdk 的 v0.4.20 Windows x64 包；Git 提交 b2a7355bb117d77a3c72c7d090f3852d947bd47c，二进制归档 blob 37e379497987ff23b4c84831a5c20de843bf3ecc。
- scripts/prepare-imaohao-mouse-sdk.ps1：下载校验厂商二进制并使用 MSVC 编译独立 umouse-bridge.exe，实测加载 um_sdk_version。
- native/umouse-bridge.cpp：动态加载 C ABI 的 uMouseSdk.dll，回调连接/断开/按键 JSON 和 PCM。数据快速复制到有界队列，由独立线程输出 NDJSON，原生异常与 Electron 主进程隔离。
- src/umouse-bridge.ts：运行 Windows 子进程并验证事件类型/长度，公开状态和事件订阅；主进程只在贸号 Windows 版本启动。
- AI 键 click 可以唤起工作区；Windows 托盘显示 SDK 状态及连接数。
- 主界面预加载桥：dshDesktop.mouse.status() / subscribe() / subscribeStatus()。
- PCM 16 kHz、16 bit、单声道回调已有数据路径，但默认关闭音频转发。开发人员设置 IMAOHAO_MOUSE_PCM_BRIDGE=1 可启用；尚未接入 ASR、翻译、Agent 投递或语音播报。

## 交付约束

1. 客户提供实物鼠标用于 Windows USB/BLE、音频、按键及断线重连测试。
2. 厂商必须明确授予 uMouseSdk.dll 商业再分发许可；示例 MIT 许可不等于 SDK 二进制 MIT。发布保留 FFmpeg LGPL、HIDAPI BSD 许可证和 NOTICE。
3. 客户后台配置“贸号”品牌是设备/服务管理能力，不自动替代 DSH 客户端账号、模型或软件界面。后两者需另行集成。
4. 语音、翻译、M 键、截图等具体业务操作需双方确定；未定义的键只透出事件，不自行执行系统动作。

## 验收门禁

- CI 校验 SDK 包 Git blob、用 MSVC 编译 Windows sidecar，并动态加载厂商 DLL 检查版本。
- DSH Windows NSIS 首次安装、自定义 D 盘路径覆盖安装、用户数据保留通过。
- 真实鼠标分别验证 USB/BLE 连接、AI 键、其他按键、音频及断线恢复。
- 上述真实设备测试未执行前，仅能称已完成代码接入，不称真机验收通过。

开发人员可运行 PowerShell：

  ./apps/desktop/scripts/prepare-imaohao-mouse-sdk.ps1 -OutputDirectory apps/desktop/.desktop-build/targets/win-x64/umouse-sdk

随后运行 pnpm run package:desktop:win:x64:unsigned。Windows 安装程序中 resources/umouse-sdk/ 应包含 umouse-bridge.exe、uMouseSdk.dll、依赖及许可文件。