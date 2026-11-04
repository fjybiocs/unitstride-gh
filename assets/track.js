/* unitstride 阅读埋点（GA4 自定义事件）。只由 build.py 的 GA_JS 在正式域名上动态加载；
   公共参数 page_type / page_lang / article_id 由 GA_JS 作为 config 参数设好，window.usPage 同值。
   read_end / section_dwell 在页面隐藏 / 离开时（GA_JS 的 usHide 钩子：visibilitychange、beforeunload、pagehide）
   及点站内链接时发增量，同一页可发多次。 */
(function () {
  var w = window, d = document, P = w.usPage, g = w.gtag;
  if (!P || typeof g != 'function') return;
  function ev(n, o) { try { g('event', n, o || {}) } catch (e) {} }
  function cut(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.slice(0, n || 100) }
  var SITE = /(^|\.)unitstride\.com$/;
  function leave() { (w.usHide || []).forEach(function (f) { try { f() } catch (x) {} }) }

  try {  /* 语言自动跳转：来源页的 LANG_JS 写 "zh>auto"（按浏览器语言）或 "zh>pref"（按记住的偏好） */
    var r = sessionStorage.getItem('us-lr');
    if (r) { sessionStorage.removeItem('us-lr'); r = r.split('>'); ev('lang_redirect', {from_lang: r[0], to_lang: P.page_lang, reason: r[1] || ''}) }
  } catch (e) {}
  if (P.page_type == '404') ev('page_not_found', {req_path: cut(location.pathname + location.search), ref_url: cut(d.referrer)});

  var main = P.page_type == 'article' && d.querySelector('main');
  var hs = main ? [].slice.call(main.querySelectorAll('h2, h3')) : [];
  function sec(h) {  /* h = null：第一个标题之前（导语） */
    if (!h) return {section_index: 0, section_id: 'intro', section_title: cut((d.querySelector('h1') || {}).textContent || 'intro')};
    return {section_index: hs.indexOf(h) + 1, section_id: h.id, section_title: htext(h)};
  }
  function htext(h) { return cut([].map.call(h.childNodes, function (n) { return n.textContent }).join(' ')) }  /* "2.1 两种 KV…"：编号与标题间留空格 */
  function secOf(node) {  /* 文档顺序里 node 之前的最后一个标题 */
    var c = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].compareDocumentPosition(node) & 4) c = hs[i];
    return c;
  }

  var area = function (a) {
    if (a.closest('#toc')) return 'toc';
    if (a.closest('.us-top, .us-hlang')) return 'top';
    if (a.closest('.us-nav')) return 'prevnext';
    if (a.closest('.us-afoot, .us-foot')) return 'end';
    if (a.closest('.us-list')) return 'list';
    return 'body';
  };
  d.addEventListener('click', function (e) {
    var t = e.target, el = t && t.closest ? t : t && t.parentElement;
    if (!el) return;
    var a = el.closest('a[href]'), f = el.closest('figure');
    if (a) {
      var u; try { u = new URL(a.href, location.href) } catch (x) { return }
      var lg = a.getAttribute('data-us-lang');
      if (lg) { ev('lang_switch', {from_lang: P.page_lang, to_lang: lg}); return leave() }
      if (u.origin == location.origin && u.pathname == location.pathname && u.hash) {
        var h = d.getElementById(decodeURIComponent(u.hash.slice(1)));
        return ev('anchor_click', {link_area: area(a), target_id: cut(u.hash.slice(1)), target_title: h ? htext(h) : ''});
      }
      if (SITE.test(u.hostname) || u.origin == location.origin)
        ev('nav_click', {link_path: cut(u.pathname), link_area: area(a), link_text: cut(a.textContent, 60)});
      return leave();  /* 跳走前先把 read_end 入队（同 GA_JS 的离开钩子） */
    }
    if (f && main) {
      var c = el.closest('button, input, select, label, [role=button], [data-l]');
      if (c) ev('fig_interact', {fig_index: figs.indexOf(f) + 1, fig_name: f.getAttribute('data-fig') || '',
        control: cut(c.textContent || c.getAttribute('aria-label') || c.value, 60)});
    }
  }, true);

  if (!main) return;  /* 以下只在文章页 */

  var figs = [].slice.call(main.querySelectorAll('figure'));
  var end = main.querySelector('aside.media');  /* 正文止于文末名片之前 */
  var maxPct = 0, MARKS = [10, 25, 50, 75, 90, 100], fired = {};
  function progress() {
    var top = main.getBoundingClientRect().top, bot = end ? end.getBoundingClientRect().top : main.getBoundingClientRect().bottom;
    var p = bot - top > 0 ? Math.round(Math.min(1, Math.max(0, (innerHeight - top) / (bot - top))) * 100) : 100;
    if (p > maxPct) maxPct = p;
    MARKS.forEach(function (m) { if (maxPct >= m && !fired[m]) { fired[m] = 1; ev('read_progress', {percent: m}) } });
  }
  function current() {  /* 视口中心所在章节 */
    var c = null, y = innerHeight / 2;
    for (var i = 0; i < hs.length; i++) if (hs[i].getBoundingClientRect().top <= y) c = hs[i];
    return c;
  }

  /* 标题 / 图首次"真正看到"：进入视口（图要露出 40% 或半屏）并停留 ≥1s 才算，滚动 / 目录平滑跳转一闪而过的不算 */
  if (w.IntersectionObserver) {
    var seen = new IntersectionObserver(function (es) {
      es.forEach(function (x) {
        var t = x.target, f = t.tagName == 'FIGURE';
        t.usIn = x.isIntersecting && (!f || x.intersectionRatio >= 0.4 || x.intersectionRect.height >= innerHeight / 2);
        if (t.usIn && !t.usT) t.usT = setTimeout(function () {
          t.usT = 0;
          if (!t.usIn) return;
          seen.unobserve(t);
          if (f) ev('figure_view', {fig_index: figs.indexOf(t) + 1, fig_name: t.getAttribute('data-fig') || '',
            fig_anim: t.getAttribute('data-publish') == 'gif' ? 1 : 0, section_id: (secOf(t) || {}).id || 'intro'});
          else ev('section_view', sec(t));
        }, 1000);
      });
    }, {threshold: [0, 0.4, 1]});
    hs.forEach(function (h) { seen.observe(h) });
    figs.forEach(function (f) { seen.observe(f) });  /* fig_anim=1 的图可见 40% 时开始播放动画，figure_view 即"动画开播" */
  }

  var hovered = [];
  main.addEventListener('mouseover', function (e) {
    var f = e.target.closest && e.target.closest('figure');
    if (f && hovered.indexOf(f) < 0) { hovered.push(f); ev('figure_hover', {fig_index: figs.indexOf(f) + 1, fig_name: f.getAttribute('data-fig') || ''}) }
  });

  d.addEventListener('copy', function () {
    var s = String(getSelection() || ''), n = getSelection().anchorNode;
    if (s.trim()) ev('text_copy', {copy_len: s.length, copy_text: cut(s), section_id: (n && secOf(n) || {}).id || 'intro'});
  });

  /* 有效阅读时长：标签页可见、且最近 30s 内有交互（加载时算一次）才累计；每秒按视口中心章节记停留 */
  var last = Date.now(), total = 0, sent = 0, seq = 0, dwell = {}, dwellSent = {};
  ['scroll', 'mousemove', 'mousedown', 'touchstart', 'keydown', 'wheel'].forEach(function (n) {
    w.addEventListener(n, function () { last = Date.now() }, {passive: true, capture: true});
  });
  var pend = 0;
  w.addEventListener('scroll', function () { if (!pend) { pend = 1; setTimeout(function () { pend = 0; progress() }, 250) } }, {passive: true});
  progress();
  setInterval(function () {
    if (d.visibilityState != 'visible' || Date.now() - last > 30000) return;
    total++;
    var h = current(), k = h ? h.id : 'intro';
    dwell[k] = (dwell[k] || 0) + 1;
  }, 1000);

  function flush() {
    progress();
    var delta = total - sent;
    if (seq && !delta) return;  /* 第一次隐藏必发；之后只在有新的阅读时长时发 */
    seq++; sent = total;
    var h = current(), s = sec(h);
    ev('read_end', {engaged_sec: delta, engaged_total: total, max_percent: maxPct, completed: maxPct >= 90 ? 1 : 0, seq: seq,
      last_section: s.section_title, last_section_id: s.section_id});
    [null].concat(hs).forEach(function (h) {
      var s = sec(h), k = s.section_id, v = dwell[k] || 0, dv = v - (dwellSent[k] || 0);
      if (v >= 5 && dv > 0) { dwellSent[k] = v; s.dwell_sec = dv; ev('section_dwell', s) }
    });
  }
  (w.usHide = w.usHide || []).push(flush);
})();
