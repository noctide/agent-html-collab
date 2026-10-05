// Host must inject window.PROTOBRIDGE_HOST before this script executes.
(function () {
  var host = window.PROTOBRIDGE_HOST;
  window.AgentHtmlCollabTransport = {
    isBound: function () { return !!(host && host.version === 1 && typeof host.submitFeedback === 'function'); },
    submitFeedback: function (bundle) {
      if (this.isBound()) return Promise.resolve().then(function () { return host.submitFeedback(bundle); });
      return fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
    },
  };
})();
