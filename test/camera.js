import { openDb } from "./db.js";
const db = openDb();

const KINDS = ["overview","lamp","port","label","ipaddress"];
const KIND_LABEL = { overview:"全景", lamp:"ランプ", port:"ポート", label:"ラベル", ipaddress:"IPアドレス" };
const REQUIRED_KINDS = ["overview","lamp","port","label"];

function normalizeRoomName(s){ return String(s||"").trim() || "-"; }
function formatDeviceIndex(n){ return String(n).padStart(3,"0"); }
function makeRoomDeviceLabel(roomName, deviceIndex){
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return `${room}_機器${idx}`;
}
function qparam(name){
  const url = new URL(location.href);
  return url.searchParams.get(name) || "";
}

const el = {
  camTitle: document.getElementById("camTitle"),
  camSub: document.getElementById("camSub"),
  btnBack: document.getElementById("btnBack"),

  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),

  btnTorch: document.getElementById("btnTorch"),
  btnRes: document.getElementById("btnRes"),
  zoom: document.getElementById("zoom"),
  zoomVal: document.getElementById("zoomVal"),

  btnShutter: document.getElementById("btnShutter"),

  // kind
  btnKind: document.getElementById("btnKind"),
  kindModal: document.getElementById("kindModal"),
  kindGrid: document.getElementById("kindGrid"),
  btnCloseKind: document.getElementById("btnCloseKind"),

  toast: document.getElementById("toast"),

  // preview
  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
};

let deviceKey = "";
let freeMode = false;
let roomName = "";
let deviceIndex = 0;

let stream = null;
let track = null;
let torchOn = false;

let use4k = false; // default 1280x720
let zoom = 1;

let selectedKind = ""; // force explicit selection

let previewUrl = null;
let modalZoom = 1;
let toastTimer = null;

async function getMeta(key, fallback=""){
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function getProjectName(){ return await getMeta("projectName","-"); }

async function upsertDeviceByKey(key){
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

function showToast(msg, ms=1800){
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.toast.classList.add("hidden"), ms);
}

function openKindModal(){ el.kindModal?.classList.remove("hidden"); }
function closeKindModal(){ el.kindModal?.classList.add("hidden"); }

function renderKindButton(){
  const t = selectedKind ? `種別:${selectedKind.startsWith("free:") ? selectedKind.slice(5) : (KIND_LABEL[selectedKind] || selectedKind)}` : "種別:未選択";
  if (el.btnKind) el.btnKind.textContent = t;
}
function renderKindGrid(){
  if (!el.kindGrid) return;
  el.kindGrid.innerHTML = "";
  if (freeMode){
    const b = document.createElement("button");
    b.textContent = "自由入力";
    if (selectedKind && selectedKind.startsWith("free:")) b.classList.add("sel");
    b.addEventListener("click", ()=>{
      const v = prompt("写真種別（自由入力）", (selectedKind.startsWith("free:") ? selectedKind.slice(5) : ""));
      if (!v) return;
      selectedKind = "free:" + v.trim();
      renderKindButton();
      renderKindGrid();
      closeKindModal();
      showToast("種別を設定しました", 1200);
    });
    el.kindGrid.appendChild(b);
  }

  for (const k of KINDS){
    const b = document.createElement("button");
    b.textContent = KIND_LABEL[k] || k;
    if (k === selectedKind) b.classList.add("sel");
    b.addEventListener("click", ()=>{
      selectedKind = k;
      renderKindButton();
      renderKindGrid();
      closeKindModal();
      showToast(`種別を「${KIND_LABEL[k]}」に設定`, 1200);
    });
    el.kindGrid.appendChild(b);
  }
}

async function startCamera(){
  if (stream) return;

  const constraints = {
    audio:false,
    video: {
      facingMode:"environment",
      width: use4k ? { ideal: 3840 } : { ideal: 1280 },
      height: use4k ? { ideal: 2160 } : { ideal: 720 }
    }
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  el.video.srcObject = stream;
  await el.video.play();
  track = stream.getVideoTracks()[0] || null;

  applyZoom(zoom);
  await applyTorch(torchOn);
}

async function stopCamera(){
  if (!stream) return;
  stream.getTracks().forEach(t=>t.stop());
  stream = null;
  track = null;
  el.video.srcObject = null;
}

async function restartCamera(){
  await stopCamera();
  await startCamera();
}

async function applyTorch(on){
  if (!track) return false;
  const caps = track.getCapabilities?.();
  if (!caps || !caps.torch) return false;
  try{
    await track.applyConstraints({ advanced:[{ torch:on }] });
    return true;
  }catch{
    return false;
  }
}

function applyZoom(val){
  zoom = val;
  if (el.zoomVal) el.zoomVal.textContent = `${zoom.toFixed(1)}x`;

  const caps = track?.getCapabilities?.();
  if (track && caps && caps.zoom){
    const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, zoom));
    track.applyConstraints({ advanced:[{ zoom:z }] }).catch(()=>{});
    el.video.style.transform = "none";
  } else {
    el.video.style.transformOrigin = "center center";
    el.video.style.transform = `scale(${zoom})`;
  }
}

async function makeThumbnail(blob, maxSide=320, quality=0.7){
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { alpha:false });
  ctx.drawImage(bmp, 0, 0, w, h);
  const thumb = await new Promise((resolve)=>c.toBlob(resolve,"image/jpeg",quality));
  bmp.close?.();
  if (!thumb) throw new Error("thumb gen failed");
  return { thumb, w, h };
}

