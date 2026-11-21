// Проверки Кото-Тапалки 2.0 без браузера: node scripts/test_cat_v2.js [путь к cat.html]
// Подменяет DOM и Telegram SDK заглушками, управляет часами через window.__GameClock.
const fs=require('fs'),vm=require('vm');
const path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'..','cat.html'),'utf8');
const code=html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
const mk=()=>new Proxy(function(){},{get(t,p){if(p===Symbol.toPrimitive)return()=>0;if(['width','height','clientWidth','clientHeight'].includes(p))return 300;if(p==='getBoundingClientRect')return()=>({left:0,top:0,width:300,height:300});if(p==='querySelectorAll')return()=>[];if(p==='parentNode')return null;if(p==='getAttribute')return()=>null;return mk();},set(){return true},apply(){return mk()}});
let T=new Date(2026,10,21,12,0,0).getTime(),P=0;const timers=[],tq=[];const store={};
const cloud={};let errors=[];
const tgObj={initDataUnsafe:{user:{id:42,first_name:'Тест'},start_param:'ref_777'},isVersionAtLeast:()=>true,expand(){},ready(){},HapticFeedback:{impactOccurred(){},notificationOccurred(){},selectionChanged(){}},BackButton:{show(){},hide(){},onClick(){}},
 CloudStorage:{setItem:(k,v)=>{if(String(v).length>4096)errors.push('chunk>4096 '+k);cloud[k]=String(v)},getItem:(k,cb)=>cb(null,cloud[k]??''),getItems:(ks,cb)=>{const o={};ks.forEach(k=>o[k]=cloud[k]);cb(null,o)}}};
function makeWin(){
 const w={__GameClock:{now:()=>T,perfNow:()=>P},__GameTimers:{setTimeout:(cb,ms)=>{tq.push({cb,at:P+(ms||0)});return tq.length},clearTimeout(){},setInterval:(cb,ms)=>{timers.push({cb,ms});return timers.length},clearInterval(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){}},
 localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v)},innerWidth:400,innerHeight:800,addEventListener(){},console:{log(){},warn(){},error:(...a)=>errors.push(a.join(' '))},Telegram:{WebApp:tgObj},location:{search:''},URLSearchParams};
 const listeners={};
 const document={getElementById:()=>mk(),createElement:()=>mk(),querySelector:()=>mk(),querySelectorAll:()=>[],body:mk(),addEventListener:(e,f)=>{(listeners[e]=listeners[e]||[]).push(f)},visibilityState:'visible'};
 w.window=w;w.document=document;w.performance={now:()=>P};
 Object.assign(w,{Math,Date,JSON,Object,Array,String,Number,isFinite,parseInt,parseFloat,Promise,setTimeout,clearTimeout,requestAnimationFrame:()=>0});
 vm.createContext(w);vm.runInContext(code,w);return {w,g:w.__game,listeners};
}
let {w,g}=makeWin();
const tick=()=>timers.find(t=>t.ms===100);
function drain(){P+=1000;let n=0;tq.sort((a,b)=>a.at-b.at);while(tq.length&&tq[0].at<=P&&n<200){tq.shift().cb();n++;tq.sort((a,b)=>a.at-b.at);}}
const s=()=>g.getState();
const ok=(c,m)=>{console.log((c?'✅':'❌')+' '+m);if(!c)process.exitCode=1;};

ok(s().fish===1000 && s().wheelTickets===2,'Реферальный подарок новичку: '+s().fish+' рыб, билетов '+s().wheelTickets);
ok(s().tutorialDone===false,'Новичку показывается обучение');
ok(g.getEnergyRegen()===4,'Энергия в 1-й жизни: '+g.getEnergyRegen()+'/с');

// Торт: 3 бабочки
s().fish=1e6; g.cookDish('dish_cake'); let caught=0;
for(let i=0;i<6;i++){const b=s().stats.butterfliesCaught;g.catchButterfly(null);if(s().stats.butterfliesCaught>b)caught++;drain();}
ok(caught===3,'Торт: поймано бабочек '+caught+' из 3');

// Вехи
ok(g.getMilestoneMult(9)===1&&g.getMilestoneMult(10)===2&&g.getMilestoneMult(25)===4,'Вехи x2 на 10 и 25');
// Покупка x10 и макс
s().fish=100000; Object.keys(s().upgrades).forEach(k=>s().upgrades[k]=0);
const bi=g.getBulkInfo(g.upgradesClickConfig[0],10); g.buyUpgrade('fish_treat','click',10);
ok(s().upgrades.fish_treat===10 && Math.abs(s().fish-(100000-bi.total))<1,'Купить x10: '+s().upgrades.fish_treat+' шт за '+bi.total);
const mx=g.getBulkInfo(g.upgradesPassiveConfig[0],'max'); g.buyUpgrade('mouse','passive','max');
ok(s().upgrades.mouse===mx.qty && s().fish>=0 && s().fish < g.getBulkInfo(g.upgradesPassiveConfig[0],1).total,'Купить макс: '+mx.qty+' мышек, остаток '+Math.floor(s().fish));
const nb=s().fish; ok(g.buyUpgrade('galaxy_palace','passive',1)===false && s().fish===nb,'Закрытое улучшение не покупается');

