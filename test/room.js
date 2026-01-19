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
  devicePad: document.getElementById("devicePad"),
  activeDeviceBadge: document.getElementById("activeDeviceBadge"),

  shotCount: document.getElementById("shotCount"),
  photoMeta: document.getElementById("photoMeta"),
  photoGrid: document.getElementById("photoGrid"),
};

let roomName = "";
let projectName = "";
let activeDeviceKey = "";

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

function openPreview(title, url){
  const w = window.open();
  if (!w) return;
  w.document.write(`<title>${title}</title><img src="${url}" style="max-width:100%;height:auto;">`);
}

async function renderDevicePad(){
  el.devicePad.innerHTML = "";
  for (let i=1; i<=199; i++){
    const b = document.createElement("button");
    b.textContent = formatDeviceIndex(i);
    b.addEventListener("click", async ()=>{
      const key = makeDeviceKey(roomName, i);
      await upsertDeviceByKey(key, i);
      await setMeta("activeDeviceKey", key);
      setActiveDevice(key);
      await renderPhotos();
      el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
    });
    el.devicePad.appendChild(b);
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
      const fullUrl = URL.createObjectURL(s.blob);
      openPreview(`${kindLabel} ${t}`, fullUrl);
      setTimeout(()=>URL.revokeObjectURL(fullUrl), 60_000);
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

  el.deviceNoPicker.open = false;
  await renderDevicePad();

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
