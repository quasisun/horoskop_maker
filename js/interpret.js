/* ============================================================================
 *  interpret.js  —  Генерация трактовки на русском по рассчитанному гороскопу
 *  (генеративный метод: природа планеты × значение дома × статус) и подбор
 *  традиционных упай (средств). Текст структурирован по разделам.
 *
 *  Комментарий астролога подаётся отдельным блоком — вывод движка явно
 *  отделён от заметок специалиста (требование ТЗ).
 * ========================================================================== */
(function (root) {
  'use strict';

  var A = root.AstroData;

  // ---- Значения домов (бхав) ----------------------------------------------
  var HOUSE = {
    1: 'личности, тела, характера и жизненного пути',
    2: 'богатства, семьи, речи и накопленных ценностей',
    3: 'усилий, смелости, младших братьев и сестёр, общения',
    4: 'дома, матери, внутреннего покоя и недвижимости',
    5: 'детей, творчества, разума и заслуг прошлых жизней',
    6: 'препятствий, здоровья, долгов и служения',
    7: 'партнёрства, брака и публичных отношений',
    8: 'трансформаций, тайн, наследства и долголетия',
    9: 'удачи, дхармы, учителей и высшего знания',
    10: 'карьеры, статуса, репутации и общественного признания',
    11: 'доходов, исполнения желаний и круга единомышленников',
    12: 'затрат, освобождения, уединения и дальних странствий'
  };

  // ---- Природа планет ------------------------------------------------------
  var NAT = {
    sun:     { karaka: 'души, отца, авторитета и жизненной силы',
               gives: 'достоинство, волю, лидерство и ясность намерения',
               shadow: 'гордость, властность и потребность в признании' },
    moon:    { karaka: 'ума, матери, эмоций и восприятия',
               gives: 'чувствительность, заботливость и богатое воображение',
               shadow: 'переменчивость настроения и зависимость от окружения' },
    mars:    { karaka: 'энергии, мужества, братьев и действия',
               gives: 'решительность, дисциплину и способность защищать',
               shadow: 'вспыльчивость, нетерпеливость и склонность к конфликтам' },
    mercury: { karaka: 'интеллекта, речи, торговли и обучения',
               gives: 'сообразительность, дар слова и аналитический ум',
               shadow: 'суетливость, поверхностность и нервозность' },
    jupiter: { karaka: 'мудрости, учителей, детей и благополучия',
               gives: 'оптимизм, нравственность, щедрость и тягу к знанию',
               shadow: 'излишнюю доверчивость и склонность к избыточности' },
    venus:   { karaka: 'любви, красоты, брака и наслаждений',
               gives: 'обаяние, чувство гармонии, артистизм и дипломатию',
               shadow: 'тягу к комфорту, привязанность к удовольствиям' },
    saturn:  { karaka: 'дисциплины, труда, времени и ограничений',
               gives: 'терпение, выносливость, ответственность и зрелость',
               shadow: 'медлительность, страхи, отстранённость и пессимизм' },
    rahu:    { karaka: 'желаний, амбиций, иллюзий и всего нового',
               gives: 'нестандартное мышление, целеустремлённость, тягу к необычному',
               shadow: 'беспокойство, навязчивые желания и склонность к крайностям' },
    ketu:    { karaka: 'отрешённости, духовности и кармы прошлого',
               gives: 'интуицию, проницательность и тягу к освобождению',
               shadow: 'неуверенность, чувство неудовлетворённости и рассеянность' }
  };

  // ---- Краткие черты лагны --------------------------------------------------
  var LAGNA = {
    'Овен': 'Вы прирождённый первопроходец: энергичны, прямолинейны и склонны действовать раньше, чем размышлять. Вас ведёт стремление быть первым.',
    'Телец': 'Вы основательны, терпеливы и цените стабильность, красоту и чувственные радости жизни. Вам важны надёжность и комфорт.',
    'Близнецы': 'Вы любознательны, общительны и подвижны умом; легко усваиваете новое и нуждаетесь в постоянном интеллектуальном обмене.',
    'Рак': 'Вы чувствительны, заботливы и привязаны к дому и семье; ваша сила — в эмоциональной глубине и интуиции.',
    'Лев': 'Вы благородны, великодушны и наделены природным достоинством; вам важно признание и возможность вести за собой.',
    'Дева': 'Вы наблюдательны, практичны и склонны к анализу; стремитесь к порядку, чистоте и совершенству в деталях.',
    'Весы': 'Вы дипломатичны, обаятельны и тонко чувствуете гармонию; стремитесь к равновесию и справедливости в отношениях.',
    'Скорпион': 'Вы глубоки, страстны и проницательны; обладаете внутренней силой и способностью к глубокой трансформации.',
    'Стрелец': 'Вы оптимистичны, прямодушны и устремлены к высшим смыслам; вас влекут знания, странствия и философия.',
    'Козерог': 'Вы дисциплинированны, целеустремлённы и ответственны; готовы к долгому труду ради устойчивого результата.',
    'Водолей': 'Вы независимы, оригинальны и гуманны; мыслите широко, цените свободу и дружеские союзы.',
    'Рыбы': 'Вы сострадательны, мечтательны и духовно восприимчивы; обладаете богатым внутренним миром и интуицией.'
  };

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // фраза о статусе планеты
  function statusPhrase(p) {
    if (p.status === 'green') return 'Планета сильна (' + p.statusLabel + '), и её благие качества проявляются полно.';
    if (p.status === 'red') return 'Планета ослаблена (' + p.statusLabel + '), что требует осознанной работы с её темами.';
    return 'Планета в нейтральном положении и проявляется уравновешенно.';
  }

  // описание «планета в доме»
  function planetInHouse(p) {
    var n = NAT[p.key];
    var s = 'Управляя темами ' + n.karaka + ', ' + p.name + ' в ' + p.house +
            '-м доме (' + HOUSE[p.house] + ') привносит в эти сферы ' + n.gives + '. ';
    s += statusPhrase(p);
    if (p.status === 'red') {
      s += ' Возможно проявление таких черт, как ' + n.shadow + '.';
    }
    return s;
  }

  // выбрать планеты по домам
  function inHouse(chart, h) {
    return chart.planets.filter(function (p) { return p.house === h; });
  }
  function planetByKey(chart, k) {
    for (var i = 0; i < chart.planets.length; i++) if (chart.planets[i].key === k) return chart.planets[i];
    return null;
  }
  // управитель дома h и где он стоит
  function houseLord(chart, h) {
    var signIndex = (chart.ascSignIndex + h - 1) % 12;
    var lordKey = A.SIGNS[signIndex].lord;
    return planetByKey(chart, lordKey);
  }

  function joinPlanets(arr) {
    return arr.map(function (p) { return p.name; }).join(', ');
  }

  // ---- Сборка разделов -----------------------------------------------------
  function section(title, paras) {
    return { title: title, paragraphs: paras.filter(Boolean) };
  }

  function generate(chart) {
    var sun = planetByKey(chart, 'sun');
    var moon = planetByKey(chart, 'moon');
    var sections = [];

    // Личность
    var lagnaLord = houseLord(chart, 1);
    sections.push(section('Личность', [
      'Асцендент (Лагна) расположен в знаке ' + chart.ascSign + '. ' + LAGNA[chart.ascSign],
      'Управитель Лагны — ' + lagnaLord.name + ' — находится в ' + lagnaLord.house +
        '-м доме (' + HOUSE[lagnaLord.house] + '). Это направляет жизненную энергию и фокус личности в эти сферы. ' + statusPhrase(lagnaLord),
      'Луна (ум) в знаке ' + moon.sign + ', накшатра ' + moon.nakshatra + ' (пада ' + moon.pada +
        '), и Солнце (душа) в знаке ' + sun.sign + ' формируют эмоциональный и волевой строй личности.'
    ]));

    // Карма и жизненный путь
    var saturn = planetByKey(chart, 'saturn');
    var rahu = planetByKey(chart, 'rahu');
    var ketu = planetByKey(chart, 'ketu');
    sections.push(section('Карма и жизненный путь', [
      'Сатурн — носитель кармических уроков и дисциплины — стоит в ' + saturn.house + '-м доме (' +
        HOUSE[saturn.house] + '). ' + statusPhrase(saturn) + ' Именно здесь жизнь будет требовать терпения, зрелости и упорного труда.',
      'Кету в ' + ketu.house + '-м доме указывает на сферы, освоенные в прошлом и теперь требующие отпускания, а Раху в ' +
        rahu.house + '-м доме — на направление нынешнего роста и новых, ещё не освоенных желаний. Эта ось — стержень кармической задачи воплощения.'
    ]));

    // Карьера
    var tenthLord = houseLord(chart, 10);
    var tenth = inHouse(chart, 10);
    sections.push(section('Карьера и призвание', [
      '10-й дом (карьера и статус) управляется планетой ' + tenthLord.name + ', стоящей в ' +
        tenthLord.house + '-м доме. ' + statusPhrase(tenthLord) +
        ' Это указывает на источник профессиональной реализации и репутации.',
      tenth.length ? 'В самом 10-м доме расположены: ' + joinPlanets(tenth) +
        '. Их природа напрямую окрашивает профессиональную деятельность и отношение к долгу.' :
        'В 10-м доме нет планет — призвание раскрывается прежде всего через его управителя и положение Солнца и Сатурна.',
      'Солнце в ' + sun.house + '-м доме и Сатурн в ' + saturn.house +
        '-м доме дополнительно описывают отношение к власти, ответственности и труду.'
    ]));

    // Богатство
    var second = houseLord(chart, 2);
    var eleventh = houseLord(chart, 11);
    var jup = planetByKey(chart, 'jupiter');
    sections.push(section('Богатство и финансы', [
      'Дом накоплений (2-й) управляется планетой ' + second.name + ' в ' + second.house +
        '-м доме, а дом доходов (11-й) — планетой ' + eleventh.name + ' в ' + eleventh.house +
        '-м доме. Соотношение их силы описывает способность зарабатывать и сохранять.',
      'Юпитер — естественный показатель изобилия — расположен в ' + jup.house + '-м доме (' +
        HOUSE[jup.house] + '). ' + statusPhrase(jup) +
        ' Когда Юпитер силён, благосостояние приходит легче и сопровождается щедростью.'
    ]));

    // Отношения и брак
    var seventh = houseLord(chart, 7);
    var seventhP = inHouse(chart, 7);
    var venus = planetByKey(chart, 'venus');
    var mars = planetByKey(chart, 'mars');
    var mangal = [1, 2, 4, 7, 8, 12].indexOf(mars.house) !== -1;
    sections.push(section('Отношения и брак', [
      '7-й дом партнёрства управляется планетой ' + seventh.name + ' в ' + seventh.house + '-м доме. ' +
        statusPhrase(seventh) + (seventhP.length ? ' В самом 7-м доме: ' + joinPlanets(seventhP) + '.' : ''),
      'Венера — показатель любви и супружеской гармонии — в знаке ' + venus.sign + ', ' + venus.house +
        '-й дом. ' + statusPhrase(venus) + ' Это описывает стиль привязанности и то, что человек ищет в близости.',
      mangal ? 'Марс расположен в ' + mars.house + '-м доме — положении, которое в традиции связывают с «мангала-дошей»; ' +
        'рекомендуется внимательность в выборе партнёра и согласование темпераментов. Эффект смягчается при силе благих планет.' :
        'Марс не образует выраженной «мангала-доши», что благоприятно для семейного согласия.'
    ]));

    // Дети
    var fifth = houseLord(chart, 5);
    var fifthP = inHouse(chart, 5);
    sections.push(section('Дети и творчество', [
      '5-й дом детей и творчества управляется планетой ' + fifth.name + ' в ' + fifth.house + '-м доме. ' +
        statusPhrase(fifth) + (fifthP.length ? ' В 5-м доме находятся: ' + joinPlanets(fifthP) + '.' : ''),
      'Юпитер как показатель потомства (в ' + jup.house + '-м доме) дополняет картину темы детей, ученичества и творческого самовыражения.'
    ]));

    // Духовность
    var ninth = houseLord(chart, 9);
    var twelfth = houseLord(chart, 12);
    sections.push(section('Духовный путь', [
      '9-й дом дхармы и высшего знания управляется планетой ' + ninth.name + ' в ' + ninth.house +
        '-м доме, а 12-й дом освобождения (мокши) — планетой ' + twelfth.name + ' в ' + twelfth.house + '-м доме.',
      'Кету в ' + ketu.house + '-м доме и Юпитер указывают на естественную предрасположенность к внутренней работе, паломничеству, медитации и постижению тонких смыслов.'
    ]));

    // Здоровье
    var sixth = houseLord(chart, 6);
    sections.push(section('Тенденции здоровья', [
      'Сила Лагны и её управителя (' + lagnaLord.name + ', ' + lagnaLord.house +
        '-й дом) описывает общую жизненную силу и конституцию. 6-й дом болезней управляется планетой ' +
        sixth.name + ' в ' + sixth.house + '-м доме.',
      'Положение Луны (' + moon.sign + ') и расположение вредителей по домам указывают на чувствительные зоны; при ослабленных планетах полезны профилактика и режим. Данные носят рекомендательный характер и не заменяют врача.'
    ]));

    // Ключевые планетные влияния
    var keyParas = chart.planets.map(function (p) {
      return cap(p.name) + ' — ' + p.sign + ', ' + p.house + '-й дом, накшатра ' + p.nakshatra +
        ' (пада ' + p.pada + '). ' + planetInHouse(p);
    });
    sections.push(section('Ключевые планетные влияния', keyParas));

    // Сильные и слабые стороны
    var strong = chart.planets.filter(function (p) { return p.status === 'green'; });
    var weak = chart.planets.filter(function (p) { return p.status === 'red'; });
    sections.push(section('Сильные стороны', [
      strong.length ? 'Наиболее сильно проявленные планеты: ' + strong.map(function (p) {
        return p.name + ' (' + p.statusLabel + ', ' + p.house + '-й дом)';
      }).join('; ') + '. Это естественные опоры натальной карты — сферы, где человек действует уверенно и приносит наибольшую пользу.' :
        'Ярко выраженных по достоинству планет немного — сила карты раскрывается через гармоничное взаимодействие планет и осознанные усилия.'
    ]));
    sections.push(section('Слабые стороны и зоны роста', [
      weak.length ? 'Требуют внимания: ' + weak.map(function (p) {
        return p.name + ' (' + p.statusLabel + ', ' + p.house + '-й дом)';
      }).join('; ') + '. Это не приговор, а направления сознательной работы; именно здесь духовная практика и упайи приносят наибольший плод.' :
        'Выраженно ослабленных планет не выявлено, что говорит о в целом устойчивой карте.'
    ]));

    // Важные уроки жизни
    sections.push(section('Важные уроки жизни', [
      'Главная ось развития проходит через темы Сатурна (' + saturn.house + '-й дом, ' + HOUSE[saturn.house] +
        ') и узлов Раху–Кету (' + rahu.house + '/' + ketu.house +
        ' дома). Через них судьба учит зрелости, отпусканию старого и движению к подлинной цели воплощения.'
    ]));

    return sections;
  }

  /* ---- Упайи (средства) ---------------------------------------------------
   * Подбираются по ослабленным планетам и управителю Лагны. */
  var REMEDY = {
    sun:     { mantra: 'Ом Храм Хрим Храум Сах Сурьяя Намах', gem: 'рубин', deity: 'Сурья / Господь Шива', day: 'воскресенье', charity: 'пшеница, медь, изделия красного цвета' },
    moon:    { mantra: 'Ом Шрам Шрим Шраум Сах Чандрая Намах', gem: 'жемчуг', deity: 'Чандра / Богиня-Мать', day: 'понедельник', charity: 'рис, молоко, серебро, белая ткань' },
    mars:    { mantra: 'Ом Крам Крим Краум Сах Бхаумая Намах', gem: 'красный коралл', deity: 'Хануман / Сканда', day: 'вторник', charity: 'красная чечевица, изделия из меди' },
    mercury: { mantra: 'Ом Брам Брим Браум Сах Будхая Намах', gem: 'изумруд', deity: 'Господь Вишну', day: 'среда', charity: 'зелёный маш, зелёная ткань, книги' },
    jupiter: { mantra: 'Ом Грам Грим Граум Сах Гураве Намах', gem: 'жёлтый сапфир', deity: 'Брихаспати / Даттатрея', day: 'четверг', charity: 'куркума, жёлтые сладости, книги' },
    venus:   { mantra: 'Ом Драм Дрим Драум Сах Шукрая Намах', gem: 'бриллиант', deity: 'Богиня Лакшми', day: 'пятница', charity: 'сахар, белые цветы, благовония' },
    saturn:  { mantra: 'Ом Прам Прим Праум Сах Шанайшчарая Намах', gem: 'синий сапфир', deity: 'Шани / Хануман', day: 'суббота', charity: 'чёрный кунжут, железо, горчичное масло' },
    rahu:    { mantra: 'Ом Бхрам Бхрим Бхраум Сах Рахаве Намах', gem: 'гессонит (гомеда)', deity: 'Богиня Дурга', day: 'суббота', charity: 'кокос, изделия серого/дымчатого цвета' },
    ketu:    { mantra: 'Ом Срам Срим Сраум Сах Кетаве Намах', gem: 'кошачий глаз', deity: 'Господь Ганеша', day: 'вторник', charity: 'разноцветная ткань, помощь животным' }
  };

  // дательный падеж мн. ч. для «по ...м» → «по четвергам»
  var DAY_DATIVE = {
    'воскресенье': 'воскресеньям', 'понедельник': 'понедельникам',
    'вторник': 'вторникам', 'среда': 'средам', 'четверг': 'четвергам',
    'пятница': 'пятницам', 'суббота': 'субботам'
  };
  function byDay(day) { return DAY_DATIVE[day] || day; }

  function remedies(chart) {
    var out = [];
    var lagnaLord = houseLord(chart, 1);

    // укрепление управителя Лагны
    var r = REMEDY[lagnaLord.key];
    out.push({
      planet: lagnaLord.name,
      reason: 'управитель Лагны — основа жизненной силы',
      items: [
        'Мантра: «' + r.mantra + '» (108 раз, по ' + byDay(r.day) + ').',
        'Почитание: ' + r.deity + '.',
        'Благотворительность: ' + r.charity + '.',
        'Камень (традиционная рекомендация, носить только после консультации): ' + r.gem + '.'
      ]
    });

    // ослабленные планеты
    chart.planets.forEach(function (p) {
      if (p.status === 'red' && p.key !== lagnaLord.key) {
        var rr = REMEDY[p.key];
        out.push({
          planet: p.name,
          reason: 'ослаблена (' + p.statusLabel + ') в ' + p.house + '-м доме — гармонизация',
          items: [
            'Мантра: «' + rr.mantra + '» (по ' + byDay(rr.day) + ').',
            'Почитание: ' + rr.deity + '.',
            'Благотворительность: ' + rr.charity + '.',
            'Камень (по согласованию с астрологом): ' + rr.gem + '.'
          ]
        });
      }
    });

    // общие рекомендации
    out.push({
      planet: 'Общие практики',
      reason: 'поддержка всей карты',
      items: [
        'Ежедневная медитация и наблюдение за дыханием для укрепления ума (Луны).',
        'Регулярная садхана и чтение священных текстов для развития 9-го дома (дхармы).',
        'Доброжелательная речь, благодарность и бескорыстное служение (сева) гармонизируют карму.',
        'Соблюдение режима, умеренность в пище и поддержание чистоты пространства.'
      ]
    });

    return out;
  }

  /* ---- «Полировка» заметок астролога (офлайн) ----------------------------
   * Нормализация пробелов, заглавные буквы, разбиение на абзацы.
   * Полноценное ИИ-улучшение доступно в app.js при наличии ключа и сети. */
  function polishNotes(text) {
    if (!text) return [];
    var paras = text.replace(/\r/g, '').split(/\n\s*\n+/);
    return paras.map(function (para) {
      var t = para.replace(/[ \t]+/g, ' ').replace(/\s+\n/g, '\n').trim();
      // заглавная буква в начале предложений
      t = t.replace(/(^|[.!?]\s+)([а-яёa-z])/g, function (m, p1, p2) {
        return p1 + p2.toUpperCase();
      });
      return t;
    }).filter(function (p) { return p.length > 0; });
  }

  /* ---- Васту: справка по направлениям (статичное знание) ----------------- */
  var VASTU_DIRECTIONS = [
    { dir: 'Северо-восток (Ишанья)', elem: 'Вода', planet: 'Юпитер / Кету',
      sphere: 'духовность, ясность ума, дети', rec: 'место для молитвы и медитации, источник воды; держать чистым и незагромождённым' },
    { dir: 'Восток (Индра)', elem: 'Воздух', planet: 'Солнце',
      sphere: 'здоровье, авторитет, связи', rec: 'окна и утренний свет, входы благоприятны' },
    { dir: 'Юго-восток (Агни)', elem: 'Огонь', planet: 'Венера',
      sphere: 'энергия, пищеварение, финансы', rec: 'кухня, очаг, электроприборы' },
    { dir: 'Юг (Яма)', elem: 'Земля', planet: 'Марс',
      sphere: 'сила, репутация, выносливость', rec: 'тяжёлые предметы и зоны отдыха; вход требует коррекции' },
    { dir: 'Юго-запад (Наиррутья)', elem: 'Земля', planet: 'Раху',
      sphere: 'стабильность, отношения, предки', rec: 'спальня хозяев и тяжёлая мебель; не оставлять пустым и лёгким' },
    { dir: 'Запад (Варуна)', elem: 'Вода', planet: 'Сатурн',
      sphere: 'прибыль, завершения, дисциплина', rec: 'столовая, хранение, рабочие зоны' },
    { dir: 'Северо-запад (Вайю)', elem: 'Воздух', planet: 'Луна',
      sphere: 'связи, движение, помощь извне', rec: 'гостевая, склады, помещения для общения' },
    { dir: 'Север (Кубера)', elem: 'Вода', planet: 'Меркурий',
      sphere: 'богатство, возможности, карьера', rec: 'открытость и лёгкость, источники дохода, хранение ценностей' },
    { dir: 'Центр (Брахмастхан)', elem: 'Эфир (Акаша)', planet: '—',
      sphere: 'жизненная сила всего пространства', rec: 'оставлять свободным, чистым и открытым' }
  ];

  /* ---- Астрогеография: общие ориентиры по силе планет карты --------------- */
  function astroGeography(chart) {
    var strong = chart.planets.filter(function (p) { return p.status === 'green'; }).map(function (p) { return p.name; });
    var weak = chart.planets.filter(function (p) { return p.status === 'red'; }).map(function (p) { return p.name; });
    var out = [];
    out.push('Астрогеография (астрокартография) показывает, как меняется проявление планет в зависимости ' +
      'от места на Земле: вблизи «линий» планеты её влияние усиливается. Это помогает выбирать места для ' +
      'жизни, работы, учёбы, лечения и путешествий.');
    if (strong.length) {
      out.push('В вашей карте наиболее благотворны линии сильных планет: ' + strong.join(', ') +
        '. Рядом с ними ярче раскрываются их лучшие качества — такие места поддерживают развитие и важные начинания.');
    }
    if (weak.length) {
      out.push('Зоны под выраженным влиянием ослабленных планет (' + weak.join(', ') +
        ') стоит посещать осознанно: здесь их уроки звучат сильнее, чем поддержка.');
    }
    out.push('Общие ориентиры по линиям: Солнце — витальность, признание и лидерство; Луна — эмоциональный ' +
      'комфорт, дом и семья; Юпитер — рост, удача, обучение и духовность; Венера — любовь, творчество и ' +
      'благополучие; Меркурий — учёба, торговля и общение; Сатурн — дисциплина и серьёзный труд; Марс — ' +
      'энергия, спорт и борьба.');
    out.push('Точные линии (восход, заход и кульминация каждой планеты) рассчитываются по карте ' +
      'астрокартографии для конкретных координат — см. приложенные материалы.');
    return out;
  }

  /* ---- Рекомендуемые драгоценные камни ------------------------------------
   * Логика: главный камень — управителя Лагны; дополнительно камни управителей
   * тригон (5 и 9 дома). Камни управителей дустхан (6/8/12) выносятся в раздел
   * предостережений. Цвета — для отрисовки иконки-самоцвета. */
  var GEM_DATA = {
    sun:     { stone: 'Рубин',           metal: 'золото',                finger: 'безымянный', day: 'воскресенье', colors: { light: '#ff7a8a', base: '#d11a3a', dark: '#7c0d22' } },
    moon:    { stone: 'Жемчуг',          metal: 'серебро',               finger: 'мизинец',    day: 'понедельник', colors: { light: '#ffffff', base: '#efe7d6', dark: '#c9bca0' } },
    mars:    { stone: 'Красный коралл',  metal: 'золото или медь',       finger: 'безымянный', day: 'вторник',     colors: { light: '#ff9a86', base: '#f0533c', dark: '#a82e1b' } },
    mercury: { stone: 'Изумруд',         metal: 'золото',                finger: 'мизинец',    day: 'среда',       colors: { light: '#6fe0a8', base: '#1f9e63', dark: '#0c5e3a' } },
    jupiter: { stone: 'Жёлтый сапфир',   metal: 'золото',                finger: 'указательный', day: 'четверг',   colors: { light: '#ffe27a', base: '#f4c430', dark: '#b07f0a' } },
    venus:   { stone: 'Бриллиант',       metal: 'серебро или белое золото', finger: 'средний', day: 'пятница',     colors: { light: '#ffffff', base: '#dcecf2', dark: '#9fb8c2' } },
    saturn:  { stone: 'Синий сапфир',    metal: 'серебро',               finger: 'средний',    day: 'суббота',     colors: { light: '#6f8fe0', base: '#1a3fa0', dark: '#0c2160' } },
    rahu:    { stone: 'Гессонит (гомеда)', metal: 'серебро',             finger: 'средний',    day: 'суббота',     colors: { light: '#f0b46a', base: '#c97b2c', dark: '#864c12' } },
    ketu:    { stone: 'Кошачий глаз',    metal: 'серебро',               finger: 'безымянный', day: 'вторник',     colors: { light: '#cfc79a', base: '#9b8f5a', dark: '#5f5733' } }
  };
  var GEM_WEIGHT = 'от 3 до 6 каратов (подбирается индивидуально)';

  function astroUrl(planetRu) {
    return 'https://astrostone.ru/astrokamni?tfc_quantity[2133591991]=y' +
      '&tfc_charact:10792782[2133591991]=' + encodeURIComponent(planetRu) + '&tfc_div=:::';
  }

  function gemstones(chart) {
    var rec = [], cautions = [], used = {};

    function ruledHouses(key) {
      var hs = [];
      for (var s = 0; s < 12; s++) {
        if (A.SIGNS[s].lord === key) hs.push(((s - chart.ascSignIndex + 12) % 12) + 1);
      }
      return hs;
    }
    function add(planetObj, role) {
      if (!planetObj || used[planetObj.key]) return;
      var hs = ruledHouses(planetObj.key);
      var isTrikona = hs.some(function (h) { return h === 1 || h === 5 || h === 9; });
      var isDusthana = hs.some(function (h) { return h === 6 || h === 8 || h === 12; });
      used[planetObj.key] = true;
      var g = GEM_DATA[planetObj.key];
      if (isDusthana && !isTrikona) {
        cautions.push({ name: planetObj.name, stone: g.stone, houses: hs });
        return;
      }
      rec.push({
        planetKey: planetObj.key, planet: planetObj.name, role: role,
        stone: g.stone, metal: g.metal, finger: g.finger, day: g.day, weight: GEM_WEIGHT,
        colors: g.colors, url: astroUrl(A.PLANETS[planetObj.key].ru),
        mantra: REMEDY[planetObj.key] ? REMEDY[planetObj.key].mantra : ''
      });
    }

    add(houseLord(chart, 1), 'управитель Лагны — главный камень жизненной силы');
    add(houseLord(chart, 5), 'управитель 5-го дома (трина: разум, удача, дети)');
    add(houseLord(chart, 9), 'управитель 9-го дома (трина: дхарма, удача, благословение учителей)');

    [6, 8, 12].forEach(function (h) {
      var l = houseLord(chart, h);
      if (l && !used[l.key]) {
        var hs = ruledHouses(l.key);
        var isTrik = hs.some(function (x) { return x === 1 || x === 5 || x === 9; });
        used[l.key] = true;
        if (!isTrik) cautions.push({ name: l.name, stone: GEM_DATA[l.key].stone, houses: hs });
      }
    });

    return { recommended: rec, cautions: cautions };
  }

  /* ---- Гуна Милан (Ашта-кута, совместимость по накшатрам Луны) ------------
   * 8 кут на 36 баллов. Йони и Вашья считаются по упрощённым правилам и
   * помечены как предварительные; остальные куты — по точным таблицам. */
  function gunaMilan(c1, c2) {
    var NAKLEN = 360 / 27;
    function moon(c) {
      var lon = c.raw.planets.moon;
      return { nak: Math.floor(lon / NAKLEN) % 27, rashi: Math.floor(lon / 30) % 12 };
    }
    var a = moon(c1), b = moon(c2);
    var items = [];

    // 1. Варна (1)
    var v1 = A.RASHI_VARNA[a.rashi], v2 = A.RASHI_VARNA[b.rashi];
    var varna = (v1 >= v2) ? 1 : 0;
    items.push({ name: 'Варна', got: varna, max: 1,
      note: A.VARNA_NAMES[v1] + ' / ' + A.VARNA_NAMES[v2] + ' — духовная совместимость' });

    // 2. Вашья (2) — упрощённо: одна группа = 2, иначе 1
    var vashya = (A.RASHI_VASHYA[a.rashi] === A.RASHI_VASHYA[b.rashi]) ? 2 : 1;
    items.push({ name: 'Вашья', got: vashya, max: 2, approx: true, note: 'взаимное влияние и притяжение' });

    // 3. Тара/Дина (3) — счёт накшатр в обе стороны
    function tara(from, to) {
      var cnt = ((to - from + 27) % 27) + 1, rem = cnt % 9;
      return (rem === 3 || rem === 5 || rem === 7) ? 0 : 1.5;
    }
    var taraScore = tara(a.nak, b.nak) + tara(b.nak, a.nak);
    items.push({ name: 'Тара (Дина)', got: taraScore, max: 3, note: 'здоровье и благополучие' });

    // 4. Йони (4)
    var y1 = A.NAK_YONI[a.nak], y2 = A.NAK_YONI[b.nak];
    var yoni = (y1 === y2) ? 4 : (A.YONI_ENEMY[y1] === y2 ? 0 : 2);
    items.push({ name: 'Йони', got: yoni, max: 4, approx: true,
      note: A.YONI_NAMES[y1] + ' / ' + A.YONI_NAMES[y2] + ' — интимная совместимость' });

    // 5. Граха Майтри (5) — дружба управителей раши Луны
    var l1 = A.SIGNS[a.rashi].lord, l2 = A.SIGNS[b.rashi].lord;
    function rel(x, y) {
      if (x === y) return 'self';
      if (A.RELATIONS[x].friend.indexOf(y) !== -1) return 'friend';
      if (A.RELATIONS[x].enemy.indexOf(y) !== -1) return 'enemy';
      return 'neutral';
    }
    var maitriScore;
    if (l1 === l2) maitriScore = 5;
    else {
      var r1 = rel(l1, l2), r2 = rel(l2, l1);
      var pair = [r1, r2].sort().join('-');
      var mp = { 'friend-friend': 5, 'friend-neutral': 4, 'neutral-neutral': 3,
        'enemy-friend': 1, 'enemy-neutral': 0.5, 'enemy-enemy': 0 };
      maitriScore = mp[pair]; if (maitriScore === undefined) maitriScore = 3;
    }
    items.push({ name: 'Граха Майтри', got: maitriScore, max: 5,
      note: A.PLANETS[l1].ru + ' / ' + A.PLANETS[l2].ru + ' — психологическая близость' });

    // 6. Гана (6)
    var g1 = A.NAK_GANA[a.nak], g2 = A.NAK_GANA[b.nak];
    var gana;
    if (g1 === g2) gana = 6;
    else if ((g1 === 0 && g2 === 1) || (g1 === 1 && g2 === 0)) gana = 5;
    else if ((g1 === 0 && g2 === 2) || (g1 === 2 && g2 === 0)) gana = 1;
    else gana = 0; // манушья-ракшаса
    items.push({ name: 'Гана', got: gana, max: 6,
      note: A.GANA_NAMES[g1] + ' / ' + A.GANA_NAMES[g2] + ' — темперамент' });

    // 7. Бхакут (7) — взаимное положение раши
    var d = (b.rashi - a.rashi + 12) % 12;
    var badBhakut = [1, 11, 4, 8, 5, 7].indexOf(d) !== -1;
    var bhakut = badBhakut ? 0 : 7;
    items.push({ name: 'Бхакут', got: bhakut, max: 7,
      note: bhakut ? 'благоприятно для семьи и достатка' : 'бхакут-доша (2/12, 5/9 или 6/8) — требует внимания' });

    // 8. Нади (8)
    var n1 = A.NAK_NADI[a.nak], n2 = A.NAK_NADI[b.nak];
    var nadi = (n1 === n2) ? 0 : 8;
    items.push({ name: 'Нади', got: nadi, max: 8,
      note: nadi ? A.NADI_NAMES[n1] + ' / ' + A.NADI_NAMES[n2] + ' — здоровье потомства' : 'нади-доша (одна нади) — важнейшее предостережение' });

    var total = items.reduce(function (s, it) { return s + it.got; }, 0);
    var verdict;
    if (total >= 32) verdict = 'отличная совместимость';
    else if (total >= 24) verdict = 'хорошая совместимость';
    else if (total >= 18) verdict = 'средняя совместимость — возможна при осознанной работе';
    else verdict = 'низкая совместимость — традиционно союз не рекомендуется без коррекции';

    var doshas = [];
    if (nadi === 0) doshas.push('Нади-доша (совпадение нади) — традиционно серьёзное препятствие; требует анализа исключений и упай.');
    if (bhakut === 0) doshas.push('Бхакут-доша (неблагоприятное взаиморасположение раши Луны) — внимание к благополучию и здоровью.');
    if (gana === 0) doshas.push('Гана-доша (манушья–ракшаса) — различие темпераментов.');

    return { items: items, total: total, max: 36, verdict: verdict, doshas: doshas,
      moon1: a, moon2: b };
  }

  root.Interpret = {
    generate: generate,
    remedies: remedies,
    polishNotes: polishNotes,
    VASTU_DIRECTIONS: VASTU_DIRECTIONS,
    astroGeography: astroGeography,
    gemstones: gemstones,
    GEM_DATA: GEM_DATA,
    gunaMilan: gunaMilan
  };

})(typeof window !== 'undefined' ? window : this);
