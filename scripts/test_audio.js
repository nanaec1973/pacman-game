/**
 * test_audio.js
 * Сьют проверки разблокировки Web Audio API, синтезатора звуков и обхода silent-режима iOS / Telegram WebApp.
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
  throw new Error('Не удалось найти HTML-файл игры');
}

const targetFile = findGameHtmlPath();
console.log(`🚀 Запуск проверки аудиосистемы и разблокировки звука...`);
console.log(`Целевой HTML: ${targetFile}\n`);

const htmlContent = fs.readFileSync(targetFile, 'utf8');

// --- ТЕСТ 1: Проверка наличия ключевых компонентов аудиосистемы в HTML/JS ---
console.log('--- ТЕСТ 1: Поиск ключевых механизмов в коде ---');
assert(htmlContent.includes("navigator.audioSession.type = 'playback'"), 'Должна быть настройка playback для iOS WebKit');
assert(htmlContent.includes('unlockAudio()'), 'Должна присутствовать функция unlockAudio');
assert(htmlContent.includes('data:audio/wav;base64,'), 'Должен быть неслышимый wav-буфер для активации iOS AudioSession');
assert(htmlContent.includes('visibilitychange'), 'Должно быть возобновление аудио при возврате из фона');

// Проверка наличия синтеза всех 7 звуков
const requiredSounds = ['coin', 'bell', 'purr', 'upgrade', 'sizzle', 'meow', 'victory'];
requiredSounds.forEach(snd => {
  assert(htmlContent.includes(`type === '${snd}'`), `Синтезатор должен обрабатывать звук '${snd}'`);
});
console.log(`✅ Тест 1 пройден: Все 7 типов звуков (${requiredSounds.join(', ')}) и iOS Playback Session присутствуют в коде.`);

// --- ТЕСТ 2: Моделирование Web Audio Context и синтеза звуков ---
console.log('\n--- ТЕСТ 2: Симуляция Web Audio синтезатора ---');

class MockOscillator {
  constructor() {
    this.type = 'sine';
    this.frequency = {
      setValueAtTime: (val, time) => { this.freqVal = val; },
      exponentialRampToValueAtTime: (val, time) => { this.rampVal = val; }
    };
  }
  connect(dest) { this.dest = dest; }
  start(t) { this.started = true; }
  stop(t) { this.stopped = true; }
}

class MockGain {
  constructor() {
    this.gain = {
      setValueAtTime: (val, time) => { this.gainVal = val; },
      exponentialRampToValueAtTime: (val, time) => { this.rampVal = val; }
    };
  }
  connect(dest) { this.dest = dest; }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0.5;
    this.state = 'suspended';
    this.destination = {};
  }
  createOscillator() { return new MockOscillator(); }
  createGain() { return new MockGain(); }
  createBuffer(channels, length, rate) { return {}; }
  createBufferSource() {
    return {
      connect: () => {},
      start: () => {}
    };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

// Запуск симуляции вызова playSound для каждого звука
let mockState = { soundEnabled: true };
let mockAudioCtx = new MockAudioContext();

const matchPlaySound = htmlContent.match(/function playSound\(type\)\s*\{([\s\S]*?)\n    \}/);
assert(matchPlaySound, 'Функция playSound должна быть найдена в HTML');

const playSoundFn = new Function('type', 'state', 'audioCtx', 'unlockAudio', matchPlaySound[1]);

let dummyUnlockCalled = false;
const dummyUnlock = () => { dummyUnlockCalled = true; mockAudioCtx.state = 'running'; };

requiredSounds.forEach(snd => {
  dummyUnlockCalled = false;
  playSoundFn(snd, mockState, mockAudioCtx, dummyUnlock);
  assert(dummyUnlockCalled, `При вызове playSound('${snd}') должен вызываться unlockAudio`);
  console.log(`  🎵 Звук '${snd}' успешно синтезирован без ошибок.`);
});

console.log('✅ Тест 2 пройден: Все звуки воспроизводятся корректно через Web Audio API.');

// --- ТЕСТ 3: Проверка переключения звука и синхронизации UI ---
console.log('\n--- ТЕСТ 3: Проверка переключения звука toggleSound() и синхронизации UI ---');
assert(htmlContent.includes('modal-sound-btn'), 'В модальном окне настроек должна быть кнопка управления звуком');
assert(htmlContent.includes("soundBtn.innerText = state.soundEnabled ? '🔊' : '🔇'"), 'Кнопка звука должна обновляться в updateUI()');

console.log('✅ Тест 3 пройден: Кнопки управления звуком и синхронизация интерфейса подтверждены.');

console.log('\n🎉 ВСЕ ТЕСТЫ АУДИОСИСТЕМЫ УСПЕШНО ПРОЙДЕНЫ!');
