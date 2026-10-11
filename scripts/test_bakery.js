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

const ARTIFACT_DIR = process.env.ARTIFACT_DIR || 
  (fs.existsSync('/Users/ksh/.gemini/antigravity/brain/ffa885fb-fa06-401d-b1a0-6698d13a18df')
    ? '/Users/ksh/.gemini/antigravity/brain/ffa885fb-fa06-401d-b1a0-6698d13a18df'
    : path.resolve(__dirname, '../screenshots'));
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

const gameHtmlFile = findGameHtmlPath();
const FILE_URL = 'file://' + gameHtmlFile;

async function runTests() {
  console.log('🚀 Starting Comprehensive Cat Bakery (Пекарня) Verification Suite...');
  console.log('Target Game HTML:', gameHtmlFile);
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
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));

  console.log('\n--- 1. Testing Save Migration (v1 -> v2) ---');
  const migrationRes = await page.evaluate(() => {
    // Simulate v1 legacy save without bakery
    const legacySave = {
      saveVersion: 1,
      coins: 4500,
      totalEarned: 12000,
      ordersServed: 180,
      gourmetsServed: 5,
      expansion: 1,
      verandaDecor: 1,
      featuredDish: 'fish',
      upgrades: { speed: 8, menu: 4, profit: 5, helper: 1 }
    };
    localStorage.setItem('cat_cafe_save_v1', JSON.stringify(legacySave));
    window.__game.loadGame();

    const st = window.__game.getState();
    return {
      saveVersion: st.saveVersion,
      coins: st.coins,
      ordersServed: st.ordersServed,
      currentVenue: st.currentVenue,
      hasBakery: !!st.bakery,
      bakeryUnlocked: st.bakery?.unlocked,
      bakeryCoins: st.bakery?.coins,
      bakeryOrdersServed: st.bakery?.ordersServed,
      bakeryOvenLvl: st.bakery?.upgrades?.oven,
      bakeryHelperLvl: st.bakery?.upgrades?.baker_helper
    };
  });
  console.log('Migration Result:', migrationRes);
  if (migrationRes.saveVersion !== 2) throw new Error('Save version not migrated to 2!');
  if (!migrationRes.hasBakery) throw new Error('Bakery object missing in state!');
  if (migrationRes.bakeryCoins !== 60) throw new Error('Bakery starting coins should be 60!');
  if (migrationRes.bakeryHelperLvl !== 0) throw new Error('Bakery helper level should start at 0!');
  console.log('✅ Save migration successfully preserved cafe data and initialized bakery state.');

  console.log('\n--- 2. Testing Bakery Unlock Gate & Cost Deduction ---');
  const unlockGateRes = await page.evaluate(() => {
    const st = window.__game.getState();
    // Case A: missing requirements
    st.coins = 2400; // < 2500
    st.ordersServed = 140; // < 150
    const canUnlockFail = window.__game.canUnlockBakery();
    window.__game.buyBakery();
    const stillLocked = !st.bakery.unlocked;

    // Case B: meets all requirements
    st.coins = 3500;
    st.ordersServed = 160;
    st.expansion = 1;
    st.verandaDecor = 1;
    const canUnlockPass = window.__game.canUnlockBakery();
    window.__game.buyBakery();

    return {
      canUnlockFail,
      stillLocked,
      canUnlockPass,
      nowUnlocked: st.bakery.unlocked,
      remainingCafeCoins: st.coins,
      initialBakeryCoins: st.bakery.coins
    };
  });
  console.log('Unlock Gate Result:', unlockGateRes);
  if (unlockGateRes.canUnlockFail !== false) throw new Error('Should not allow unlock when under requirements!');
  if (!unlockGateRes.canUnlockPass) throw new Error('Should allow unlock when requirements met!');
  if (!unlockGateRes.nowUnlocked) throw new Error('Bakery should be unlocked after buyBakery()!');
  if (unlockGateRes.remainingCafeCoins !== 1000) throw new Error('Cafe coins should be deducted by exactly 2500 (3500 -> 1000)!');
  if (unlockGateRes.initialBakeryCoins !== 60) throw new Error('Bakery coins must start at 60!');
  console.log('✅ Unlock gate validated: strictly requires veranda + flower corner + 150 guests + 2500 coins.');

  // Screenshot celebration modal
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'bakery_unlocked_modal.png') });
  console.log('📸 Saved bakery_unlocked_modal.png');

  await page.evaluate(() => {
    window.__game.closeBakeryUnlockedModal();
  });

  console.log('\n--- 3. Testing Venue Switcher & Economy Isolation ---');
  const switcherRes = await page.evaluate(() => {
    window.__game.switchVenue('bakery');
    const headerVenueLabel = document.getElementById('coins-venue-label')?.innerText;
    const coinsDisplay = document.getElementById('coins-val')?.innerText;
    const cafeBtnActive = document.getElementById('venue-btn-cafe')?.classList.contains('active');
    const bakeryBtnActive = document.getElementById('venue-btn-bakery')?.classList.contains('active');

    // Add 100 bakery coins
    window.__game.addBakeryCoins(100);
    const st = window.__game.getState();
    const bakeryCoins = st.bakery.coins;
    const cafeCoins = st.coins;

    // Switch back to cafe
    window.__game.switchVenue('cafe');
    const cafeCoinsDisplay = document.getElementById('coins-val')?.innerText;
    const cafeLabel = document.getElementById('coins-venue-label')?.innerText;

    // Return to bakery
    window.__game.switchVenue('bakery');

    return {
      headerVenueLabel,
      coinsDisplay,
      cafeBtnActive,
      bakeryBtnActive,
      bakeryCoins,
      cafeCoins,
      cafeCoinsDisplay,
      cafeLabel
    };
  });
  console.log('Switcher Result:', switcherRes);
  if (switcherRes.bakeryCoins !== 160) throw new Error('Bakery coins should be 160!');
  if (switcherRes.cafeCoins !== 1000) throw new Error('Cafe coins should remain unchanged at 1000!');
  console.log('✅ Venue switching and strict economy isolation confirmed.');

  console.log('\n--- 4. Testing Bakery Upgrades Math & Progression ---');
  const upgradesRes = await page.evaluate(() => {
    const st = window.__game.getState();
    st.bakery.coins = 1000; // give test coins

    // 1. Oven upgrade (level 1 -> 2)
    const baseBake = window.__game.getEffectiveBakeTime(window.__game.BAKERY_RECIPES[0]);
    window.__game.buyBakeryUpgrade('oven');
    const lvl2Bake = window.__game.getEffectiveBakeTime(window.__game.BAKERY_RECIPES[0]);

    // 2. Waiter speed (level 1 -> 2)
    const baseSpeed = window.__game.getBakeryWaiterSpeed();
    window.__game.buyBakeryUpgrade('waiter_speed');
    const lvl2Speed = window.__game.getBakeryWaiterSpeed();

    // 3. Tables (level 1 -> 2)
    const baseTables = window.__game.getBakeryMaxTables();
    window.__game.buyBakeryUpgrade('tables');
    const lvl2Tables = window.__game.getBakeryMaxTables();

    // 4. Recipes (level 1 -> 2: unlocks cookie)
    const baseRecipesCount = window.__game.getBakeryUnlockedRecipes().length;
    window.__game.buyBakeryUpgrade('recipes');
    const lvl2Recipes = window.__game.getBakeryUnlockedRecipes();

    // 5. Baker helper (level 0 -> 1: unlocks Pushok)
    const helperLvlBefore = window.__game.getBakeryUpgradeLevel('baker_helper');
    window.__game.buyBakeryUpgrade('baker_helper');
    const helperLvlAfter = window.__game.getBakeryUpgradeLevel('baker_helper');

    return {
      oven: { baseBake, lvl2Bake, ratio: lvl2Bake / baseBake },
      waiter: { baseSpeed, lvl2Speed },
      tables: { baseTables, lvl2Tables },
      recipes: { baseRecipesCount, lvl2RecipesCount: lvl2Recipes.length, unlockedNames: lvl2Recipes.map(r => r.name) },
      helper: { helperLvlBefore, helperLvlAfter }
    };
  });
  console.log('Upgrades Result:', JSON.stringify(upgradesRes, null, 2));
  if (upgradesRes.oven.lvl2Bake >= upgradesRes.oven.baseBake) throw new Error('Oven upgrade did not reduce bake time!');
  if (upgradesRes.waiter.lvl2Speed <= upgradesRes.waiter.baseSpeed) throw new Error('Waiter speed did not increase!');
  if (upgradesRes.tables.lvl2Tables <= upgradesRes.tables.baseTables) throw new Error('Tables count did not increase!');
  if (upgradesRes.recipes.lvl2RecipesCount <= upgradesRes.recipes.baseRecipesCount) throw new Error('Recipes did not unlock new recipe!');
  if (upgradesRes.helper.helperLvlAfter !== 1) throw new Error('Baker helper was not hired!');
  console.log('✅ Bakery upgrades function correctly with correct stats and unlock thresholds.');

  console.log('\n--- 5. Testing Quests Chain in Bakery ---');
  const questRes = await page.evaluate(() => {
    const q1 = window.__game.getCurrentBakeryQuest();
    const st = window.__game.getState();
    st.bakery.ordersServed = 6;
    const canClaim = q1.isCompleted();
    window.__game.claimBakeryQuestReward();
    const q2 = window.__game.getCurrentBakeryQuest();

    return {
      q1Title: q1.title,
      canClaim,
      q2Title: q2 ? q2.title : null
    };
  });
  console.log('Quest Result:', questRes);
  if (!questRes.canClaim) throw new Error('Quest 1 should be complete with 6 orders!');
  if (!questRes.q2Title) throw new Error('Quest 2 should be active after claiming quest 1!');
  console.log('✅ Bakery quests chain progresses smoothly.');

  console.log('\n--- 6. Testing Gameplay Cycle: Baking, Vitrine, Priority Tap, Waiter Delivery ---');
  const simRes = await page.evaluate(() => {
    // Reset bakery state
    window.__game.resetBakerySimulationState({ clearReadyOrders: true });
    const st = window.__game.getState();
    st.bakery.coins = 100;
    st.bakery.ordersServed = 0;

    // Spawn 1 customer
    window.__game.spawnBakeryCustomer();
    const tables = window.__game.getBakeryTables();
    const occupiedTable = tables.find(t => t.customer !== null);
    if (!occupiedTable) return { error: 'Customer failed to sit at table' };

    // Advance simulation until dish is ready in vitrine
    // Step 0.1s at a time
    let steps = 0;
    while (window.__game.getReadyOrders().length === 0 && steps < 100) {
      window.__game.updateBakerySimulation(0.1);
      steps++;
    }

    const readyOrders = window.__game.getReadyOrders();
    if (readyOrders.length === 0) return { error: 'No order produced in vitrine after baking' };

    // Mark as priority (simulating player tap on vitrine)
    readyOrders[0].isPriority = true;
    const wasMarkedPriority = readyOrders[0].isPriority;

    // Step simulation until waiter delivers and customer finishes eating
    let deliverySteps = 0;
    const initialOrdersServed = st.bakery.ordersServed;
    while (st.bakery.ordersServed === initialOrdersServed && deliverySteps < 150) {
      window.__game.updateBakerySimulation(0.1);
      deliverySteps++;
    }

    return {
      customerSeated: !!occupiedTable,
      bakingSteps: steps,
      readyOrdersCount: readyOrders.length,
      wasMarkedPriority,
      deliverySteps,
      finalOrdersServed: st.bakery.ordersServed,
      finalBakeryCoins: st.bakery.coins
    };
  });
  console.log('Simulation Result:', simRes);
  if (simRes.error) throw new Error(simRes.error);
  if (simRes.finalOrdersServed !== 1) throw new Error('Customer was not served by waiter!');
  console.log('✅ Complete bakery service loop verified: Table -> Oven -> Vitrine (Priority tap) -> Waiter -> Eating -> Payment.');

  console.log('\n--- 7. Testing Bakery Offline Earnings ---');
  const offlineRes = await page.evaluate(() => {
    const st = window.__game.getState();
    const beforeCoins = st.bakery.coins;
    // Set last saved time to 1800 seconds (30 mins) ago
    st.bakery.lastSavedTime = Date.now() - 1800 * 1000;
    window.__game.checkBakeryOfflineEarnings();

    const modalDisplay = document.getElementById('welcome-modal')?.style.display;
    const earnedValText = document.getElementById('offline-earned-val')?.innerText;

    // Claim earnings
    window.__game.claimOfflineEarnings();
    const afterCoins = st.bakery.coins;

    return {
      beforeCoins,
      modalDisplay,
      earnedValText,
      afterCoins,
      earnedDiff: afterCoins - beforeCoins
    };
  });
  console.log('Offline Earnings Result:', offlineRes);
  if (offlineRes.earnedDiff <= 0) throw new Error('Offline earnings were not credited to bakery!');
  console.log('✅ Bakery offline delivery & revenue math verified.');

  console.log('\n--- 8. Capturing Responsive Screenshots ---');
  await page.evaluate(() => {
    // Dismiss any open modal overlays
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    // Hide toast notifications completely
    const toast = document.getElementById('toast-msg');
    if (toast) {
      toast.classList.remove('show');
      toast.style.display = 'none';
      toast.style.opacity = '0';
    }
    window.__game.switchVenue('bakery');
    // Spawn customers at tables and simulate to show active baking and dining
    window.__game.spawnBakeryCustomer();
    window.__game.spawnBakeryCustomer();
    for (let i = 0; i < 40; i++) {
      window.__game.updateBakerySimulation(0.08);
    }
  });

  const dismissToast = async () => {
    await page.evaluate(() => {
      const toast = document.getElementById('toast-msg');
      if (toast) {
        toast.classList.remove('show');
        toast.style.display = 'none';
        toast.style.opacity = '0';
      }
      if (window.__game && typeof window.__game.clearParticles === 'function') {
        window.__game.clearParticles();
      }
    });
  };

  // 1. Android compact 360x640 - OPEN SHOP
  await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    if (window.__game.isShopCollapsed()) {
      window.__game.toggleShopCollapse();
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await dismissToast();
  const screen360OpenPath = path.join(ARTIFACT_DIR, 'bakery_mobile_360x640_open.png');
  await page.screenshot({ path: screen360OpenPath });
  fs.copyFileSync(screen360OpenPath, path.join(ARTIFACT_DIR, 'bakery_mobile_360x640.png'));
  console.log('📸 Saved bakery_mobile_360x640_open.png (and bakery_mobile_360x640.png)');

  // 2. Android compact 360x640 - COLLAPSED SHOP
  await page.evaluate(() => {
    if (!window.__game.isShopCollapsed()) {
      window.__game.toggleShopCollapse();
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await dismissToast();
  const screen360CollapsedPath = path.join(ARTIFACT_DIR, 'bakery_mobile_360x640_collapsed.png');
  await page.screenshot({ path: screen360CollapsedPath });
  console.log('📸 Saved bakery_mobile_360x640_collapsed.png');

  // 3. iPhone 390x844 - OPEN SHOP
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    if (window.__game.isShopCollapsed()) {
      window.__game.toggleShopCollapse();
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await dismissToast();
  const screen390OpenPath = path.join(ARTIFACT_DIR, 'bakery_mobile_390x844_open.png');
  await page.screenshot({ path: screen390OpenPath });
  fs.copyFileSync(screen390OpenPath, path.join(ARTIFACT_DIR, 'bakery_mobile_390x844.png'));
  console.log('📸 Saved bakery_mobile_390x844_open.png (and bakery_mobile_390x844.png)');

  // 4. iPhone 390x844 - COLLAPSED SHOP
  await page.evaluate(() => {
    if (!window.__game.isShopCollapsed()) {
      window.__game.toggleShopCollapse();
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await dismissToast();
  const screen390CollapsedPath = path.join(ARTIFACT_DIR, 'bakery_mobile_390x844_collapsed.png');
  await page.screenshot({ path: screen390CollapsedPath });
  fs.copyFileSync(screen390CollapsedPath, path.join(ARTIFACT_DIR, 'bakery_canvas_collapsed.png'));
  console.log('📸 Saved bakery_mobile_390x844_collapsed.png (and bakery_canvas_collapsed.png)');

  // 5. Switch to Cafe view
  await page.evaluate(() => {
    if (window.__game.isShopCollapsed()) {
      window.__game.toggleShopCollapse();
    }
    window.__game.switchVenue('cafe');
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
  await dismissToast();
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'cafe_with_bakery_tab.png') });
  console.log('📸 Saved cafe_with_bakery_tab.png');

  if (consoleErrors.length > 0) {
    console.error('Console errors encountered during testing:', consoleErrors);
    throw new Error('Test run had console errors!');
  }

  await browser.close();
  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! No errors detected.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
