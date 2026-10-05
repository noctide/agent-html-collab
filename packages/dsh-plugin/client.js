window.__ModuleLoader__.load({
  id: 'protobridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = 'protobridge';
    const buttonStyle = { display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32, padding: '6px 10px', border: '1px solid var(--dsw-alias-border-l1, #e4e7eb)', borderRadius: 'var(--dsw-radius-md, 8px)', background: 'var(--dsw-specific-menu, #fff)', color: 'var(--dsw-alias-label-secondary, #454b54)', font: 'inherit', fontSize: 13, cursor: 'pointer', WebkitAppRegion: 'no-drag' };
    const icon = () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true }, h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h('path', { d: 'M3 9h18M9 9v11' }));
    function Action({ onClick, children }) { return h('button', { type: 'button', style: buttonStyle, onClick, onMouseEnter: e => { e.currentTarget.style.background = 'var(--dsw-alias-bg-l2, #f2f4f7)'; }, onMouseLeave: e => { e.currentTarget.style.background = buttonStyle.background; } }, children); }
    const copy = {
      zh: { title: '原型协同', open: '打开原型协同', opening: '正在打开原型…', retry: '重试', select: '请先打开已有对话，或发送第一条消息创建对话，再打开原型协同。', description: '编辑原型并将反馈发送给所属对话' },
      en: { title: 'ProtoBridge', open: 'Open ProtoBridge', opening: 'Opening prototype…', retry: 'Retry', select: 'Open an existing conversation, or send the first message to create one, then open ProtoBridge.', description: 'Edit prototypes and send feedback to this conversation' },
    };
    const request = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error || String(r.status)); return j; }));
    function Body({ ownerSessionId, useTabInfo, t }) {
      const { tab } = useTabInfo();
      const [page, setPage] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);
      React.useEffect(() => {
        let disposed = false, opened = null;
        setError(null); setPage(null);
        request('/protobridge/open', { sessionId: ownerSessionId, pageId: tab.id }).then(value => {
          opened = value;
          if (disposed) request(value.url.replace(/\/studio$/, '/close'), {}).catch(() => {});
          else setPage(value);
        }).catch(e => { if (!disposed) setError(e.message); });
        return () => {
          disposed = true;
          if (opened) request(opened.url.replace(/\/studio$/, '/close'), {}).catch(() => {});
        };
      }, [ownerSessionId, tab.id, attempt]);
      if (error || !page) return h('div', { style: { padding: 24, fontFamily: 'inherit', color: 'var(--dsw-alias-label-secondary, #454b54)' } },
        h('div', { role: error ? 'alert' : 'status', style: { padding: 20, border: '1px solid var(--dsw-alias-border-l1, #e4e7eb)', borderRadius: 12, background: 'var(--dsw-specific-menu, #fff)' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 } }, icon(), t('title')),
          h('p', { style: { fontSize: 13, lineHeight: 1.6, margin: '12px 0' } }, error || t('opening')),
          error && h(Action, { onClick: () => setAttempt(x => x + 1) }, t('retry'))));
      return h('iframe', { src: page.url, title: t('title'), style: { width: '100%', height: '100%', flex: 1, border: 0 },
        sandbox: 'allow-scripts allow-same-origin allow-downloads' });
    }
    function PersistentLauncher({ open, t }) {
      const [error, setError] = React.useState(null);
      return h('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center', WebkitAppRegion: 'no-drag' } },
        error && h('p', { role: 'status', style: { position: 'absolute', top: '100%', left: 0, zIndex: 100, width: 280, padding: 12, fontSize: 13, lineHeight: 1.6, border: buttonStyle.border, background: buttonStyle.background, color: buttonStyle.color, borderRadius: 8 } }, error),
        h(Action, { onClick: () => {
          setError(null);
          try { open(); } catch (e) { setError(e.message === 'sidebarRight: no session surface is mounted' ? t('select') : e.message); }
        } }, icon(), t('title')));
    }
    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(ID, copy), 'protobridge: locale');
        const t = ctx.locale.bind(ID);
        ctx.effect(() => ctx.sidebarRightTabs.register({ id: ID, kind: ID, multiple: true, title: () => t('title'), keepMounted: true }), 'protobridge: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: ID, locale: ID,
          inject: sessionId => ({ ownerSessionId: sessionId }),
        }, Body)), 'protobridge: bound pane');
        // DSH rc.2 declares this persistent navigation seat with no built-in occupant.
        ctx.effect(() => ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
          name: 'conversation.header.leading', id: 'protobridge-launcher', locale: ID,
          inject: () => ({ open: () => ctx.sidebarRight.openTab(ID) }),
        }, PersistentLauncher)), 'protobridge: persistent launch');
      },
    };
  },
});
