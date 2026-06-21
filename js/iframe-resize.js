/* Авто-подгон высоты при встраивании через iframe (Вариант Б, см. README).
   Безвреден при прямом открытии страницы: если она НЕ во фрейме
   (window.parent === window) — ничего не отправляется. */
(function () {
  if (window.parent === window) { return; } // не во фрейме — ничего не делаем
  var last = 0;
  // Меряем высоту КОНТЕНТА (box body), а НЕ documentElement.scrollHeight:
  // во фрейме scrollHeight «приклеен» к высоте вьюпорта и не уменьшается при
  // скрытии данных, из-за чего iframe не сжимался бы обратно.
  function measure() {
    var b = document.body;
    return b ? Math.ceil(b.getBoundingClientRect().height) : 0;
  }
  function post() {
    var h = measure();
    if (h && h !== last) {
      last = h;
      window.parent.postMessage({ type: 'sd-height', height: h }, '*');
    }
  }
  function observe() {
    if (window.ResizeObserver && document.body) {
      try { new ResizeObserver(post).observe(document.body); } catch (e) {}
    }
  }
  if (document.body) { observe(); } else { document.addEventListener('DOMContentLoaded', observe); }
  window.addEventListener('load', post);
  window.addEventListener('resize', post);
  setInterval(post, 1000); // фолбэк для изменений, не пойманных ResizeObserver
  post();
})();
