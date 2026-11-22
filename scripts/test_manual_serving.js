#!/usr/bin/env node
/**
 * Тесты ручной подачи (основной игровой цикл).
 *
 * 1. Без игрока и без официанта кафе не зарабатывает, гости уходят.
 * 2. Тап по гостю с готовым блюдом: подача, оплата с чаевыми.
 * 3. Комбо растёт при подаче подряд и сбрасывается, когда гость уходит.
 * 4. Раздача заполнена — повар ждёт.
 * 5. Нанятый официант разносит сам; офлайн-доход есть только с ним.
 * 6. Пекарня: тап по выпечке — мгновенная подача; гость без подачи уходит.
 * 7. «Позвать компанию» в пекарне.
 * 8. Квесты ведут: пройденный этап пропускается, счётные цели — от момента активации.
 * 9. Спрос дня: блюдо в моде оплачивается ×2.
 *
 * Запуск: node scripts/test_manual_serving.js [путь/к/cafe.html]
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
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ].find(c => fs.existsSync(c));
}

const FILE_URL = 'file://' + findGameHtmlPath();

async function run() {
  const puppeteer = getPuppeteer();
  const browser = await puppeteer.launch({ executablePath: findChromePath(), headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Живой игровой цикл останавливаем: время двигаем сами
    await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; });
    await page.setRequestInterception(true);
    page.on('request', req => (req.url().includes('telegram.org') ? req.respond({ status: 200, contentType: 'text/javascript', body: '' }) : req.continue()));
    await page.goto(FILE_URL);
    await page.evaluate(() => { isResettingSave = true; localStorage.clear(); });
    await page.reload();
    await page.waitForFunction(() => !!window.__game);

    const res = await page.evaluate(() => {
      isResettingSave = true;
      const g = window.__game;
      const st = g.getState();
      g.setDemandOverride('none');
      document.querySelectorAll('.modal-overlay').forEach(m => (m.style.display = 'none'));
      const out = {};
      const step = (secs, onTick) => { for (let t = 0; t < secs; t += 0.05) { g.updateSimulation(0.05); if (onTick) onTick(t); } };
      const readyGuest = () => g.getCustomers().find(c => c.state === 'waiting_order' && g.getReadyPlates().some(p => p.dish.id === c.dish.id));

      // 1. Без игрока
      g.resetSimulationState({ stoveLevel: 1, menuLevel: 1, seed: 7 });
      st.stats = {};
      st.upgrades.waiter = 0;
      g.setGourmetSpawnTimer(1e9);
      step(120);
      out.afk = { earned: st.totalEarned, lost: st.stats.guestsLost || 0 };

      // 2. Подача с чаевыми
      g.resetSimulationState({ stoveLevel: 1, menuLevel: 1, seed: 8 });
      st.stats = {};
      g.setGourmetSpawnTimer(1e9);
      let guest = null;
      for (let t = 0; t < 30 && !guest; t += 0.05) { g.updateSimulation(0.05); guest = readyGuest(); }
      const served = guest ? g.serveCafeCustomer(guest, false) : false;
      const coinsBefore = st.coins;
      step(3);
      out.serve = { served, state: guest && guest.state, gained: st.coins - coinsBefore, base: g.calculateDishPayout(guest.dish, false, guest.isFeaturedOrder ? guest.dish.id : null) };

      // 3. Комбо
      g.resetSimulationState({ stoveLevel: 6, menuLevel: 1, seatsLevel: 3, seed: 9 });
      st.stats = {};
      g.setGourmetSpawnTimer(1e9);
      let maxCombo = 0;
      step(60, (t) => { if (Math.round(t / 0.05) % 10 === 0) { const c = readyGuest(); if (c) g.serveCafeCustomer(c, false); maxCombo = Math.max(maxCombo, g.getCafeCombo().count); } });
      // дальше игрок отворачивается — гости уходят, комбо сбрасывается
      step(60);
      out.combo = { maxCombo, after: g.getCafeCombo().count, lost: st.stats.guestsLost || 0 };

      // 4. Раздача заполнена — повар ждёт
      g.resetSimulationState({ stoveLevel: 10, menuLevel: 1, seatsLevel: 4, seed: 10 });
      g.setGourmetSpawnTimer(1e9);
      let blocked = false;
      step(40, () => { if (g.getCookingStations()[0].isBlocked) blocked = true; });
      out.pass = { plates: g.getReadyPlates().length, blocked };

      // 5. Официант и офлайн
      g.resetSimulationState({ stoveLevel: 4, menuLevel: 2, seatsLevel: 2, seed: 11 });
      st.stats = {};
      st.upgrades.waiter = 2;
      g.setGourmetSpawnTimer(1e9);
      step(180);
      const withWaiter = st.totalEarned;
      const offlineWith = g.estimateCafeOfflineRate().ordersPerSec;
      st.upgrades.waiter = 0;
      const offlineWithout = g.estimateCafeOfflineRate().ordersPerSec;
      out.waiter = { earned: withWaiter, lost: st.stats.guestsLost || 0, offlineWith, offlineWithout };
      return out;
    });

    console.log('\n--- 1. Без игрока кафе не зарабатывает ---', res.afk);
    assert.strictEqual(res.afk.earned, 0, 'Без игрока и официанта кафе не должно зарабатывать');
    assert(res.afk.lost > 0, 'Гости должны уходить, если их никто не обслуживает');
    console.log('✅ Пройдено');

    console.log('\n--- 2. Подача с чаевыми ---', res.serve);
    assert(res.serve.served, 'Подача гостю с готовым блюдом должна сработать');
    assert(res.serve.gained > res.serve.base, 'Быстрая подача должна приносить чаевые сверх цены');
    console.log('✅ Пройдено');

    console.log('\n--- 3. Комбо ---', res.combo);
    assert(res.combo.maxCombo >= 3, 'Подача подряд должна наращивать комбо');
    assert.strictEqual(res.combo.after, 0, 'Комбо должно сброситься, когда игрок перестал подавать');
    console.log('✅ Пройдено');

    console.log('\n--- 4. Раздача заполнена ---', res.pass);
    assert(res.pass.plates <= 4, 'На раздаче не больше 4 блюд');
    assert(res.pass.blocked, 'Когда раздача заполнена, повар должен ждать');
    console.log('✅ Пройдено');

    console.log('\n--- 5. Официант и офлайн ---', res.waiter);
    assert(res.waiter.earned > 0, 'Нанятый официант должен разносить блюда без игрока');
    assert(res.waiter.offlineWith > 0, 'С официантом офлайн-доход есть');
    assert.strictEqual(res.waiter.offlineWithout, 0, 'Без официанта офлайн-дохода нет');
    console.log('✅ Пройдено');

    // --- Пекарня ---
    const bak = await page.evaluate(() => {
      const g = window.__game;
      const st = g.getState();
      g.setDemandOverride('none');
      st.bakery.unlocked = true;
      st.currentVenue = 'bakery';
      g.resetBakerySimulationState({});
      st.bakery.upgrades.recipes = 2;
      st.bakery.stats = {};
      const stepB = (secs, cb) => { for (let t = 0; t < secs; t += 0.05) { g.updateBakerySimulation(0.05); if (isBakeryEventOfferOpen) g.declineBakeryEvent(); if (cb && cb()) break; } };
      // ждём первую выпечку на витрине
      stepB(30, () => g.getReadyOrders().length > 0);
      const order = g.getReadyOrders()[0];
      const owner = order && g.getBakeryCustomers().find(c => c.id === order.customerId);
      const delivered = g.deliverBakeryOrderByPlayer(order);
      const ownerState = owner && owner.state;
      // гость без подачи уходит: убираем официанта с пути (огромное расстояние) — проще: обнуляем терпение
      const waiting = g.getBakeryCustomers().find(c => c.state === 'waiting_order' && !c.isGroupCustomer);
      if (waiting) waiting.patience = 0.01;
      stepB(0.2);
      const leftAngry = waiting ? waiting.state === 'leaving' : null;
      // Позвать компанию
      st.bakery.lastEventEndedAt = 0;
      const inviteOk = g.getBakeryInviteState().ok;
      g.inviteBakeryCompany();
      const offerShown = isBakeryEventOfferOpen;
      g.declineBakeryEvent();
      const cooldown = g.getBakeryInviteState();
      return { delivered, ownerState, leftAngry, manual: st.bakery.stats.manualServes || 0, inviteOk, offerShown, cooldownBlocked: !cooldown.ok };
    });
    console.log('\n--- 6–7. Пекарня: ручная подача, терпение, «Позвать компанию» ---', bak);
    assert(bak.delivered && bak.ownerState === 'eating', 'Тап по выпечке должен сразу подать её гостю');
    assert.strictEqual(bak.manual, 1, 'Ручная подача должна учитываться');
    assert.strictEqual(bak.leftAngry, true, 'Гость с закончившимся терпением должен уйти');
    assert(bak.inviteOk && bak.offerShown, 'Кнопка «Позвать компанию» должна открывать предложение');
    assert(bak.cooldownBlocked, 'Сразу после отказа позвать компанию снова нельзя (перезарядка)');
    console.log('✅ Пройдено');

    // --- Квесты и спрос дня ---
    const qd = await page.evaluate(() => {
      const g = window.__game;
      const st = g.getState();
      st.currentVenue = 'cafe';
      st.claimedQuests = [];
      st.questActive = null;
      st.ordersServed = 500;           // уже много заказов
      st.upgrades.speed = 5;           // плита уже улучшена
      const q1 = g.getCurrentQuest();  // «Подай 5 блюд» — должна считаться с нуля
      const q1Done = q1.isCompleted();
      st.ordersServed += 5;
      const q1DoneAfter = q1.isCompleted();
      g.claimQuestReward();
      // combo_3 — «защёлка»
      const q2 = g.getCurrentQuest();
      st.claimedQuests.push('combo_3');
      st.questActive = null;
      const q3 = g.getCurrentQuest();  // stove_2 уже выполнен → должен быть пропущен
      // Спрос дня
      const dish = g.DISHES[0];
      g.setDemandOverride('none');
      const normal = g.calculateDishPayout(dish, false, null);
      g.setDemandOverride(dish.id);
      const demand = g.calculateDishPayout(dish, false, null);
      g.setDemandOverride('none');
      return { q1: q1.title, q1Done, q1DoneAfter, q2: q2.id, q3: q3.id, normal, demand };
    });
    console.log('\n--- 8–9. Квесты и спрос дня ---', qd);
    assert.strictEqual(qd.q1Done, false, 'Счётная цель не должна засчитываться задним числом');
    assert.strictEqual(qd.q1DoneAfter, true, 'Счётная цель должна выполниться после 5 новых подач');
    assert.strictEqual(qd.q2, 'combo_3', 'Следующей целью должно быть комбо ×3');
    assert.notStrictEqual(qd.q3, 'stove_2', 'Уже пройденный этап (плита ур. 2) должен быть пропущен');
    assert(qd.demand >= qd.normal * 2 - 1, 'Блюдо спроса дня должно оплачиваться ×2');
    console.log('✅ Пройдено');

    if (errors.length) throw new Error('Ошибки JS на странице: ' + errors.join(' | '));
    console.log('\n🎉 ВСЕ ТЕСТЫ РУЧНОЙ ПОДАЧИ ПРОЙДЕНЫ!');
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('❌ Тест завершился с ошибкой:', err);
  process.exit(1);
});
