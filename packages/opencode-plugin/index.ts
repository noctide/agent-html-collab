// ProtoBridge · OpenCode 适配层(③)
// 作用:用户在 studio 点「发送反馈」→ 反馈包落盘 → 本插件发现新包 → 向"目标会话"投一条消息,
//       agent 自动接手处理。运行时(studio/serve.mjs)完全不知道本插件存在(方案 A,零耦合)。
//
// 目标会话如何确定(优先级):
//   1) 显式绑定:在某个会话里发送触发词「启用协同」或「/protobridge bind」→ 该会话成为目标并持久化;
//   2) 最近一次"用户输入"所在的会话(只在 prompt 钩子更新,后台事件不会抢占);
//   3) 最近一次的会话事件(兜底)。
// 说明:OpenCode 插件 API 没有"当前聚焦会话",页面(studio)也无法自己识别会话;
//       因此"发给哪个对话"必须由对话侧声明(发触发词),页面开关只控制"是否自动通知"。
//       studio 反馈包可带 notify:false,表示本次不自动唤醒(需用户手动说「处理反馈」)。
//
// 安装(任选):
//   全局(装一次,所有项目生效): protobridge install-plugin
//     或 opencode plugin add 'github:noctide/protobridge::path:packages/opencode-plugin'
//   单项目: 把本目录复制到 <项目>/.opencode/plugins/protobridge/
// 重启 OpenCode 后生效。
// 注意:本文件只用 node: 内置模块,不导入 @opencode/plugin(自定义运行时的本地加载器不做 node_modules 解析)。
import fs from "node:fs"
import path from "node:path"
import os from "node:os"

const FEEDBACK_RE = /^feedback-.*\.json$/
const CONFIG_NAME = "proto.config.json"
const POLL_MS = 800
const DBG = path.join(os.tmpdir(), "protobridge-plugin.log")
const log = (m: string) => { try { fs.appendFileSync(DBG, new Date().toISOString() + " " + m + "\n") } catch { /* ignore */ } }

/* 触发词:命中即把当前会话绑定为反馈目标(去空白/大小写/尾部标点后比较) */
const BIND_TRIGGERS = ["启用协同", "/protobridge bind", "protobridge bind"]
const normalize = (s: any) => String(s == null ? "" : s).trim().toLowerCase().replace(/[。.!！\s]+$/g, "")
const isBindTrigger = (t: any) => BIND_TRIGGERS.includes(normalize(t))

