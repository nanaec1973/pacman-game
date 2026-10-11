#!/usr/bin/env node
/**
 * ☕ Cat Snack Bar: Economy Simulation & Benchmark Runner
 * 
 * Executes 10-minute (600s) reproducible simulations using the REAL updateSimulation
 * engine extracted directly from web/cafe/index.html (or cafe.html) with rendering disabled.
 * Zero duplicate code: uses the exact same stations, queue, perks, and math as the live game.
 * 
 * Evaluates all 8 combinations:
 * Stove Lvl 1 / 10  ×  Chefs 1 / 2  ×  Gourmets Accepted / Ignored
 * across 20 reproducible seeds for all 4 featured dishes (640 total runs).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Locate HTML source file (works from repo root or scripts dir)
function findHtmlPath() {
  const candidates = [
    path.join(__dirname, '../web/cafe/index.html'),
    path.join(__dirname, 'web/cafe/index.html'),
    path.join(__dirname, '../cafe.html'),
    path.join(__dirname, 'cafe.html'),
    path.join(__dirname, 'index.html')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  throw new Error('Could not find cafe HTML file in candidate paths: ' + candidates.join(', '));
}

function createGameEngine(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not find script block in ' + htmlPath);
  const scriptContent = match[1];

  const listeners = {};
  const mockWindow = {
    Telegram: {},
    addEventListener: (evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    dispatchEvent: () => {},
    devicePixelRatio: 1
  };

  const mockDoc = {
    getElementById: () => ({
      innerText: '',
      style: {},
      classList: { add: () => {}, remove: () => {} },
      getContext: () => ({
        scale: () => {}, clearRect: () => {}, fillRect: () => {}, save: () => {}, restore: () => {},
        beginPath: () => {}, rect: () => {}, arc: () => {}, ellipse: () => {}, fill: () => {}, stroke: () => {}, fillText: () => {}
      }),
      getBoundingClientRect: () => ({ width: 380, height: 340, left: 0, top: 0 })
    }),
    querySelector: () => ({ innerText: '' }),
    querySelectorAll: () => []
  };

  const sandbox = {
    window: mockWindow,
    document: mockDoc,
    requestAnimationFrame: () => {},
    setInterval: () => {},
    setTimeout: () => {},
    clearTimeout: () => {},
    performance: { now: () => 0 },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math,
    Date,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(scriptContent, sandbox);
  if (listeners['DOMContentLoaded']) {
    listeners['DOMContentLoaded'].forEach(fn => fn());
  }

  if (!sandbox.window.__game) {
    throw new Error('window.__game was not initialized!');
  }

  return sandbox.window.__game;
}

function runSingleSimulation(game, {
  stoveLevel = 1,
  hasHelper = false,
  acceptGourmet = true,
  featuredDish = 'coffee',
  seed = 42,
  duration = 600,
  dt = 0.1
}) {
  game.resetSimulationState({
    stoveLevel,
    hasHelper,
    featuredDish,
    menuLevel: 4,
    seed
  });

  const state = game.getState();
  let time = 0;

  while (time < duration) {
    time += dt;

    if (acceptGourmet) {
      // Find waiting gourmet who hasn't been accepted yet
      const waitingCat = game.getCustomers().find(c =>
        c.isVIP && !c.isVipAccepted && c.state === 'waiting_vip_accept'
      );
      if (waitingCat) {
        game.acceptVipOrder(waitingCat);
      }
    }

    game.updateSimulation(dt);
  }

  return {
    totalCoins: state.totalEarned,
    totalServed: state.ordersServed,
    gourmetCoins: state.gourmetEarned || 0,
    gourmetServed: game.getGourmetsServed()
  };
}

function runScenario(game, {
  name,
  stoveLevel,
  hasHelper,
  acceptGourmet,
  seedsCount = 20,
  duration = 600
}) {
  const seeds = [];
  for (let s = 1; s <= seedsCount; s++) seeds.push(s * 7919);

  const dishes = ['coffee', 'sandwich', 'fish', 'cake'];
  const summary = {};

  for (const dishId of dishes) {
    let totCoins = 0;
    let totServed = 0;
    let totGourmetCoins = 0;
    let totGourmetServed = 0;

    for (const seed of seeds) {
      const res = runSingleSimulation(game, {
        stoveLevel,
        hasHelper,
        acceptGourmet,
        featuredDish: dishId,
        seed,
        duration
      });
      totCoins += res.totalCoins;
      totServed += res.totalServed;
      totGourmetCoins += res.gourmetCoins;
      totGourmetServed += res.gourmetServed;
    }

    const avgCoins = Math.round(totCoins / seeds.length);
    const avgServed = Number((totServed / seeds.length).toFixed(1));
    const avgGourmetCoins = Math.round(totGourmetCoins / seeds.length);
    const avgGourmetServed = Number((totGourmetServed / seeds.length).toFixed(1));
    const vipShare = (avgGourmetCoins / (avgCoins || 1) * 100).toFixed(1) + '%';

    summary[dishId] = {
      'Итого 🪙': avgCoins,
      'Гостей 🐾': avgServed,
      'Гурманы 🪙': avgGourmetCoins,
      'Гурманов 👑': avgGourmetServed,
      'Доля VIP %': vipShare
    };
  }

  return { name, stoveLevel, hasHelper, acceptGourmet, summary };
}

function runAllCombinations() {
  const htmlPath = findHtmlPath();
  console.log(`☕ Loading game engine from: ${htmlPath}`);
  const game = createGameEngine(htmlPath);

  const combinations = [
    { name: '1. Плита 1 (медл.) × 1 повар × Гурманы ДА', stoveLevel: 1, hasHelper: false, acceptGourmet: true },
    { name: '2. Плита 1 (медл.) × 1 повар × Гурманы НЕТ', stoveLevel: 1, hasHelper: false, acceptGourmet: false },
    { name: '3. Плита 1 (медл.) × 2 повара × Гурманы ДА', stoveLevel: 1, hasHelper: true, acceptGourmet: true },
    { name: '4. Плита 1 (медл.) × 2 повара × Гурманы НЕТ', stoveLevel: 1, hasHelper: true, acceptGourmet: false },
    { name: '5. Плита 10 (макс.) × 1 повар × Гурманы ДА', stoveLevel: 10, hasHelper: false, acceptGourmet: true },
    { name: '6. Плита 10 (макс.) × 1 повар × Гурманы НЕТ', stoveLevel: 10, hasHelper: false, acceptGourmet: false },
    { name: '7. Плита 10 (макс.) × 2 повара × Гурманы ДА', stoveLevel: 10, hasHelper: true, acceptGourmet: true },
    { name: '8. Плита 10 (макс.) × 2 повара × Гурманы НЕТ', stoveLevel: 10, hasHelper: true, acceptGourmet: false }
  ];

  console.log('🚀 Running 8 combinations × 4 dishes × 20 seeds (640 runs @ 600s each)...');
  const startTime = Date.now();
  const allResults = [];

  for (const combo of combinations) {
    const res = runScenario(game, combo);
    allResults.push(res);

    console.log(`\n========================================================================================`);
    console.log(`=== ${combo.name} ===`);
    console.log(`========================================================================================`);
    console.table(res.summary);
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✨ Finished 640 simulations in ${elapsedSec}s using live updateSimulation engine!`);

  // Save results to JSON file
  const outPath = path.join(__dirname, '../benchmark_results.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`💾 Saved benchmark results to: ${path.resolve(outPath)}`);

  return allResults;
}

if (require.main === module) {
  runAllCombinations();
}

module.exports = {
  createGameEngine,
  runSingleSimulation,
  runScenario,
  runAllCombinations
};
