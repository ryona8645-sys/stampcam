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
  addedDevices: document.getElementById("addedDevices"),
  deviceGrid: document.getElementById("deviceGrid"),
  activeDeviceBadge: document.getElementById("activeDeviceBadge"),

  shotCount: document.getElementById("shotCount"),
  photoMeta: document.getElementById("photoMeta"),
  photoGrid: document.getElementById("photoGrid"),

  deviceList: document.getElementById("deviceList"),
  deviceAddPicker: document.getElementById("deviceAddPicker"),
  deviceAddGrid: document.getElementById("deviceAddGrid"),

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


async function getRoomDevices(){
  const devs = await db.devices.where("roomName").equals(roomName).toArray();
  devs.sort((a,b)=>Number(a.deviceIndex)-Number(b.deviceIndex));
  return devs;
}

async function setActiveByIndex(idx){
  const key = makeDeviceKey(roomName, idx);
  await upsertDeviceByKey(key, idx);
  await setMeta("activeDeviceKey", key);
  setActiveDevice(key);
  await renderAdded();
  await renderPhotos();
  el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
}

async function renderAdded(){
  const devs = await getRoomDevices();
  const indices = new Set(devs.map(d=>Number(d.deviceIndex)));
  indices.add(0); // always show FREE chip
  const list = Array.from(indices).sort((a,b)=>a-b);

  el.addedDevices.innerHTML = "";
  for (const idx of list){
    const b = document.createElement("button");
    b.textContent = (idx === 0) ? "番号なし" : formatDeviceIndex(idx);
    const key = makeDeviceKey(roomName, idx);
    if (key === activeDeviceKey) b.classList.add("sel");
    b.addEventListener("click", async ()=>{ await setActiveByIndex(idx); });
    el.addedDevices.appendChild(b);
  }
}

async function renderAddGrid(){
  el.deviceGrid.innerHTML = "";
  for (let i=1; i<=199; i++){
    const b = document.createElement("button");
    b.textContent = formatDeviceIndex(i);
    b.addEventListener("click", async ()=>{
      await setActiveByIndex(i);
      el.deviceNoPicker.open = false;
  await renderAddGrid();
  await renderAdded();
    });
    el.deviceGrid.appendChild(b);
  }
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


}

async function listDevicesForRoom(){
  const all = await db.devices.where("roomName").equals(roomName).toArray();
  // deviceIndexで昇順固定（選択しても並び替えない）
  all.sort((a,b)=>Number(a.deviceIndex)-Number(b.deviceIndex));
  return all;
}

async function renderDeviceList(){
  el.deviceList.innerHTML = "";

  // FREE（機器番号なし）は常に先頭固定
  const freeKey = makeDeviceKey(roomName, 0);
  const bFree = document.createElement("button");
  bFree.textContent = "機器番号なし";
  if (freeKey === activeDeviceKey) bFree.classList.add("sel");
  bFree.addEventListener("click", async ()=>{
    await upsertDeviceByKey(freeKey, 0);
    await setMeta("activeDeviceKey", freeKey);
    setActiveDevice(freeKey);
    await renderPhotos();
    el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
  });
  el.deviceList.appendChild(bFree);

  const items = await listDevicesForRoom();
  for (const d of items){
    if (Number(d.deviceIndex) === 0) continue; // FREEは上で表示済み
    const b = document.createElement("button");
    b.textContent = formatDeviceIndex(d.deviceIndex);
    if (d.deviceKey === activeDeviceKey) b.classList.add("sel");
    b.addEventListener("click", async ()=>{
      await setMeta("activeDeviceKey", d.deviceKey);
      setActiveDevice(d.deviceKey);
      await renderPhotos();
      el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
    });
    el.deviceList.appendChild(b);
  }
}

async function renderAddGrid(){
  el.deviceAddGrid.innerHTML = "";
  for (let i=1; i<=199; i++){
    const b = document.createElement("button");
    b.textContent = formatDeviceIndex(i);
    b.addEventListener("click", async ()=>{
      const key = makeDeviceKey(roomName, i);
      await upsertDeviceByKey(key, i);

      // 追加した番号を即選択 → 写真一覧切替（現場フローに一致）
      await setMeta("activeDeviceKey", key);
      setActiveDevice(key);

      // 一覧を更新して、追加した番号が見える状態にする
      await renderDeviceList();
      await renderPhotos();

      // 追加パネルは閉じる（邪魔にならない）
      if (el.deviceAddPicker) el.deviceAddPicker.open = false;

      el.photoGrid.scrollIntoView({ behavior:"smooth", block:"start" });
    });
    el.deviceAddGrid.appendChild(b);
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
  const ret = `./room.html?room=${encodeURIComponent(roomName)}`;
  location.href = `./camera.html?deviceKey=${encodeURIComponent(activeDeviceKey)}${free}&return=${encodeURIComponent(ret)}`;
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

    el.btnFree.addEventListener("click", async ()=>{ await setActiveByIndex(0); });
  });

  el.btnOpenCamera.addEventListener("click", goCamera);  el.deviceNoPicker.open = false;
  await renderAddGrid();
  await renderAdded();
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
  await renderAddGrid();
  await renderAdded();
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
  // 追加グリッドはデフォルト閉
  el.deviceAddPicker.open = false;

  await renderAddGrid();

  // 登録済み一覧を出す（折りたたみ不要）
  await renderDeviceList();


init();
