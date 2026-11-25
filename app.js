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
  {name:"玉子", gramsPerBase:3860},
  {name:"デリドール", gramsPerBase:666},
  {name:"パルファンドール", gramsPerBase:66},
  {name:"ヤキマンミックス", gramsPerBase:6660},
  {name:"水", gramsPerBase:400}
];
const SETTINGS_DOC_ID = "_settings";
const $ = id => document.getElementById(id);
let db = null, auth = null, currentUser = null, plans = {};
let shelfLifeSettings = {regularDays:null,boxedDays:null};
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
function productBreakdown(plan={}){
  const products=plan.products||{};
  const boxed=qty(plan.bundle4)*2+qty(plan.bundle8)*4+qty(plan.bundle16)*8;
  const custard=qty(products["カスタード"]),anko=qty(products["あんこ"]);
  return {custardNormal:custard,ankoNormal:anko,custardBox:boxed,ankoBox:boxed,custardTotal:custard+boxed,ankoTotal:anko+boxed};
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
  const exactGrams=grams.toLocaleString("ja-JP",{maximumFractionDigits:3});
  if(grams>=1000){
    const kilograms=(grams/1000).toLocaleString("ja-JP",{maximumFractionDigits:2});
    return {main:`${kilograms} kg`,detail:`${exactGrams} g`};
  }
  return {main:`${exactGrams} g`,detail:""};
}
function currentFormPlan(){
  const products={};
  document.querySelectorAll("[data-product]").forEach(input=>products[input.dataset.product]=qty(input.value));
  return {products,bundle4:qty($("bundle4").value),bundle8:qty($("bundle8").value),bundle16:qty($("bundle16").value)};
}
function renderMaterialSummary(){
  const dates=weekDates();
  let weeklyPieces=dates.reduce((sum,date)=>sum+total(plans[dateKey(date)]),0);
  const editingKey=$("editingDate").value;
  const planKey=$("planDate").value;
  const currentForm=currentFormPlan();
  let includesDraft=false;
  const isInWeek=key=>Boolean(key)&&dates.some(date=>dateKey(date)===key);
  if(editingKey){
    if(isInWeek(editingKey))weeklyPieces-=total(plans[editingKey]);
    if(isInWeek(planKey)){weeklyPieces+=total(currentForm);includesDraft=true;}
  }else if(isInWeek(planKey)&&!plans[planKey]){
    weeklyPieces+=total(currentForm);
    includesDraft=total(currentForm)>0;
  }
  const materialFactor=weeklyPieces/MATERIAL_BASE_YIELD;
  const draftLabel=includesDraft?"（入力中を含む）":"";
  $("materialBasis").textContent=`週間予定 ${weeklyPieces.toLocaleString()}個${draftLabel} ／ 400個仕込み ${materialFactor.toLocaleString("ja-JP",{maximumFractionDigits:3})}回分`;
  $("materialSummary").innerHTML=MATERIALS.map(material=>{
    const amount=formatMaterialAmount(material.gramsPerBase*materialFactor);
    return `<article class="material-card"><strong>${material.name}</strong><span>${amount.main}</span>${amount.detail?`<small>${amount.detail}</small>`:""}</article>`;
  }).join("");
}
function renderTodaySummary(){
  const today=new Date(),key=dateKey(today);
  let plan=plans[key]||{};
  const editingKey=$("editingDate").value,planKey=$("planDate").value,draft=currentFormPlan();
  if(editingKey===key)plan=draft;
  else if(!editingKey&&planKey===key&&!plans[key]&&total(draft)>0)plan=draft;
  const weekdays=["日","月","火","水","木","金","土"];
  $("todayDate").textContent=`${today.getFullYear()}年${today.getMonth()+1}月${today.getDate()}日（${weekdays[today.getDay()]}）`;
  const products=plan.products||{};
  $("todayRegularCounts").innerHTML=PRODUCTS.map(name=>`<div class="today-count-row"><span>${name}</span><strong>${qty(products[name]).toLocaleString()}個</strong></div>`).join("");
  const breakdown=productBreakdown(plan);
  $("todayBoxCounts").innerHTML=[
    ["カスタード",breakdown.custardBox],
    ["あんこ",breakdown.ankoBox]
  ].map(([name,count])=>`<div class="today-count-row"><span>${name}</span><strong>${count.toLocaleString()}個</strong></div>`).join("");
  const bundleSets=qty(plan.bundle4)+qty(plan.bundle8)+qty(plan.bundle16);
  $("todayBundleDetail").textContent=`${bundleSets.toLocaleString()}セット・${bundleCount(plan).toLocaleString()}個`;
  $("todayTotal").textContent=`${total(plan).toLocaleString()}個`;
  $("todayPlanStatus").textContent=total(plan)>0?`予定あり${plan.eventName?`：${plan.eventName}`:""}`:"予定なし";
}
function activateTab(name){
  document.querySelectorAll(".tab-button").forEach(button=>{
    const active=button.dataset.tab===name;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
  });
  document.querySelectorAll(".tab-panel").forEach(panel=>panel.classList.toggle("hidden",panel.id!==`tabPanel-${name}`));
  $("weekToolbar").classList.toggle("hidden",name!=="materials"&&name!=="schedule");
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
    plans={};shelfLifeSettings={regularDays:null,boxedDays:null};renderShelfLifeForm();renderWeek();
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
  $("bundle4Result").textContent=`${b4}セット × 4個 = ${b4*4}個`;
  $("bundle8Result").textContent=`${b8}セット × 8個 = ${b8*8}個`;
  $("bundle16Result").textContent=`${b16}セット × 16個 = ${b16*16}個`;
  $("individualSubtotal").textContent=`${individual}個`;
  $("bundleSubtotal").textContent=`${bundles}個`;
  $("dayTotal").textContent=`${individual+bundles}個`;
  renderMaterialSummary();
  renderTodaySummary();
}
function clearForm(date=dateKey(new Date())){
  $("scheduleForm").reset();$("planDate").value=date;$("editingDate").value="";
  $("editorTitle").textContent="焼成予定を登録";$("saveButton").textContent="予定を保存";
  $("deleteButton").classList.add("hidden");$("formMessage").textContent="";
  $("bundle4").value=0;$("bundle8").value=0;$("bundle16").value=0;renderProductInputs();updateTotals();
}
function fillForm(key){
  const p=plans[key];if(!p)return;
  $("editingDate").value=key;$("planDate").value=key;$("eventName").value=p.eventName||"";
  $("businessHours").value=p.businessHours||"";$("groupCount").value=p.groupCount??"";
  $("notes").value=p.notes||"";$("bundle4").value=qty(p.bundle4);$("bundle8").value=qty(p.bundle8);$("bundle16").value=qty(p.bundle16);
  renderProductInputs(p.products||{});$("editorTitle").textContent=`${fmtDate(parseDate(key))} の予定を編集`;
  $("saveButton").textContent="変更を保存";$("deleteButton").classList.remove("hidden");
  updateTotals();$("editorPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderWeek(){
  const dates=weekDates(),end=dates[6];
  $("weekLabel").textContent=`${dates[0].getFullYear()}年 ${fmtDate(dates[0])}〜${fmtDate(end)}`;
  const rows=dates.map(d=>({key:dateKey(d),date:d,plan:plans[dateKey(d)]}));
  const registered=rows.filter(x=>x.plan&&total(x.plan)>0).length;
  const individual=rows.reduce((s,x)=>s+sumProducts(x.plan?.products),0);
  const bundles=rows.reduce((s,x)=>s+bundleCount(x.plan),0);
  const weeklyPieces=individual+bundles;
  const flavor=rows.reduce((sum,x)=>{
    const b=productBreakdown(x.plan);
    sum.custardNormal+=b.custardNormal;sum.ankoNormal+=b.ankoNormal;
    sum.custardBox+=b.custardBox;sum.ankoBox+=b.ankoBox;
    sum.custardTotal+=b.custardTotal;sum.ankoTotal+=b.ankoTotal;
    return sum;
  },{custardNormal:0,ankoNormal:0,custardBox:0,ankoBox:0,custardTotal:0,ankoTotal:0});
  $("registeredDays").textContent=`${registered}日`;$("individualTotal").textContent=`${individual}個`;
  $("bundleTotal").textContent=`${bundles}個`;$("grandTotal").textContent=`${weeklyPieces}個`;
  renderMaterialSummary();
  renderTodaySummary();
  $("flavorSummary").innerHTML=[
    ["通常製作分",flavor.custardNormal,flavor.ankoNormal],
    ["箱入り製作分",flavor.custardBox,flavor.ankoBox],
    ["最終製作数",flavor.custardTotal,flavor.ankoTotal]
  ].map(([title,custard,anko])=>`<article class="flavor-card"><strong>${title}</strong><p>カスタード <b>${custard.toLocaleString()}個</b><br>あんこ <b>${anko.toLocaleString()}個</b></p></article>`).join("");
  const expirationsByDate={};
  Object.entries(plansWithCurrentDraft()).forEach(([createdKey,plan])=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(createdKey))return;
    expirationEntries(createdKey,plan).forEach(entry=>{
      if(!expirationsByDate[entry.dateKey])expirationsByDate[entry.dateKey]=[];
      expirationsByDate[entry.dateKey].push(entry.label);
    });
  });
  $("scheduleList").innerHTML=rows.map(({key,date,plan})=>{
    const day=["日","月","火","水","木","金","土"][date.getDay()];
    const dayHoliday=holidayName(date);
    const calendarClass=dayHoliday?"calendar-holiday":date.getDay()===0?"calendar-sunday":date.getDay()===6?"calendar-saturday":"";
    const dayLabel=`${date.getMonth()+1}/${date.getDate()}（<span class="weekday-label">${day}</span>）`;
    const holidayCaption=dayHoliday?`<small class="holiday-name">${escapeHtml(dayHoliday)}</small>`:"";
    const dateMarkup=`<div class="day-date ${calendarClass}" title="${escapeHtml(dayHoliday)}"><span class="date-label">${dayLabel}</span>${holidayCaption}`;
    const expiryMarkup=(expirationsByDate[key]||[]).map(line=>`<div class="expiry-line">${escapeHtml(line)}</div>`).join("");
    const expiryBlock=expiryMarkup?`<div class="expiry-list">${expiryMarkup}</div>`:"";
    if(!plan||total(plan)===0)return `<article class="day-card ${calendarClass}">${dateMarkup}<small>予定なし</small></div><div class="day-main"><strong>焼成予定なし</strong><p>この日の予定を登録できます。</p>${expiryBlock}<div class="day-tools"><button class="mini" data-add="${key}">${plan?"編集":"＋ 予定を登録"}</button></div></div><div class="day-count">—</div></article>`;
    const detail=[plan.businessHours,plan.groupCount?`団体 ${plan.groupCount}人`:"",plan.notes].filter(Boolean).join(" ／ ");
    const breakdown=productBreakdown(plan);
    const flavorLine=`カスタード ${breakdown.custardTotal.toLocaleString()}個 ／ あんこ ${breakdown.ankoTotal.toLocaleString()}個`;
    return `<article class="day-card ${calendarClass}">${dateMarkup}<small><span class="status ${plan.done?"done":""}">${plan.done?"焼成完了":"予定あり"}</span></small></div><div class="day-main"><strong>${escapeHtml(plan.eventName||"焼成予定")}</strong><p>${escapeHtml(detail||"備考なし")}<span class="production-detail">${flavorLine}</span></p>${expiryBlock}<div class="day-tools"><button class="mini" data-edit="${key}">編集</button><button class="mini" data-done="${key}">${plan.done?"未完了に戻す":"完了にする"}</button></div></div><div class="day-count">${total(plan).toLocaleString()}個<small>予定数量</small></div></article>`;
  }).join("");
  $("scheduleList").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const key=b.dataset.add;if(plans[key])fillForm(key);else clearForm(key);$("editorPanel").scrollIntoView({behavior:"smooth",block:"start"});});
  $("scheduleList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>fillForm(b.dataset.edit));
  $("scheduleList").querySelectorAll("[data-done]").forEach(b=>b.onclick=()=>toggleDone(b.dataset.done));
}
async function loadPlans(){
  if(!db||!currentUser)return;
  try{
    const q=query(collection(db,"bakeSchedules"),where("ownerUid","==",currentUser.uid));
    const snap=await getDocs(q);plans={};shelfLifeSettings={regularDays:null,boxedDays:null};
    snap.forEach(d=>{
      const data=d.data();
      if(d.id===SETTINGS_DOC_ID){
        shelfLifeSettings={regularDays:normalizeDayCount(data.regularShelfDays),boxedDays:normalizeDayCount(data.boxedShelfDays)};
      }else plans[d.id]=data;
    });
    renderShelfLifeForm();renderWeek();
  }catch(e){console.error(e);$("formMessage").textContent=`読み込みエラー：${e.message}`;}
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
  try{
    await setDoc(doc(db,"bakeSchedules",SETTINGS_DOC_ID),{
      ownerUid:currentUser.uid,regularShelfDays:nextSettings.regularDays,
      boxedShelfDays:nextSettings.boxedDays,updatedAt:new Date().toISOString()
    });
    shelfLifeSettings=nextSettings;renderWeek();
    $("shelfLifeMessage").textContent="賞味期限を保存しました。";
  }catch(error){
    console.error(error);$("shelfLifeMessage").textContent=`保存できませんでした：${error.message}`;
  }
});
$("scheduleForm").addEventListener("submit",async e=>{
  e.preventDefault();const key=$("planDate").value;if(!key){$("formMessage").textContent="日付を入力してください。";return;}
  const products={};document.querySelectorAll("[data-product]").forEach(i=>products[i.dataset.product]=qty(i.value));
  const data={date:key,eventName:$("eventName").value.trim(),products,bundle4:qty($("bundle4").value),bundle8:qty($("bundle8").value),bundle16:qty($("bundle16").value),businessHours:$("businessHours").value.trim(),groupCount:qty($("groupCount").value),notes:$("notes").value.trim(),done:plans[key]?.done||false,updatedAt:new Date().toISOString()};
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
["bundle4","bundle8","bundle16"].forEach(id=>$(id).addEventListener("input",updateTotals));
$("planDate").addEventListener("change",updateTotals);
$("prevWeek").onclick=()=>{weekStart.setDate(weekStart.getDate()-7);renderWeek();};
$("nextWeek").onclick=()=>{weekStart.setDate(weekStart.getDate()+7);renderWeek();};
$("thisWeek").onclick=()=>{weekStart=mondayOf(new Date());renderWeek();};

activateTab("home");renderProductInputs();clearForm();renderWeek();
const app=initializeApp(firebaseConfig);db=getFirestore(app);auth=getAuth(app);
onAuthStateChanged(auth,showApp);
