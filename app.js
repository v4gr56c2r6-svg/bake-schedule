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
const $ = id => document.getElementById(id);
let db = null, auth = null, currentUser = null, plans = {};
let weekStart = mondayOf(new Date());

function mondayOf(date){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate());d.setDate(d.getDate()-((d.getDay()+6)%7));return d;}
function dateKey(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function parseDate(key){const [y,m,d]=key.split("-").map(Number);return new Date(y,m-1,d);}
function fmtDate(d){return `${d.getMonth()+1}/${d.getDate()}`;}
function qty(v){return Math.max(0,Math.floor(Number(v)||0));}
function sumProducts(p={}){return Object.values(p).reduce((a,b)=>a+qty(b),0);}
function boxFlavorCount(p){
  const half=qty(p?.bundle4)*2+qty(p?.bundle8)*4+qty(p?.bundle16)*8;
  return {custard:half,anko:half};
}
function bundleCount(p){return qty(p?.bundle4)*4+qty(p?.bundle8)*8+qty(p?.bundle16)*16;}
function flavorTotals(p){
  const box=boxFlavorCount(p), products=p?.products||{};
  const regularCustard=qty(products["カスタード"]), regularAnko=qty(products["あんこ"]);
  return {regularCustard,regularAnko,boxCustard:box.custard,boxAnko:box.anko,
    totalCustard:regularCustard+box.custard,totalAnko:regularAnko+box.anko};
}
function total(p){
  const products=p?.products||{};
  const other=sumProducts(Object.fromEntries(Object.entries(products).filter(([k])=>k!=="カスタード"&&k!=="あんこ")));
  const f=flavorTotals(p);
  return other+f.totalCustard+f.totalAnko;
}
function weekDates(){return Array.from({length:7},(_,i)=>{const d=new Date(weekStart);d.setDate(d.getDate()+i);return d;});}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function showApp(user){
  currentUser=user;
  $("authPanel").classList.toggle("hidden",!!user);
  $("appContent").classList.toggle("hidden",!user);
  $("accountBar").classList.toggle("hidden",!user);
  if(user){
    $("accountEmail").textContent=user.email||"ログイン中";
    $("connection").textContent="Firebase接続済み";
    $("connection").classList.add("online");
    loadPlans();
  }else{
    plans={};renderWeek();
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
  const b4=qty($("bundle4").value),b8=qty($("bundle8").value),b16=qty($("bundle16").value);
  const boxEach=b4*2+b8*4+b16*8;
  const regularCustard=qty(products["カスタード"]),regularAnko=qty(products["あんこ"]);
  const custardTotal=regularCustard+boxEach,ankoTotal=regularAnko+boxEach;
  const otherTotal=sumProducts(Object.fromEntries(Object.entries(products).filter(([k])=>k!=="カスタード"&&k!=="あんこ")));
  const bundlePieces=b4*4+b8*8+b16*16;
  $("bundle4Result").textContent=`${b4}セット × 4個 = ${b4*4}個`;
  $("bundle8Result").textContent=`${b8}セット × 8個 = ${b8*8}個`;
  $("bundle16Result").textContent=`${b16}セット × 16個 = ${b16*16}個`;
  $("individualSubtotal").textContent=`${sumProducts(products)}個`;
  $("bundleSubtotal").textContent=`${bundlePieces}個`;
  $("regularCustard").textContent=`${regularCustard}個`;
  $("regularAnko").textContent=`${regularAnko}個`;
  $("boxCustard").textContent=`${boxEach}個`;
  $("boxAnko").textContent=`${boxEach}個`;
  $("totalCustard").textContent=`${custardTotal}個`;
  $("totalAnko").textContent=`${ankoTotal}個`;
  $("dayTotal").textContent=`${otherTotal+custardTotal+ankoTotal}個`;
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
  const weeklyFlavors=rows.reduce((acc,x)=>{const f=flavorTotals(x.plan);for(const k of Object.keys(acc))acc[k]+=f[k];return acc;},
    {regularCustard:0,regularAnko:0,boxCustard:0,boxAnko:0,totalCustard:0,totalAnko:0});
  $("registeredDays").textContent=`${registered}日`;$("individualTotal").textContent=`${individual}個`;
  $("bundleTotal").textContent=`${bundles}個`;$("grandTotal").textContent=`${rows.reduce((n,x)=>n+total(x.plan),0)}個`;
  $("weekCustardBreakdown").textContent=`通常 ${weeklyFlavors.regularCustard}個 ＋ 箱入り ${weeklyFlavors.boxCustard}個`;
  $("weekCustardTotal").textContent=`${weeklyFlavors.totalCustard}個`;
  $("weekAnkoBreakdown").textContent=`通常 ${weeklyFlavors.regularAnko}個 ＋ 箱入り ${weeklyFlavors.boxAnko}個`;
  $("weekAnkoTotal").textContent=`${weeklyFlavors.totalAnko}個`;
  $("scheduleList").innerHTML=rows.map(({key,date,plan})=>{
    const day=["日","月","火","水","木","金","土"][date.getDay()],label=`${date.getMonth()+1}/${date.getDate()}（${day}）`;
    if(!plan||total(plan)===0)return `<article class="day-card"><div class="day-date">${label}<small>予定なし</small></div><div class="day-main"><strong>焼成予定なし</strong><p>この日の予定を登録できます。</p><div class="day-tools"><button class="mini" data-add="${key}">${plan?"編集":"＋ 予定を登録"}</button></div></div><div class="day-count">—</div></article>`;
    const f=flavorTotals(plan);
    const flavorDetail=`カスタード ${f.totalCustard}個（通常${f.regularCustard}＋箱${f.boxCustard}）／ あんこ ${f.totalAnko}個（通常${f.regularAnko}＋箱${f.boxAnko}）`;
    const detail=[flavorDetail,plan.businessHours,plan.groupCount?`団体 ${plan.groupCount}人`:"",plan.notes].filter(Boolean).join(" ／ ");
    return `<article class="day-card"><div class="day-date">${label}<small><span class="status ${plan.done?"done":""}">${plan.done?"焼成完了":"予定あり"}</span></small></div><div class="day-main"><strong>${escapeHtml(plan.eventName||"焼成予定")}</strong><p>${escapeHtml(detail||"備考なし")}</p><div class="day-tools"><button class="mini" data-edit="${key}">編集</button><button class="mini" data-done="${key}">${plan.done?"未完了に戻す":"完了にする"}</button></div></div><div class="day-count">${total(plan).toLocaleString()}個<small>予定数量</small></div></article>`;
  }).join("");
  $("scheduleList").querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const key=b.dataset.add;if(plans[key])fillForm(key);else clearForm(key);$("editorPanel").scrollIntoView({behavior:"smooth",block:"start"});});
  $("scheduleList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>fillForm(b.dataset.edit));
  $("scheduleList").querySelectorAll("[data-done]").forEach(b=>b.onclick=()=>toggleDone(b.dataset.done));
}
async function loadPlans(){
  if(!db||!currentUser)return;
  try{
    const q=query(collection(db,"bakeSchedules"),where("ownerUid","==",currentUser.uid));
    const snap=await getDocs(q);plans={};snap.forEach(d=>plans[d.id]=d.data());renderWeek();
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
["bundle4","bundle8","bundle16"].forEach(id=>$(id).addEventListener("input",updateTotals));
$("prevWeek").onclick=()=>{weekStart.setDate(weekStart.getDate()-7);renderWeek();};
$("nextWeek").onclick=()=>{weekStart.setDate(weekStart.getDate()+7);renderWeek();};
$("thisWeek").onclick=()=>{weekStart=mondayOf(new Date());renderWeek();};

renderProductInputs();clearForm();renderWeek();
const app=initializeApp(firebaseConfig);db=getFirestore(app);auth=getAuth(app);
onAuthStateChanged(auth,showApp);