// Обучение закрывается после рыбки и мышки
g.updateTutorial(); ok(s().tutorialDone===true,'Обучение пройдено после покупки рыбки и мышки');

// Перерождение по заработку в жизни
s().lifeEarned=99999; s().fish=500000; g.ascendLife(); ok(s().livesLevel===1,'Не перерождает при 99 999 заработанных, даже с 500 000 на руках');
s().lifeEarned=100000; s().fish=0; g.ascendLife(); ok(s().livesLevel===2 && s().lifeEarned===0 && s().fish===0,'Перерождает при 100 000 заработанных в жизни');
ok(g.getEnergyRegen()===2,'Со 2-й жизни энергия 2/с');

// Боссы по порядку
s().bossesDefeated=[]; ok(g.isBossUnlocked(0)&&!g.isBossUnlocked(1),'Открыт только первый босс');
s().bossesDefeated=['cucumber']; ok(g.isBossUnlocked(1)&&!g.isBossUnlocked(2),'После огурца открыт пылесос');
s().bossesDefeated=['cucumber','dog']; ok(g.isBossUnlocked(2),'Старое сохранение: побеждённый не по порядку пёс не закрывается');
const est=g.estimateBossDamage(g.bossCatalog[0]); ok(est>0,'Оценка урона по огурцу: '+est);

// Серия входов
s().streak={lastDay:'',count:0,claimedDay:''}; g.updateDailyStreak(); ok(s().streak.count===1,'Серия: день 1');
const f0=s().fish; g.claimStreak(); ok(s().fish>f0,'Награда за серию: +'+Math.round(s().fish-f0)); const f1=s().fish; g.claimStreak(); ok(s().fish===f1,'Повторно в тот же день не выдаётся');
T+=86400000; g.updateDailyStreak(); ok(s().streak.count===2,'Следующий день: серия 2');
T+=3*86400000; g.updateDailyStreak(); ok(s().streak.count===1,'Пропуск дней: серия сбрасывается');

// Золотая рыбка
const gf=s().fish; g.showGoldenFish(); g.catchGoldenFish(null); ok(s().fish>gf,'Золотая рыбка: +'+Math.round(s().fish-gf));

// Цель
const goal=g.computeGoal(); ok(goal&&goal.name,'Цель: '+goal.name+' ('+Math.round(goal.cur)+'/'+goal.target+')');

// Облако: сохранение кусками и восстановление на «новом устройстве»
s().artifacts=Array.from({length:60},(_,i)=>({uid:'art_'+i+'_xxxxxxxxxxxxx',baseId:'collar_bell',slot:'collar',tier:1}));
g.saveGame(true); g.cloudSave(true);
const meta=JSON.parse(cloud.cs_meta); ok(meta.n>=2 && errors.filter(e=>e.startsWith('chunk')).length===0,'Облако: '+meta.n+' кусков, каждый ≤ 4096 символов');
const savedLives=s().livesLevel, savedFish=Math.floor(s().fish);
for(const k of Object.keys(store)) delete store[k]; // локальное хранилище стёрто
T+=60000;
let L; ({w,g,listeners:L}=makeWin()); drain();
ok(g.getState().livesLevel===savedLives && g.getState().artifacts.length===60,'Новое устройство: прогресс взят из облака (жизнь '+g.getState().livesLevel+', реликвий '+g.getState().artifacts.length+')');

// Тики без ошибок
for(let i=0;i<300;i++){T+=100;P+=100;tick().cb();}
ok(errors.filter(e=>!e.startsWith('chunk')).length===0,'Ошибок в консоли: '+errors.length+(errors.length?' → '+errors.slice(0,3).join(' | '):''));

// Офлайн-доход: сворачивание на 5 секунд не должно платить за время активной игры
{
  const st=g.getState(); st.upgrades.mouse=50; g.calculatePassive();
  for(let i=0;i<6000;i++){T+=100;P+=100;tick().cb();}
  const before=st.fish, rate=st.passivePerSec;
  w.document.visibilityState='hidden'; L.visibilitychange.forEach(f=>f());
  T+=5000;P+=5000;
  w.document.visibilityState='visible'; L.visibilitychange.forEach(f=>f());
  const got=g.getState().fish-before;
  ok(got<=rate*5*1.6+1,'Сворачивание на 5 с: начислено '+Math.round(got)+' (≈ '+Math.round(rate*5)+' ожидалось)');
}
