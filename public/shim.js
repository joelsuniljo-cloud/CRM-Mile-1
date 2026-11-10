/* Gives the page the two services it expects (a saved-data store and the AI)
   by talking to this server's REST API. The page code itself never knows the difference. */
(function () {
  'use strict';
  var inflight = 0, lastWrite = 0;

  async function call(path, opts) {
    var res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts));
    if (!res.ok) {
      var body = {};
      try { body = await res.json(); } catch (e) { /* no body */ }
      throw { code: body.code || (res.status === 429 ? 'rate_limited' : 'upstream_error'), message: body.message || res.statusText };
    }
    return res.status === 204 ? null : res.json();
  }
  async function write(path, method, body) {
    inflight++;
    try { return await call(path, { method: method, body: body === undefined ? undefined : JSON.stringify(body) }); }
    finally { inflight--; lastWrite = Date.now(); }
  }

  function docSnap(id, data) {
    return { id: id, exists: data != null, data: function () { return data == null ? undefined : data; }, metadata: { fromCache: false } };
  }

  var clients = {
    onSnapshot: function (next, error) {
      var stopped = false, failedOnce = false;
      async function pull(initial) {
        if (stopped) return;
        // Do not overwrite the page with a stale list while one of its own writes is in flight.
        if (!initial && (inflight > 0 || Date.now() - lastWrite < 2500)) return;
        try {
          var r = await call('/api/clients');
          if (stopped) return;
          var docs = r.docs.map(function (d) { return docSnap(d.id, d.data); });
          next({ docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false }, docChanges: function () { return []; } });
        } catch (e) {
          if (!failedOnce && initial && error) { failedOnce = true; error(e); }
        }
      }
      pull(true);
      var timer = setInterval(function () { pull(false); }, 15000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) pull(false); });
      return function () { stopped = true; clearInterval(timer); };
    },
    doc: function (id) {
      var p = '/api/clients/' + encodeURIComponent(id);
      return {
        id: id,
        set: function (data) { return write(p, 'PUT', data); },
        update: function (data) { return write(p, 'PATCH', data); },
        delete: function () { return write(p, 'DELETE'); }
      };
    }
  };

  var db = {
    collection: function (name) {
      if (name !== 'clients') throw new TypeError('Unknown collection ' + name);
      return clients;
    },
    doc: function (path) {
      if (path !== 'settings/profile') throw new TypeError('Unknown document ' + path);
      return {
        onSnapshot: function (next, error) {
          call('/api/settings').then(function (r) { next(docSnap('profile', r.exists ? r.data : null)); }, function (e) { if (error) error(e); });
          return function () {};
        },
        set: function (data) { return write('/api/settings', 'PUT', data); }
      };
    }
  };

  async function json(prompt) {
    var r = await call('/api/sample', { method: 'POST', body: JSON.stringify({ prompt: String(prompt) }) });
    return r.value;
  }
  var sample = function () { return Promise.reject({ code: 'capability_removed', message: 'Use sample.json' }); };
  sample.json = json;

  window.claude = {
    use: function (name) {
      return Promise.resolve(name === 'db' ? db : name === 'sample' ? sample : null);
    }
  };
})();
