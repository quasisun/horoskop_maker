/* ============================================================================
 *  app.js  —  Управление приложением: форма, автодополнение города, валидация,
 *  расчёт карты, сборка отчёта, экспорт PDF/JSON, автосохранение, отмена/повтор,
 *  опциональное улучшение заметок через ИИ (онлайн, Anthropic API).
 * ========================================================================== */
(function () {
  'use strict';

  var A = window.AstroData;
  var $ = function (id) { return document.getElementById(id); };

  // поля формы, участвующие в состоянии
  var FIELDS = ['astrologer', 'reportType', 'reportDate', 'firstName', 'lastName',
    'dob', 'tob', 'place', 'lat', 'lon', 'tz', 'tzIana', 'notes', 'remedyNotes',
    'vastuNotes', 'astroGeoNotes', 'apiKey',
    'firstName2', 'lastName2', 'dob2', 'tob2', 'place2', 'lat2', 'lon2', 'tz2', 'tzIana2'];

  var COMPAT_TYPE = 'Совместимость (синастрия)';
  function isCompat() { return $('reportType').value === COMPAT_TYPE; }

  var DRAFT_KEY = 'jyotish-naadi-draft';
  var lastChart = null;
  var attachments = [];   // [{ id, dataUrl, caption, section }]
  var attachSeq = 0;

  /* ---- Мандала (декоративные лепестки) ----------------------------------- */
  function buildMandala() {
    var g = $('petals');
    if (!g) return;
    var paths = '';
    for (var ring = 0; ring < 2; ring++) {
      var r1 = ring === 0 ? 26 : 50;
      var r2 = ring === 0 ? 50 : 74;
      var n = ring === 0 ? 12 : 16;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        var x1 = 100 + r1 * Math.cos(a), y1 = 100 + r1 * Math.sin(a);
        var x2 = 100 + r2 * Math.cos(a), y2 = 100 + r2 * Math.sin(a);
        var ca = a + Math.PI / n;
        var cx = 100 + (r2 + 6) * Math.cos(ca), cy = 100 + (r2 + 6) * Math.sin(ca);
        var ca2 = a - Math.PI / n;
        var cx2 = 100 + (r2 + 6) * Math.cos(ca2), cy2 = 100 + (r2 + 6) * Math.sin(ca2);
        paths += '<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
          ' Q' + cx.toFixed(1) + ',' + cy.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1) +
          ' Q' + cx2.toFixed(1) + ',' + cy2.toFixed(1) + ' ' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' Z"/>';
      }
    }
    g.innerHTML = paths;
  }

  /* ---- Состояние формы --------------------------------------------------- */
  // withImages=false для снимков undo/redo (чтобы не таскать тяжёлый base64);
  // withImages=true для черновика и экспорта JSON.
  function collectState(withImages) {
    var s = {};
    FIELDS.forEach(function (f) { var el = $(f); if (el) s[f] = el.value; });
    if (withImages) s._attachments = attachments;
    return s;
  }
  function applyState(s) {
    FIELDS.forEach(function (f) { var el = $(f); if (el && s[f] !== undefined) el.value = s[f]; });
    if (s._attachments && Object.prototype.toString.call(s._attachments) === '[object Array]') {
      attachments = s._attachments.map(function (a) {
        if (a.id > attachSeq) attachSeq = a.id;
        return a;
      });
      renderAttachments();
    }
  }

  /* ---- Undo / Redo -------------------------------------------------------- */
  var undoStack = [], redoStack = [], suppress = false, snapTimer = null;
  function snapshot() {
    if (suppress) return;
    var s = JSON.stringify(collectState(false));
    if (undoStack.length && undoStack[undoStack.length - 1] === s) return;
    undoStack.push(s);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
  }
  function scheduleSnapshot() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapshot, 500);
  }
  function undo() {
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    suppress = true;
    applyState(JSON.parse(undoStack[undoStack.length - 1]));
    suppress = false;
    updateUndoButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    var s = redoStack.pop();
    undoStack.push(s);
    suppress = true;
    applyState(JSON.parse(s));
    suppress = false;
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('btnUndo').disabled = undoStack.length < 2;
    $('btnRedo').disabled = redoStack.length === 0;
  }

  /* ---- Автосохранение ----------------------------------------------------- */
  function saveDraft(silent) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(collectState(true)));
      if (!silent) toast('Черновик сохранён');
      $('saveStatus').textContent = 'Черновик сохранён · ' + new Date().toLocaleTimeString('ru-RU');
    } catch (e) {
      $('saveStatus').textContent = 'Не удалось сохранить черновик' +
        (attachments.length ? ' (возможно, изображения слишком большие для локального хранилища)' : ' (хранилище недоступно)');
    }
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (raw) { applyState(JSON.parse(raw)); return true; }
    } catch (e) {}
    return false;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---- Изображения / вложения -------------------------------------------- */
  var SECTION_LABEL = { general: 'Общее (Приложения)', vastu: 'Васту', astro: 'Астрогеография' };

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // уменьшение изображения через canvas (макс. ширина 1200px, JPEG ~0.82)
  function processImageFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var maxW = 1200;
        var scale = Math.min(1, maxW / img.width);
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // фон для прозрачных PNG
        ctx.drawImage(img, 0, 0, w, h);
        try { cb(c.toDataURL('image/jpeg', 0.82)); }
        catch (e) { cb(null); }
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function handleImageFiles(fileList) {
    var files = Array.prototype.slice.call(fileList).filter(function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;
    var pending = files.length;
    files.forEach(function (f) {
      processImageFile(f, function (dataUrl) {
        if (dataUrl) {
          attachments.push({ id: ++attachSeq, dataUrl: dataUrl, caption: '', section: 'general' });
        }
        if (--pending === 0) { renderAttachments(); saveDraft(true); }
      });
    });
    $('imageInput').value = '';
  }

  function renderAttachments() {
    var box = $('attachList');
    if (!box) return;
    if (!attachments.length) { box.innerHTML = ''; return; }
    box.innerHTML = attachments.map(function (a) {
      var opts = ['general', 'vastu', 'astro'].map(function (key) {
        return '<option value="' + key + '"' + (a.section === key ? ' selected' : '') + '>' + SECTION_LABEL[key] + '</option>';
      }).join('');
      return '<div class="attach-item" data-id="' + a.id + '">' +
        '<img class="attach-thumb" src="' + a.dataUrl + '" alt="">' +
        '<div class="attach-fields">' +
          '<input class="attach-caption" type="text" placeholder="Подпись к изображению" value="' + escAttr(a.caption) + '">' +
          '<div class="attach-row">' +
            '<select class="attach-section">' + opts + '</select>' +
            '<button class="btn-attach-del" type="button">Удалить</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function findAttach(id) {
    for (var i = 0; i < attachments.length; i++) if (attachments[i].id === id) return attachments[i];
    return null;
  }

  function initAttachments() {
    $('btnAddImages').addEventListener('click', function () { $('imageInput').click(); });
    $('imageInput').addEventListener('change', function (e) { handleImageFiles(e.target.files); });

    var box = $('attachList');
    box.addEventListener('input', function (e) {
      var item = e.target.closest('.attach-item'); if (!item) return;
      var a = findAttach(+item.getAttribute('data-id')); if (!a) return;
      if (e.target.classList.contains('attach-caption')) { a.caption = e.target.value; scheduleSaveImages(); }
    });
    box.addEventListener('change', function (e) {
      var item = e.target.closest('.attach-item'); if (!item) return;
      var a = findAttach(+item.getAttribute('data-id')); if (!a) return;
      if (e.target.classList.contains('attach-section')) { a.section = e.target.value; saveDraft(true); }
    });
    box.addEventListener('click', function (e) {
      if (!e.target.classList.contains('btn-attach-del')) return;
      var item = e.target.closest('.attach-item'); if (!item) return;
      var id = +item.getAttribute('data-id');
      attachments = attachments.filter(function (a) { return a.id !== id; });
      renderAttachments(); saveDraft(true); toast('Изображение удалено');
    });
  }
  var saveImgTimer = null;
  function scheduleSaveImages() { clearTimeout(saveImgTimer); saveImgTimer = setTimeout(function () { saveDraft(true); }, 800); }

  // векторная иконка-самоцвет (огранённый октагон) по цветам камня
  var gemSeq = 0;
  function gemSVG(c) {
    var gid = 'gem' + (gemSeq++);
    var R = 44, r = 20, cx = 50, cy = 50, outer = [], inner = [], i;
    for (i = 0; i < 8; i++) {
      var ang = (22.5 + 45 * i) * Math.PI / 180;
      outer.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]);
      inner.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
    }
    function pts(a) { return a.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
    var facets = '';
    for (i = 0; i < 8; i++) {
      facets += '<line x1="' + outer[i][0].toFixed(1) + '" y1="' + outer[i][1].toFixed(1) +
        '" x2="' + inner[i][0].toFixed(1) + '" y2="' + inner[i][1].toFixed(1) +
        '" stroke="rgba(255,255,255,0.45)" stroke-width="0.8"/>';
    }
    return '<svg viewBox="0 0 100 100" class="gem-svg" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><radialGradient id="' + gid + '" cx="38%" cy="30%" r="80%">' +
      '<stop offset="0%" stop-color="' + c.light + '"/>' +
      '<stop offset="55%" stop-color="' + c.base + '"/>' +
      '<stop offset="100%" stop-color="' + c.dark + '"/></radialGradient></defs>' +
      '<polygon points="' + pts(outer) + '" fill="url(#' + gid + ')" stroke="' + c.dark +
      '" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<polygon points="' + pts(inner) + '" fill="' + c.light + '" fill-opacity="0.30" ' +
      'stroke="rgba(255,255,255,0.6)" stroke-width="0.8"/>' + facets +
      '<ellipse cx="40" cy="33" rx="8.5" ry="4.5" fill="#fff" fill-opacity="0.5"/></svg>';
  }

  // изображения раздела для отчёта (HTML)
  function imagesHTML(section) {
    var imgs = attachments.filter(function (a) { return a.section === section; });
    if (!imgs.length) return '';
    return imgs.map(function (a) {
      return '<figure class="r-figure"><img src="' + a.dataUrl + '" alt="">' +
        (a.caption ? '<figcaption>' + esc(a.caption) + '</figcaption>' : '') + '</figure>';
    }).join('');
  }

  /* ---- Автодополнение города --------------------------------------------- */
  var sugIndex = -1;

  // часовой пояс (IANA) -> смещение UTC в часах для КОНКРЕТНОЙ даты/времени.
  // База IANA в браузере хранит всю историю (декретное время СССР, летнее время,
  // отмену перевода часов и т.д.), поэтому смещение получается исторически верным.
  function offsetForDate(iana, y, mo, d, h, mi) {
    try {
      function offAt(instant) {
        var dtf = new Intl.DateTimeFormat('en-US', {
          timeZone: iana, hour12: false, year: 'numeric', month: '2-digit',
          day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        var p = {};
        dtf.formatToParts(instant).forEach(function (x) { p[x.type] = x.value; });
        var hh = p.hour === '24' ? 0 : +p.hour;
        var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hh, +p.minute, +p.second);
        return (asUTC - instant.getTime()) / 3600000;
      }
      var guess = Date.UTC(y, mo - 1, d, h, mi, 0);
      var o1 = offAt(new Date(guess));
      var o2 = offAt(new Date(guess - o1 * 3600000)); // уточнение возле переходов
      return Math.round(o2 * 4) / 4;                  // до четверти часа
    } catch (e) { return null; }
  }
  // текущее смещение зоны (для подсказки в списке городов)
  function ianaOffsetNow(iana) {
    var n = new Date();
    return offsetForDate(iana, n.getFullYear(), n.getMonth() + 1, n.getDate(), 12, 0);
  }

  // пересчёт пояса по выбранной зоне на дату рождения (sfx: '' или '2')
  function recomputeTz(sfx) {
    sfx = sfx || '';
    var iana = $('tzIana' + sfx).value;
    var note = $('tzNote' + sfx);
    if (!iana) { note.textContent = ''; return; }
    var dob = $('dob' + sfx).value.split('-'), tob = ($('tob' + sfx).value || '12:00').split(':');
    if (dob.length !== 3 || !dob[0]) {
      note.textContent = 'Зона: ' + iana + ' — укажите дату рождения для точного исторического пояса.';
      return;
    }
    var off = offsetForDate(iana, +dob[0], +dob[1], +dob[2], +tob[0] || 0, +tob[1] || 0);
    if (off == null) { note.textContent = ''; return; }
    $('tz' + sfx).value = off;
    note.textContent = 'Авто: UTC' + (off >= 0 ? '+' : '') + off +
      ' — исторический пояс (' + iana + ') на дату рождения. При необходимости поправьте вручную.';
  }

  function initPlaceAutocomplete(sfx) {
    sfx = sfx || '';
    var input = $('place' + sfx), box = $('suggestions' + sfx);
    var geoTimer = null, reqToken = 0, idx = -1;

    function render(list, loading) {
      var html = list.map(function (c, i) {
        return '<div data-i="' + i + '">' + (c.label || c.name) +
          ' <span class="coord">(' + c.lat.toFixed(2) + ', ' + c.lon.toFixed(2) +
          ', UTC' + (c.tz >= 0 ? '+' : '') + c.tz + ')</span></div>';
      }).join('');
      if (loading) html += '<div class="sug-loading">поиск онлайн…</div>';
      if (!html) { box.classList.add('hidden'); return; }
      box.innerHTML = html;
      box.classList.remove('hidden');
      idx = -1;
      box._list = list;
    }
    function pick(c) {
      input.value = c.name;
      $('lat' + sfx).value = (Math.round(c.lat * 10000) / 10000);
      $('lon' + sfx).value = (Math.round(c.lon * 10000) / 10000);
      $('tz' + sfx).value = c.tz;
      $('tzIana' + sfx).value = c.iana || '';
      box.classList.add('hidden');
      recomputeTz(sfx);       // уточняем пояс на дату рождения (если зона известна)
      scheduleSnapshot();
    }
    function localMatches(q) {
      return A.CITIES.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 6);
    }
    // онлайн-геокодер Open-Meteo (находит любой, даже небольшой, город)
    function searchOnline(q, local, token) {
      fetch('https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(q) + '&count=8&language=ru&format=json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (token !== reqToken) return; // ответ устарел
          var have = {};
          local.forEach(function (c) { have[c.name.toLowerCase()] = true; });
          var online = ((data && data.results) || []).map(function (r) {
            var off = r.timezone ? ianaOffsetNow(r.timezone) : null;
            return {
              name: r.name,
              label: r.name + (r.admin1 ? ', ' + r.admin1 : '') + (r.country ? ', ' + r.country : ''),
              lat: r.latitude, lon: r.longitude,
              tz: off == null ? Math.round(r.longitude / 15) : off,
              iana: r.timezone || null
            };
          }).filter(function (c) {
            var k = c.name.toLowerCase();
            if (have[k]) return false; have[k] = true; return true;
          });
          render(local.concat(online).slice(0, 12), false);
        })
        .catch(function () { /* офлайн / нет сети — остаётся локальный список */ });
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      reqToken++;
      if (q.length < 2) {
        if (q.length === 1) render(localMatches(q), false); else box.classList.add('hidden');
        return;
      }
      var local = localMatches(q);
      render(local, true);                 // мгновенно — локальные + индикатор
      clearTimeout(geoTimer);
      var token = reqToken;
      geoTimer = setTimeout(function () { searchOnline(q, local, token); }, 300);
    });
    box.addEventListener('click', function (e) {
      var d = e.target.closest('div[data-i]');
      if (d) pick(box._list[+d.getAttribute('data-i')]);
    });
    input.addEventListener('keydown', function (e) {
      if (box.classList.contains('hidden')) return;
      var items = box.querySelectorAll('div[data-i]');
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); e.preventDefault(); }
      else if (e.key === 'Enter' && idx >= 0) { pick(box._list[idx]); e.preventDefault(); return; }
      else if (e.key === 'Escape') { box.classList.add('hidden'); return; }
      items.forEach(function (it, i) { it.classList.toggle('active', i === idx); });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.field-autocomplete')) box.classList.add('hidden');
    });
  }

  /* ---- Валидация данных рождения (sfx: '' или '2') ----------------------- */
  function validateBirth(sfx) {
    sfx = sfx || '';
    var errs = [];
    if (!$('dob' + sfx).value) errs.push('дата рождения');
    if (!$('tob' + sfx).value) errs.push('время рождения');
    if ($('lat' + sfx).value === '' || isNaN(+$('lat' + sfx).value)) errs.push('широта');
    if ($('lon' + sfx).value === '' || isNaN(+$('lon' + sfx).value)) errs.push('долгота');
    if ($('tz' + sfx).value === '' || isNaN(+$('tz' + sfx).value)) errs.push('часовой пояс');
    var el = $('birthError' + sfx);
    if (errs.length) { el.textContent = 'Заполните: ' + errs.join(', ') + '.'; return false; }
    el.textContent = '';
    return true;
  }

  /* ---- Расчёт карты из формы (sfx: '' или '2') --------------------------- */
  function computeFromForm(sfx) {
    sfx = sfx || '';
    var dob = $('dob' + sfx).value.split('-');     // YYYY-MM-DD
    var tob = $('tob' + sfx).value.split(':');     // HH:MM
    var input = {
      year: +dob[0], month: +dob[1], day: +dob[2],
      hour: +tob[0], minute: +tob[1],
      tzOffset: +$('tz' + sfx).value,
      lat: +$('lat' + sfx).value, lon: +$('lon' + sfx).value
    };
    return window.Jyotish.build(window.Eph.computeChart(input));
  }
  function personName(sfx) {
    sfx = sfx || '';
    return (($('firstName' + sfx).value + ' ' + $('lastName' + sfx).value).trim()) ||
      (sfx ? 'Второй человек' : 'Первый человек');
  }

  /* ---- Таблица планет (экран) -------------------------------------------- */
  var STATUS_LABEL = { green: 'благоприятно', red: 'неблагоприятно', neutral: 'нейтрально' };
  function renderPlanetTable(chart) {
    var rows = ['<tr><th>Планета</th><th>Знак</th><th>Дом</th><th>Градус</th>' +
      '<th>Накшатра</th><th>Пада</th><th>Статус</th></tr>'];
    function row(p) {
      return '<tr><td><b>' + p.name + '</b></td><td>' + p.sign + '</td><td>' + p.house +
        '</td><td>' + p.degStr + '</td><td>' + p.nakshatra + '</td><td>' + p.pada +
        '</td><td class="st-' + p.status + '"><span class="dot ' + p.status + '"></span>' +
        p.statusLabel + '</td></tr>';
    }
    rows.push('<tr><td><b>Лагна</b></td><td>' + chart.lagna.sign + '</td><td>1</td><td>' +
      chart.lagna.degStr + '</td><td>' + chart.lagna.nakshatra + '</td><td>' + chart.lagna.pada +
      '</td><td class="st-neutral">—</td></tr>');
    chart.planets.forEach(function (p) { rows.push(row(p)); });
    $('planetTable').innerHTML = rows.join('');

    $('chartSummary').innerHTML =
      '<div><b>Асцендент (Лагна):</b> ' + chart.ascSign + ' ' + chart.lagna.degStr + '</div>' +
      '<div><b>Накшатра Луны при рождении:</b> ' +
        planetField(chart, 'moon', 'nakshatra') + ', пада ' + planetField(chart, 'moon', 'pada') + '</div>' +
      '<div><b>Аянамша (Лахири):</b> ' + chart.ayanamshaStr + '</div>';
  }
  function planetField(chart, key, field) {
    for (var i = 0; i < chart.planets.length; i++) if (chart.planets[i].key === key) return chart.planets[i][field];
    return '';
  }

  /* ---- Сборка HTML отчёта ------------------------------------------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function buildReport(chart) {
    var astrologer = esc($('astrologer').value || 'Светлана Кройцер');
    var rtype = esc($('reportType').value);
    var rdate = formatRu($('reportDate').value);
    var fullName = esc(($('firstName').value + ' ' + $('lastName').value).trim()) || 'Клиент';
    var place = esc($('place').value);
    var dobStr = formatRu($('dob').value);
    var tob = esc($('tob').value);

    var footline = 'мастер — ' + astrologer + ' — астролог тамильской традиции Наади';

    // --- Обложка ---
    var mandala = $('mandala-template').outerHTML.replace('id="mandala-template"', 'class="mandala"').replace('hidden', '');
    var cover =
      '<div class="page">' +
        '<div class="page-bar-top"></div>' +
        '<div class="report-content cover">' +
          '<div class="cover-title font-jaipur">Астрологический разбор</div>' +
          '<div class="cover-type">' + rtype + '</div>' +
          '<div class="cover-frame">' + mandala +
            '<div class="cover-client">' +
              '<div class="name font-jaipur">' + fullName + '</div>' +
              '<div class="sub">' + (dobStr ? dobStr : '') + (tob ? ', ' + tob : '') +
                (place ? ' · ' + place : '') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="cover-meta">' +
            '<div><span class="lbl">метод:</span> <b>Тамильская астрология Наади</b></div>' +
            '<div><span class="lbl">система:</span> <b>Нирайна (сидерическая)</b></div>' +
            '<div><span class="lbl">аянамша:</span> <b>Лахири</b></div>' +
            '<div><span class="lbl">дата составления:</span> <b>' + rdate + '</b></div>' +
            '<div><span class="lbl">астролог:</span> <b>' + astrologer + '</b></div>' +
          '</div>' +
        '</div>' +
        '<div class="page-bar-bottom"><div class="footline">' + footline + '</div></div>' +
      '</div>';

    // --- Тело отчёта ---
    var body = ['<div class="report-body"><div class="report-content">'];

    // карта + таблица
    body.push('<div class="r-h1 font-jaipur">Натальная карта</div><div class="gold-sep"></div>');
    body.push('<div class="chart-wrap">' + window.Jyotish.renderSVG(chart, { size: 360 }) + '</div>');
    body.push('<div class="chart-legend">Северо-индийский стиль · цифры — номера знаков (1 — Овен … 12 — Рыбы) · ' +
      '<span style="color:#1d7a33;">зелёный</span> — сильная, <span style="color:#df2227;">красный</span> — ослабленная планета</div>');

    body.push('<div class="r-h2 font-jaipur">Положения планет</div>');
    body.push(reportTable(chart));

    // трактовка
    body.push('<div class="r-h2 font-jaipur">Толкование карты</div>');
    var sections = window.Interpret.generate(chart);
    sections.forEach(function (sec) {
      body.push('<div class="r-h2 font-jaipur">' + esc(sec.title) + '</div>');
      sec.paragraphs.forEach(function (p) { body.push('<p>' + esc(p) + '</p>'); });
    });

    // комментарий астролога (отдельным блоком)
    var notes = window.Interpret.polishNotes($('notes').value);
    if (notes.length) {
      body.push('<div class="r-h2 font-jaipur">Комментарий астролога</div>');
      body.push('<div class="note-block"><div class="src-tag">из заметок специалиста</div>');
      notes.forEach(function (p) { body.push('<p>' + esc(p) + '</p>'); });
      body.push('</div>');
    }

    // --- Васту-разбор (если есть заметки / изображения / выбран тип) ---
    var rtypeRaw = $('reportType').value;
    var vNotes = window.Interpret.polishNotes($('vastuNotes').value);
    var vImgs = imagesHTML('vastu');
    if (rtypeRaw === 'Васту-разбор' || vNotes.length || vImgs) {
      body.push('<div class="r-h2 font-jaipur">Васту-разбор</div>');
      body.push('<p>Согласно Васту-шастре каждое направление связано со стихией и планетой и отвечает ' +
        'за свою сферу жизни. Это основа гармонизации пространства:</p>');
      body.push('<table class="r-table"><tr><th>Направление</th><th>Стихия</th><th>Планета</th>' +
        '<th>Сфера</th><th>Рекомендация</th></tr>' +
        window.Interpret.VASTU_DIRECTIONS.map(function (d) {
          return '<tr><td><b>' + esc(d.dir) + '</b></td><td>' + esc(d.elem) + '</td><td>' + esc(d.planet) +
            '</td><td>' + esc(d.sphere) + '</td><td>' + esc(d.rec) + '</td></tr>';
        }).join('') + '</table>');
      if (vNotes.length) {
        body.push('<div class="note-block"><div class="src-tag">из заметок специалиста</div>' +
          vNotes.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>');
      }
      if (vImgs) body.push(vImgs);
    }

    // --- Астрогеография ---
    var aNotes = window.Interpret.polishNotes($('astroGeoNotes').value);
    var aImgs = imagesHTML('astro');
    if (rtypeRaw === 'Астрогеография' || aNotes.length || aImgs) {
      body.push('<div class="r-h2 font-jaipur">Астрогеография</div>');
      window.Interpret.astroGeography(chart).forEach(function (p) { body.push('<p>' + esc(p) + '</p>'); });
      if (aNotes.length) {
        body.push('<div class="note-block"><div class="src-tag">из заметок специалиста</div>' +
          aNotes.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>');
      }
      if (aImgs) body.push(aImgs);
    }

    // упайи
    body.push('<div class="r-h2 font-jaipur">Упайи — рекомендованные средства</div>');
    var rem = window.Interpret.remedies(chart);
    rem.forEach(function (r) {
      body.push('<div class="remedy"><h4>' + esc(r.planet) + '</h4>' +
        '<div class="reason">' + esc(r.reason) + '</div><ul>' +
        r.items.map(function (it) { return '<li>' + esc(it) + '</li>'; }).join('') + '</ul></div>');
    });
    var rnotes = window.Interpret.polishNotes($('remedyNotes').value);
    if (rnotes.length) {
      body.push('<div class="remedy"><h4>Комментарий астролога по упайям</h4>' +
        '<div class="note-block"><div class="src-tag">из заметок специалиста</div>' +
        rnotes.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div></div>');
    }

    // рекомендуемые драгоценные камни
    var gems = window.Interpret.gemstones(chart);
    body.push('<div class="r-h2 font-jaipur">Рекомендуемые драгоценные камни</div>');
    body.push('<p>Камни усиливают благотворные планеты карты. Главный камень соответствует ' +
      'управителю Лагны; дополнительно полезны камни управителей тригон (5 и 9 домов). ' +
      'Носить камень рекомендуется только после консультации, подбора качества и освящения мантрой.</p>');
    gems.recommended.forEach(function (g) {
      body.push(
        '<div class="gem-card">' +
          '<a class="gem-vis" href="' + g.url + '" target="_blank" rel="noopener">' + gemSVG(g.colors) + '</a>' +
          '<div class="gem-info">' +
            '<h4>' + esc(g.stone) + ' — для планеты ' + esc(g.planet) + '</h4>' +
            '<div class="reason">' + esc(g.role) + '</div>' +
            '<ul>' +
              '<li>Металл оправы: ' + esc(g.metal) + '</li>' +
              '<li>Палец: ' + esc(g.finger) + '</li>' +
              '<li>День ношения (впервые надевать): ' + esc(g.day) + '</li>' +
              '<li>Вес: ' + esc(g.weight) + '</li>' +
              (g.mantra ? '<li>Освящение мантрой: «' + esc(g.mantra) + '»</li>' : '') +
            '</ul>' +
            '<a class="gem-link" href="' + g.url + '" target="_blank" rel="noopener">Подобрать на astrostone.ru →</a>' +
          '</div>' +
        '</div>');
    });
    if (gems.cautions.length) {
      body.push('<p class="gem-caution"><b>С осторожностью:</b> без особых показаний обычно ' +
        'не рекомендуются камни ' +
        gems.cautions.map(function (c) { return esc(c.stone) + ' (' + esc(c.name) + ')'; }).join(', ') +
        ' — это управители «трудных» домов (6/8/12). Решение принимается астрологом индивидуально.</p>');
    }

    // приложения (общие изображения)
    var gImgs = imagesHTML('general');
    if (gImgs) {
      body.push('<div class="r-h2 font-jaipur">Приложения</div>');
      body.push(gImgs);
    }

    // подвал
    body.push(
      '<div class="report-footer">' +
        '<div class="school font-jaipur">Школа астрологии</div>' +
        '<div class="lines">Тамильская традиция Наади Джйотиш<br>' +
          'Сидерический зодиак (Нирайна) · Аянамша Лахири</div>' +
        '<div class="sign">Астролог: <b>' + astrologer + '</b></div>' +
      '</div>');

    body.push('</div></div>');

    // печатная «фурнитура» (повторяется на каждой странице при печати)
    var furniture = '<div class="print-furniture">' +
      '<div class="pf-top"></div><div class="pf-bottom"></div>' +
      '<div class="pf-foot">' + footline + '</div></div>';

    return cover + body.join('') + furniture;
  }

  /* ---- Отчёт совместимости (две карты + Гуна Милан) ---------------------- */
  function buildCompatibilityReport(c1, c2) {
    var astrologer = esc($('astrologer').value || 'Светлана Кройцер');
    var rdate = formatRu($('reportDate').value);
    var n1 = esc(personName('')), n2 = esc(personName('2'));
    var footline = 'мастер — ' + astrologer + ' — астролог тамильской традиции Наади';
    var mandala = $('mandala-template').outerHTML
      .replace('id="mandala-template"', 'class="mandala"').replace('hidden', '');

    var cover =
      '<div class="page"><div class="page-bar-top"></div>' +
      '<div class="report-content cover">' +
        '<div class="cover-title font-jaipur">Гороскоп совместимости</div>' +
        '<div class="cover-type">Синастрия · Гуна Милан</div>' +
        '<div class="cover-frame">' + mandala +
          '<div class="cover-client"><div class="name font-jaipur">' + n1 + '<br>и<br>' + n2 + '</div></div>' +
        '</div>' +
        '<div class="cover-meta">' +
          '<div><span class="lbl">метод:</span> <b>Тамильская астрология Наади</b></div>' +
          '<div><span class="lbl">система:</span> <b>Нирайна (сидерическая) · Лахири</b></div>' +
          '<div><span class="lbl">дата составления:</span> <b>' + rdate + '</b></div>' +
          '<div><span class="lbl">астролог:</span> <b>' + astrologer + '</b></div>' +
        '</div>' +
      '</div><div class="page-bar-bottom"><div class="footline">' + footline + '</div></div></div>';

    var gm = window.Interpret.gunaMilan(c1, c2);
    var body = ['<div class="report-body"><div class="report-content">'];
    body.push('<div class="r-h1 font-jaipur">Гороскоп совместимости</div><div class="gold-sep"></div>');
    body.push('<div class="compat-score">' + gm.total + ' / 36 — ' + esc(gm.verdict) + '</div>');

    function personBlock(c, name, sfx) {
      var dobStr = formatRu($('dob' + sfx).value), tob = esc($('tob' + sfx).value), place = esc($('place' + sfx).value);
      var moon = null; c.planets.forEach(function (p) { if (p.key === 'moon') moon = p; });
      return '<div class="r-h2 font-jaipur">' + esc(name) + '</div>' +
        '<p>' + (dobStr || '') + (tob ? ', ' + tob : '') + (place ? ' · ' + place : '') +
        '. Лагна: <b>' + c.ascSign + '</b>; Луна: <b>' + moon.sign + '</b>, накшатра <b>' +
        moon.nakshatra + '</b> (пада ' + moon.pada + ').</p>' +
        '<div class="chart-wrap">' + window.Jyotish.renderSVG(c, { size: 300 }) + '</div>' +
        reportTable(c);
    }
    body.push(personBlock(c1, personName(''), ''));
    body.push(personBlock(c2, personName('2'), '2'));

    body.push('<div class="r-h2 font-jaipur">Гуна Милан — Ашта-кута (36 баллов)</div>');
    var rows = ['<table class="r-table"><tr><th>Кута</th><th>Баллы</th><th>Значение</th></tr>'];
    gm.items.forEach(function (it) {
      rows.push('<tr><td><b>' + esc(it.name) + (it.approx ? ' *' : '') + '</b></td><td>' +
        it.got + ' / ' + it.max + '</td><td>' + esc(it.note) + '</td></tr>');
    });
    rows.push('<tr><td><b>Итого</b></td><td><b>' + gm.total + ' / 36</b></td><td><b>' + esc(gm.verdict) + '</b></td></tr></table>');
    body.push(rows.join(''));
    body.push('<p style="font-size:12px;color:#8a7a68;">Расчёт по классической системе Ашта-кута (8 кут, метод Б. В. Рамана). ' +
      'В разных традициях отдельные баллы (особенно Йони и Вашья) могут незначительно различаться.</p>');

    if (gm.doshas.length) {
      body.push('<div class="r-h2 font-jaipur">Важные предостережения (доши)</div>');
      gm.doshas.forEach(function (d) { body.push('<p class="gem-caution">' + esc(d) + '</p>'); });
    }

    var notes = window.Interpret.polishNotes($('notes').value);
    if (notes.length) {
      body.push('<div class="r-h2 font-jaipur">Комментарий астролога</div>');
      body.push('<div class="note-block"><div class="src-tag">из заметок специалиста</div>' +
        notes.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>');
    }
    var gImgs = imagesHTML('general');
    if (gImgs) { body.push('<div class="r-h2 font-jaipur">Приложения</div>'); body.push(gImgs); }

    body.push('<div class="report-footer"><div class="school font-jaipur">Школа астрологии</div>' +
      '<div class="lines">Тамильская традиция Наади Джйотиш<br>Сидерический зодиак (Нирайна) · Аянамша Лахири</div>' +
      '<div class="sign">Астролог: <b>' + astrologer + '</b></div></div>');
    body.push('</div></div>');

    var furniture = '<div class="print-furniture"><div class="pf-top"></div><div class="pf-bottom"></div>' +
      '<div class="pf-foot">' + footline + '</div></div>';
    return cover + body.join('') + furniture;
  }

  function reportTable(chart) {
    var rows = ['<table class="r-table"><tr><th>Планета</th><th>Знак</th><th>Дом</th>' +
      '<th>Градус</th><th>Накшатра</th><th>Пада</th><th>Статус</th></tr>'];
    rows.push('<tr><td><b>Лагна</b></td><td>' + chart.lagna.sign + '</td><td>1</td><td>' +
      chart.lagna.degStr + '</td><td>' + chart.lagna.nakshatra + '</td><td>' + chart.lagna.pada + '</td><td>—</td></tr>');
    chart.planets.forEach(function (p) {
      var color = p.status === 'green' ? '#1d7a33' : (p.status === 'red' ? '#df2227' : '#8a7a68');
      rows.push('<tr><td><b>' + p.name + '</b></td><td>' + p.sign + '</td><td>' + p.house +
        '</td><td>' + p.degStr + '</td><td>' + p.nakshatra + '</td><td>' + p.pada +
        '</td><td style="color:' + color + ';font-weight:bold;">' + p.statusLabel + '</td></tr>');
    });
    rows.push('</table>');
    return rows.join('');
  }

  function formatRu(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    if (p.length !== 3) return iso;
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  /* ---- Генерация ---------------------------------------------------------- */
  function generate() {
    var compat = isCompat();
    if (compat) {
      if (!validateBirth('')) { toast('Проверьте данные первого человека'); return; }
      if (!validateBirth('2')) { toast('Проверьте данные второго человека'); return; }
    } else {
      if (!validateBirth('')) { toast('Проверьте данные рождения'); return; }
    }
    showOverlay(compat ? 'Рассчитываем карты…' : 'Рассчитываем карту…');
    setTimeout(function () {
      try {
        var c1 = computeFromForm('');
        lastChart = c1;
        renderPlanetTable(c1);
        $('chartHolder').innerHTML = window.Jyotish.renderSVG(c1, { size: 360 });
        if (compat) {
          var c2 = computeFromForm('2');
          $('report-root').innerHTML = buildCompatibilityReport(c1, c2);
        } else {
          $('report-root').innerHTML = buildReport(c1);
        }
        $('calcCard').classList.remove('hidden');
        $('reportActions').classList.remove('hidden');
        $('reportPreview').classList.remove('hidden');
        hideOverlay();
        $('reportActions').scrollIntoView({ behavior: 'smooth' });
        toast(compat ? 'Отчёт совместимости сформирован' : 'Отчёт сформирован');
        saveDraft(true);
      } catch (e) {
        hideOverlay();
        $('birthError').textContent = 'Ошибка расчёта: ' + e.message;
        toast('Ошибка расчёта');
      }
    }, 60);
  }

  // показать/скрыть блок второго человека и подправить заголовок
  function updateCompatUI() {
    var compat = isCompat();
    $('person2Card').classList.toggle('hidden', !compat);
    $('birthHeading').textContent = compat ? 'Данные рождения — первый человек' : 'Данные рождения';
  }

  function showOverlay(msg) { $('overlayMsg').textContent = msg; $('overlay').classList.add('show'); }
  function hideOverlay() { $('overlay').classList.remove('show'); }

  /* ---- Копирование текста ------------------------------------------------- */
  function copyText() {
    if (!lastChart) { toast('Сначала сформируйте отчёт'); return; }
    var root = $('report-root').cloneNode(true);
    var fr = root.querySelector('.print-furniture');
    if (fr) fr.remove();
    var text = root.innerText.replace(/\n{3,}/g, '\n\n').trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Текст скопирован'); },
        function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Текст скопирован'); }
    catch (e) { toast('Не удалось скопировать'); }
    document.body.removeChild(ta);
  }

  /* ---- Прямое скачивание PDF (без диалога печати) ------------------------ */
  function downloadPDF() {
    if (!lastChart) { toast('Сначала сформируйте отчёт'); return; }
    if (typeof html2pdf === 'undefined') { toast('Модуль PDF не загрузился — используйте «Печать»'); return; }
    var base = ('goroskop_' + ($('lastName').value || '') + '_' + ($('firstName').value || ''))
      .trim().replace(/\s+/g, '_');
    showOverlay('Готовим PDF-файл…');

    // Отдельный контейнер с собственной вёрсткой — не зависит от ширины окна
    // и медиазапросов, фиксированная высота обложки убрана (нет пустых страниц).
    var src = $('report-root').cloneNode(true);
    var pf = src.querySelector('.print-furniture'); if (pf) pf.remove();
    var stage = document.createElement('div');
    stage.className = 'pdf-stage';
    var holder = document.createElement('div');
    holder.className = 'pdf-doc';
    while (src.firstChild) holder.appendChild(src.firstChild);
    stage.appendChild(holder);
    document.body.appendChild(stage);

    function done() { if (stage.parentNode) stage.parentNode.removeChild(stage); hideOverlay(); }
    var opt = {
      margin: [12, 12, 14, 12],                 // поля: верх, лево, низ, право (мм)
      filename: (base || 'goroskop') + '.pdf',
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1000 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // avoid-all: ни один блок (абзац, таблица, карточка) не рвётся между страниц
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    var ready = (window.document && document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    ready.then(function () {
      html2pdf().set(opt).from(holder).save()
        .then(function () { done(); toast('PDF сохранён'); })
        .catch(function () { done(); toast('Не удалось создать PDF — попробуйте «Печать»'); });
    });
  }

  /* ---- JSON экспорт/импорт ------------------------------------------------ */
  function exportJSON() {
    var data = collectState(true);
    data._meta = { app: 'jyotish-naadi', version: 2, exported: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var fn = ('goroskop_' + ($('lastName').value || '') + '_' + ($('firstName').value || '')).trim();
    a.href = url; a.download = (fn || 'goroskop') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Проект экспортирован');
  }
  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        applyState(data);
        snapshot();
        toast('Проект импортирован');
      } catch (e) { toast('Не удалось прочитать файл'); }
    };
    reader.readAsText(file);
  }

  /* ---- Улучшение заметок через ИИ (онлайн, Anthropic API) ----------------- */
  function polishWithAI() {
    var key = $('apiKey').value.trim();
    var text = $('notes').value.trim();
    if (!text) { toast('Сначала впишите заметки'); return; }
    if (!key) { $('aiStatus').textContent = 'Укажите API-ключ для онлайн-улучшения (или текст будет структурирован офлайн при генерации).'; return; }

    $('aiStatus').textContent = 'Обращение к ИИ…';
    $('btnPolishAI').disabled = true;

    var prompt = 'Ты — редактор текстов ведического астролога. Отредактируй заметки на русском языке: ' +
      'исправь орфографию и грамматику, перестрой неуклюжие фразы, раздели на логичные абзацы, ' +
      'сделай слог изящным и профессиональным. СОХРАНИ все предсказания и смыслы без искажений. ' +
      'Не добавляй новых астрологических утверждений. Верни только отредактированный текст.\n\nЗаметки:\n' + text;

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    }).then(function (r) { return r.json(); }).then(function (data) {
      $('btnPolishAI').disabled = false;
      if (data && data.content && data.content[0] && data.content[0].text) {
        $('notes').value = data.content[0].text.trim();
        $('aiStatus').textContent = 'Готово — текст улучшен ИИ.';
        scheduleSnapshot();
      } else {
        $('aiStatus').textContent = 'Ответ ИИ не распознан' + (data && data.error ? ': ' + data.error.message : '') + '.';
      }
    }).catch(function (e) {
      $('btnPolishAI').disabled = false;
      $('aiStatus').textContent = 'Не удалось обратиться к ИИ (нет сети или ограничение браузера). Текст будет структурирован офлайн при генерации.';
    });
  }

  /* ---- Инициализация ------------------------------------------------------ */
  function init() {
    buildMandala();
    initPlaceAutocomplete('');
    initPlaceAutocomplete('2');
    initAttachments();

    // дата составления = сегодня (редактируемо)
    var today = new Date();
    var iso = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    $('reportDate').value = iso;

    var hadDraft = loadDraft();
    if (!$('reportDate').value) $('reportDate').value = iso;

    // слушатели
    $('btnGenerate').addEventListener('click', generate);
    $('btnSaveDraft').addEventListener('click', function () { saveDraft(false); });
    $('btnExportJSON').addEventListener('click', exportJSON);
    $('btnImportJSON').addEventListener('click', function () { $('importFile').click(); });
    $('importFile').addEventListener('change', function (e) { if (e.target.files[0]) importJSON(e.target.files[0]); });
    $('btnPDFFile').addEventListener('click', downloadPDF);
    $('btnPDF').addEventListener('click', function () { window.print(); });
    $('btnCopy').addEventListener('click', copyText);
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnPolishAI').addEventListener('click', polishWithAI);

    FIELDS.forEach(function (f) {
      var el = $(f);
      if (el) el.addEventListener('input', scheduleSnapshot);
      if (el && el.tagName === 'SELECT') el.addEventListener('change', scheduleSnapshot);
    });

    // при изменении даты/времени рождения пересчитываем исторический пояс (оба человека)
    ['', '2'].forEach(function (sfx) {
      $('dob' + sfx).addEventListener('change', function () { recomputeTz(sfx); });
      $('tob' + sfx).addEventListener('change', function () { recomputeTz(sfx); });
      // ручная правка пояса убирает авто-зону, чтобы не перетиралось
      $('tz' + sfx).addEventListener('input', function () { $('tzIana' + sfx).value = ''; $('tzNote' + sfx).textContent = ''; });
    });
    // показывать второй блок данных для гороскопа совместимости
    $('reportType').addEventListener('change', updateCompatUI);
    updateCompatUI();
    recomputeTz('');
    recomputeTz('2');   // восстановить подписи после загрузки черновика

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(false); }
    });

    snapshot();                         // базовое состояние
    setInterval(function () { saveDraft(true); }, 30000);   // автосохранение каждые 30 с
    if (hadDraft) $('saveStatus').textContent = 'Загружен сохранённый черновик.';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
