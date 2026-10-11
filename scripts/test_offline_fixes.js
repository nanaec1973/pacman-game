const path = require('path');
const fs = require('fs');

function findGameHtmlPath() {
  if (process.argv[2] && fs.existsSync(process.argv[2])) {
    return path.resolve(process.argv[2]);
  }
  if (process.env.GAME_HTML_PATH && fs.existsSync(process.env.GAME_HTML_PATH)) {
    return path.resolve(process.env.GAME_HTML_PATH);
  }
  const candidateRelatives = [
    '../web/cafe/index.html',
    '../cafe.html',
    '../index.html',
    'web/cafe/index.html',
    'cafe.html',
    'index.html',
    './cafe.html',
    './web/cafe/index.html'
  ];
  for (const rel of candidateRelatives) {
    const fromDir = path.resolve(__dirname, rel);
    if (fs.existsSync(fromDir)) return fromDir;
    const fromCwd = path.resolve(process.cwd(), rel);
    if (fs.existsSync(fromCwd)) return fromCwd;
  }
  const knownAbsolutes = [
    '/Users/ksh/GolandProjects/awesomeProject/web/cafe/index.html',
    '/Users/ksh/GolandProjects/pacman-game/cafe.html'
  ];
  for (const abs of knownAbsolutes) {
    if (fs.existsSync(abs)) return abs;
  }
  throw new Error('Game HTML file not found! Searched: ' + candidateRelatives.join(', '));
}

function getPuppeteer() {
  try {
    return require('puppeteer-core');
  } catch (e1) {
    try {
      return require('puppeteer');
    } catch (e2) {
      const scratchDir = '/Users/ksh/.gemini/antigravity/brain/ffa885fb-fa06-401d-b1a0-6698d13a18df/scratch/node_modules/puppeteer-core';
      if (fs.existsSync(scratchDir)) {
        return require(scratchDir);
      }
      throw new Error('Puppeteer is not installed. Run: npm install puppeteer-core or npm install puppeteer');
    }
  }
}

function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

const gameHtmlFile = findGameHtmlPath();
const FILE_URL = 'file://' + gameHtmlFile;

