/* ============================================================================
 *  ephemeris.js  —  Сидерический ведический эфемеридный движок (без внешних
 *  файлов эфемерид). Высокоточные аналитические формулы:
 *    • Солнце        — Meeus, гл. 25 (видимая долгота даты)
 *    • Луна          — Meeus, гл. 47 (усечённый ELP-2000, ~few arcmin)
 *    • Меркурий..Сатурн — кеплеровы элементы JPL (Standish, 1800–2050)
 *    • Раху/Кету     — средний восходящий узел Луны
 *    • Аянамша       — Лахири (Chitrapaksha)
 *    • Лагна         — асцендент по местному звёздному времени
 *
 *  Все долготы приводятся к ТРОПИЧЕСКОЙ ДОЛГОТЕ ДАТЫ, затем из них
 *  вычитается аянамша даты → сидерическая (Нирайна, Лахири) долгота.
 *
 *  Проверяется офлайн через:  osascript -l JavaScript test.js
 * ========================================================================== */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function sind(x) { return Math.sin(x * DEG); }
  function cosd(x) { return Math.cos(x * DEG); }
  function tand(x) { return Math.tan(x * DEG); }

  /* ---- Юлианская дата (григорианский календарь) --------------------------
   * y,m,d — дата; hourUT — десятичные часы всемирного времени (UT/UTC). */
  function julianDay(y, m, d, hourUT) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100);
    var B = 2 - A + Math.floor(A / 4);
    var jd = Math.floor(365.25 * (y + 4716)) +
             Math.floor(30.6001 * (m + 1)) +
             d + B - 1524.5;
    return jd + hourUT / 24;
  }

  /* ---- Аянамша Лахири ----------------------------------------------------
   * Формула N.C. Lahiri: T в юлианских столетиях от эпохи 1900.0
   * (JD 2415020.0). На 1900.0 ≈ 22°27'37" = 22.46015°; рост ≈ 50.27"/год. */
  function ayanamshaLahiri(jd) {
    var T = (jd - 2415020.0) / 36525.0;
    return 22.460148 + 1.396042 * T + 0.000308 * T * T;
  }

  /* ---- Накопленная общая прецессия по долготе от J2000 (градусы) ---------- */
  function precessionFromJ2000(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    return (5028.796195 * T + 1.1054348 * T * T) / 3600.0;
  }

  /* ---- Средний наклон эклиптики (Meeus, гл. 22, в градусах) --------------- */
  function obliquity(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var seconds = 84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T;
    return seconds / 3600.0;
  }

  /* =======================================================================
   *  СОЛНЦЕ — Meeus гл. 25 (видимая геоцентрическая долгота даты)
   * ===================================================================== */
  function sunLongitude(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
    var M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sind(M)
          + (0.019993 - 0.000101 * T) * sind(2 * M)
          + 0.000289 * sind(3 * M);
    var trueLong = L0 + C;
    // редукция к видимой долготе (нутация + аберрация)
    var omega = 125.04 - 1934.136 * T;
    var apparent = trueLong - 0.00569 - 0.00478 * sind(omega);
    return norm360(apparent);
  }

  /* =======================================================================
   *  ЛУНА — Meeus гл. 47 (усечённый, главные периодические члены)
   *  Точность по долготе ~ несколько угловых минут — достаточно для
   *  знака / накшатры / пады.
   * ===================================================================== */
  function moonLongitude(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
                     + T * T * T / 538841 - T * T * T * T / 65194000);
    var D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
                    + T * T * T / 545868 - T * T * T * T / 113065000);
    var M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T
                    + T * T * T / 24490000);
    var Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
                     + T * T * T / 69699 - T * T * T * T / 14712000);
    var F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
                    - T * T * T / 3526000 + T * T * T * T / 863310000);
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var E2 = E * E;

    // [D, M, Mp, F, coeff(1e-6 deg)]  — главные члены таблицы 47.A
    var terms = [
      [0, 0, 1, 0, 6288774],
      [2, 0, -1, 0, 1274027],
      [2, 0, 0, 0, 658314],
      [0, 0, 2, 0, 213618],
      [0, 1, 0, 0, -185116],
      [0, 0, 0, 2, -114332],
      [2, 0, -2, 0, 58793],
      [2, -1, -1, 0, 57066],
      [2, 0, 1, 0, 53322],
      [2, -1, 0, 0, 45758],
      [0, 1, -1, 0, -40923],
      [1, 0, 0, 0, -34720],
      [0, 1, 1, 0, -30383],
      [2, 0, 0, -2, 15327],
      [0, 0, 1, 2, -12528],
      [0, 0, 1, -2, 10980],
      [4, 0, -1, 0, 10675],
      [0, 0, 3, 0, 10034],
      [4, 0, -2, 0, 8548],
      [2, 1, -1, 0, -7888],
      [2, 1, 0, 0, -6766],
      [1, 0, -1, 0, -5163],
      [1, 1, 0, 0, 4987],
      [2, -1, 1, 0, 4036],
      [2, 0, 2, 0, 3994],
      [4, 0, 0, 0, 3861],
      [2, 0, -3, 0, 3665],
      [0, 1, -2, 0, -2689],
      [2, 0, -1, 2, -2602],
      [2, -1, -2, 0, 2390],
      [1, 0, 1, 0, -2348],
      [2, -2, 0, 0, 2236],
      [0, 1, 2, 0, -2120],
      [0, 2, 0, 0, -2069],
      [2, -2, -1, 0, 2048],
      [2, 0, 1, -2, -1773],
      [2, 0, 0, 2, -1595],
      [4, -1, -1, 0, 1215],
      [0, 0, 2, 2, -1110],
      [3, 0, -1, 0, -892],
      [2, 1, 1, 0, -810],
      [4, -1, -2, 0, 759],
      [0, 2, -1, 0, -713],
      [2, 2, -1, 0, -700],
      [2, 1, -2, 0, 691],
      [2, -1, 0, -2, 596],
      [4, 0, 1, 0, 549],
      [0, 0, 4, 0, 537],
      [4, -1, 0, 0, 520],
      [1, 0, -2, 0, -487],
      [2, 1, 0, -2, -399],
      [0, 0, 2, -2, -381],
      [1, 1, 1, 0, 351],
      [3, 0, -2, 0, -340],
      [4, 0, -3, 0, 330],
      [2, -1, 2, 0, 327],
      [0, 2, 1, 0, -323],
      [1, 1, -1, 0, 299],
      [2, 0, 3, 0, 294]
    ];

    var sumL = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var arg = t[0] * D + t[1] * M + t[2] * Mp + t[3] * F;
      var coeff = t[4];
      var ecorr = 1;
      if (t[1] === 1 || t[1] === -1) ecorr = E;
      else if (t[1] === 2 || t[1] === -2) ecorr = E2;
      sumL += coeff * ecorr * sind(arg);
    }

    // дополнительные аддитивные члены (Венера, Юпитер, уплощение)
    var A1 = 119.75 + 131.849 * T;
    var A2 = 53.09 + 479264.290 * T;
    sumL += 3958 * sind(A1) + 1962 * sind(Lp - F) + 318 * sind(A2);

    var lon = Lp + sumL / 1000000.0;
    return norm360(lon);
  }

  /* =======================================================================
   *  ПЛАНЕТЫ Меркурий..Сатурн — кеплеровы элементы JPL (Standish)
   *  Возвращают геоцентрическую эклиптическую долготу J2000; затем
   *  добавляется прецессия → тропическая долгота даты.
   * ===================================================================== */
  // a, e, I, L, ϖ(longPeri), Ω(longNode) и их вековые скорости (на столетие)
  var ELEMENTS = {
    mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
              0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    venus:   [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
              0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
    earth:   [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
              0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
    mars:    [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
              0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
              -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    saturn:  [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
              -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]
  };

  // гелиоцентрические прямоугольные координаты (эклиптика J2000) для планеты
  function heliocentric(name, T) {
    var el = ELEMENTS[name];
    var a = el[0] + el[6] * T;
    var e = el[1] + el[7] * T;
    var I = el[2] + el[8] * T;
    var L = el[3] + el[9] * T;
    var peri = el[4] + el[10] * T;
    var node = el[5] + el[11] * T;

    var omega = peri - node;          // аргумент перигелия
    var M = norm360(L - peri);        // средняя аномалия
    if (M > 180) M -= 360;

    // решение уравнения Кеплера (M, E в градусах)
    var Estar = RAD * e;              // e* = e в градусах
    var E = M + Estar * sind(M);
    for (var it = 0; it < 12; it++) {
      var dM = M - (E - Estar * sind(E));
      var dE = dM / (1 - e * cosd(E));
      E += dE;
      if (Math.abs(dE) < 1e-9) break;
    }

    // координаты в плоскости орбиты
    var xp = a * (cosd(E) - e);
    var yp = a * Math.sqrt(1 - e * e) * sind(E);

    var co = cosd(omega), so = sind(omega);
    var cn = cosd(node), sn = sind(node);
    var ci = cosd(I), si = sind(I);

    var x = (co * cn - so * sn * ci) * xp + (-so * cn - co * sn * ci) * yp;
    var y = (co * sn + so * cn * ci) * xp + (-so * sn + co * cn * ci) * yp;
    var z = (so * si) * xp + (co * si) * yp;
    return { x: x, y: y, z: z };
  }

  function planetLongitude(name, jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var p = heliocentric(name, T);
    var earth = heliocentric('earth', T);
    var gx = p.x - earth.x;
    var gy = p.y - earth.y;
    var lonJ2000 = norm360(Math.atan2(gy, gx) * RAD);
    // J2000 → тропическая долгота даты
    return norm360(lonJ2000 + precessionFromJ2000(jd));
  }

  /* =======================================================================
   *  РАХУ — средний восходящий узел Луны (Meeus). Кету = Раху + 180°.
   * ===================================================================== */
  function rahuLongitudeMean(jd) {
    var T = (jd - 2451545.0) / 36525.0;
    var omega = 125.04452 - 1934.136261 * T + 0.0020708 * T * T + T * T * T / 450000;
    return norm360(omega);  // уже тропическая долгота даты
  }

  /* =======================================================================
   *  АСЦЕНДЕНТ (Лагна) — тропическая долгота даты.
   *  jd — UT; lonEast — долгота места (восток +); latDeg — широта.
   * ===================================================================== */
  function ascendantTropical(jd, lonEast, latDeg) {
    var T = (jd - 2451545.0) / 36525.0;
    // среднее звёздное время по Гринвичу (градусы)
    var gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
             + 0.000387933 * T * T - T * T * T / 38710000;
    gmst = norm360(gmst);
    var lst = norm360(gmst + lonEast);     // местное звёздное время = RAMC
    var eps = obliquity(jd);

    var ramc = lst;
    // Стандартная формула асцендента (Meeus); atan2 сам выбирает
    // восходящую точку эклиптики — дополнительная коррекция квадранта
    // не нужна.
    var asc = Math.atan2(
      cosd(ramc),
      -(sind(ramc) * cosd(eps) + tand(latDeg) * sind(eps))
    ) * RAD;
    return norm360(asc);
  }

  /* =======================================================================
   *  СВОДКА: полный сидерический гороскоп
   *  input: { year, month, day, hour, minute, tzOffset(в часах, восток +),
   *           lat, lon }
   * ===================================================================== */
  function computeChart(input) {
    var hourLocal = input.hour + input.minute / 60;
    var hourUT = hourLocal - input.tzOffset;          // местное → UT
    var dayShift = 0;
    if (hourUT < 0) { hourUT += 24; dayShift = -1; }
    if (hourUT >= 24) { hourUT -= 24; dayShift = 1; }

    var jd = julianDay(input.year, input.month, input.day + dayShift, hourUT);
    var ayan = ayanamshaLahiri(jd);

    function sidereal(tropical) { return norm360(tropical - ayan); }

    var tropAsc = ascendantTropical(jd, input.lon, input.lat);
    var ascSid = sidereal(tropAsc);

    var rahuTrop = rahuLongitudeMean(jd);
    var planets = {
      sun:     sidereal(sunLongitude(jd)),
      moon:    sidereal(moonLongitude(jd)),
      mercury: sidereal(planetLongitude('mercury', jd)),
      venus:   sidereal(planetLongitude('venus', jd)),
      mars:    sidereal(planetLongitude('mars', jd)),
      jupiter: sidereal(planetLongitude('jupiter', jd)),
      saturn:  sidereal(planetLongitude('saturn', jd)),
      rahu:    sidereal(rahuTrop),
      ketu:    sidereal(norm360(rahuTrop + 180))
    };

    return {
      jd: jd,
      ayanamsha: ayan,
      ascendant: ascSid,
      ascendantTropical: tropAsc,
      planets: planets
    };
  }

  root.Eph = {
    julianDay: julianDay,
    ayanamshaLahiri: ayanamshaLahiri,
    obliquity: obliquity,
    sunLongitude: sunLongitude,
    moonLongitude: moonLongitude,
    planetLongitude: planetLongitude,
    rahuLongitudeMean: rahuLongitudeMean,
    ascendantTropical: ascendantTropical,
    computeChart: computeChart,
    norm360: norm360
  };

})(typeof window !== 'undefined' ? window : this);
