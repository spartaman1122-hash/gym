/* The ONE place the page talks to the server (replaces google.script.run).
 * window.gymApi(fn, args) -> Promise of the same answer the Apps Script server gave.
 * Every call is one POST to Supabase: /rest/v1/rpc/api {fn, args}. The anon / publishable key is public by design
 * (row level security + the token checks inside api() decide what anyone gets). Never put the service_role key here.
 * pageVer / freshPage (auto-update) read this site's own version.json / index.html: GitHub Pages serves the page. */
(function () {
  var C = window.GYM_CONFIG || {};
  var BUILD_VER = window.GYM_PAGE_VER || '';
  var latestVer = BUILD_VER, verAt = 0;

  function headers() {
    var h = { 'Content-Type': 'application/json', apikey: C.key || '' };
    if (C.key && C.key.indexOf('sb_') !== 0) h.Authorization = 'Bearer ' + C.key;   // old-style anon key is a JWT
    return h;
  }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('Request timed out')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function fetchVer(force) {
    if (!force && Date.now() - verAt < 5 * 60000) return Promise.resolve(latestVer);
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { verAt = Date.now(); if (j && j.ver) latestVer = String(j.ver); return latestVer; })
      .catch(function () { return latestVer; });
  }
  function rpc(fn, args) {
    if (window.__offline) return Promise.reject(new Error('NetworkError: Connection failure due to HTTP 0'));
    return withTimeout(fetch(C.url + '/rest/v1/rpc/api', {
      method: 'POST', headers: headers(), body: JSON.stringify({ fn: fn, args: args || [] }), cache: 'no-store',
    }), 30000).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) {}
        if (!res.ok) throw new Error((body && (body.message || body.msg)) || ('Server error (HTTP ' + res.status + ')'));
        if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.gymError === 'string') throw new Error(body.gymError);
        return body;
      });
    });
  }

  window.gymApi = function (fn, args) {
    if (fn === 'pageVer') return fetchVer(true);
    if (fn === 'freshPage') {
      return fetchVer(true).then(function (ver) {
        return fetch('index.html?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); })
          .then(function (html) { return { ver: ver, html: html }; });
      });
    }
    return rpc(fn, args).then(function (r) {
      // The page compares getData's ver with its own to spot a new version: this site's version.json, read at most
      // every 5 minutes (in the background, never slowing the call down).
      if (fn === 'getData' && r && typeof r === 'object') {
        if (r.login) { try { localStorage.setItem('gym.bootCache', JSON.stringify({ users: r.users })); } catch (e) {} }
        r.ver = latestVer;
        fetchVer(false);
      }
      return r;
    });
  };

  // What the page starts with before the first answer: the login screen as it was last time (names + faces), so
  // the tiles show at once.
  window.gymBoot = function () {
    var users = [];
    try { users = (JSON.parse(localStorage.getItem('gym.bootCache') || '{}').users) || []; } catch (e) {}
    var boot = { login: true, users: users, invite: false, pinMin: 4, pinMax: 8, ver: BUILD_VER };
    // The old server put fresh names + faces into every page load. Here: the saved copy at once, the fresh one a moment
    // later (same object the page keeps as LOGIN, so faces used as photo fallbacks are never stale).
    rpc('getData', ['']).then(function (r) {
      if (!r || !r.login) return;
      boot.users = r.users || boot.users;
      try { localStorage.setItem('gym.bootCache', JSON.stringify({ users: r.users })); } catch (e) {}
      if (typeof window.gymLoginFresh === 'function') window.gymLoginFresh();
    }).catch(function () {});
    return boot;
  };
})();
