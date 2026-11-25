import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, setDoc, deleteDoc, query, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const PRODUCTS = ["カスタード","あんこ","生地のみ","チョコ"];
const MATERIAL_BASE_YIELD = 400;
const MATERIALS = [
  {id:"egg",name:"玉子", gramsPerBase:3860},
  {id:"delidor",name:"デリドール", gramsPerBase:666},
  {id:"parfandor",name:"パルファンドール", gramsPerBase:66},
  {id:"yakimanMix",name:"ヤキマンミックス", gramsPerBase:6660},
  {id:"water",name:"水", gramsPerBase:400}
];
const BUNDLE_TYPES = [
  {key:"bundle4",size:4,flavorField:"bundle4Flavor"},
  {key:"bundle8",size:8,flavorField:"bundle8Flavor"},
  {key:"bundle16",size:16,flavorField:"bundle16Flavor"}
];
const BUNDLE_FLAVORS = {custard:"カスタード",anko:"あんこ",double:"ダブル焼き"};
const SETTINGS_DOC_ID = "_settings";
const $ = id => document.getElementById(id);
let db = null, auth = null, currentUser = null, plans = {};
let shelfLifeSettings = {regularDays:null,boxedDays:null};
let materialOrderSettings = defaultMaterialOrderSettings();
let weeklyInventory = {};
let excludeNonBusinessDays = true;
let weekStart = mondayOf(new Date());

function mondayOf(date){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function parseDate(key){const [y,m,d]=key.split("-").map(Number);return new Date(y,m-1,d);}
function fmtDate(d){return `${d.getMonth()+1}/${d.getDate()}`;}
function pad2(n){return String(n).padStart(2,"0");}
function qty(v){return Math.max(0,Math.floor(Number(v)||0));}
function sumProducts(p={}){return Object.values(p).reduce((a,b)=>a+qty(b),0);}
function bundleCount(p){return qty(p?.bundle4)*4+qty(p?.bundle8)*8+qty(p?.bundle16)*16;}
function total(p){return sumProducts(p?.products)+bundleCount(p);}
function bundleFlavors(plan={}){
  const stored=plan.bundleFlavors||{};
  return Object.fromEntries(BUNDLE_TYPES.map(type=>{
    const value=stored[type.key]||plan[type.flavorField];
    return [type.key,Object.hasOwn(BUNDLE_FLAVORS,value)?value:"double"];
  }));
}
function boxedProductionFromPlan(plan={},phase="today"){
  const result={custard:0,anko:0},flavors=bundleFlavors(plan);
  BUNDLE_TYPES.forEach(type=>{
    const half=qty(plan[type.key])*type.size/2,flavor=flavors[type.key];
    if(phase==="today"){
      if(flavor==="custard"||flavor==="double")result.custard+=half;
      if(flavor==="anko"||flavor==="double")result.anko+=half;
    }else if(flavor==="custard")result.anko+=half;
    else if(flavor==="anko")result.custard+=half;
  });
  return result;
}
function previousDateKey(key){const date=parseDate(key);date.setDate(date.getDate()-1);return dateKey(date);}
function productionBreakdownForDate(key,planMap=plans){
  const plan=planMap[key]||{},todayBoxes=boxedProductionFromPlan(plan,"today"),carryBoxes=boxedProductionFromPlan(planMap[previousDateKey(key)]||{},"next");
  const custardBox=todayBoxes.custard+carryBoxes.custard,ankoBox=todayBoxes.anko+carryBoxes.anko;
  const custardNormal=qty(plan.products?.["カスタード"]),ankoNormal=qty(plan.products?.["あんこ"]);
  return {custardNormal,ankoNormal,custardBox,ankoBox,custardTotal:custardNormal+custardBox,ankoTotal:ankoNormal+ankoBox};
}
function totalProductionForDate(key,planMap=plans){
  const plan=planMap[key]||{},todayBoxes=boxedProductionFromPlan(plan,"today"),carryBoxes=boxedProductionFromPlan(planMap[previousDateKey(key)]||{},"next");
  return sumProducts(plan.products)+(todayBoxes.custard+todayBoxes.anko)+(carryBoxes.custard+carryBoxes.anko);
}
function totalProductionForWeek(dates,planMap=plans){return dates.reduce((sum,date)=>sum+totalProductionForDate(dateKey(date),planMap),0);}
function weekDates(){return Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;});}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

