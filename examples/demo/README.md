# 示例 · Demo(通用样例)

一个与具体业务无关的 3 页原型,演示 Agent HTML Collab 完整接入:**single 模式 + 区域标注 + 回灌适配器**。
它同时是 `tests/verify-generic.mjs` 的运行夹具。

## 运行

```bash
node <agent-html-collab>/studio/serve.mjs --root examples/demo --config examples/demo/proto.config.json
# 打开 http://127.0.0.1:8131/studio
```

## 文件

- `proto.html`:3 页(各一个 `.pg-sec` 根容器),含 `data-anno` 区域与唯一可编辑文本;
- `proto.config.json`:single 模式、`switch=auto`、`tools.anno=true`、`apply.adapter=apply.mjs`;
- `apply.mjs`:回灌适配器样例(页 → `proto.html`),演示 `plans()` 接口。

## 冒烟

```bash
node <agent-html-collab>/tests/verify-generic.mjs
```
