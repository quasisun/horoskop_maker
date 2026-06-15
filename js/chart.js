/* ============================================================================
 *  chart.js  —  Построение структурированного гороскопа из сырых долгот
 *  (положение по знаку / дому / накшатре / паде / статусу) и отрисовка
 *  северо-индийского (ромбовидного) чарта в виде SVG для экрана и PDF.
 * ========================================================================== */
(function (root) {
  'use strict';

  var A = root.AstroData;
  var NAK_LEN = 360 / 27;        // 13°20'
  var PADA_LEN = NAK_LEN / 4;    // 3°20'

  function degToDMS(d) {
    var deg = Math.floor(d);
    var mfloat = (d - deg) * 60;
    var min = Math.floor(mfloat);
    var sec = Math.round((mfloat - min) * 60);
    if (sec === 60) { sec = 0; min += 1; }
    if (min === 60) { min = 0; deg += 1; }
    return deg + '°' + (min < 10 ? '0' : '') + min + "'" + (sec < 10 ? '0' : '') + sec + '"';
  }

  // Оценка статуса планеты по расширяемым правилам STATUS_RULES
  function evalStatus(planet, signIndex, degInSign) {
    if (!A.DIGNITY[planet]) return { status: 'neutral', label: '—' }; // Лагна и пр.
    var ctx = {
      planet: planet,
      signIndex: signIndex,
      degInSign: degInSign,
      lordOfSign: A.SIGNS[signIndex].lord
    };
    for (var i = 0; i < A.STATUS_RULES.length; i++) {
      var r = A.STATUS_RULES[i];
      if (r.test(ctx)) return { status: r.status, label: r.label };
    }
    return { status: 'neutral', label: 'нейтрально' };
  }

  // Полная структура планеты из сидерической долготы
  function describePoint(planet, lon, ascSignIndex) {
    var signIndex = Math.floor(lon / 30);
    var degInSign = lon - signIndex * 30;
    var nakIndex = Math.floor(lon / NAK_LEN);
    var pada = Math.floor((lon - nakIndex * NAK_LEN) / PADA_LEN) + 1;
    var house = ((signIndex - ascSignIndex + 12) % 12) + 1;
    var st = evalStatus(planet, signIndex, degInSign);
    return {
      key: planet,
      name: A.PLANETS[planet] ? A.PLANETS[planet].ru : planet,
      lon: lon,
      signIndex: signIndex,
      sign: A.SIGNS[signIndex].ru,
      degInSign: degInSign,
      degStr: degToDMS(degInSign),
      house: house,
      nakshatra: A.NAKSHATRAS[nakIndex].ru,
      nakLord: A.PLANETS[A.NAKSHATRAS[nakIndex].lord].ru,
      pada: pada,
      status: st.status,
      statusLabel: st.label
    };
  }

  // Главный построитель: raw = результат Eph.computeChart
  function build(raw) {
    var ascSignIndex = Math.floor(raw.ascendant / 30);
    var lagna = describePoint('lagna', raw.ascendant, ascSignIndex);
    lagna.name = 'Лагна (Асцендент)';

    var planets = A.PLANET_ORDER.map(function (key) {
      return describePoint(key, raw.planets[key], ascSignIndex);
    });

    // распределение по домам (1..12) для чарта
    var houses = [];
    for (var h = 1; h <= 12; h++) {
      houses.push({
        house: h,
        signIndex: (ascSignIndex + h - 1) % 12,
        signNum: ((ascSignIndex + h - 1) % 12) + 1,
        planets: []
      });
    }
    planets.forEach(function (p) { houses[p.house - 1].planets.push(p); });

    return {
      raw: raw,
      ascSignIndex: ascSignIndex,
      ascSign: A.SIGNS[ascSignIndex].ru,
      ayanamsha: raw.ayanamsha,
      ayanamshaStr: degToDMS(raw.ayanamsha),
      lagna: lagna,
      planets: planets,
      houses: houses
    };
  }

  /* ---- Северо-индийский чарт (SVG) ---------------------------------------
   * Квадрат + диагонали + ромб по серединам сторон = 12 домов. */
  function renderSVG(chart, opts) {
    opts = opts || {};
    var S = opts.size || 420;
    var red = '#df2227';
    var ink = '#2b2118';

    var p = function (x, y) { return (x * S) + ',' + (y * S); };
    var lines = [
      // внешний квадрат
      'M' + p(0, 0) + ' L' + p(1, 0) + ' L' + p(1, 1) + ' L' + p(0, 1) + ' Z',
      // диагонали (от угла к углу)
      'M' + p(0, 0) + ' L' + p(1, 1),
      'M' + p(1, 0) + ' L' + p(0, 1),
      // ромб по серединам сторон
      'M' + p(0.5, 0) + ' L' + p(1, 0.5) + ' L' + p(0.5, 1) + ' L' + p(0, 0.5) + ' Z'
    ];

    // ИСТИННЫЕ центроиды 12 областей (доли стороны), индекс 0 -> дом 1.
    // Затем слегка поджимаем к центру, чтобы подписи не липли к граням.
    var centroid = [
      [0.500, 0.250], [0.250, 0.083], [0.083, 0.250], [0.250, 0.500],
      [0.083, 0.750], [0.250, 0.917], [0.500, 0.750], [0.750, 0.917],
      [0.917, 0.750], [0.750, 0.500], [0.917, 0.250], [0.750, 0.083]
    ];
    var NUDGE = 0.13;  // доля смещения к центру (0.5,0.5)
    centroid = centroid.map(function (c) {
      return [c[0] + NUDGE * (0.5 - c[0]), c[1] + NUDGE * (0.5 - c[1])];
    });

    var svg = [];
    svg.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" ' +
      'width="' + S + '" height="' + S + '" class="ni-chart">');
    svg.push('<rect x="0" y="0" width="' + S + '" height="' + S + '" fill="#ffffff"/>');
    svg.push('<path d="' + lines.join(' ') + '" fill="none" stroke="' + red +
      '" stroke-width="1.6" stroke-linejoin="round"/>');

    var numFs = S * 0.036;
    var fs = S * 0.040;
    var lineH = fs * 1.22;

    for (var i = 0; i < 12; i++) {
      var house = chart.houses[i];
      var cx = centroid[i][0] * S, cy = centroid[i][1] * S;

      // элементы ячейки: в 1-м доме первой идёт Лагна, затем планеты
      var items = [];
      if (house.house === 1) {
        items.push({ glyph: 'Лг', deg: Math.round(chart.lagna.degInSign), color: red, bold: true });
      }
      house.planets.forEach(function (pl) {
        items.push({
          glyph: A.PLANETS[pl.key].short,
          deg: Math.round(pl.degInSign),
          color: pl.status === 'green' ? '#1d7a33' : (pl.status === 'red' ? red : ink),
          bold: true
        });
      });

      // общий вертикальный блок: [номер знака] + элементы, по центру ячейки
      var totalLines = 1 + items.length;
      var startY = cy - (totalLines - 1) * lineH / 2;

      // номер знака (мелкий, приглушённый) — первая строка блока
      svg.push('<text x="' + cx + '" y="' + (startY + numFs * 0.35) +
        '" font-size="' + numFs + '" fill="' + ink +
        '" text-anchor="middle" font-family="Arial, sans-serif" opacity="0.55">' +
        house.signNum + '</text>');

      // элементы
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        svg.push('<text x="' + cx + '" y="' + (startY + (j + 1) * lineH + fs * 0.35) +
          '" font-size="' + fs + '" fill="' + it.color +
          '" text-anchor="middle" font-family="Arial, sans-serif"' +
          (it.bold ? ' font-weight="bold"' : '') + '>' +
          it.glyph + ' ' + it.deg + '°</text>');
      }
    }
    svg.push('</svg>');
    return svg.join('');
  }

  root.Jyotish = {
    build: build,
    renderSVG: renderSVG,
    degToDMS: degToDMS,
    describePoint: describePoint
  };

})(typeof window !== 'undefined' ? window : this);