function openPreview(title, blob){
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  modalZoom = 1;
  el.previewImg.style.transformOrigin = "0 0";
  el.previewImg.style.transform = `scale(${modalZoom})`;
  el.previewImg.src = previewUrl;
  el.previewTitle.textContent = title;
  el.preview.classList.remove("hidden");
}
function closePreview(){
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

async function showProgressToast(){
  const shots = await db.shots.where("deviceKey").equals(deviceKey).toArray();
  const done = new Set(shots.map(s=>s.kind));
  const miss = REQUIRED_KINDS.filter(k=>!done.has(k)).map(k=>KIND_LABEL[k]).join(" / ");
  showToast(miss ? `未撮影: ${miss}` : "必須4種 完了 ✅", 2000);
}

async function takeShot(){
  if (!deviceKey) return alert("機器が未選択です");
  if (!stream) return alert("カメラ起動に失敗しています");

  if (!selectedKind){
    openKindModal();
    showToast("撮影前に種別を選択してください", 1400);
    return;
  }

  const v = el.video;
  const w = v.videoWidth || (use4k ? 3840 : 1280);
  const h = v.videoHeight || (use4k ? 2160 : 720);

  const c = el.canvas;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { alpha:false });
  ctx.drawImage(v, 0, 0, w, h);

  const blob = await new Promise((resolve)=>c.toBlob(resolve,"image/jpeg",0.85));
  if (!blob) return alert("撮影失敗");

  const { thumb, w:tw, h:th } = await makeThumbnail(blob);

  const shotId = await db.shots.add({
    deviceKey,
    kind: (selectedKind.startsWith("free:") ? ("free_" + selectedKind.slice(5)) : selectedKind),
    createdAt: Date.now(),
    mime: blob.type,
    blob,
    thumbMime: thumb.type,
    thumbBlob: thumb,
    w, h, tw, th
  });

  await db.meta.put({ key:"lastShotId", value:String(shotId) });

  await recomputeChecked(deviceKey);

  // show progress only now (2:C)
  await showProgressToast();
  const kLabel = selectedKind.startsWith("free:") ? selectedKind.slice(5) : (KIND_LABEL[selectedKind] || selectedKind);
  showToast(`撮影: ${kLabel} ✅`, 1200);
}

async function init(){
  deviceKey = qparam("deviceKey");
  freeMode = qparam("free") === "1" || String(deviceKey).startsWith("free::000");
  if (!deviceKey){
    alert("deviceKeyがありません。");
    location.href = "./index.html";
    return;
  }

  {
    if (freeMode){
      roomName = "フリー";
      deviceIndex = 0;
    } else {
      const [r, idx] = String(deviceKey).split("::");
      roomName = normalizeRoomName(r);
      deviceIndex = Number(idx);
    }
  }

  await upsertDeviceByKey(deviceKey);

  const pj = (await getProjectName()).trim();
  const label = makeRoomDeviceLabel(roomName, deviceIndex);

  if (el.camTitle) el.camTitle.textContent = `撮影`;
  if (el.camSub) el.camSub.textContent = `${label}  [${pj || "-"}]`;

  el.btnBack?.addEventListener("click", async ()=>{
    await stopCamera();
    location.href = "./index.html";
  });

  el.btnKind?.addEventListener("click", openKindModal);
  el.btnCloseKind?.addEventListener("click", closeKindModal);
  el.kindModal?.addEventListener("click", (e)=>{ if (e.target === el.kindModal) closeKindModal(); });

  el.closePreview?.addEventListener("click", closePreview);
  el.preview?.addEventListener("click", (e)=>{ if (e.target === el.preview) closePreview(); });
  el.zoomIn?.addEventListener("click", ()=>setModalZoom(modalZoom * 1.25));
  el.zoomOut?.addEventListener("click", ()=>setModalZoom(modalZoom / 1.25));
  el.zoomReset?.addEventListener("click", ()=>setModalZoom(1));

  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape"){
      closePreview();
      closeKindModal();
    }
  });

  el.zoom?.addEventListener("input", ()=>applyZoom(Number(el.zoom.value)));
  if (el.zoom) el.zoom.value = String(zoom);

  el.btnTorch?.addEventListener("click", async ()=>{
    torchOn = !torchOn;
    const ok = await applyTorch(torchOn);
    if (!ok){
      torchOn = false;
      alert("この端末/ブラウザではライト制御に対応していません。");
    }
    if (el.btnTorch) el.btnTorch.textContent = torchOn ? "ライトON" : "ライト";
  });

  if (el.btnRes) el.btnRes.textContent = use4k ? "3840×2160" : "1280×720";
  el.btnRes?.addEventListener("click", async ()=>{
    use4k = !use4k;
    if (el.btnRes) el.btnRes.textContent = use4k ? "3840×2160" : "1280×720";
    await restartCamera();
  });

  el.btnShutter?.addEventListener("click", takeShot);

  renderKindButton();
  renderKindGrid();

  try{
    await startCamera();
  }catch(e){
    console.error(e);
    alert("カメラ起動に失敗。権限/HTTPS/設定を確認してください。");
  }

  // prompt kind selection on entry to reduce mistakes
  openKindModal();
}

init();
