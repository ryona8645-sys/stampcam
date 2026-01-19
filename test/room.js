import { openDb } from "./db.js";
const db = openDb();

const REQUIRED_KINDS = ["overview","lamp","port","label"];
const KIND_LABEL = { overview:"全景", lamp:"ランプ", port:"ポート", label:"ラベル", ipaddress:"IPアドレス" };

function qparam(name){
  const url = new URL(location.href);
  return url.searchParams.get(name) || "";
}
function normalizeRoomName(s){ return String(s||"").trim() || "（未設定）"; }
function formatDeviceIndex(n){ return String(n).padStart(3,"0"); }
function makeDeviceKey(roomName, deviceIndex){
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return `${room}::${idx}`;
}
function makeRoomDeviceLabel(roomName, deviceIndex){
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return (Number(deviceIndex) === 0) ? `${room}_機器番号なし` : `${room}_機器${idx}`;
}

const el = {
  roomTitle: document.getElementById("roomTitle"),
  roomSub: document.getElementById("roomSub"),
  btnBack: document.getElementById("btnBack"),

  btnFree: document.getElementById("btnFree"),
  btnOpenCamera: document.getElementById("btnOpenCamera"),
  deviceNoPicker: document.getElementById("deviceNoPicker"),
  deviceInput: document.getElementById("deviceInput"),
  btnKeyBack: document.getElementById("btnKeyBack"),
  btnKeyClear: document.getElementById("btnKeyClear"),
  btnKeyOk: document.getElementById("btnKeyOk"),
  keypadGrid: document.getElementById("keypadGrid"),
  recentDevices: document.getElementById("recentDevices"),
  activeDeviceBadge: document.getElementById("activeDeviceBadge"),

  shotCount: document.getElementById("shotCount"),
  photoMeta: document.getElementById("photoMeta"),
  photoGrid: document.getElementById("photoGrid"),

  // preview modal
  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
};

let roomName = "";
let projectName = "";
let activeDeviceKey = "";
let inputDigits = "";
let recentList = [];

async function getMeta(key, fallback=""){
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value){
  await db.meta.put({ key, value });
}
async function getProjectName(){ return await getMeta("projectName",""); }

async function upsertDeviceByKey(key, deviceIndex){
  const updatedAt = Date.now();
  const existing = await db.devices.get(key);
  if (existing){
    await db.devices.put({ ...existing, roomName, deviceIndex, updatedAt });
    return;
  }
  await db.devices.put({ deviceKey:key, roomName, deviceIndex, checked:false, updatedAt });
}
async function recomputeChecked(key){
  const shots = await db.shots.where("deviceKey").equals(key).toArray();
  const done = new Set(shots.map(s=>s.kind));
  const checked = REQUIRED_KINDS.every(k=>done.has(k));
  const dev = await db.devices.get(key);
  if (dev) await db.devices.put({ ...dev, checked, updatedAt: Date.now() });
  return checked;
}

function setActiveDevice(key){
  activeDeviceKey = key;
  const parts = String(key).split("::");
  const idx = Number(parts[1] || "0");
  el.activeDeviceBadge.textContent = makeRoomDeviceLabel(roomName, idx);
}

function clearGrid(){ el.photoGrid.innerHTML = ""; }

let previewUrl = null;
let modalZoom = 1;

function openPreviewModal(title, blob){
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  modalZoom = 1;
  el.previewImg.style.transformOrigin = "0 0";
  el.previewImg.style.transform = `scale(${modalZoom})`;
  el.previewImg.src = previewUrl;
  el.previewTitle.textContent = title;
  el.preview.classList.remove("hidden");
}
function closePreviewModal(){
  el.preview.classList.add("hidden");
  if (previewUrl){
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}
function setModalZoom(next){
  modalZoom = Math.max(0.25, Math.min(6, next));
  el.previewImg.style.transform = `scale(${modalZoom})`;
}


async function getRoomRecentKey(room){
  return `recentDevices::${room}`;
}
async function loadRecent(){
  const key = await getRoomRecentKey(roomName);
  const raw = await getMeta(key, "[]");
  try { recentList = JSON.parse(raw) || []; } catch { recentList = []; }
  // keep only 3-digit strings
  recentList = recentList.filter(x => /^[0-9]{3}$/.test(String(x)));
  recentList = Array.from(new Set(recentList)).slice(0, 8);
}
async function saveRecent(){
  const key = await getRoomRecentKey(roomName);
  await setMeta(key, JSON.stringify(recentList.slice(0,8)));
}
function updateInputDisplay(){
  const s = inputDigits.padEnd(3, "-").slice(0,3);
  el.deviceInput.textContent = s;
}
function pushDigit(d){
  if (inputDigits.length >= 3) return;
  inputDigits += String(d);
  updateInputDisplay();
}
function backspace(){
  inputDigits = inputDigits.slice(0, -1);
  updateInputDisplay();
}
function clearInput(){
  inputDigits = "";
  updateInputDisplay();
}
function parseInput(){
  if (inputDigits.length !== 3) return null;
  const n = Number(inputDigits);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 199) return null;
  return n;
}
async function commitDeviceIndex(n){
  const key = makeDeviceKey(roomName, n);
  await upsertDeviceByKey(key, n);
  await setMeta("activeDeviceKey", key);
  setActiveDevice(key);
  // recent update (most recent first)
  const s = formatDeviceIndex(n);
  recentList = [s, ...recentList.filter(x => x !== s)].slice(0,8);
  await saveRecent();
  await renderRecent();
  await renderPhotos();
  el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
}
async function renderRecent(){
  if (!el.recentDevices) return;
  el.recentDevices.innerHTML = "";
  for (const s of recentList){
    const b = document.createElement("button");
    b.textContent = s;
    const key = makeDeviceKey(roomName, Number(s));
    if (key === activeDeviceKey) b.classList.add("sel");
    b.addEventListener("click", async ()=>{
      await commitDeviceIndex(Number(s));
    });
    el.recentDevices.appendChild(b);
  }
}
function renderKeypad(){
  const nums = ["1","2","3","4","5","6","7","8","9","0"];
  el.keypadGrid.innerHTML = "";
  for (const n of nums){
    const b = document.createElement("button");
    b.textContent = n;
    b.addEventListener("click", ()=>pushDigit(n));
    el.keypadGrid.appendChild(b);
  }
}




