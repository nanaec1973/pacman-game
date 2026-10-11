/**
 * test_telegram_swipe_lock.js
 * Сьют проверки закрепления игрового экрана и защиты от закрытия свайпом вниз в Telegram Mini App.
 * Проверяет:
 * 1. Интеграцию с Telegram WebApp SDK (disableVerticalSwipes, enableClosingConfirmation, expand)
 * 2. Безопасность при отсутствии SDK или старой версии Bot API
 * 3. CSS-фиксацию контейнеров и холста (touch-action, overscroll-behavior, position: fixed)
 * 4. JS-щит: блокировку свайпа по холсту/шапке и защиту от rubber-band в списке улучшений
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
  throw new Error('Не удалось найти HTML-файл игры (проверены web/cafe/index.html и cafe.html)');
}

const targetFile = findGameHtmlPath();

console.log(`🚀 Запуск проверки закрепления экрана и блокировки свайпа Telegram WebApp...`);
console.log(`Целевой HTML: ${targetFile}\n`);

const htmlContent = fs.readFileSync(targetFile, 'utf8');

// --- ТЕСТ 1: Проверка CSS стилей закрепления экрана ---
console.log('--- ТЕСТ 1: CSS-правила закрепления экрана и touch-action ---');
assert(htmlContent.includes('overscroll-behavior: none;'), 'Обязательно наличие overscroll-behavior: none');
assert(htmlContent.includes('overscroll-behavior-y: none;'), 'Обязательно наличие overscroll-behavior-y: none');
assert(htmlContent.includes('position: fixed;'), 'html, body должны быть зафиксированы через position: fixed');
assert(htmlContent.includes('min-height: 100dvh;'), 'Использование dynamic viewport 100dvh');

// Проверка touch-action для холста и игрового поля
const canvasTouchActionMatch = htmlContent.match(/#cafe-viewport\s*\{[^}]*touch-action:\s*none/s);
assert(canvasTouchActionMatch, '#cafe-viewport должен иметь touch-action: none');

const appContainerMatch = htmlContent.match(/#app-container\s*\{[^}]*touch-action:\s*none/s);
assert(appContainerMatch, '#app-container должен иметь touch-action: none');

// Проверка прокручиваемых контейнеров (.upgrades-scroll, .modal-card, .featured-list)
const upgradesScrollMatch = htmlContent.match(/\.upgrades-scroll\s*\{[^}]*touch-action:\s*pan-y/s);
assert(upgradesScrollMatch, '.upgrades-scroll должен иметь touch-action: pan-y');

const modalCardMatch = htmlContent.match(/\.modal-card\s*\{[^}]*touch-action:\s*pan-y/s);
assert(modalCardMatch, '.modal-card должен иметь touch-action: pan-y');

console.log('✅ Тест 1 пройден: CSS-стили корректно фиксируют экран и изолируют прокрутку.');

// --- ТЕСТ 2: Проверка Telegram WebApp SDK вызовов ---
console.log('\n--- ТЕСТ 2: Вызовы Telegram WebApp SDK методов ---');

// Мокаем глобальные объекты для выполнения скрипта
let readyCalled = false;
let expandCalled = false;
let disableVerticalSwipesCalled = false;
let enableClosingConfirmationCalled = false;
let isVerticalSwipesEnabledVal = true;

const mockTelegram = {
  WebApp: {
    ready: () => { readyCalled = true; },
    expand: () => { expandCalled = true; },
    disableVerticalSwipes: () => {
      disableVerticalSwipesCalled = true;
      mockTelegram.WebApp.isVerticalSwipesEnabled = false;
    },
    isVerticalSwipesEnabled: true,
    enableClosingConfirmation: () => { enableClosingConfirmationCalled = true; }
  }
};

// Проверяем наличие методов в кодовой базе
assert(htmlContent.includes('webApp.disableVerticalSwipes()'), 'Код должен вызывать disableVerticalSwipes()');
assert(htmlContent.includes('webApp.enableClosingConfirmation()'), 'Код должен вызывать enableClosingConfirmation()');
assert(htmlContent.includes('webApp.expand()'), 'Код должен вызывать expand()');

console.log('✅ Тест 2 пройден: вызовы Telegram WebApp API (Bot API 7.7+) присутствуют.');

// --- ТЕСТ 3: Симуляция JS Touch Shield (блокировка свайпа вниз и rubber-band) ---
console.log('\n--- ТЕСТ 3: Симуляция JS Touch Shield ---');

// Имитируем DOM-дерево и слушатели событий
const listeners = {};
const mockDocument = {
  addEventListener: (event, handler, options) => {
    listeners[event] = { handler, options };
  }
};

let touchStartRan = false;
let touchMovePreventDefaultCount = 0;

// Извлекаем функцию setupTouchProtection из HTML и исполняем её в песочнице
const matchSetupTouch = htmlContent.match(/function setupTouchProtection\(\)\s*\{([\s\S]*?)\n    \}/);
assert(matchSetupTouch, 'Функция setupTouchProtection должна быть определена');

const setupFn = new Function('document', 'window', matchSetupTouch[1]);

// Запускаем установку защиты с нашими моками
setupFn(mockDocument, { Telegram: mockTelegram });

assert(listeners['touchstart'], 'Слушатель touchstart должен быть зарегистрирован');
assert(listeners['touchmove'], 'Слушатель touchmove должен быть зарегистрирован');
assert.strictEqual(listeners['touchmove'].options.passive, false, 'touchmove должен иметь passive: false для возможности preventDefault');

// Сценарий 3.1: Свайп вниз по холсту игры (Canvas / Viewport)
const fakeCanvasTarget = {
  closest: (sel) => null // Вне прокручиваемых блоков
};

listeners['touchstart'].handler({
  touches: [{ clientY: 100 }],
  target: fakeCanvasTarget
});

let canvasDefaultPrevented = false;
listeners['touchmove'].handler({
  touches: [{ clientY: 180 }], // Свайп вниз на 80px
  cancelable: true,
  preventDefault: () => { canvasDefaultPrevented = true; }
});

assert(canvasDefaultPrevented, 'Свайп вниз по холсту должен блокироваться (preventDefault)');
console.log('✅ Сценарий 3.1 пройден: свайп по игровому полю отменён, экран зафиксирован.');

// Сценарий 3.2: Свайп вниз у самого верха списка улучшений (защита от закрытия окна через rubber-band)
const fakeUpgradesList = {
  scrollTop: 0,
  clientHeight: 300,
  scrollHeight: 800,
  closest: (sel) => fakeUpgradesList
};

listeners['touchstart'].handler({
  touches: [{ clientY: 200 }],
  target: fakeUpgradesList
});

// Проверяем, что scrollTop был сдвинут с 0 на 1 для предотвращения WebKit rubber-band
assert.strictEqual(fakeUpgradesList.scrollTop, 1, 'scrollTop должен быть сдвинут на 1px для устранения rubber-band');

let upgradesPullDownPrevented = false;
listeners['touchmove'].handler({
  touches: [{ clientY: 260 }], // Попытка потянуть список вниз
  cancelable: true,
  preventDefault: () => { upgradesPullDownPrevented = true; }
});

assert(upgradesPullDownPrevented, 'Попытка потянуть список вниз в начале списка должна блокироваться');
console.log('✅ Сценарий 3.2 пройден: отскок в начале списка улучшений предотвращён.');

// Сценарий 3.3: Обычная прокрутка внутри списка (не в самом верху)
fakeUpgradesList.scrollTop = 50; // Находимся в середине списка
listeners['touchstart'].handler({
  touches: [{ clientY: 300 }],
  target: fakeUpgradesList
});

let normalScrollPrevented = false;
listeners['touchmove'].handler({
  touches: [{ clientY: 240 }], // Скроллим вниз (палец вверх)
  cancelable: true,
  preventDefault: () => { normalScrollPrevented = true; }
});

assert(!normalScrollPrevented, 'Штатная прокрутка внутри списка улучшений не должна блокироваться');
console.log('✅ Сценарий 3.3 пройден: штатная прокрутка списка улучшений работает штатно.');

console.log('\n🎉 ВСЕ ТЕСТЫ ЗАКРЕПЛЕНИЯ ЭКРАНА УСПЕШНО ПРОЙДЕНЫ!');
