#!/usr/bin/env node
/**
 * Регрессионные тесты «Кошачьего кафе»: графика и жизненный цикл.
 *
 * 1. Canvas не сплющивается: буфер совпадает с размером на экране (×DPR) на разных экранах.
 * 2. Таймер события «Компания котов» обновляется каждый кадр, а не только при оплате.
 * 3. Свёрнутое приложение: фоновые автосохранения не двигают отметку времени,
 *    при возвращении начисляется офлайн-доход.
 * 4. Сброс прогресса действительно сбрасывает (pagehide/visibilitychange не пересохраняют старое).
 * 5. Сохранение с монетами = null (бывший NaN) не теряет прогресс.
 * 6. Тап по полу не ускоряет готовку, тап у плиты су-шефа ускоряет именно её.
 * 7. Список магазина не перестраивается, пока палец лежит на кнопке.
 * 8. Офлайн-доход кафе не превышает реальную пропускную способность.
 *
 * Запуск: node scripts/test_cafe_render_lifecycle.js [путь/к/cafe.html]
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

function findGameHtmlPath() {
  if (process.argv[2] && fs.existsSync(process.argv[2])) return path.resolve(process.argv[2]);
  if (process.env.GAME_HTML_PATH && fs.existsSync(process.env.GAME_HTML_PATH)) return path.resolve(process.env.GAME_HTML_PATH);
  for (const rel of ['../cafe.html', 'cafe.html']) {
    const p = path.resolve(__dirname, rel);
    if (fs.existsSync(p)) return p;
    const q = path.resolve(process.cwd(), rel);
    if (fs.existsSync(q)) return q;
  }
  throw new Error('cafe.html не найден');
}

function getPuppeteer() {
  for (const name of ['puppeteer-core', 'puppeteer']) {
    try { return require(name); } catch (e) {}
  }
  throw new Error('Puppeteer не установлен. Выполните: npm install puppeteer-core');
}

function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];
  return candidates.find(c => fs.existsSync(c));
}

const FILE_URL = 'file://' + findGameHtmlPath();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openGame(browser, width, height, { keepStorage = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Внешний Telegram SDK в тестах не нужен (и может быть недоступен без сети)
  await page.setRequestInterception(true);
  page.on('request', req => (req.url().includes('telegram.org') ? req.respond({ status: 200, contentType: 'text/javascript', body: '' }) : req.continue()));
  await page.goto(FILE_URL);
  if (!keepStorage) {
    // isResettingSave блокирует сохранение на pagehide — иначе игра пересохранит старое состояние
    await page.evaluate(() => { isResettingSave = true; localStorage.clear(); });
    await page.reload();
  }
  await page.waitForFunction(() => !!window.__game);
  await sleep(300);
  return { page, errors };
}

async function run() {
  const puppeteer = getPuppeteer();
  const browser = await puppeteer.launch({
    executablePath: findChromePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const allErrors = [];
  try {
    // --- 1. Пропорции canvas ---
    console.log('\n--- 1. Canvas не сплющивается ---');
    for (const [w, h] of [[375, 667], [390, 844], [360, 740]]) {
      const { page, errors } = await openGame(browser, w, h);
      allErrors.push(...errors);
      const check = async (label) => {
        const r = await page.evaluate(() => {
          const c = document.getElementById('cafe-canvas');
          const rect = c.getBoundingClientRect();
          return { cssW: rect.width, cssH: rect.height, bufW: c.width, bufH: c.height, dpr: devicePixelRatio };
        });
        const ratioCss = r.cssW / r.cssH;
        const ratioBuf = r.bufW / r.bufH;
        assert(Math.abs(ratioCss - ratioBuf) / ratioCss < 0.02,
          `${w}x${h} ${label}: пропорции буфера ${r.bufW}x${r.bufH} не совпадают с экраном ${r.cssW}x${r.cssH}`);
        assert(Math.abs(r.bufW - r.cssW * r.dpr) <= 2, `${w}x${h} ${label}: ширина буфера не равна CSS × DPR`);
        return r;
      };
      const r1 = await check('после загрузки');
      assert(r1.cssH >= 210, `${w}x${h}: сцена слишком низкая (${r1.cssH}px)`);
      await page.evaluate(() => window.__game.toggleShopCollapse());
      await sleep(600);
      await check('после сворачивания магазина');
      console.log(`✅ ${w}x${h}: сцена ${Math.round(r1.cssW)}x${Math.round(r1.cssH)}, пропорции сохранены`);
      await page.close();
    }

    // --- 2. Таймер события пекарни ---
    console.log('\n--- 2. Таймер «Компании котов» тикает каждый кадр ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      const res = await page.evaluate(() => {
        const g = window.__game;
        const st = g.getState();
        st.bakery.unlocked = true;
        st.bakery.upgrades.recipes = 2;
        g.switchVenue('bakery');
        document.querySelectorAll('.modal-overlay').forEach(m => (m.style.display = 'none'));
        g.showBakeryEventOffer();
        g.acceptBakeryEvent();
        const ev = st.bakery.activeEvent;
        ev.state = 'running';
        ev.remainingSec = 40;
        ev.totalTimeSec = 40;
        g.updateBakerySimulation(0.016);
        const before = document.getElementById('event-bar-time').innerText;
        for (let i = 0; i < 100; i++) g.updateBakerySimulation(0.05); // 5 секунд без единой оплаты
        const after = document.getElementById('event-bar-time').innerText;
        return { before, after };
      });
      assert.notStrictEqual(res.before, res.after, `Таймер события не изменился: ${res.before} → ${res.after}`);
      console.log(`✅ Таймер обновляется сам: ${res.before} → ${res.after}`);
      await page.close();
    }

    // --- 3. Сворачивание и возврат ---
    console.log('\n--- 3. Свёрнутое приложение получает офлайн-доход ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      const res = await page.evaluate(() => {
        const g = window.__game;
        const st = g.getState();
        document.querySelectorAll('.modal-overlay').forEach(m => (m.style.display = 'none'));
        const realNow = Date.now;
        let fakeNow = realNow();
        Date.now = () => fakeNow;
        const setVis = v => {
          Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        };
        setVis('hidden');
        const leftAt = st.lastSavedTime;
        fakeNow += 3600 * 1000; // час в фоне
        g.saveGame(); // фоновое автосохранение
        const afterBgSave = st.lastSavedTime;
        setVis('visible');
        const pending = g.getPendingOfflineCoins();
        const modal = document.getElementById('welcome-modal').style.display;
        Date.now = realNow;
        return { leftAt, afterBgSave, pending, modal };
      });
      assert.strictEqual(res.afterBgSave, res.leftAt, 'Фоновое автосохранение сдвинуло отметку времени');
      assert(res.pending > 0 && res.modal === 'flex', 'После возврата из фона офлайн-доход не начислен: ' + JSON.stringify(res));
      console.log(`✅ Час в фоне → +${res.pending} 🪙, отметка времени не сдвигалась`);
      await page.close();
    }

    // --- 4. Сброс прогресса ---
    console.log('\n--- 4. Сброс прогресса не перезаписывается при перезагрузке ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      await page.evaluate(() => {
        const st = window.__game.getState();
        st.coins = 9999;
        st.ordersServed = 77;
        window.__game.saveGame();
        window.confirm = () => true;
      });
      await Promise.all([
        page.waitForNavigation(),
        page.evaluate(() => resetSaveData())
      ]);
      await page.waitForFunction(() => !!window.__game);
      const st = await page.evaluate(() => ({ coins: window.__game.getState().coins, orders: window.__game.getState().ordersServed }));
      assert.strictEqual(st.orders, 0, `После сброса осталось ${st.orders} заказов`);
      assert(st.coins < 9999, 'После сброса монеты не сбросились');
      console.log('✅ Прогресс сброшен, старое состояние не пересохранилось');
      await page.close();
    }

    // --- 5. Повреждённое сохранение ---
    console.log('\n--- 5. Сохранение с coins = null не теряет прогресс ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      await page.evaluate(() => {
        isResettingSave = true; // не даём игре пересохранить своё состояние на pagehide
        localStorage.setItem('cat_cafe_save_v1', JSON.stringify({
          coins: null, totalEarned: 5000, ordersServed: 321,
          upgrades: { speed: 6, profit: 4, seats: 2, menu: 3, helper: 1 },
          expansion: 1, lastSavedTime: Date.now()
        }));
      });
      await page.reload();
      await page.waitForFunction(() => !!window.__game);
      const st = await page.evaluate(() => {
        const s = window.__game.getState();
        return { coins: s.coins, orders: s.ordersServed, speed: s.upgrades.speed, helper: s.upgrades.helper, expansion: s.expansion };
      });
      assert.strictEqual(st.orders, 321, 'Прогресс (заказы) потерян');
      assert.strictEqual(st.speed, 6, 'Уровень плиты потерян');
      assert.strictEqual(st.helper, 1, 'Помощник потерян');
      assert(Number.isFinite(st.coins), 'Монеты не восстановлены до числа');
      console.log(`✅ Прогресс сохранён (заказов ${st.orders}, плита ${st.speed}), монеты = ${st.coins}`);
      await page.close();
    }

    // --- 6. Тап по кухне ---
    console.log('\n--- 6. Ускорение готовки только по тапу у плиты ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      const res = await page.evaluate(() => {
        const g = window.__game;
        const st = g.getState();
        st.upgrades.helper = 1;
        document.querySelectorAll('.modal-overlay').forEach(m => (m.style.display = 'none'));
        window.dispatchEvent(new Event('resize'));
        const [chef, helper] = g.getCookingStations();
        const dish = g.getAvailableDishes()[0];
        [chef, helper].forEach(s => { s.isCooking = true; s.dish = dish; s.progress = 0.1; s.totalTime = 999; });
        const canvas = document.getElementById('cafe-canvas');
        const rect = canvas.getBoundingClientRect();
        // canvasWidth — логическая ширина сцены (глобальная переменная игры)
        const k = rect.width / canvasWidth;
        const click = (lx, ly) => handleStageClick({ clientX: rect.left + lx * k, clientY: rect.top + ly * k });
        // Тап по полу у нижнего края сцены
        click(canvasWidth * 0.5, canvasHeight - 10);
        const afterFloor = [chef.progress, helper.progress];
        // Тап по плите су-шефа
        click(helper.x, helper.y + 20);
        const afterHelper = [chef.progress, helper.progress];
        [chef, helper].forEach(s => { s.isCooking = false; s.dish = null; s.progress = 0; });
        return { afterFloor, afterHelper };
      });
      assert.deepStrictEqual(res.afterFloor, [0.1, 0.1], `Тап по полу ускорил готовку: ${res.afterFloor}`);
      assert(res.afterHelper[1] > 0.1 && res.afterHelper[0] === 0.1, `Тап у плиты су-шефа ускорил не ту плиту: ${res.afterHelper}`);
      console.log('✅ Пол не ускоряет; тап у плиты су-шефа ускоряет именно её');
      await page.close();
    }

    // --- 7. Защита списка магазина ---
    console.log('\n--- 7. Магазин не перестраивается под пальцем ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      const res = await page.evaluate(async () => {
        const g = window.__game;
        const list = document.getElementById('upgrades-list');
        const firstBtnBefore = list.querySelector('button');
        list.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        g.addCoins(5000); // вызывает updateUI → перестройку магазина
        const sameWhilePressed = list.querySelector('button') === firstBtnBefore;
        list.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));
        const replacedAfter = list.querySelector('button') !== firstBtnBefore;
        return { sameWhilePressed, replacedAfter };
      });
      assert(res.sameWhilePressed, 'Список перестроился, пока палец был на кнопке');
      assert(res.replacedAfter, 'Отложенное обновление магазина не применилось после отпускания');
      console.log('✅ Обновление откладывается до отпускания пальца и затем применяется');
      await page.close();
    }

    // --- 8. Офлайн-доход кафе ---
    console.log('\n--- 8. Офлайн-доход кафе не выше реальной игры ---');
    {
      const { page, errors } = await openGame(browser, 390, 844);
      allErrors.push(...errors);
      const rows = await page.evaluate(() => {
        const g = window.__game;
        const out = [];
        for (const [stove, helper, menu, seats] of [[1, false, 1, 1], [10, true, 1, 1], [10, true, 4, 4], [4, false, 4, 4]]) {
          let orders = 0;
          const seeds = [5, 6];
          for (const seed of seeds) {
            g.resetSimulationState({ stoveLevel: stove, hasHelper: helper, menuLevel: menu, seatsLevel: seats, featuredDish: 'coffee', seed });
            g.setGourmetSpawnTimer(1e9);
            for (let t = 0; t < 600; t += 0.05) g.updateSimulation(0.05);
            orders += g.getState().ordersServed;
          }
          const online = orders / (seeds.length * 600);
          const offline = g.estimateCafeOfflineRate().ordersPerSec * 0.75;
          out.push({ stove, helper, menu, seats, online, offline, ratio: offline / online });
        }
        return out;
      });
      rows.forEach(r => {
        assert(r.ratio <= 1.0, `Офлайн выгоднее онлайна: ${JSON.stringify(r)}`);
        assert(r.ratio >= 0.4, `Офлайн слишком скупой: ${JSON.stringify(r)}`);
        console.log(`   плита ${r.stove}, помощник ${r.helper ? 'да' : 'нет'}, меню ${r.menu}, места ${r.seats}: офлайн = ${(r.ratio * 100).toFixed(0)}% от онлайна`);
      });
      console.log('✅ Офлайн-доход в пределах 40–100% от реальной игры');
      await page.close();
    }

    if (allErrors.length) throw new Error('Ошибки JS на странице: ' + allErrors.join(' | '));
    console.log('\n🎉 ВСЕ РЕГРЕССИОННЫЕ ТЕСТЫ ГРАФИКИ И ЖИЗНЕННОГО ЦИКЛА ПРОЙДЕНЫ!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('❌ Тест завершился с ошибкой:', err);
  process.exit(1);
});