export default {
  id: "protobridge",
  async setup(ctx: any) {
    const root: string = ctx.location?.directory || process.cwd()
    const isSessionID = (v: any) => typeof v === "string" && v.startsWith("ses")

    /* 1) 维护"目标会话"信号:显式绑定 + 最近用户输入 + 最近事件(兜底) */
    let bound: { sessionID: string; at: number } | undefined = (await ctx.storage.get("bound")) as any
    const lastPrompt: Record<string, number> = ((await ctx.storage.get("lastPrompt")) as any) || {}
    const lastEvent: Record<string, number> = {}

    const bind = (sid: any) => {
      if (!isSessionID(sid)) return
      bound = { sessionID: sid, at: Date.now() }
      void ctx.storage.set("bound", bound)
      log("bound session " + sid)
    }
    const notePrompt = (sid: any) => {
      if (!isSessionID(sid)) return
      lastPrompt[sid] = Date.now()
      void ctx.storage.set("lastPrompt", lastPrompt)
    }
    const noteEvent = (sid: any) => { if (isSessionID(sid)) lastEvent[sid] = Date.now() }
    const newest = (m: Record<string, number>) => {
      let best: string | undefined, ts = -1
      for (const k of Object.keys(m)) if (m[k] > ts) { ts = m[k]; best = k }
      return best
    }
    const pickTarget = () => (bound && isSessionID(bound.sessionID) ? bound.sessionID : newest(lastPrompt) || newest(lastEvent))

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
          let e: any = raw
          if (typeof e === "string") { try { e = JSON.parse(e) } catch { continue } }
          noteEvent(e?.properties?.sessionID ?? e?.sessionID ?? e?.data?.sessionID)
        }
      } catch { /* 流结束/中断忽略 */ }
    })()
    try {
      await ctx.session.hook("prompt", (event: any) => {
        const sid = event?.sessionID ?? event?.session?.id
        notePrompt(sid)
        if (isBindTrigger(event?.prompt?.text ?? event?.text)) bind(sid)
      })
    } catch { /* 钩子不可用时靠事件流 */ }

    /* 2) 发现反馈目录:扫描项目内 proto.config.json 的 server.feedbackDir;跳过 examples/tests 夹具 */
    const dirs = new Set<string>()
    const addFromConfig = (cfgPath: string) => {
      try {
        const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"))
        const fd = (j.server && j.server.feedbackDir) || "feedback/"
        dirs.add(path.resolve(path.dirname(cfgPath), fd))
      } catch { /* 忽略坏配置 */ }
    }
    const discover = (dir: string, depth: number) => {
      if (depth < 0) return
      let entries: any[] = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const ent of entries) {
        if (ent.name === "node_modules" || ent.name === ".git") continue
        const full = path.join(dir, ent.name)
        if (["examples", "tests"].includes(path.relative(root, full).split(path.sep)[0])) continue  // 测试夹具不唤醒真实会话
        if (ent.isFile() && ent.name === CONFIG_NAME) addFromConfig(full)
        else if (ent.isDirectory()) discover(full, depth - 1)
      }
    }
    discover(root, 3)
    if (!dirs.size) dirs.add(path.resolve(root, "feedback"))
    log("loaded root=" + root + " dirs=" + JSON.stringify([...dirs]))

    /* 3) 扫描新反馈包并唤醒(首次扫描只登记;独占标记文件原子去重,防多实例重复唤醒) */
    const markDir = path.join(os.tmpdir(), "protobridge-woken")
    try { fs.mkdirSync(markDir, { recursive: true }) } catch { /* ignore */ }
    const claim = (key: string) => {
      const h = Buffer.from(key).toString("base64url").slice(0, 180)
      try { fs.writeFileSync(path.join(markDir, h), "1", { flag: "wx" }); return true } catch { return false }
    }
    const notifyOff = (file: string) => {
      try { return JSON.parse(fs.readFileSync(file, "utf8"))?.notify === false } catch { return false }
    }
    const deliver = async (sid: string, file: string) => {
      await ctx.session.prompt({
        sessionID: sid,
        text: `ProtoBridge:新反馈包 ${path.basename(file)},请按 AGENTS.md 约定读取并处理。\n包路径:${file}`,
        delivery: "queue",
      })
      log("woke session " + sid + " for " + file)
    }
    const wake = async (file: string) => {
      const target = pickTarget()
      if (!target) { log("new feedback but no target session yet: " + file); return }
      try {
        await deliver(target, file)
      } catch (e: any) {
        // 绑定会话可能已关闭:清掉绑定,退回最近用户输入/事件
        if (bound && target === bound.sessionID) {
          bound = undefined
          try { await ctx.storage.remove("bound") } catch { /* ignore */ }
          const alt = pickTarget()
          if (alt && alt !== target) { try { await deliver(alt, file); return } catch { /* fallthrough */ } }
        }
        log("wake failed: " + String(e?.message || e))
      }
    }
    let priming = true
    const scan = () => {
      for (const d of dirs) {
        let files: string[] = []
        try { files = fs.readdirSync(d) } catch { continue }
        for (const f of files) {
          if (!FEEDBACK_RE.test(f)) continue
          const key = d + "/" + f
          if (!claim(key)) continue          // 已被任意实例处理过
          const full = path.join(d, f)
          if (!priming && !notifyOff(full)) void wake(full)
        }
      }
      priming = false
    }
    scan()
    const timer = setInterval(scan, POLL_MS)

    return () => {
      clearInterval(timer)
      controller.abort()
    }
  },
}