const japaneseHolidayCache=new Map();
function nthWeekday(year,month,weekday,nth){
  const firstWeekday=new Date(Date.UTC(year,month-1,1)).getUTCDay();
  return 1+((weekday-firstWeekday+7)%7)+(nth-1)*7;
}
function vernalEquinoxDay(year){
  return Math.floor(year<=1979
    ? 20.8357+0.242194*(year-1980)-Math.floor((year-1980)/4)
    : 20.8431+0.242194*(year-1980)-Math.floor((year-1980)/4));
}
function autumnalEquinoxDay(year){
  return Math.floor(year<=1979
    ? 23.2588+0.242194*(year-1980)-Math.floor((year-1980)/4)
    : 23.2488+0.242194*(year-1980)-Math.floor((year-1980)/4));
}
function japaneseHolidays(year){
  if(japaneseHolidayCache.has(year))return japaneseHolidayCache.get(year);
  const holidays=new Map();
  const add=(month,day,name)=>holidays.set(`${year}-${pad2(month)}-${pad2(day)}`,name);
  const weekday=(month,day)=>new Date(Date.UTC(year,month-1,day)).getUTCDay();

  if(year>=1949)add(1,1,"元日");
  if(year>=2000)add(1,nthWeekday(year,1,1,2),"成人の日");
  else if(year>=1949)add(1,15,"成人の日");
  if(year>=1967)add(2,11,"建国記念の日");
  if(year>=2020)add(2,23,"天皇誕生日");
  else if(year>=1989&&year<=2018)add(12,23,"天皇誕生日");
  if(year>=1948)add(3,vernalEquinoxDay(year),"春分の日");

  if(year>=1949&&year<=1988)add(4,29,"天皇誕生日");
  else if(year>=1989&&year<=2006)add(4,29,"みどりの日");
  else if(year>=2007)add(4,29,"昭和の日");
  if(year>=1948)add(5,3,"憲法記念日");
  if(year>=2007)add(5,4,"みどりの日");
  if(year>=1948)add(5,5,"こどもの日");

  if(year>=1996&&year<=2002)add(7,20,"海の日");
  else if(year>=2003&&year!==2020&&year!==2021)add(7,nthWeekday(year,7,1,3),"海の日");
  if(year>=2016&&year!==2020&&year!==2021)add(8,11,"山の日");
  if(year>=1966&&year<=2002)add(9,15,"敬老の日");
  else if(year>=2003)add(9,nthWeekday(year,9,1,3),"敬老の日");
  if(year>=1948)add(9,autumnalEquinoxDay(year),"秋分の日");
  if(year>=1966&&year<=1999)add(10,10,"体育の日");
  else if(year>=2000&&year<=2019)add(10,nthWeekday(year,10,1,2),"体育の日");
  else if(year>=2022)add(10,nthWeekday(year,10,1,2),"スポーツの日");
  if(year>=1948){add(11,3,"文化の日");add(11,23,"勤労感謝の日");}

  // 祝日法の特例で移動した日・臨時の祝日
  if(year===2019){add(5,1,"天皇の即位の日");add(10,22,"即位礼正殿の儀");}
  if(year===2020){add(7,23,"海の日");add(7,24,"スポーツの日");add(8,10,"山の日");}
  if(year===2021){add(7,22,"海の日");add(7,23,"スポーツの日");add(8,8,"山の日");}
  if(year===1959)add(4,10,"皇太子明仁親王の結婚の儀");
  if(year===1989)add(2,24,"大喪の礼");
  if(year===1990)add(11,12,"即位礼正殿の儀");
  if(year===1993)add(6,9,"皇太子徳仁親王の結婚の儀");

  // 祝日に挟まれた平日（国民の休日）
  if(year>=1986){
    const nationalHolidays=new Set(holidays.keys());
    for(let month=1;month<=12;month++){
      const days=new Date(Date.UTC(year,month,0)).getUTCDate();
      for(let day=2;day<days;day++){
        const key=`${year}-${pad2(month)}-${pad2(day)}`;
        const prev=`${year}-${pad2(month)}-${pad2(day-1)}`;
        const next=`${year}-${pad2(month)}-${pad2(day+1)}`;
        if(!holidays.has(key)&&nationalHolidays.has(prev)&&nationalHolidays.has(next))add(month,day,"国民の休日");
      }
    }
  }

  // 2007年以降は、日曜の祝日の後にある最も近い祝日でない日が振替休日。
  for(const [key,name] of [...holidays]){
    const [,month,day]=key.split("-").map(Number);
    if(weekday(month,day)!==0)continue;
    if(year<2007){
      const substitute=new Date(Date.UTC(year,month-1,day+1));
      const substituteKey=`${year}-${pad2(substitute.getUTCMonth()+1)}-${pad2(substitute.getUTCDate())}`;
      if(!holidays.has(substituteKey))holidays.set(substituteKey,"振替休日");
    }else{
      let offset=1;
      while(offset<=7){
        const substitute=new Date(Date.UTC(year,month-1,day+offset));
        const substituteKey=`${substitute.getUTCFullYear()}-${pad2(substitute.getUTCMonth()+1)}-${pad2(substitute.getUTCDate())}`;
        if(!holidays.has(substituteKey)){holidays.set(substituteKey,"振替休日");break;}
        offset++;
      }
    }
  }
  japaneseHolidayCache.set(year,holidays);
  return holidays;
}
function holidayName(date){return japaneseHolidays(date.getFullYear()).get(dateKey(date))||"";}
function isBusinessDay(date){return date.getDay()!==0&&date.getDay()!==6&&!holidayName(date);}
function orderDeadlineDate(shortageDate,leadDays,excludeClosedDays){
  const dueDate=parseDate(shortageDate);
  if(!excludeClosedDays){dueDate.setDate(dueDate.getDate()-leadDays);return dueDate;}
  let remainingDays=leadDays;
  while(remainingDays>0){
    dueDate.setDate(dueDate.getDate()-1);
    if(isBusinessDay(dueDate))remainingDays--;
  }
  while(!isBusinessDay(dueDate))dueDate.setDate(dueDate.getDate()-1);
  return dueDate;
}
function productBreakdown(plan={}){
  const products=plan.products||{};
  const boxed=qty(plan.bundle4)*2+qty(plan.bundle8)*4+qty(plan.bundle16)*8;
  const custard=qty(products["カスタード"]),anko=qty(products["あんこ"]);
  return {custardNormal:custard,ankoNormal:anko,custardBox:boxed,ankoBox:boxed,custardTotal:custard+boxed,ankoTotal:anko+boxed};
}
function defaultMaterialOrderSettings(){
  return Object.fromEntries(MATERIALS.map(material=>[material.id,{leadDays:null,orderPackKg:null,orderUnit:""}]));
}
function normalizeOptionalNumber(value){
  if(value===null||value===undefined||value==="")return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?number:null;
}
function normalizeMaterialOrderSettings(source={}){
  return Object.fromEntries(MATERIALS.map(material=>{
    const item=source?.[material.id]||{};
    const pack=normalizeOptionalNumber(item.orderPackKg);
    return [material.id,{
      leadDays:normalizeDayCount(item.leadDays),
      orderPackKg:pack>0?pack:null,
      orderUnit:String(item.orderUnit||"").trim().slice(0,16)
    }];
  }));
}
function normalizeWeeklyInventory(source={}){
  const inventory={};
  Object.entries(source||{}).forEach(([weekKey,values])=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(weekKey))return;
    inventory[weekKey]=Object.fromEntries(MATERIALS.map(material=>[material.id,normalizeOptionalNumber(values?.[material.id])]));
  });
  return inventory;
}
function currentWeekStockKg(materialId){
  const weekKey=dateKey(weekStart);
  const input=document.querySelector(`[data-stock-kg="${materialId}"]`);
  if(input&&input.dataset.weekKey===weekKey)return normalizeOptionalNumber(input.value);
  return weeklyInventory[weekKey]?.[materialId]??null;
}
function normalizeDayCount(value){
  if(value===null||value===undefined||value==="")return null;
  const days=Number(value);
  return Number.isInteger(days)&&days>=0?days:null;
}
function renderShelfLifeForm(){
  $("regularShelfDays").value=shelfLifeSettings.regularDays??"";
  $("boxedShelfDays").value=shelfLifeSettings.boxedDays??"";
}
function expirationDateKey(key,days){
  const expiration=parseDate(key);
  expiration.setDate(expiration.getDate()+days);
  return dateKey(expiration);
}
function expirationEntries(key,plan){
  const made=fmtDate(parseDate(key)),entries=[];
  if(shelfLifeSettings.regularDays!==null){
    PRODUCTS.forEach(product=>{
      if(qty(plan.products?.[product])>0){
        entries.push({dateKey:expirationDateKey(key,shelfLifeSettings.regularDays),label:`${made}作成 ${product}期限`});
      }
    });
  }
  if(shelfLifeSettings.boxedDays!==null){
    const breakdown=productBreakdown(plan);
    if(breakdown.custardBox>0)entries.push({dateKey:expirationDateKey(key,shelfLifeSettings.boxedDays),label:`${made}作成 箱入りカスタード期限`});
    if(breakdown.ankoBox>0)entries.push({dateKey:expirationDateKey(key,shelfLifeSettings.boxedDays),label:`${made}作成 箱入りあんこ期限`});
  }
  return entries;
}
function plansWithCurrentDraft(){
  const result={...plans};
  const editingKey=$("editingDate").value,planKey=$("planDate").value,draft=currentFormPlan();
  if(editingKey){
    delete result[editingKey];
    if(planKey&&total(draft)>0)result[planKey]=draft;
  }else if(planKey&&!result[planKey]&&total(draft)>0){
    result[planKey]=draft;
  }
  return result;
}
function formatMaterialAmount(grams){
  const sign=grams<0?"−":"",absolute=Math.abs(grams);
  const exactGrams=`${sign}${absolute.toLocaleString("ja-JP",{maximumFractionDigits:3})}`;
  if(absolute>=1000){
    const kilograms=(absolute/1000).toLocaleString("ja-JP",{maximumFractionDigits:2});
    return {main:`${sign}${kilograms} kg`,detail:`${exactGrams} g`};
  }
  return {main:`${exactGrams} g`,detail:""};
}
function currentFormPlan(){
  const products={};
  document.querySelectorAll("[data-product]").forEach(input=>products[input.dataset.product]=qty(input.value));
  const counts=Object.fromEntries(BUNDLE_TYPES.map(type=>[type.key,qty($(type.key).value)]));
  const flavors=Object.fromEntries(BUNDLE_TYPES.map(type=>[type.key,$(`${type.key}Flavor`).value]));
  return {products,...counts,bundleFlavors:flavors};
}
function renderMaterialSummary(){
  const dates=weekDates();
  const projected=plansWithCurrentDraft();
  const weeklyPieces=totalProductionForWeek(dates,projected);
  const editingKey=$("editingDate").value,planKey=$("planDate").value;
  const includesDraft=Boolean(total(currentFormPlan())>0&&dates.some(date=>dateKey(date)===planKey)&&(editingKey||!plans[planKey]));
  const materialFactor=weeklyPieces/MATERIAL_BASE_YIELD;
  const draftLabel=includesDraft?"（入力中を含む）":"";
  $("materialBasis").textContent=`週間予定 ${weeklyPieces.toLocaleString()}個${draftLabel} ／ 400個仕込み ${materialFactor.toLocaleString("ja-JP",{maximumFractionDigits:3})}回分`;
  $("materialSummary").innerHTML=MATERIALS.map(material=>{
    const requiredGrams=material.gramsPerBase*materialFactor;
    const amount=formatMaterialAmount(requiredGrams),stockKg=currentWeekStockKg(material.id);
    const remaining=stockKg===null?"在庫未入力":formatMaterialAmount(stockKg*1000-requiredGrams).main;
    return `<article class="material-card" data-required-grams="${requiredGrams}"><strong>${material.name}</strong><div class="material-need">${amount.main}</div>${amount.detail?`<small class="material-exact">${amount.detail}</small>`:""}<label class="material-stock-label">週初在庫（kg）<input type="number" min="0" step="0.001" inputmode="decimal" data-stock-kg="${material.id}" data-week-key="${dateKey(weekStart)}" value="${stockKg??""}" placeholder="例：10"></label><div class="material-remaining"><span>理論残数</span><strong id="material-remaining-${material.id}">${remaining}</strong></div></article>`;
  }).join("");
  document.querySelectorAll("[data-stock-kg]").forEach(input=>input.addEventListener("input",()=>{updateMaterialBalances();renderOrderResults();}));
  updateMaterialBalances();
}
function updateMaterialBalances(){
  document.querySelectorAll("[data-stock-kg]").forEach(input=>{
    const id=input.dataset.stockKg,card=input.closest(".material-card"),result=$(`material-remaining-${id}`);
    if(!card||!result)return;
    const stockKg=normalizeOptionalNumber(input.value);
    const requiredGrams=Number(card.dataset.requiredGrams)||0;
    if(stockKg===null){result.textContent="在庫未入力";result.classList.remove("negative");return;}
    const remainingGrams=stockKg*1000-requiredGrams;
    result.textContent=formatMaterialAmount(remainingGrams).main;
    result.classList.toggle("negative",remainingGrams<0);
  });
}
function currentOrderConfig(materialId){
  const saved=materialOrderSettings[materialId]||{leadDays:null,orderPackKg:null,orderUnit:""};
  const leadInput=document.querySelector(`[data-lead-days="${materialId}"]`);
  const packInput=document.querySelector(`[data-order-pack-kg="${materialId}"]`);
  const unitInput=document.querySelector(`[data-order-unit="${materialId}"]`);
  const pack=normalizeOptionalNumber(packInput?packInput.value:saved.orderPackKg);
  return {
    leadDays:normalizeDayCount(leadInput?leadInput.value:saved.leadDays),
    orderPackKg:pack>0?pack:null,
    orderUnit:String(unitInput?unitInput.value:saved.orderUnit||"").trim().slice(0,16)
  };
}
function renderOrderSettings(){
  $("excludeNonBusinessDays").checked=excludeNonBusinessDays;
  $("orderSettingsGrid").innerHTML=MATERIALS.map(material=>{
    const settings=materialOrderSettings[material.id]||{leadDays:null,orderPackKg:null,orderUnit:""};
    return `<article class="order-card"><h3>${material.name}</h3><div class="order-input-grid"><label>仕入れ納期（日）<input type="number" min="0" step="1" inputmode="numeric" data-lead-days="${material.id}" value="${settings.leadDays??""}" placeholder="例：3"></label><label>1発注単位（kg）<input type="number" min="0" step="0.001" inputmode="decimal" data-order-pack-kg="${material.id}" value="${settings.orderPackKg??""}" placeholder="例：20"></label><label>単位名<input type="text" maxlength="16" data-order-unit="${material.id}" value="${escapeHtml(settings.orderUnit)}" placeholder="例：袋"></label></div><div class="order-result-grid"><div><span>発注期限</span><strong id="order-deadline-${material.id}">—</strong></div><div><span>発注数</span><strong id="order-quantity-${material.id}">—</strong><small id="order-amount-${material.id}"></small></div></div></article>`;
  }).join("");
  document.querySelectorAll("[data-lead-days],[data-order-pack-kg],[data-order-unit]").forEach(input=>input.addEventListener("input",renderOrderResults));
  $("excludeNonBusinessDays").onchange=renderOrderResults;
  renderOrderResults();
}
function renderOrderResults(){
  const dates=weekDates(),projected=plansWithCurrentDraft();
  const excludeClosedDays=$("excludeNonBusinessDays").checked;
  const weeklyPieces=totalProductionForWeek(dates,projected);
  $("orderBasis").textContent=`対象週：${$("weekLabel").textContent} ／ 予定 ${weeklyPieces.toLocaleString()}個分`;
  MATERIALS.forEach(material=>{
    const deadline=$(`order-deadline-${material.id}`),quantity=$(`order-quantity-${material.id}`),amountLabel=$(`order-amount-${material.id}`);
    if(!deadline||!quantity||!amountLabel)return;
    const stockKg=currentWeekStockKg(material.id),config=currentOrderConfig(material.id);
    const weeklyNeed=material.gramsPerBase*weeklyPieces/MATERIAL_BASE_YIELD;
    if(weeklyNeed===0){deadline.textContent="今週は発注不要";quantity.textContent="0";amountLabel.textContent="";return;}
    if(stockKg===null){deadline.textContent="在庫未入力";quantity.textContent="在庫を入力";amountLabel.textContent="材料タブで週初在庫を設定";return;}
    const stockGrams=stockKg*1000,shortage=Math.max(0,weeklyNeed-stockGrams);
    if(shortage===0){deadline.textContent="今週は発注不要";quantity.textContent="0";amountLabel.textContent=`理論残数 ${formatMaterialAmount(stockGrams-weeklyNeed).main}`;return;}
    let remaining=stockGrams,shortageDate="";
    for(const date of dates){
      const dailyNeed=material.gramsPerBase*totalProductionForDate(dateKey(date),projected)/MATERIAL_BASE_YIELD;
      remaining-=dailyNeed;
      if(remaining< -0.000001){shortageDate=dateKey(date);break;}
    }
    if(config.leadDays===null){deadline.textContent="納期未入力";}
    else if(shortageDate){
      const dueDate=orderDeadlineDate(shortageDate,config.leadDays,excludeClosedDays);
      const todayKey=dateKey(new Date()),dueKey=dateKey(dueDate);
      const dueLabel=`${dueDate.getMonth()+1}/${dueDate.getDate()}まで`;
      deadline.textContent=dueKey<todayKey?`${dueLabel}（期限超過）`:dueKey===todayKey?`${dueLabel}（本日）`:dueLabel;
    }else deadline.textContent="期限を算出できません";
    if(config.orderPackKg){
      const count=Math.ceil(shortage/(config.orderPackKg*1000)-0.0000001);
      quantity.textContent=`${count}${config.orderUnit||"単位"}`;
      amountLabel.textContent=`約${formatMaterialAmount(count*config.orderPackKg*1000).main}`;
    }else{
      quantity.textContent=formatMaterialAmount(shortage).main;
      amountLabel.textContent="発注単位を入力すると個数に換算";
    }
  });
}
function renderTodaySummary(){
  const today=new Date(),key=dateKey(today);
  const projected=plansWithCurrentDraft(),plan=projected[key]||{};
  const weekdays=["日","月","火","水","木","金","土"];
  $("todayDate").textContent=`${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日（${weekdays[today.getDay()]}）`;
  const products=plan.products||{};
  $("todayRegularCounts").innerHTML=PRODUCTS.map(name=>`<div class="today-count-row"><span>${name}</span><strong>${qty(products[name]).toLocaleString()}個</strong></div>`).join("");
  const breakdown=productionBreakdownForDate(key,projected);
  $("todayBoxCounts").innerHTML=[
    ["カスタード",breakdown.custardBox],
    ["あんこ",breakdown.ankoBox]
  ].map(([name,count])=>`<div class="today-count-row"><span>${name}</span><strong>${count.toLocaleString()}個</strong></div>`).join("");
  const bundleSets=qty(plan.bundle4)+qty(plan.bundle8)+qty(plan.bundle16);
  const carry=boxedProductionFromPlan(projected[previousDateKey(key)]||{},"next"),carryPieces=carry.custard+carry.anko;
  $("todayBundleDetail").textContent=`今日入力分 ${bundleSets.toLocaleString()}セット・${bundleCount(plan).toLocaleString()}個${carryPieces?` ／ 前日入力分 ${carryPieces.toLocaleString()}個`:""}`;
  const todayTotal=totalProductionForDate(key,projected);
  $("todayTotal").textContent=`${todayTotal.toLocaleString()}個`;
  $("todayPlanStatus").textContent=total(plan)>0?`予定あり${plan.eventName?`：${plan.eventName}`:""}`:todayTotal>0?"前日予定からの製作":"予定なし";
}
function activateTab(name){
  document.querySelectorAll(".tab-button").forEach(button=>{
    const active=button.dataset.tab===name;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll(".tab-panel").forEach(panel=>panel.classList.toggle("hidden",panel.id!==`tabPanel-${name}`));
  $("weekToolbar").classList.toggle("hidden",!(["materials","orders","schedule"].includes(name)));
}

function showApp(user){
  currentUser=user;
  $("authPanel").classList.toggle("hidden",!!user);
  $("appContent").classList.toggle("hidden",!user);
  $("accountBar").classList.toggle("hidden",!user);
  if(user){
    activateTab("home");
    $("accountEmail").textContent=user.email||"ログイン中";
    $("connection").textContent="Firebase接続済み";
    $("connection").classList.add("online");
    loadPlans();
  }else{
    activateTab("home");
    plans={};shelfLifeSettings={regularDays:null,boxedDays:null};materialOrderSettings=defaultMaterialOrderSettings();weeklyInventory={};excludeNonBusinessDays=true;
    renderShelfLifeForm();renderOrderSettings();renderWeek();
    $("connection").textContent="ログインしてください";
    $("connection").classList.remove("online");
  }
}

function renderProductInputs(values={}){
  $("productInputs").innerHTML=PRODUCTS.map(name=>`<label>${name}<input type="number" min="0" step="1" inputmode="numeric" data-product="${name}" value="${qty(values[name])}"></label>`).join("");
  $("productInputs").querySelectorAll("input").forEach(i=>i.addEventListener("input",updateTotals));
}
function updateTotals(){
  const products={};document.querySelectorAll("[data-product]").forEach(i=>products[i.dataset.product]=qty(i.value));
  const individual=sumProducts(products),b4=qty($("bundle4").value),b8=qty($("bundle8").value),b16=qty($("bundle16").value),bundles=b4*4+b8*8+b16*16;
  BUNDLE_TYPES.forEach(type=>{
    const count=qty($(type.key).value),flavor=$(type.flavorField).value,pieces=count*type.size,label=BUNDLE_FLAVORS[flavor];
    const today=boxedProductionFromPlan({[type.key]:count,bundleFlavors:{[type.key]:flavor}},"today");
    const next=boxedProductionFromPlan({[type.key]:count,bundleFlavors:{[type.key]:flavor}},"next");
    const todayPieces=today.custard+today.anko,nextPieces=next.custard+next.anko;
    const scheduleText=count===0?"":flavor==="double"?" ／ 当日2種類":` ／ 当日${label}${todayPieces}個・翌日${BUNDLE_FLAVORS[flavor==="custard"?"anko":"custard"]}${nextPieces}個`;
    $(`${type.key}Result`).textContent=`${count}セット × ${type.size}個 = ${pieces}個${scheduleText}`;
  });
  $("individualSubtotal").textContent=`${individual}個`;
  $("bundleSubtotal").textContent=`${bundles}個`;
  const planDateKey=$("planDate").value,projected=plansWithCurrentDraft();
  $("dayTotal").textContent=`${totalProductionForDate(planDateKey,projected).toLocaleString()}個`;
  renderMaterialSummary();
  renderTodaySummary();
  renderOrderResults();
}
function clearForm(date=dateKey(new Date())){
  $("scheduleForm").reset();$("planDate").value=date;$("editingDate").value="";
  $("editorTitle").textContent="焼成予定を登録";$("saveButton").textContent="予定を保存";
  $("deleteButton").classList.add("hidden");$("formMessage").textContent="";
  BUNDLE_TYPES.forEach(type=>{$(type.key).value=0;$(type.flavorField).value="double";});renderProductInputs();updateTotals();
}
function fillForm(key){
  const p=plans[key];if(!p)return;
  $("editingDate").value=key;$("planDate").value=key;$("eventName").value=p.eventName||"";
  $("businessHours").value=p.businessHours||"";$("groupCount").value=p.groupCount??"";
  $("notes").value=p.notes||"";
  const flavors=bundleFlavors(p);
  BUNDLE_TYPES.forEach(type=>{$(type.key).value=qty(p[type.key]);$(type.flavorField).value=flavors[type.key];});
  renderProductInputs(p.products||{});$("editorTitle").textContent=`${fmtDate(parseDate(key))} の予定を編集`;
  $("saveButton").textContent="変更を保存";$("deleteButton").classList.remove("hidden");
  updateTotals();$("editorPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderWeek(){
  const dates=weekDates(),end=dates[6];
  $("weekLabel").textContent=`${dates[0].getFullYear()}年 ${fmtDate(dates[0])}〜${fmtDate(end)}`;
  const projected=plansWithCurrentDraft();
  const rows=dates.map(d=>{
    const key=dateKey(d);
    return {key,date:d,plan:plans[key],breakdown:productionBreakdownForDate(key,plans),pieces:totalProductionForDate(key,plans)};
  });
  const registered=rows.filter(x=>x.pieces>0).length;
  const individual=rows.reduce((s,x)=>s+sumProducts(x.plan?.products),0);
  const weeklyPieces=rows.reduce((s,x)=>s+x.pieces,0);
  const bundles=weeklyPieces-individual;
  const flavor=rows.reduce((sum,x)=>{
    const b=x.breakdown;
    sum.custardNormal+=b.custardNormal;sum.ankoNormal+=b.ankoNormal;
    sum.custardBox+=b.custardBox;sum.ankoBox+=b.ankoBox;
    sum.custardTotal+=b.custardTotal;sum.ankoTotal+=b.ankoTotal;
    return sum;
  },{custardNormal:0,ankoNormal:0,custardBox:0,ankoBox:0,custardTotal:0,ankoTotal:0});
  $("registeredDays").textContent=`${registered}日`;$("individualTotal").textContent=`${individual}個`;
  $("bundleTotal").textContent=`${bundles}個`;$("grandTotal").textContent=`${weeklyPieces}個`;
  renderMaterialSummary();
  renderTodaySummary();
  renderOrderResults();
  $("flavorSummary").innerHTML=[
    ["通常製作分",flavor.custardNormal,flavor.ankoNormal],
    ["箱入り製作分",flavor.custardBox,flavor.ankoBox],
    ["最終製作数",flavor.custardTotal,flavor.ankoTotal]
  ].map(([title,custard,anko])=>`<article class="flavor-card"><strong>${title}</strong><p>カスタード <b>${custard.toLocaleString()}個</b><br>あんこ <b>${anko.toLocaleString()}個</b></p></article>`).join("");
  const expirationsByDate={};
  Object.entries(projected).forEach(([createdKey,plan])=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(createdKey))return;
    expirationEntries(createdKey,plan).forEach(entry=>{
      if(!expirationsByDate[entry.dateKey])expirationsByDate[entry.dateKey]=[];
      expirationsByDate[entry.dateKey].push(entry.label);
    });
  });
  $("scheduleList").innerHTML=rows.map(({key,date,plan,breakdown,pieces})=>{
    const day=["日","月","火","水","木","金","土"][date.getDay()];
    const dayHoliday=holidayName(date);
    const calendarClass=dayHoliday?"calendar-holiday":date.getDay()===0?"calendar-sunday":date.getDay()===6?"calendar-saturday":"";
    const dayLabel=`${date.getMonth()+1}/${date.getDate()}（<span class="weekday-label">${day}</span>）`;
    const holidayCaption=dayHoliday?`<small class="holiday-name">${escapeHtml(dayHoliday)}</small>`:"";
    const dateMarkup=`<div class="day-date ${calendarClass}" title="${escapeHtml(dayHoliday)}"><span class="date-label">${dayLabel}</span>${holidayCaption}`;
    const expiryMarkup=(expirationsByDate[key]||[]).map(line=>`<div class="expiry-line">${escapeHtml(line)}</div>`).join("");
    const expiryBlock=expiryMarkup?`<div class="expiry-list">${expiryMarkup}</div>`:"";
    if(!plan||total(plan)===0){
      if(pieces>0){
        const flavorLine=`カスタード ${breakdown.custardTotal.toLocaleString()}個 ／ あんこ ${breakdown.ankoTotal.toLocaleString()}個`;
        const sourceKey=previousDateKey(key),sourcePlan=plans[sourceKey],carryDone=Boolean(sourcePlan?.continuationDone);
        const carryDoneButton=sourcePlan?`<button class="mini" data-carry-done="${sourceKey}">${carryDone?"前日分を未完了に戻す":"前日分を完了にする"}</button>`:"";
        return `<article class="day-card ${calendarClass}">${dateMarkup}<small><span class="status ${carryDone?"done":""}">${carryDone?"焼成完了":"前日予定の続き"}</span></small></div><div class="day-main"><strong>前日の箱入りセットを製作</strong><p>前日入力分の残りを焼成します。<span class="production-detail">${flavorLine}</span></p>${expiryBlock}<div class="day-tools">${carryDoneButton}<button class="mini" data-add="${key}">＋ 予定を登録</button></div></div><div class="day-count">${pieces.toLocaleString()}個<small>箱入り製作数</small></div></article>`;
      }
      return `<article class="day-card ${calendarClass}">${dateMarkup}<small>予定なし</small></div><div class="day-main"><strong>焼成予定なし</strong><p>この日の予定を登録できます。</p>${expiryBlock}<div class="day-tools"><button class="mini" data-add="${key}">${plan?"編集":"＋ 予定を登録"}</button></div></div><div class="day-count">—</div></article>`;
    }
    const detail=[plan.businessHours,plan.groupCount?`団体 ${plan.groupCount}人`:"",plan.notes].filter(Boolean).join(" ／ ");
    const flavorLine=`カスタード ${breakdown.custardTotal.toLocaleString()}個 ／ あんこ ${breakdown.ankoTotal.toLocaleString()}個`;
    const sourceKey=previousDateKey(key),carry=boxedProductionFromPlan(plans[sourceKey]||{},"next"),carryPieces=carry.custard+carry.anko,sourcePlan=plans[sourceKey],carryDone=Boolean(sourcePlan?.continuationDone);
    const carryDetail=carryPieces?`（前日入力分 ${carryPieces.toLocaleString()}個を含む）`:"";
    const carryDoneButton=carryPieces&&sourcePlan?`<button class="mini" data-carry-done="${sourceKey}">${carryDone?"前日分を未完了に戻す":"前日分を完了にする"}</button>`:"";
    const carryStatus=carryPieces?`<small class="carry-status">前日分：${carryDone?"完了":"未完了"}</small>`:"";
    return `<article class="day-card ${calendarClass}">${dateMarkup}<small><span class="status ${plan.done?"done":""}">${plan.done?"焼成完了":"予定あり"}</span></small></div><div class="day-main"><strong>${escapeHtml(plan.eventName||"焼成予定")}</strong><p>${escapeHtml(detail||"備考なし")}<span class="production-detail">${flavorLine}${carryDetail}</span></p>${carryStatus}${expiryBlock}<div class="day-tools"><button class="mini" data-edit="${key}">編集</button><button class="mini" data-done="${key}">${plan.done?"未完了に戻す":"完了にする"}</button>${carryDoneButton}</div></div><div class="day-count">${pieces.toLocaleString()}個<small>当日製作数</small></div></article>`;
  }).join("");
  $("scheduleList").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const key=b.dataset.add;if(plans[key])fillForm(key);else clearForm(key);$("editorPanel").scrollIntoView({behavior:"smooth",block:"start"});});
  $("scheduleList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>fillForm(b.dataset.edit));
  $("scheduleList").querySelectorAll("[data-done]").forEach(b=>b.onclick=()=>toggleDone(b.dataset.done));
  $("scheduleList").querySelectorAll("[data-carry-done]").forEach(b=>b.onclick=()=>toggleContinuationDone(b.dataset.carryDone));
}
async function loadPlans(){
  if(!db||!currentUser)return;
  try{
    const q=query(collection(db,"bakeSchedules"),where("ownerUid","==",currentUser.uid));
    const snap=await getDocs(q);plans={};shelfLifeSettings={regularDays:null,boxedDays:null};
    materialOrderSettings=defaultMaterialOrderSettings();weeklyInventory={};excludeNonBusinessDays=true;
    snap.forEach(d=>{
      const data=d.data();
      if(d.id===SETTINGS_DOC_ID){
        shelfLifeSettings={regularDays:normalizeDayCount(data.regularShelfDays),boxedDays:normalizeDayCount(data.boxedShelfDays)};
        materialOrderSettings=normalizeMaterialOrderSettings(data.materialOrderSettings);
        weeklyInventory=normalizeWeeklyInventory(data.weeklyInventory);
        excludeNonBusinessDays=data.excludeNonBusinessDays!==false;
      }else plans[d.id]=data;
    });
    renderShelfLifeForm();renderOrderSettings();renderWeek();
  }catch(e){console.error(e);$("formMessage").textContent=`読み込みエラー：${e.message}`;}
}
async function saveAppSettings(){
  if(!db||!currentUser)throw new Error("ログイン状態を確認してください。");
  await setDoc(doc(db,"bakeSchedules",SETTINGS_DOC_ID),{
    ownerUid:currentUser.uid,
    regularShelfDays:shelfLifeSettings.regularDays,
    boxedShelfDays:shelfLifeSettings.boxedDays,
    materialOrderSettings,
    weeklyInventory,
    excludeNonBusinessDays,
    updatedAt:new Date().toISOString()
  });
}
async function persist(key,data){
  if(!db||!currentUser)return false;
  try{await setDoc(doc(db,"bakeSchedules",key),{...data,ownerUid:currentUser.uid});plans[key]={...data,ownerUid:currentUser.uid};renderWeek();return true;}
  catch(e){console.error(e);$("formMessage").textContent=`保存できませんでした：${e.message}`;return false;}
}
async function toggleDone(key){
  const current=plans[key];if(!current)return;
  if(await persist(key,{...current,done:!current.done,updatedAt:new Date().toISOString()}))$("formMessage").textContent="完了状態を更新しました。";
}
async function toggleContinuationDone(sourceKey){
  const current=plans[sourceKey];if(!current)return;
  if(await persist(sourceKey,{...current,continuationDone:!current.continuationDone,updatedAt:new Date().toISOString()}))$("formMessage").textContent="翌日分の完了状態を更新しました。";
}

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();$("authMessage").textContent="";
  try{await signInWithEmailAndPassword(auth,$("authEmail").value.trim(),$("authPassword").value);}
  catch(err){$("authMessage").textContent=authError(err);}
});
$("registerButton").onclick=async()=>{
  $("authMessage").textContent="";
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  if(!email||password.length<6){$("authMessage").textContent="メールアドレスと6文字以上のパスワードを入力してください。";return;}
  try{await createUserWithEmailAndPassword(auth,email,password);}
  catch(err){$("authMessage").textContent=authError(err);}
};
function authError(e){
  const map={"auth/email-already-in-use":"このメールアドレスは登録済みです。ログインしてください。","auth/invalid-email":"メールアドレスの形式を確認してください。","auth/weak-password":"パスワードは6文字以上にしてください。","auth/invalid-credential":"メールアドレスまたはパスワードが違います。","auth/too-many-requests":"試行回数が多すぎます。しばらくしてから再度お試しください。"};
  return map[e.code]||`認証エラー：${e.message}`;
}
$("logoutButton").onclick=()=>signOut(auth);
$("shelfLifeForm").addEventListener("submit",async e=>{
  e.preventDefault();$("shelfLifeMessage").textContent="";
  if(!db||!currentUser){$("shelfLifeMessage").textContent="ログイン後に設定を保存できます。";return;}
  const regularValue=$("regularShelfDays").value,boxedValue=$("boxedShelfDays").value;
  const nextSettings={regularDays:normalizeDayCount(regularValue),boxedDays:normalizeDayCount(boxedValue)};
  if((regularValue!==""&&nextSettings.regularDays===null)||(boxedValue!==""&&nextSettings.boxedDays===null)){
    $("shelfLifeMessage").textContent="賞味期限は0以上の整数で入力してください。";return;
  }
  const previousSettings=shelfLifeSettings;
  shelfLifeSettings=nextSettings;
  try{
    await saveAppSettings();renderWeek();
    $("shelfLifeMessage").textContent="賞味期限を保存しました。";
  }catch(error){
    shelfLifeSettings=previousSettings;
    console.error(error);$("shelfLifeMessage").textContent=`保存できませんでした：${error.message}`;
  }
});
$("materialInventoryForm").addEventListener("submit",async e=>{
  e.preventDefault();$("inventoryMessage").textContent="";
  const weekKey=dateKey(weekStart),nextWeek={...(weeklyInventory[weekKey]||{})};
  for(const material of MATERIALS){
    const input=document.querySelector(`[data-stock-kg="${material.id}"]`),value=input?.value??"";
    const amount=normalizeOptionalNumber(value);
    if(value!==""&&amount===null){$("inventoryMessage").textContent="在庫は0以上の数値で入力してください。";return;}
    nextWeek[material.id]=amount;
  }
  const previousInventory=weeklyInventory;
  weeklyInventory={...weeklyInventory,[weekKey]:nextWeek};
  try{await saveAppSettings();renderWeek();$("inventoryMessage").textContent="週初在庫を保存しました。";}
  catch(error){weeklyInventory=previousInventory;console.error(error);$("inventoryMessage").textContent=`保存できませんでした：${error.message}`;}
});
$("orderSettingsForm").addEventListener("submit",async e=>{
  e.preventDefault();$("orderSettingsMessage").textContent="";
  const nextSettings=defaultMaterialOrderSettings();
  for(const material of MATERIALS){
    const leadInput=document.querySelector(`[data-lead-days="${material.id}"]`);
    const packInput=document.querySelector(`[data-order-pack-kg="${material.id}"]`);
    const unitInput=document.querySelector(`[data-order-unit="${material.id}"]`);
    const leadValue=leadInput?.value??"",packValue=packInput?.value??"";
    const leadDays=normalizeDayCount(leadValue),packKg=normalizeOptionalNumber(packValue);
    if((leadValue!==""&&leadDays===null)||(packValue!==""&&(packKg===null||packKg<=0))){
      $("orderSettingsMessage").textContent="納期は0以上の日数、発注単位は0より大きいkg数で入力してください。";return;
    }
    nextSettings[material.id]={leadDays,orderPackKg:packKg,orderUnit:String(unitInput?.value||"").trim().slice(0,16)};
  }
  const previousSettings=materialOrderSettings;
  const previousExcludeNonBusinessDays=excludeNonBusinessDays;
  materialOrderSettings=nextSettings;
  excludeNonBusinessDays=$("excludeNonBusinessDays").checked;
  try{await saveAppSettings();renderOrderSettings();$("orderSettingsMessage").textContent="発注情報を保存しました。";}
  catch(error){materialOrderSettings=previousSettings;excludeNonBusinessDays=previousExcludeNonBusinessDays;renderOrderSettings();console.error(error);$("orderSettingsMessage").textContent=`保存できませんでした：${error.message}`;}
});
$("scheduleForm").addEventListener("submit",async e=>{
  e.preventDefault();const key=$("planDate").value;if(!key){$("formMessage").textContent="日付を入力してください。";return;}
  const products={};document.querySelectorAll("[data-product]").forEach(i=>products[i.dataset.product]=qty(i.value));
  const bundleCounts=Object.fromEntries(BUNDLE_TYPES.map(type=>[type.key,qty($(type.key).value)]));
  const selectedFlavors=Object.fromEntries(BUNDLE_TYPES.map(type=>[type.key,$(type.flavorField).value]));
  const previous=plans[key]||{},previousFlavors=bundleFlavors(previous);
  const continuationUnchanged=BUNDLE_TYPES.every(type=>qty(previous[type.key])===bundleCounts[type.key]&&previousFlavors[type.key]===selectedFlavors[type.key]);
  const data={date:key,eventName:$("eventName").value.trim(),products,...bundleCounts,bundleFlavors:selectedFlavors,businessHours:$("businessHours").value.trim(),groupCount:qty($("groupCount").value),notes:$("notes").value.trim(),done:previous.done||false,continuationDone:continuationUnchanged&&Boolean(previous.continuationDone),updatedAt:new Date().toISOString()};
  if(await persist(key,data)){clearForm(key);$("formMessage").textContent="予定を保存しました。";}
});
$("deleteButton").onclick=async()=>{
  const key=$("editingDate").value;if(!key||!db||!currentUser)return;
  if(!confirm(`${key} の予定を削除しますか？`))return;
  try{await deleteDoc(doc(db,"bakeSchedules",key));delete plans[key];renderWeek();clearForm(key);$("formMessage").textContent="予定を削除しました。";}
  catch(e){$("formMessage").textContent=`削除できませんでした：${e.message}`;}
};
$("clearForm").onclick=()=>clearForm($("planDate").value||dateKey(new Date()));
$("addToday").onclick=()=>{clearForm(dateKey(new Date()));$("editorPanel").scrollIntoView({behavior:"smooth"});};
document.querySelectorAll(".tab-button").forEach(button=>button.addEventListener("click",()=>activateTab(button.dataset.tab)));
BUNDLE_TYPES.forEach(type=>{
  $(type.key).addEventListener("input",updateTotals);
  $(type.flavorField).addEventListener("change",updateTotals);
});
$("planDate").addEventListener("change",updateTotals);
$("prevWeek").onclick=()=>{weekStart.setDate(weekStart.getDate()-7);renderWeek();};
$("nextWeek").onclick=()=>{weekStart.setDate(weekStart.getDate()+7);renderWeek();};
$("thisWeek").onclick=()=>{weekStart=mondayOf(new Date());renderWeek();};

activateTab("home");renderProductInputs();clearForm();renderOrderSettings();renderWeek();
const app=initializeApp(firebaseConfig);db=getFirestore(app);auth=getAuth(app);
onAuthStateChanged(auth,showApp);
