#!/usr/bin/env node
/*
 * Автотест Pac-Man (index.html).
 *   node scripts/test_pacman.js [path/to/index.html]
 *
 * Работает с puppeteer, puppeteer-core или playwright (что установлено).
 * Браузер: CHROME_PATH / PUPPETEER_EXECUTABLE_PATH или системный Google Chrome.
 * Скриншоты сохраняются в ./screenshots/pacman_*.png
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = path.resolve(process.argv[2] || process.env.GAME_HTML || path.join(ROOT, 'index.html'));
const SHOTS = path.join(ROOT, 'screenshots');

function findChrome() {
  const cands = [
    process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

function tryRequire(name) {
  try { return require(name); } catch (e) {}
  try { return require(require.resolve(name, { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/npm-tools/node_modules'] })); } catch (e) {}
  return null;
}

async function launch() {
  const executablePath = findChrome();
  const pptr = tryRequire('puppeteer') || tryRequire('puppeteer-core');
  if (pptr) {
    const browser = await pptr.launch({ headless: 'new', executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
    return {
      browser,
      async newPage(w, h, dpr) {
        const page = await browser.newPage();
        await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr || 1, isMobile: true, hasTouch: true });
        return page;
      },
    };
  }
  const pw = tryRequire('playwright') || tryRequire('playwright-core');
  if (pw) {
    const browser = await pw.chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
    return {
      browser,
      async newPage(w, h, dpr) {
        const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr || 1, hasTouch: true, isMobile: true });
        return context.newPage();
      },
    };
  }
  throw new Error('Не найден puppeteer / playwright. Установите: npm install puppeteer');
}

let failed = 0, passed = 0;
function check(name, ok, info) {
  if (ok) { passed++; console.log('  ✅ ' + name + (info ? ' — ' + info : '')); }
  else { failed++; console.log('  ❌ ' + name + (info ? ' — ' + info : '')); }
}

async function openGame(env, w, h, dpr) {
  const page = await env.newPage(w, h, dpr);
  const errors = [];
  const requests = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/telegram\.org|ERR_|net::/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => requests.push(r.url()));
  await page.goto('file://' + GAME);
  // telegram-web-app.js может не загрузиться без сети — ждём хук игры вручную
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(() => !!window.__pacman)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return { page, errors, requests };
}

// Функции, исполняемые внутри страницы
const PAGE_HELPERS = () => {
  const P = window.__pacman;
  window.__T = {
    P,
    tileFree(c, r) { return !P.blocked(c, r); },
    // BFS-бот: ведёт Пакмана к ближайшей точке
    botStep() {
      const s = P.state, map = P.map;
      const px = s.pac.x, py = s.pac.y;
      const c0 = Math.round((px - 10) / 20), r0 = Math.round((py - 10) / 20);
      const COLS = 19, ROWS = 21;
      const wrap = c => ((c % COLS) + COLS) % COLS;
      const key = (c, r) => r * COLS + wrap(c);
      const seen = new Map();
      const q = [[wrap(c0), r0]];
      seen.set(key(c0, r0), null);
      const dirs = [[0, -1], [-1, 0], [0, 1], [1, 0]];
      let goal = null;
      while (q.length) {
        const [c, r] = q.shift();
        if ((map[r][c] === 2 || map[r][c] === 3) && !(c === wrap(c0) && r === r0)) { goal = [c, r]; break; }
        for (const [dx, dy] of dirs) {
          const nc = wrap(c + dx), nr = r + dy;
          if (P.blocked(nc, nr)) continue;
          const k = key(nc, nr);
          if (seen.has(k)) continue;
          seen.set(k, [c, r, dx, dy]);
          q.push([nc, nr]);
        }
      }
      if (!goal) return;
      let cur = goal, step = null;
      while (true) {
        const prev = seen.get(key(cur[0], cur[1]));
        if (!prev) break;
        step = prev;
        if (prev[0] === wrap(c0) && prev[1] === r0) break;
        cur = [prev[0], prev[1]];
      }
      if (step) P.setDirection(step[2], step[3]);
    },
    runBot(maxTicks, stopPhases) {
      for (let i = 0; i < maxTicks; i++) {
        const ph = P.state.phase;
        if (stopPhases.includes(ph)) return { ticks: i, phase: ph };
        if (ph === 'play') this.botStep();
        P.tick(1);
      }
      return { ticks: maxTicks, phase: P.state.phase };
    },
  };
};

(async () => {
  console.log('🎮 Тест Pac-Man: ' + GAME);
  fs.mkdirSync(SHOTS, { recursive: true });
  const env = await launch();
  try {
    const { page, errors, requests } = await openGame(env, 390, 844, 3);
    await page.evaluate(PAGE_HELPERS);
    await page.evaluate(() => { window.__pacman.setManual(true); });

    // ---------------------------------------------------------------
    console.log('\n1. Лабиринты: точки достижимы, точки спавна свободны, дверь закрыта');
    for (let lvl = 1; lvl <= 3; lvl++) {
      const res = await page.evaluate((lvl) => {
        const P = window.__pacman;
        P.initLevel(lvl);
        const s = P.state, L = s.layout, map = P.map;
        const pc = 9, pr = L.pacRow;
        const seen = new Set([pr * 19 + pc]);
        const q = [[pc, pr]];
        while (q.length) {
          const [c, r] = q.shift();
          for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nc = ((c + dx) % 19 + 19) % 19, nr = r + dy;
            if (P.blocked(nc, nr)) continue;
            const k = nr * 19 + nc;
            if (!seen.has(k)) { seen.add(k); q.push([nc, nr]); }
          }
        }
        let unreachable = 0;
        map.forEach((row, r) => row.forEach((v, c) => { if ((v === 2 || v === 3) && !seen.has(r * 19 + c)) unreachable++; }));
        const free = (c, r) => map[r][c] !== 1;
        return {
          unreachable, dots: s.totalDots,
          spawnsFree: free(9, L.pacRow) && free(9, L.exitRow) && free(9, L.doorRow) && free(8, L.houseRow) && free(9, L.houseRow) && free(10, L.houseRow) && free(9, L.fruitRow),
          doorBlocked: P.blocked(9, L.doorRow),
          houseUnreachable: !seen.has(L.houseRow * 19 + 9),
        };
      }, lvl);
      check(`Уровень ${lvl}: все ${res.dots} точек достижимы`, res.unreachable === 0, `недоступно: ${res.unreachable}`);
      check(`Уровень ${lvl}: точки спавна не в стенах`, res.spawnsFree);
      check(`Уровень ${lvl}: Пакман не может войти в домик`, res.doorBlocked && res.houseUnreachable);
    }

    // ---------------------------------------------------------------
    console.log('\n2. Съеденные призраки всегда возвращаются домой и не ходят сквозь стены');
    for (let lvl = 1; lvl <= 3; lvl++) {
      const res = await page.evaluate((lvl) => {
        const P = window.__pacman;
        let lost = 0, trials = 0, wallHits = 0, maxTicks = 0;
        for (let trial = 0; trial < 12; trial++) {
          P.initLevel(lvl);
          P.setInvincible(true);
          P.setGhostSpeed(1 + (trial % 4));
          P.forcePhase('play');
          // Немного поиграть, чтобы призраки разошлись по лабиринту
          P.tick(200 + trial * 37);
          if (P.state.phase !== 'play') P.forcePhase('play');
          const gs = P.state.ghosts;
          for (let i = 0; i < 4; i++) {
            if (gs[i].mode !== 'active') continue;
            trials++;
            P.eatGhost(i);
            P.forcePhase('play');
            let back = false;
            for (let t = 0; t < 2500; t++) {
              P.tick(1);
              if (P.state.phase !== 'play') P.forcePhase('play');
              const g = P.state.ghosts[i];
              if (g.mode === 'eaten') {
                const c = (((Math.floor(g.x / 20)) % 19) + 19) % 19, r = Math.floor(g.y / 20);
                if (r < 0 || r >= 21 || P.map[r][c] === 1) wallHits++;
              } else { back = true; maxTicks = Math.max(maxTicks, t); break; }
            }
            if (!back) lost++;
          }
        }
        P.setInvincible(false);
        return { lost, trials, wallHits, maxTicks };
      }, lvl);
      check(`Уровень ${lvl}: вернулись ${res.trials - res.lost}/${res.trials}`, res.lost === 0 && res.trials > 0, `макс. ${res.maxTicks} тиков`);
      check(`Уровень ${lvl}: глаза не проходят сквозь стены`, res.wallHits === 0, `нарушений: ${res.wallHits}`);
    }

    // ---------------------------------------------------------------
    console.log('\n3. Скорость не зависит от частоты экрана (60 / 90 / 120 / 144 Гц)');
    const rates = [60, 90, 120, 144];
    const positions = [];
    for (const hz of rates) {
      const r = await page.evaluate((hz) => {
        const P = window.__pacman;
        P.initLevel(1);
        P.setInvincible(true);
        P.forcePhase('play');
        P.stepTime(0);
        let ticks = 0;
        const dt = 1000 / hz;
        for (let i = 0; i < hz * 2; i++) ticks += P.stepTime(dt);   // 2 секунды
        const s = P.state;
        P.setInvincible(false);
        return { ticks, x: s.pac.x, y: s.pac.y };
      }, hz);
      positions.push(r);
    }
    const t0 = positions[0].ticks;
    const okRate = positions.every(p => Math.abs(p.ticks - t0) <= 1);
    check('Одинаковое число игровых тиков за 2 с', okRate, positions.map((p, i) => `${rates[i]}Гц: ${p.ticks}`).join(', '));

    // ---------------------------------------------------------------
    console.log('\n4. Очки за призраков по цепочке 200 → 400 → 800 → 1600');
    const chain = await page.evaluate(() => {
      const P = window.__pacman;
      P.startGame();
      P.forcePhase('play');
      const deltas = [];
      for (let i = 0; i < 4; i++) {
        const before = P.state.score;
        P.eatGhost(i);
        deltas.push(P.state.score - before);
        P.forcePhase('play');
      }
      return deltas;
    });
    check('Цепочка очков', JSON.stringify(chain) === '[200,400,800,1600]', chain.join(' → '));

    // ---------------------------------------------------------------
    console.log('\n5. Мгновенный разворот и допуск поворота');
    const turn = await page.evaluate(() => {
      const P = window.__pacman;
      P.initLevel(1);
      P.forcePhase('play');
      P.setInvincible(true);
      P.tick(5);                         // едет влево
      const x1 = P.state.pac.x;
      P.setDirection(1, 0);              // разворот посреди клетки
      P.tick(1);
      const reversed = P.state.pac.dx === 1 && P.state.pac.x > x1;
      // допуск поворота: ставим Пакмана на 3 px за центром перекрёстка (5,16) и просим «вверх»
      P.initLevel(1); P.forcePhase('play');
      P.setPac({ x: 4 * 20 + 10 - 3, y: 16 * 20 + 10, dx: -1, dy: 0, ndx: 0, ndy: 0 });
      P.setDirection(0, -1);
      P.tick(1);
      const s = P.state.pac;
      P.setInvincible(false);
      return { reversed, turned: s.dy === -1 && s.dx === 0 };
    });
    check('Разворот на 180° без ожидания центра клетки', turn.reversed);
    check('Поворот срабатывает в пределах допуска', turn.turned);

    // ---------------------------------------------------------------
    console.log('\n6. Пауза');
    const pause = await page.evaluate(() => {
      const P = window.__pacman;
      P.startGame(); P.forcePhase('play');
      P.pauseGame();
      const x = P.state.pac.x;
      P.tick(120);
      const still = P.state.pac.x === x && P.state.phase === 'paused';
      const overlay = getComputedStyle(document.getElementById('overlay')).display !== 'none';
      P.resumeGame();
      return { still, overlay, after: P.state.phase };
    });
    check('Игра стоит на паузе и показывает меню', pause.still && pause.overlay);
    check('После паузы — отсчёт READY', pause.after === 'ready');

    // ---------------------------------------------------------------
    console.log('\n7. Бот проходит уровни 1 → 4 (бесконечный режим)');
    await page.evaluate(() => { window.__pacman.startGame(); window.__pacman.setInvincible(true); });
    for (let lvl = 1; lvl <= 4; lvl++) {
      const r = await page.evaluate(() => window.__T.runBot(40000, ['level_done', 'over']));
      const s = await page.evaluate(() => window.__pacman.state);
      check(`Уровень ${s.currentLevel} пройден ботом`, r.phase === 'level_done', `${r.ticks} тиков, счёт ${s.score}`);
      if (r.phase !== 'level_done') break;
      await page.evaluate(() => window.__pacman.onPrimary());
    }
    const lvl5 = await page.evaluate(() => window.__pacman.state);
    check('После 4-го уровня игра продолжается (уровень 5)', lvl5.currentLevel === 5 && lvl5.phase === 'ready');
    await page.evaluate(() => window.__pacman.setInvincible(false));

    // ---------------------------------------------------------------
    console.log('\n8. Game Over: рекорд сохраняется локально, запросов на /api/score нет');
    const over = await page.evaluate(() => {
      const P = window.__pacman;
      P.startGame();
      P.setGhostSpeed(4);
      let r = { phase: '' };
      for (let i = 0; i < 20 && r.phase !== 'over'; i++) {
        r = window.__T.runBot(60000, ['over', 'level_done']);
        if (r.phase === 'level_done') P.onPrimary();
      }
      return { phase: r.phase, high: localStorage.getItem('pacman_high'), top: localStorage.getItem('pacman_top5'), score: P.state.score };
    });
    check('Игра заканчивается Game Over', over.phase === 'over', `счёт ${over.score}`);
    check('Рекорд и топ-5 записаны', Number(over.high) > 0 && JSON.parse(over.top || '[]').length > 0);
    await page.waitForTimeout ? await page.waitForTimeout(200) : await new Promise(r => setTimeout(r, 200));
    await page.screenshot({ path: path.join(SHOTS, 'pacman_game_over_390x844.png') });
    check('Нет запросов на несуществующий /api/score', !requests.some(u => u.includes('/api/score')));

    // ---------------------------------------------------------------
    console.log('\n9. Скриншоты');
    await page.evaluate(() => {
      const P = window.__pacman;
      P.startGame(); P.setInvincible(true); P.setGhostSpeed(3);
      P.forcePhase('play');
      window.__T.runBot(900, ['level_done', 'over']);
    });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'pacman_play_390x844.png') });
    await page.evaluate(() => { const P = window.__pacman; P.initLevel(2); P.forcePhase('play'); window.__T.runBot(1400, ['level_done', 'over']); });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'pacman_level2_390x844.png') });
    await page.evaluate(() => { const P = window.__pacman; P.initLevel(3); P.forcePhase('play'); window.__T.runBot(600, ['level_done', 'over']); P.pauseGame(); });
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(SHOTS, 'pacman_level3_pause_390x844.png') });

    check('Нет ошибок JavaScript на странице', errors.length === 0, errors.slice(0, 3).join(' | '));

    const small = await openGame(env, 360, 640, 2);
    await new Promise(r => setTimeout(r, 300));
    await small.page.screenshot({ path: path.join(SHOTS, 'pacman_menu_360x640.png') });
    const fit = await small.page.evaluate(() => {
      const c = document.getElementById('canvas').getBoundingClientRect();
      const d = document.getElementById('dpad').getBoundingClientRect();
      return { canvasBottom: c.bottom, dpadTop: d.top, dpadBottom: d.bottom, vh: innerHeight, cw: c.width, ch: c.height };
    });
    check('360×640: поле и джойстик помещаются без перекрытия', fit.canvasBottom <= fit.dpadTop + 1 && fit.dpadBottom <= fit.vh, JSON.stringify(fit));
    check('360×640: пропорции поля сохранены', Math.abs(fit.cw / fit.ch - 380 / 420) < 0.02);
  } finally {
    await env.browser.close();
  }
  console.log(`\nИтого: ${passed} ✅, ${failed} ❌`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
