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
    'dob', 'tob', 'place', 'lat', 'lon', 'tz', 'notes', 'remedyNotes',
    'vastuNotes', 'astroGeoNotes', 'apiKey'];

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
  function initPlaceAutocomplete() {
    var input = $('place'), box = $('suggestions');
    function render(list) {
      if (!list.length) { box.classList.add('hidden'); return; }
      box.innerHTML = list.map(function (c, i) {
        return '<div data-i="' + i + '">' + c.name +
          ' <span class="coord">(' + c.lat.toFixed(2) + ', ' + c.lon.toFixed(2) +
          ', UTC' + (c.tz >= 0 ? '+' : '') + c.tz + ')</span></div>';
      }).join('');
      box.classList.remove('hidden');
      sugIndex = -1;
      box._list = list;
    }
    function pick(c) {
      input.value = c.name;
      $('lat').value = c.lat;
      $('lon').value = c.lon;
      $('tz').value = c.tz;
      box.classList.add('hidden');
      scheduleSnapshot();
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (q.length < 1) { box.classList.add('hidden'); return; }
      var list = A.CITIES.filter(function (c) {
        return c.name.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      render(list);
    });
    box.addEventListener('click', function (e) {
      var d = e.target.closest('div[data-i]');
      if (d) pick(box._list[+d.getAttribute('data-i')]);
    });
    input.addEventListener('keydown', function (e) {
      if (box.classList.contains('hidden')) return;
      var items = box.querySelectorAll('div[data-i]');
      if (e.key === 'ArrowDown') { sugIndex = Math.min(sugIndex + 1, items.length - 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sugIndex = Math.max(sugIndex - 1, 0); e.preventDefault(); }
      else if (e.key === 'Enter' && sugIndex >= 0) { pick(box._list[sugIndex]); e.preventDefault(); return; }
      else if (e.key === 'Escape') { box.classList.add('hidden'); return; }
      items.forEach(function (it, i) { it.classList.toggle('active', i === sugIndex); });
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.field-autocomplete')) box.classList.add('hidden');
    });
  }

  /* ---- Валидация данных рождения ----------------------------------------- */
  function validateBirth() {
    var errs = [];
    if (!$('dob').value) errs.push('дата рождения');
    if (!$('tob').value) errs.push('время рождения');
    if ($('lat').value === '' || isNaN(+$('lat').value)) errs.push('широта');
    if ($('lon').value === '' || isNaN(+$('lon').value)) errs.push('долгота');
    if ($('tz').value === '' || isNaN(+$('tz').value)) errs.push('часовой пояс');
    var el = $('birthError');
    if (errs.length) { el.textContent = 'Заполните: ' + errs.join(', ') + '.'; return false; }
    el.textContent = '';
    return true;
  }

  /* ---- Расчёт карты из формы --------------------------------------------- */
  function computeFromForm() {
    var dob = $('dob').value.split('-');     // YYYY-MM-DD
    var tob = $('tob').value.split(':');     // HH:MM
    var input = {
      year: +dob[0], month: +dob[1], day: +dob[2],
      hour: +tob[0], minute: +tob[1],
      tzOffset: +$('tz').value,
      lat: +$('lat').value, lon: +$('lon').value
    };
    var raw = window.Eph.computeChart(input);
    return window.Jyotish.build(raw);
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
    if (!validateBirth()) { toast('Проверьте данные рождения'); return; }
    showOverlay('Рассчитываем карту…');
    setTimeout(function () {
      try {
        var chart = computeFromForm();
        lastChart = chart;
        renderPlanetTable(chart);
        $('chartHolder').innerHTML = window.Jyotish.renderSVG(chart, { size: 360 });
        $('report-root').innerHTML = buildReport(chart);
        $('calcCard').classList.remove('hidden');
        $('reportActions').classList.remove('hidden');
        $('reportPreview').classList.remove('hidden');
        hideOverlay();
        $('reportActions').scrollIntoView({ behavior: 'smooth' });
        toast('Отчёт сформирован');
        saveDraft(true);
      } catch (e) {
        hideOverlay();
        $('birthError').textContent = 'Ошибка расчёта: ' + e.message;
        toast('Ошибка расчёта');
      }
    }, 60);
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
    initPlaceAutocomplete();
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
