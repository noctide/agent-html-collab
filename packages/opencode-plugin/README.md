# protobridge-opencode-plugin

ProtoBridge 的 OpenCode 适配层:用户在 studio 点「发送反馈」→ 反馈包落盘 → 插件自动向**目标会话**投递一条消息,agent 接手处理。

## 安装(三选一)

**1. 用 ProtoBridge CLI(推荐,无需 OpenCode CLI)**
```bash
protobridge install-plugin          # 复制到 ~/.config/opencode/plugins/protobridge
```

**2. 用 OpenCode CLI**
```bash
opencode plugin add 'github:noctide/protobridge::path:packages/opencode-plugin'
```

**3. 手动(单项目)**
把本目录复制到 `<项目>/.opencode/plugins/protobridge/`。

安装后**重启 OpenCode**(或重载配置)生效。

## 用法

- 目标会话:在你想接收反馈的对话里发一次触发词 **`启用协同`** 或 **`/protobridge bind`**。
- 目标优先级:显式绑定 > 最近一次"用户输入"的会话 > 最近事件。
- 反馈包带 `notify:false` 时(studio「协同通知」关)不自动唤醒。
- 自检日志:`%TEMP%\protobridge-plugin.log`(Windows)/ `$TMPDIR/protobridge-plugin.log`。

详见内核 `AGENTS-SNIPPET.md` 与 `skills/proto-bridge/SKILL.md`。
