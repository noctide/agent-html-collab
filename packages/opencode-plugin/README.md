# ProtoBridge OpenCode Host 适配包

全局安装一次：`protobridge install-plugin`；升级用 `--force` 并重启客户端。HTML 项目不需要复制插件。

此版本移除全局目标文件、最近会话兜底、/protobridge 手动绑定和文件扫描自动通知。

客户端必须提供 `ctx.protobridge.registerPageBridge`、`saveFeedback`、`enqueue`。这些是本项目的接入契约，不是已核实的上游 OpenCode API。未接入时仅保存反馈，不自动通知。

完整生命周期及 RPC 接入见 [Host 接入说明](../../docs/host-integration.md)。
