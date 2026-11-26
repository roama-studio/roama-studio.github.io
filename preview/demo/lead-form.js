/*! © ROAMA. All rights reserved. */
// TASK-0789: the browser part of the lead form template. Plain script, no library. It works with the ROAMA form
// module (it sends on the module's cancelable roama:form:submit, so the module's checks and hints stay) and without
// it (then the browser's own checks run on submit). The form's settings come from its
// <script type="application/json" data-lead-demo-config> block that build.mjs writes from the instance config.
// The first touch of the form takes a form token from the web app (GET ?issue=1); the server measures the fill time
// from it and takes each token once. The POST is a «simple» request (text/plain): no CORS preflight.
// Every text goes in with textContent; a bot link is shown only when it is exactly t.me/<our bot>?start=<nonce>.
// The demo (visitor mode) never ends in a dead form: when the server is busy, the visitor's own row is shown locally.
(function (root) {
  'use strict';

  function payload(form, cfg, token, page) {
    var out = { _tk: String(token || ''), _page: String(page || '').slice(0, 300) };
    cfg.fields.forEach(function (f) {
      var el = form.elements[f.name];
      if (!el) return;
      out[f.name] = f.type === 'checkbox' ? (el.checked ? '1' : '') : String(el.value || '');
    });
    var trap = form.elements[cfg.honeypot];
    out[cfg.honeypot] = trap ? String(trap.value || '') : '';
    return out;
  }

  // The row as the visitor typed it, for the local demo when the server is busy (labels from the config).
  function localRow(cfg, body) {
    return cfg.fields.map(function (f) {
      var v = body[f.name] || '';
      return { label: f.label, value: f.type === 'checkbox' ? (v ? (f.value_on || '1') : '') : String(v).trim() };
    });
  }

  // The server's row in the page's language: the server answers in the config's field order with its own labels
  // and option values; a translated page (a locale) shows its own labels and option texts.
  function pageRow(cfg, row) {
    if (!Array.isArray(row) || row.length !== cfg.fields.length) return row;
    return row.map(function (cell, i) {
      var f = cfg.fields[i];
      var value = String(cell.value);
      return { label: f.label, value: (f.show && f.show[value]) || value };
    });
  }

  function send(endpoint, body, fetchFn) {
    return fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      credentials: 'omit',
    }).then(function (res) { return res.json(); });
  }

  function issue(endpoint, fetchFn) {
    return fetchFn(endpoint + '?issue=1', { credentials: 'omit' })
      .then(function (res) { return res.json(); })
      .then(function (data) { return data && data.ok && typeof data.token === 'string' ? data.token : ''; })
      .catch(function () { return ''; });
  }

  function safeLink(link, bot) {
    if (!bot || typeof link !== 'string') return null;
    var expected = 'https://t.me/' + bot + '?start=';
    var nonce = link.slice(expected.length);
    return link.indexOf(expected) === 0 && /^[a-f0-9]{32}$/.test(nonce) ? link : null;
  }

  function message(cfg, answer) {
    if (answer && answer.ok) return cfg.mode === 'visitor' && answer.link ? cfg.texts.done_visitor : cfg.texts.done;
    var code = answer && answer.error;
    return (cfg.texts.errors && cfg.texts.errors[code]) || cfg.texts.error;
  }

  // Busy or unreachable in the demo -> show the flow locally with a note, never a dead form.
  function localDemo(cfg, answer) {
    return cfg.mode === 'visitor' && !!cfg.texts.demo_local && (!answer || answer.error === 'busy' || answer.error === 'network');
  }

  function el(doc, tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showRow(doc, box, cfg, row) {
    box.textContent = '';
    if (!Array.isArray(row) || !row.length) return;
    box.appendChild(el(doc, 'p', 'lead-demo__caption', cfg.texts.your_row));
    var table = el(doc, 'table', 'lead-demo__row');
    var head = doc.createElement('tr');
    var line = doc.createElement('tr');
    row.forEach(function (cell) {
      head.appendChild(el(doc, 'th', '', String(cell.label)));
      line.appendChild(el(doc, 'td', '', String(cell.value)));
    });
    table.appendChild(head);
    table.appendChild(line);
    box.appendChild(table);
  }

  function waitForStart(cfg, nonce, status, fetchFn, timer) {
    var tries = 0;
    function look() {
      tries += 1;
      if (tries > 36) return; // 3 minutes; the 5-minute trigger still delivers later
      fetchFn(cfg.endpoint + '?n=' + nonce, { credentials: 'omit' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.delivered) status.textContent = cfg.texts.delivered;
          else timer(look, 5000);
        })
        .catch(function () { timer(look, 5000); });
    }
    timer(look, 5000);
  }

  function attach(form, win) {
    var doc = form.ownerDocument;
    var cfg = JSON.parse(form.querySelector('script[data-lead-demo-config]').textContent);
    var status = form.querySelector('[data-lead-demo-status]');
    var result = form.querySelector('[data-lead-demo-result]');
    var button = form.querySelector('[type="submit"]');
    var fetchFn = win.fetch.bind(win);
    var timer = win.setTimeout.bind(win);
    var token = null; // a promise of {token, at}
    var busy = false;

    function takeToken() {
      if (!token) {
        token = issue(cfg.endpoint, fetchFn).then(function (t) { return { token: t, at: Date.now() }; });
      }
      return token;
    }

    function finish(answer, body) {
      busy = false;
      form.removeAttribute('aria-busy');
      if (button) button.disabled = false;
      token = null; // a token is good for one send
      if (localDemo(cfg, answer)) {
        status.textContent = cfg.texts.demo_local;
        showRow(doc, result, cfg, pageRow(cfg, localRow(cfg, body)));
        result.hidden = false;
        return;
      }
      status.textContent = message(cfg, answer);
      if (!answer || !answer.ok) return;
      showRow(doc, result, cfg, pageRow(cfg, answer.row));
      var link = safeLink(answer.link, cfg.bot);
      if (link) {
        var a = el(doc, 'a', 'lead-demo__bot ' + (cfg.button_class || 'roama-btn'), cfg.texts.open_bot);
        a.href = link;
        a.target = '_blank';
        a.rel = 'noopener';
        a.addEventListener('click', function () { status.textContent = cfg.texts.waiting; });
        result.appendChild(a);
        waitForStart(cfg, link.slice(link.length - 32), status, fetchFn, timer);
      }
      result.hidden = false;
      form.reset();
    }

    function go() {
      if (busy) return;
      busy = true;
      form.setAttribute('aria-busy', 'true');
      if (button) button.disabled = true;
      status.textContent = cfg.texts.sending;
      var body = payload(form, cfg, '', win.location.href);
      takeToken().then(function (t) {
        body._tk = t.token;
        var wait = Math.max(0, cfg.min_ms + 300 - (Date.now() - t.at)); // the server counts from the token's time
        return new Promise(function (ok) { timer(ok, wait); });
      }).then(function () {
        return send(cfg.endpoint, body, fetchFn);
      }).catch(function () { return { ok: false, error: 'network' }; })
        .then(function (answer) { finish(answer, body); });
    }

    form.addEventListener('focusin', takeToken, { once: true });
    form.addEventListener('roama:form:submit', function (event) {
      event.preventDefault();
      go();
    });
    // Always: a native submit would put the fields into the URL. The form module, when bound, sets noValidate and
    // sends roama:form:submit itself; without it the browser's checks run here. Decided at submit time.
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (win.ROAMA && form.noValidate) return;
      if (form.checkValidity()) go();
      else form.reportValidity();
    });
    if (button) button.disabled = false; // the button stays off until this script is ready
  }

  function init(doc, win) {
    Array.prototype.forEach.call(doc.querySelectorAll('form[data-lead-demo]'), function (form) {
      if (form.hasAttribute('data-lead-demo-ready')) return;
      form.setAttribute('data-lead-demo-ready', '');
      attach(form, win);
    });
  }

  root.LeadDemo = {
    payload: payload, localRow: localRow, pageRow: pageRow, send: send, issue: issue, safeLink: safeLink, message: message,
    localDemo: localDemo, init: init,
  };
  if (root.document && !root.LeadDemoNoAuto) {
    var start = function () { init(root.document, root); };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
