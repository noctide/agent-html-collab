window.__ModuleLoader__.load({
  id: 'protobridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ID = 'protobridge';
    const copy = {
      zh: { title: '原型协同', open: '打开原型协同', opening: '正在打开原型…', retry: '重试', description: '编辑原型并将反馈发送给所属对话' },
      en: { title: 'ProtoBridge', open: 'Open ProtoBridge', opening: 'Opening prototype…', retry: 'Retry', description: 'Edit prototypes and send feedback to this conversation' },
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
      if (error) return h('div', { style: { padding: 16 } }, h('p', null, error), h('button', { onClick: () => setAttempt(x => x + 1) }, t('retry')));
      if (!page) return h('p', { style: { padding: 16 } }, t('opening'));
      return h('iframe', { src: page.url, title: t('title'), style: { width: '100%', height: '100%', flex: 1, border: 0 },
        sandbox: 'allow-scripts allow-same-origin allow-downloads' });
    }
    function Launcher({ open, t }) { return h('button', { onClick: open, type: 'button', style: { margin: '4px 0' } }, t('open')); }
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
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: ID, locale: ID,
          inject: () => ({ open: () => ctx.sidebarRight.openTab(ID) }),
        }, Launcher)), 'protobridge: launch');
      },
    };
  },
});
