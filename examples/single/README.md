# 示例 · Single(单文档模式)

整页只有一页的静态文档(没有 `.pg-sec` / `data-page` / 活动类约定),用 **单文档模式** 接入。
它同时是 `tests/verify-single.mjs` 的运行夹具。

## 关键配置

```jsonc
"pages": {
  "container": "body",   // 整页一个容器
  "single": true,        // 把它视为当前页,忽略 activeClass
  "defaultId": "page",   // 无 idAttr 时的稳定页 id(供 localStorage 分页与回灌定位)
  "list": [{ "id": "page", "title": "整页文档" }]
}
```

## 运行

```bash
node <protobridge>/studio/serve.mjs --root examples/single --config examples/single/proto.config.json
# 打开 http://127.0.0.1:8133/studio
```

## 冒烟

```bash
node <protobridge>/tests/verify-single.mjs
```

## 与多页示例的区别

多页(`examples/demo`)靠 `pages.container + activeClass + idAttr` 区分页面;单文档靠 `single + defaultId`。
两者共用同一内核,不需要任何项目专用代码。