async function runTests() {
  console.log('🚀 Запуск верификационного пакета: Исправление офлайн-дохода и учёта времени...');
  console.log('Целевой HTML игры:', gameHtmlFile);
  const puppeteer = getPuppeteer();
  const chromePath = findChromePath();
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  };
  if (chromePath) {
    launchOptions.executablePath = chromePath;
  }
  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.toString()));

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(FILE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

  // Setup base unlocked state
  await page.evaluate(() => {
    const st = window.__game.getState();
    st.coins = 5000;
    st.ordersServed = 200;
    st.expansion = 1;
    st.verandaDecor = 1;
    st.featuredDish = 'coffee';
    if (!st.bakery) {
      st.bakery = {
        unlocked: true,
        coins: 60,
        totalEarned: 60,
        ordersServed: 0,
        lastSavedTime: Date.now(),
        upgrades: { oven: 1, waiter_speed: 1, tables: 1, recipes: 1, baker_helper: 0 },
        claimedQuests: []
      };
    } else {
      st.bakery.unlocked = true;
    }
    st.currentVenue = 'cafe';
    window.__game.saveGame();
  });

  console.log('\n--- Проверка 1: Играть в Кафе 60 сек с автосохранениями -> переход в Пекарню ---');
  const check1 = await page.evaluate(async () => {
    const st = window.__game.getState();
    st.currentVenue = 'cafe';
    const T0 = 1700000000000; // фиксированная базовая метка времени
    st.lastSavedTime = T0;
    st.bakery.lastSavedTime = T0;
    st.bakery.coins = 100;

    // Моделируем 60 секунд активной игры в Кафе с автосохранениями каждые 4 секунды
    let simTime = T0;
    const timestampsHistory = [];
    for (let sec = 4; sec <= 60; sec += 4) {
      simTime = T0 + sec * 1000;
      // Подменяем Date.now для контролируемого шага времени
      Date.now = () => simTime;
      window.__game.saveGame();
      timestampsHistory.push({
        elapsed: sec,
        cafeSaved: st.lastSavedTime - T0,
        bakerySaved: st.bakery.lastSavedTime - T0
      });
    }

    // В момент 60с переходим в Пекарню
    Date.now = () => T0 + 60000;
    const bakerySavedBeforeSwitch = st.bakery.lastSavedTime;
    window.__game.switchVenue('bakery');

    const pendingBakeryCoins = window.__game.getPendingBakeryOfflineCoins();
    const modalVisible = document.getElementById('welcome-modal')?.style.display === 'flex';
    const earnedValText = document.getElementById('offline-earned-val')?.innerText;

    // Забираем награду
    const coinsBeforeClaim = st.bakery.coins;
    window.__game.claimOfflineEarnings();
    const coinsAfterClaim = st.bakery.coins;
    const bakerySavedAfterClaim = st.bakery.lastSavedTime;

    return {
      timestampsHistory,
      bakerySavedBeforeSwitchPreserved: bakerySavedBeforeSwitch === T0,
      pendingBakeryCoins,
      modalVisible,
      earnedValText,
      rewardCredited: coinsAfterClaim - coinsBeforeClaim,
      bakerySavedAfterClaimUpdated: bakerySavedAfterClaim === T0 + 60000
    };
  });

  console.log('Результат проверки 1:', check1);
  if (!check1.bakerySavedBeforeSwitchPreserved) {
    throw new Error('Автосохранение в Кафе стёрло время отсутствия Пекарни!');
  }
  if (!check1.modalVisible || check1.pendingBakeryCoins <= 0) {
    throw new Error('Офлайн-доход Пекарни за 60 секунд отсутствия не был начислен!');
  }
  if (check1.rewardCredited <= 0) {
    throw new Error('Награда не была зачислена в кассу Пекарни!');
  }
  if (!check1.bakerySavedAfterClaimUpdated) {
    throw new Error('Получение награды не закрыло оплаченный интервал!');
  }
  console.log('✅ Проверка 1 пройдена: автосохранение Кафе не трогает Пекарню, доход за 60с начислен и интервал закрыт.');

  console.log('\n--- Проверка 2: Играть в Пекарне 60 сек с автосохранениями -> переход в Кафе ---');
  const check2 = await page.evaluate(async () => {
    const st = window.__game.getState();
    st.currentVenue = 'bakery';
    const T1 = 1700001000000;
    st.lastSavedTime = T1;
    st.bakery.lastSavedTime = T1;
    st.coins = 1000;

    // Моделируем 60 секунд игры в Пекарне
    let simTime = T1;
    for (let sec = 4; sec <= 60; sec += 4) {
      simTime = T1 + sec * 1000;
      Date.now = () => simTime;
      window.__game.saveGame();
    }

    const cafeSavedBeforeSwitch = st.lastSavedTime;
    Date.now = () => T1 + 60000;
    window.__game.switchVenue('cafe');

    const pendingCafeCoins = window.__game.getPendingOfflineCoins();
    const modalVisible = document.getElementById('welcome-modal')?.style.display === 'flex';
    const earnedValText = document.getElementById('offline-earned-val')?.innerText;

    const coinsBeforeClaim = st.coins;
    window.__game.claimOfflineEarnings();
    const coinsAfterClaim = st.coins;
    const cafeSavedAfterClaim = st.lastSavedTime;

    return {
      cafeSavedBeforeSwitchPreserved: cafeSavedBeforeSwitch === T1,
      pendingCafeCoins,
      modalVisible,
      earnedValText,
      rewardCredited: coinsAfterClaim - coinsBeforeClaim,
      cafeSavedAfterClaimUpdated: cafeSavedAfterClaim === T1 + 60000
    };
  });

  console.log('Результат проверки 2:', check2);
  if (!check2.cafeSavedBeforeSwitchPreserved) {
    throw new Error('Автосохранение в Пекарне стёрло время отсутствия Кафе!');
  }
  if (!check2.modalVisible || check2.pendingCafeCoins <= 0) {
    throw new Error('Офлайн-доход Кафе за 60 секунд отсутствия не был начислен!');
  }
  if (check2.rewardCredited <= 0) {
    throw new Error('Награда не была зачислена в кассу Кафе!');
  }
  if (!check2.cafeSavedAfterClaimUpdated) {
    throw new Error('Получение награды не закрыло оплаченный интервал Кафе!');
  }
  console.log('✅ Проверка 2 пройдена: обратный сценарий работает полностью симметрично.');

  console.log('\n--- Проверка 3: Перезагрузить игру и повторно переключиться -> нет дублирования ---');
  const check3 = await page.evaluate(async () => {
    const st = window.__game.getState();
    const curTime = 1700002000000;
    Date.now = () => curTime;
    // Оба заведения только что закрыли интервалы
    st.lastSavedTime = curTime;
    st.bakery.lastSavedTime = curTime;
    window.__game.saveGame();

    // Симулируем перезагрузку страницы (loadGame)
    window.__game.loadGame();
    window.__game.checkOfflineEarnings();
    const pendingOnLoad = window.__game.getPendingOfflineCoins() + window.__game.getPendingBakeryOfflineCoins();

    // Немедленно переключаемся в Пекарню
    window.__game.switchVenue('bakery');
    const pendingAfterSwitchToBakery = window.__game.getPendingBakeryOfflineCoins();

    // Немедленно переключаемся обратно в Кафе
    window.__game.switchVenue('cafe');
    const pendingAfterSwitchToCafe = window.__game.getPendingOfflineCoins();

    return {
      pendingOnLoad,
      pendingAfterSwitchToBakery,
      pendingAfterSwitchToCafe
    };
  });

  console.log('Результат проверки 3:', check3);
  if (check3.pendingOnLoad !== 0 || check3.pendingAfterSwitchToBakery !== 0 || check3.pendingAfterSwitchToCafe !== 0) {
    throw new Error('Обнаружено повторное дублирование начислений при перезагрузке или переключении!');
  }
  console.log('✅ Проверка 3 пройдена: повторное переключение и перезагрузка не создают дублей.');

  console.log('\n--- Проверка 4: Ожидающая неполученная награда при сохранении ---');
  const check4 = await page.evaluate(async () => {
    const st = window.__game.getState();
    st.currentVenue = 'bakery';
    const T_base = 1700003000000;
    st.bakery.lastSavedTime = T_base - 120000; // 120 сек назад
    Date.now = () => T_base;

    // Вызываем проверку дохода -> модалка открыта, награда ожидается
    window.__game.checkBakeryOfflineEarnings();
    const pendingBefore = window.__game.getPendingBakeryOfflineCoins();

    // Пока модалка открыта, происходит автосохранение
    window.__game.saveGame();
    const savedLastTime = JSON.parse(localStorage.getItem('cat_cafe_save_v1')).bakery.lastSavedTime;

    // Перезагрузка без клика по кнопке «Забрать»
    window.__game.loadGame();
    // Проверяем, что после загрузки метка времени сохранила исходный оффлайн-интервал
    const restoredLastTime = window.__game.getState().bakery.lastSavedTime;

    // Повторный вызов checkOfflineEarnings восстанавливает возможность забрать
    window.__game.checkBakeryOfflineEarnings();
    const pendingAfterReload = window.__game.getPendingBakeryOfflineCoins();

    // Теперь забираем
    window.__game.claimOfflineEarnings();
    const finalSavedLastTime = window.__game.getState().bakery.lastSavedTime;

    return {
      pendingBefore,
      savedLastTimePreserved: savedLastTime === T_base - 120000,
      restoredLastTimePreserved: restoredLastTime === T_base - 120000,
      pendingAfterReload,
      finalSavedUpdated: finalSavedLastTime === T_base
    };
  });

  console.log('Результат проверки 4:', check4);
  if (!check4.savedLastTimePreserved || !check4.restoredLastTimePreserved) {
    throw new Error('Автосохранение перезаписало время при открытой невостребованной награде!');
  }
  if (check4.pendingAfterReload <= 0) {
    throw new Error('Неполученная награда была утеряна после перезагрузки!');
  }
  if (!check4.finalSavedUpdated) {
    throw new Error('После окончательного забора награды метка времени не обновилась!');
  }
  console.log('✅ Проверка 4 пройдена: невостребованная награда надёжно защищена от стирания.');

  console.log('\n--- Проверка 5: 2 пекаря и медленный официант -> производительность ограничена доставкой ---');
  const check5 = await page.evaluate(() => {
    const st = window.__game.getState();
    const elapsed = 600; // 600 секунд (10 минут)

    // Конфигурация A: 1 пекарь, медленный официант (ур. 1, скорость 100)
    st.bakery.upgrades.baker_helper = 0;
    st.bakery.upgrades.waiter_speed = 1;
    st.bakery.upgrades.oven = 1;
    st.bakery.upgrades.recipes = 1; // только булочки (3.2с)
    const stats1BakerSlow = window.__game.calculateBakeryOfflineStats(elapsed);

    // Конфигурация B: 2 пекаря (Пушок нанят), ТОТ ЖЕ медленный официант (скорость 100)
    st.bakery.upgrades.baker_helper = 1;
    st.bakery.upgrades.waiter_speed = 1;
    const stats2BakersSlow = window.__game.calculateBakeryOfflineStats(elapsed);

    // Конфигурация C: 2 пекаря, но МАКСИМАЛЬНЫЙ официант (ур. 5, скорость 180)
    st.bakery.upgrades.baker_helper = 1;
    st.bakery.upgrades.waiter_speed = 5;
    const stats2BakersFast = window.__game.calculateBakeryOfflineStats(elapsed);

    // Конфигурация D: Сверхбыстрая печь (10 ур., 0.8с) при 2 пекарях и медленном официанте
    st.bakery.upgrades.oven = 10;
    st.bakery.upgrades.waiter_speed = 1;
    const statsUltraOvenSlowWaiter = window.__game.calculateBakeryOfflineStats(elapsed);

    return {
      stats1BakerSlow: {
        bakerCount: stats1BakerSlow.bakerCount,
        bakeRate: stats1BakerSlow.bakeRate,
        deliveryRate: stats1BakerSlow.deliveryRate,
        bottleneck: stats1BakerSlow.bottleneck,
        effectiveCycleSec: stats1BakerSlow.effectiveCycleSec,
        estimatedOrders: stats1BakerSlow.estimatedOrders
      },
      stats2BakersSlow: {
        bakerCount: stats2BakersSlow.bakerCount,
        bakeRate: stats2BakersSlow.bakeRate,
        deliveryRate: stats2BakersSlow.deliveryRate,
        bottleneck: stats2BakersSlow.bottleneck,
        effectiveCycleSec: stats2BakersSlow.effectiveCycleSec,
        estimatedOrders: stats2BakersSlow.estimatedOrders
      },
      stats2BakersFast: {
        bakerCount: stats2BakersFast.bakerCount,
        bakeRate: stats2BakersFast.bakeRate,
        deliveryRate: stats2BakersFast.deliveryRate,
        bottleneck: stats2BakersFast.bottleneck,
        effectiveCycleSec: stats2BakersFast.effectiveCycleSec,
        estimatedOrders: stats2BakersFast.estimatedOrders
      },
      statsUltraOvenSlowWaiter: {
        bakeRate: statsUltraOvenSlowWaiter.bakeRate,
        deliveryRate: statsUltraOvenSlowWaiter.deliveryRate,
        bottleneck: statsUltraOvenSlowWaiter.bottleneck,
        effectiveCycleSec: statsUltraOvenSlowWaiter.effectiveCycleSec,
        estimatedOrders: statsUltraOvenSlowWaiter.estimatedOrders
      }
    };
  });

  console.log('Результат проверки 5:', JSON.stringify(check5, null, 2));

  // Анализ узкого места при 2 пекарях и медленном официанте:
  // При 2 пекарях bakeRate = 2 / 3.2 = 0.625, deliveryRate = 1 / 3.0 = 0.333
  // Узкое место обязано быть 'waiter', а effectiveCycleSec обязан быть равен deliverySec (3.0с)
  if (check5.stats2BakersSlow.bottleneck !== 'waiter') {
    throw new Error('При 2 пекарях и медленном официанте узким местом должен быть официант (waiter)!');
  }
  if (Math.abs(check5.stats2BakersSlow.effectiveCycleSec - 3.0) > 0.01) {
    throw new Error(`Время цикла должно быть ограничено доставкой (3.0с), получено: ${check5.stats2BakersSlow.effectiveCycleSec}`);
  }
  // Даже при сверхбыстрой печи 10 ур. (0.8с) производительность остаётся ограниченной официантом (200 заказов)
  if (check5.statsUltraOvenSlowWaiter.estimatedOrders !== 200) {
    throw new Error('Сверхбыстрая печь не должна превышать предел доставки одиночного официанта!');
  }
  // А ускорение официанта обязано увеличить заказы с 200 до ~360!
  if (check5.stats2BakersFast.estimatedOrders <= check5.stats2BakersSlow.estimatedOrders) {
    throw new Error('Ускорение официанта не увеличило пропускную способность доставки!');
  }

  console.log('✅ Проверка 5 пройдена: пропускная способность строго ограничена узким местом доставки.');

  if (consoleErrors.length > 0) {
    console.error('Ошибки консоли во время тестов:', consoleErrors);
    throw new Error('Обнаружены ошибки консоли браузера!');
  }

  await browser.close();
  console.log('\n🎉 ВСЕ 5 ПРОВЕРОК УСПЕШНО ПРОЙДЕНЫ! Баланс и учёт времени полностью согласованы.');
}

runTests().catch(err => {
  console.error('❌ Тест завершился с ошибкой:', err);
  process.exit(1);
});
