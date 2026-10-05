# ZCode 本地验证记录

本轮只增加本地研究文件，不修改 ZCode checkout，不 commit、push 或创建 PR。

## 已验证

- 功能分支：`662c30bea4e833acaacbfb745a65eb09c23d55f8`，提交时间为 2026-09-29 08:46:19 UTC，标题 `feat: add UI plugins and Gen UI`。
- 本机正在运行的程序路径：`D:/07_software/ZCode/ZCode.exe`。
- 直接从该安装的 `resources/app.asar` 读取元数据：版本 3.14.4，构建提交 `10bbcea5`，构建时间 2026-09-29 02:49:35 UTC。
- 安装包构建时间早于所查功能提交约六小时。这支持功能分支与安装版不同步的解释，但时间本身不能证明功能缺失；`10bbcea5` 不在当前本地 Git 对象库中，未验证祖先关系。
- `node research/zcode-local-validation.cjs` 执行分支实际消息适配模块，12 项检查通过。详见 JSON 结果。

## 验证边界

脚本将分支 TypeScript 转译后在 VM 执行；会话入口、确认对话框、宿主端口与共享常量使用 fixture。它验证真实适配代码的取消、失效检查、发送 ACK 和附件失败行为，不证明 SDK 握手、Electron 页面加载、真实会话投递或 3.14.4 兼容。

现有 main checkout 的依赖缺少功能分支需要的 `@modelcontextprotocol/ext-apps`。未更改该 checkout 的依赖或切换分支。完整桌面测试需在功能分支的独立源码目录安装对应锁文件依赖，并使用临时 profile 和模型 fixture，避免接触现有用户会话。

当前适配建议：优先验证现成 `ui.surfaces` + MCP Apps 页面调用服务保存反馈 + `App.sendMessage()` 投递会话。不依据现有源码能力宣称官网安装版支持，也不新增原生接口。
