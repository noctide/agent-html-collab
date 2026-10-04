/* ============================================================
   ProtoBridge · 区域标注模块(可选,config.tools.anno=true 时才注入)
   - 编号:HTML 里手写的 data-anno="P01-03"(稳定编号,不自动生成)
   - 意见:点击编号徽章填写,存 localStorage(key: proto.anno.comments)
   - 导出:JSON / Markdown / CSV,含编号 → 源码映射(window.PROTO_ANNO_MAP)
   - 配置:读取 window.PROTOBRIDGE_CFG(studio 注入),兼容内置默认值
   ============================================================ */
(function () {
  'use strict';
  var CFG = (typeof window !== 'undefined' && window.PROTOBRIDGE_CFG) || {};
  var PC = CFG.pages || {};
  var CONTAINER = PC.container || '.pg-sec';
  var ACTIVE = PC.activeClass || 'act';
  var IDATTR = PC.idAttr || 'data-page';

  var ST = CFG.storage || {};
  var LS_MODE = ST.annoMode || 'proto.anno.mode';
  var LS_COMMENTS = ST.comments || 'proto.anno.comments';

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* 当前页 id:优先活动容器,回退 body 属性(单文件方案稿必须这样取) */
  function activeRoots() {
    var list = document.querySelectorAll(CONTAINER);
    if (list.length <= 1) return null;               /* 单页文档:全文档即一页 */
    var act = document.querySelector(CONTAINER + '.' + ACTIVE);
    return act ? [act] : [];
  }
  function pageId() {
    var act = document.querySelector(CONTAINER + '.' + ACTIVE);
    if (act && act.getAttribute(IDATTR)) return act.getAttribute(IDATTR);
    return document.body.getAttribute(IDATTR) || '';
  }
  function TLQ(sel) {
    var roots = activeRoots();
    if (!roots) return document.querySelectorAll(sel);
    var out = [];
    roots.forEach(function (r) { Array.prototype.push.apply(out, r.querySelectorAll(sel)); });
    return out;
  }

  var comments = lsGet(LS_COMMENTS, {});   // { "P01-03": {type,priority,author,comment,updatedAt,region,page} }
  var mode = lsGet(LS_MODE, '0') === '1' || new URLSearchParams(location.search).get('anno') === '1';
  var srcMap = null;
  var badgeLayer = null;
  var popEl = null;
  var currentId = null;

  /* ---------- 源码映射 ---------- */
  if (window.PROTO_ANNO_MAP) { srcMap = window.PROTO_ANNO_MAP; refreshPopSrc(); }
  else {
    fetch('../annotations/annotation-map.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { srcMap = j; refreshPopSrc(); })
      .catch(function () { srcMap = null; });
  }
  function srcOf(id) {
    if (!srcMap || !srcMap.pages) return null;
    var pg = srcMap.pages[pageId()];
    if (!pg) return null;
    for (var i = 0; i < (pg.regions || []).length; i++) if (pg.regions[i].id === id) return pg.file + ':' + pg.regions[i].line;
    return null;
  }

  /* ---------- 徽章层 ---------- */
  function buildBadges() {
    if (badgeLayer) { badgeLayer.remove(); badgeLayer = null; }
    document.documentElement.classList.toggle('pb-anno-on', mode);
    if (!mode) return;
    badgeLayer = document.createElement('div');
    badgeLayer.id = 'pb-badge-layer';
    badgeLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:0;z-index:8999;';
    document.body.appendChild(badgeLayer);
    positionBadges();
    window.addEventListener('resize', positionBadges, { passive: true });
    window.addEventListener('scroll', positionBadges, { passive: true, capture: true });
  }
  function positionBadges() {
    if (!mode || !badgeLayer) return;
    badgeLayer.innerHTML = '';
    TLQ('[data-anno]').forEach(function (el) {
      var id = el.getAttribute('data-anno');
      if (!id) return;
      var r = el.getBoundingClientRect();
      var b = document.createElement('div');
      b.className = 'pb-badge' + (comments[id] ? ' filled' : '');
      b.textContent = id.split('-').slice(1).join('-');
      b.dataset.annoId = id;
      b.title = (el.getAttribute('data-anno-label') || '') + '(' + id + ') — 点击填写意见';
      b.style.left = Math.max(2, r.left + window.scrollX) + 'px';
      b.style.top = Math.max(2, r.top + window.scrollY - 9) + 'px';
      b.addEventListener('click', function (e) { e.stopPropagation(); openEditor(id, b); });
      badgeLayer.appendChild(b);
    });
  }

  /* ---------- 意见编辑 ---------- */
  function closePop() { if (popEl) { popEl.remove(); popEl = null; currentId = null; } document.removeEventListener('click', onDocClick, true); }
  function onDocClick(e) { if (popEl && !popEl.contains(e.target)) closePop(); }
  function openEditor(id, anchor) {
    closePop();
    currentId = id;
    var el = document.querySelector('[data-anno="' + id + '"]');
    var label = el ? (el.getAttribute('data-anno-label') || '') : '';
    var c = comments[id] || {};
    var src = srcOf(id);
    popEl = document.createElement('div');
    popEl.className = 'pb-pop';
    popEl.innerHTML =
      '<div class="pb-pop-head"><b><span class="pb-id">' + id + '</span>' + esc(label) + '</b>' +
      '<button class="pb-btn" data-x="close">✕</button></div>' +
      (src ? '<div class="pb-pop-src">源码 ' + esc(src) + '</div>' : '<div class="pb-pop-src">源码映射未生成</div>') +
      '<div class="pb-pop-body">' +
      '<div class="pb-2col"><div><label>类型</label><select data-f="type">' +
      ['修改', '新增', '删除', '疑问'].map(function (t) { return '<option' + (c.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div><div><label>优先级</label><select data-f="priority">' +
      ['高', '中', '低'].map(function (t) { return '<option' + ((c.priority || '中') === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div><label>修改意见</label><textarea data-f="comment" placeholder="写清希望调整的内容、原因或参考…">' + esc(c.comment || '') + '</textarea></div>' +
      '<div><label>提出人</label><input data-f="author" value="' + esc(c.author || '') + '" placeholder="姓名/角色"></div>' +
      '<div class="pb-pop-foot">' +
      (comments[id] ? '<button class="pb-btn danger" data-x="del">删除意见</button>' : '') +
      '<button class="pb-btn primary" data-x="save">保存</button></div></div>';
    document.body.appendChild(popEl);
    var ar = anchor.getBoundingClientRect();
    var pw = 320, ph = popEl.offsetHeight || 300;
    var left = Math.min(Math.max(8, ar.left), window.innerWidth - pw - 12);
    var top = ar.bottom + 8 + window.scrollY;
    if (ar.bottom + ph + 12 > window.innerHeight) top = Math.max(8, ar.top - ph - 8) + window.scrollY;
    popEl.style.left = left + 'px'; popEl.style.top = top + 'px';
    popEl.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-x');
      if (!act) return;
      e.stopPropagation();
      if (act === 'close') closePop();
      if (act === 'save') {
        var get = function (f) { var n = popEl.querySelector('[data-f="' + f + '"]'); return n ? n.value.trim() : ''; };
        var node = document.querySelector('[data-anno="' + id + '"]');
        comments[id] = {
          region: node ? (node.getAttribute('data-anno-label') || '') : '',
          type: get('type'), priority: get('priority'), comment: get('comment'), author: get('author'),
          page: pageId(), source: srcOf(id) || null, updatedAt: new Date().toISOString()
        };
        lsSet(LS_COMMENTS, comments); closePop(); positionBadges(); notify();
      }
      if (act === 'del') { delete comments[id]; lsSet(LS_COMMENTS, comments); closePop(); positionBadges(); notify(); }
    });
    document.addEventListener('click', onDocClick, true);
  }
  function refreshPopSrc() { if (currentId && popEl) { var e = popEl.querySelector('.pb-pop-src'), s = srcOf(currentId); if (s && e) e.textContent = '源码 ' + s; } }

  function notify() { try { parent.postMessage({ type: 'pbx-anno-updated' }, '*'); } catch (e) {} }

  /* ---------- 导出 ---------- */
  function collectAll() {
    var all = lsGet(LS_COMMENTS, {});
    return Object.keys(all).sort().map(function (id) {
      var c = all[id];
      var pageFile = null, line = null;
      if (srcMap && srcMap.pages) {
        var pg = srcMap.pages[c.page || id.slice(0, 3).toLowerCase()];
        if (pg) { pageFile = pg.file; (pg.regions || []).forEach(function (r) { if (r.id === id) line = r.line; }); }
      }
      return Object.assign({ id: id }, c, { source: pageFile ? pageFile + (line ? ':' + line : '') : null });
    });
  }
  function toMarkdown(list) {
    var out = '# 修改意见清单\n\n导出时间:' + new Date().toLocaleString() + '　共 ' + list.length + ' 条\n\n' +
      '| 编号 | 页面 | 区域 | 类型 | 优先级 | 修改意见 | 提出人 | 源码位置 |\n|---|---|---|---|---|---|---|---|\n';
    list.forEach(function (c) {
      out += '| ' + c.id + ' | ' + (c.page || '') + ' | ' + (c.region || '') + ' | ' + c.type + ' | ' + c.priority +
        ' | ' + (c.comment || '').replace(/\|/g, '\\|').replace(/\n/g, ' ') + ' | ' + (c.author || '') + ' | ' + (c.source || '—') + ' |\n';
    });
    return out;
  }
  function toCsv(list) {
    var e = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
    var rows = [['编号', '页面', '区域', '类型', '优先级', '修改意见', '提出人', '更新时间', '源码位置']];
    list.forEach(function (c) { rows.push([c.id, c.page, c.region, c.type, c.priority, c.comment, c.author, c.updatedAt, c.source]); });
    return '\ufeff' + rows.map(function (r) { return r.map(e).join(','); }).join('\r\n');
  }
  function download(name, text, mime) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
  }
  function openExport() {
    closePop();
    var list = collectAll();
    popEl = document.createElement('div');
    popEl.className = 'pb-pop pb-export';
    popEl.style.cssText = 'position:fixed;right:18px;bottom:110px;width:520px;';
    popEl.innerHTML =
      '<div class="pb-pop-head"><b>修改意见清单(' + list.length + ' 条)</b><button class="pb-btn" data-x="close">✕</button></div>' +
      '<div class="pb-pop-body"><div class="pb-export-tabs"><button class="pb-btn on" data-x="t">Markdown</button><button class="pb-btn" data-x="j">JSON</button><button class="pb-btn" data-x="c">CSV</button></div>' +
      '<pre></pre><div class="pb-pop-foot"><button class="pb-btn" data-x="copy">复制</button>' +
      '<button class="pb-btn primary" data-x="dl">下载当前格式</button><button class="pb-btn" data-x="dlall">下载全部三份</button></div></div>';
    var fmt = 'md';
    var pre = popEl.querySelector('pre');
    var render = function () {
      if (!list.length) { pre.innerHTML = '<span class="pb-empty">暂无意见。点击页面上的编号徽章即可填写。</span>'; return; }
      pre.textContent = fmt === 'md' ? toMarkdown(list) : fmt === 'j' ? JSON.stringify(list, null, 2) : toCsv(list);
      popEl.querySelectorAll('.pb-export-tabs .pb-btn').forEach(function (b, i) { b.classList.toggle('on', ['md', 'j', 'c'][i] === fmt); });
    };
    render();
    popEl.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-x');
      if (!act) return; e.stopPropagation();
      if (act === 'close') closePop();
      if (act === 't') { fmt = 'md'; render(); }
      if (act === 'j') { fmt = 'j'; render(); }
      if (act === 'c') { fmt = 'c'; render(); }
      if (act === 'copy' && list.length) { navigator.clipboard.writeText(pre.textContent); e.target.textContent = '已复制'; }
      if (act === 'dl' && list.length) {
        var base = '修改意见清单-' + new Date().toISOString().slice(0, 10);
        if (fmt === 'md') download(base + '.md', toMarkdown(list), 'text/markdown');
        if (fmt === 'j') download(base + '.json', JSON.stringify(list, null, 2), 'application/json');
        if (fmt === 'c') download(base + '.csv', toCsv(list), 'text/csv');
      }
      if (act === 'dlall' && list.length) {
        var b2 = '修改意见清单-' + new Date().toISOString().slice(0, 10);
        download(b2 + '.md', toMarkdown(list), 'text/markdown');
        setTimeout(function () { download(b2 + '.json', JSON.stringify(list, null, 2), 'application/json'); }, 250);
        setTimeout(function () { download(b2 + '.csv', toCsv(list), 'text/csv'); }, 500);
      }
    });
    document.body.appendChild(popEl);
    document.addEventListener('click', onDocClick, true);
  }

  /* ---------- 悬浮控件 ---------- */
  function buildFab() {
    var fab = document.createElement('div');
    fab.className = 'pb-anno-fab' + (mode ? ' open' : '');
    fab.innerHTML =
      '<div class="pb-anno-tools">' +
      '<button class="pb-tool-btn count" data-x="count"></button>' +
      '<button class="pb-tool-btn" data-x="export">导出修改清单</button>' +
      '<button class="pb-tool-btn" data-x="clear">清空本页意见</button></div>' +
      '<button class="pb-fab-main' + (mode ? ' on' : '') + '" data-x="toggle">⚑ 标注模式' + (mode ? ' · 开' : '') + '</button>';
    fab.addEventListener('click', function (e) {
      var act = e.target.getAttribute && e.target.getAttribute('data-x');
      if (!act) return; e.stopPropagation();
      if (act === 'toggle') setMode(!mode);
      if (act === 'export') openExport();
      if (act === 'clear') {
        var all = lsGet(LS_COMMENTS, {});
        Object.keys(all).forEach(function (k) { if (all[k].page === pageId()) delete all[k]; });
        comments = all; lsSet(LS_COMMENTS, all); positionBadges(); updateCount(); notify();
      }
      if (act === 'count') openExport();
    });
    document.body.appendChild(fab);
    updateCount();
    function updateCount() {
      var n = collectAll().length;
      var c = fab.querySelector('[data-x="count"]');
      if (c) c.textContent = '本页区域 ' + TLQ('[data-anno]').length + ' 个 · 意见 ' + n + ' 条';
    }
  }
  function setMode(v) {
    mode = v; lsSet(LS_MODE, v ? '1' : '0');
    var f = document.querySelector('.pb-anno-fab');
    if (f) {
      f.classList.toggle('open', v);
      var m = f.querySelector('.pb-fab-main');
      m.classList.toggle('on', v);
      m.textContent = '⚑ 标注模式' + (v ? ' · 开' : '');
    }
    closePop(); buildBadges(); notify();
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'pb-anno-set') setMode(!!d.on);
    if (d.type === 'pb-anno-refresh') { comments = lsGet(LS_COMMENTS, {}); closePop(); positionBadges(); }
    if (d.type === 'pbx-page') { comments = lsGet(LS_COMMENTS, {}); positionBadges(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'a' && !/input|textarea|select/i.test(e.target.tagName) && !e.metaKey && !e.ctrlKey && !e.altKey) setMode(!mode);
    if (e.key === 'Escape') closePop();
  });
  function boot() { if (!new URLSearchParams(location.search).get('shot')) buildFab(); buildBadges(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