async function renderPhotos(){
  clearGrid();
  if (!activeDeviceKey){
    el.photoMeta.textContent = "機器を選択してください。";
    el.shotCount.textContent = "0枚";
    return;
  }
  const shots = await db.shots.where("deviceKey").equals(activeDeviceKey).toArray();
  shots.sort((a,b)=>b.createdAt-a.createdAt);

  el.shotCount.textContent = `${shots.length}枚`;

  const done = new Set(shots.map(s=>s.kind));
  const miss = REQUIRED_KINDS.filter(k=>!done.has(k)).map(k=>KIND_LABEL[k]).join(" / ");
  el.photoMeta.textContent = miss ? `未撮影: ${miss}` : "必須4種 完了 ✅";

  for (const s of shots){
    const blob = s.thumbBlob || s.blob;
    const url = URL.createObjectURL(blob);
    const card = document.createElement("div");
    card.className = "thumb";
    const kind = String(s.kind || "");
    const kindLabel = kind.startsWith("free_") ? kind.slice(5) : (KIND_LABEL[kind] || kind || "（不明）");
    const t = new Date(s.createdAt).toLocaleString();
    card.innerHTML = `
      <img alt="" src="${url}">
      <div class="thumbMeta">
        <div class="thumbKind">${kindLabel}</div>
        <div class="thumbTime">${t}</div>
      </div>
    `;
    card.addEventListener("click", ()=>{
      openPreviewModal(`${kindLabel} ${t}`, s.blob);
    });
    el.photoGrid.appendChild(card);
    setTimeout(()=>URL.revokeObjectURL(url), 60_000);
  }

  await recomputeChecked(activeDeviceKey);
}

function goCamera(){
  if (!activeDeviceKey){
    alert("機器を選択してください。");
    return;
  }
  const free = String(activeDeviceKey).endsWith("::000") ? "&free=1" : "";
  location.href = `./camera.html?deviceKey=${encodeURIComponent(activeDeviceKey)}${free}`;
}

async function init(){
  roomName = normalizeRoomName(qparam("room"));
  if (!roomName){
    alert("部屋が指定されていません");
    location.href = "./index.html";
    return;
  }
  projectName = (await getProjectName()).trim();

  el.roomTitle.textContent = roomName;
  el.roomSub.textContent = projectName ? `案件: ${projectName}` : "";

  el.btnBack.addEventListener("click", ()=>location.href="./index.html");

  el.btnFree.addEventListener("click", async ()=>{
    const key = makeDeviceKey(roomName, 0);
    await upsertDeviceByKey(key, 0);
    await setMeta("activeDeviceKey", key);
    setActiveDevice(key);
    await renderPhotos();
    el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
  });

  el.btnOpenCamera.addEventListener("click", goCamera);

  // keypad
  renderKeypad();
  updateInputDisplay();
  el.btnKeyBack?.addEventListener("click", backspace);
  el.btnKeyClear?.addEventListener("click", clearInput);
  el.btnKeyOk?.addEventListener("click", async ()=>{
    const n = parseInput();
    if (n === null){ alert("機器Noは001〜199の3桁で入力してください。"); return; }
    await commitDeviceIndex(n);
    clearInput();
    el.deviceNoPicker.open = false;
  await loadRecent();
  await renderRecent();
  });

  // allow Enter key
  document.addEventListener("keydown", async (e)=>{
    if (e.key === "Enter" && !el.preview.classList.contains("hidden")) return; // modal open
    if (e.key === "Enter"){
      const n = parseInput();
      if (n !== null) await commitDeviceIndex(n);
    }
    if (/^[0-9]$/.test(e.key)) pushDigit(e.key);
    if (e.key === "Backspace") backspace();
  });

  // preview modal
  el.closePreview?.addEventListener("click", closePreviewModal);
  el.preview?.addEventListener("click", (e)=>{ if (e.target === el.preview) closePreviewModal(); });
  el.zoomIn?.addEventListener("click", ()=>setModalZoom(modalZoom * 1.25));
  el.zoomOut?.addEventListener("click", ()=>setModalZoom(modalZoom / 1.25));
  el.zoomReset?.addEventListener("click", ()=>setModalZoom(1));
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape") closePreviewModal(); });


  el.deviceNoPicker.open = false;
  await loadRecent();
  await renderRecent();

  const lastKey = await getMeta("activeDeviceKey","");
  if (lastKey && String(lastKey).startsWith(roomName + "::")){
    setActiveDevice(lastKey);
  } else {
    activeDeviceKey = "";
    el.activeDeviceBadge.textContent = "未選択";
  }
  await renderPhotos();
}

init();
