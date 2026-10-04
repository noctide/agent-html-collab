// examples/demo/apply.mjs
// 回灌适配器样例:演示 config.apply.adapter 的接口(SPEC §3.4)。
// 本 demo 是 single 模式,所有页都在 proto.html,所以每页都映射到同一文件;
// 内核负责备份 / 文本兜底匹配 / 写回 / 报告 / 归包。
export function plans({ feedback }) {
  const file = 'proto.html';   // 相对 projectRoot
  const edits = (feedback.edits || []).map((record) => ({ record, file, from: record.from, to: record.to }));
  const comments = (feedback.comments || []).map((comment) => ({ comment, file, line: null }));
  return { edits, comments };
}
