# v0.3.0

- 项目更名为 agent-html-collab，界面名称为 Agent HTML Collab。
- OpenCode V2 提供 /agent-html-collab 与 /agent-html-collab-close，安装时迁移旧 ProtoBridge 插件登记。
- 统一扫描和 CLI 参数解析，自动扫描排除子仓库与工具运行页面。
- 修复外部反馈包在报告目录不存在时无法生成报告的问题。
- 共用 Host 移回通用包；通知开关移除重复文案。
- 保留 proto.config.json、PROTOBRIDGE_HOST/PROTOBRIDGE_WAKE 及旧浏览器存储键作为兼容格式。

# v0.2.0（待真实客户端 GUI 验证）

- 移除全局目标和最近会话兜底，按页面实例捕获所属对话。
- DSH：新增 bundle、对话启动按钮、认证 Host 路由和会话控制器投递。
- ZCode：新增原生插件 manifest、会话隔离 stdio MCP，反馈返回当前等待工具。无等待工具时不承诺主动唤醒空闲模型。
- 通知失败保留反馈，重试去重，页面关闭失效。
- 提供 TGZ、ZIP、SHA256 与发布工作流模板（尚未启用）。

9 项协议/集成测试通过；真实客户端安装和 UI 联动仍需验证。旧版全局自动监听已停用。
