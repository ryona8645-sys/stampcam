import { openDb } from "./db.js";

const db = openDb();

const KINDS = ["overview","lamp","port","label","ipaddress"];
const KIND_LABEL = {
  overview:"全景",
  lamp:"ランプ",
  port:"ポート",
  label:"ラベル",
  ipaddress:"IPアドレス"
};
const REQUIRED_KINDS = ["overview","lamp","port","label"];

function normalizeRoomName(s) {
  return String(s || "").trim() || "（未設定）";
}
function formatDeviceIndex(n) {
  return String(n).padStart(2, "0");
}
function makeRoomDeviceLabel(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return `${room}_機器${idx}`;
}

function qparam(name) {
  const url = new URL(location.href);
  return url.searchParams.get(name) || "";
}

const el = {
  camTitle: document.getElementById("camTitle"),
  btnBack: document.getElementById("btnBack"),

  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),

  btnTorch: document.getElementById("btnTorch"),
  btnRes: document.getElementById("btnRes"),
  zoom: document.getElementById("zoom"),
  zoomVal: document.getElementById("zoomVal"),

  btnShutter: document.getElementById("btnShutter"),
  kindStrip: document.getElementById("kindStrip"),
  kindStatus: document.getElementById("kindStatus"),
  btnDrawer: document.getElementById("btnDrawer"),

  drawer: document.getElementById("drawer"),
  btnCloseDrawer: document.getElementById("btnCloseDrawer"),
  lastImg: document.getElementById("lastImg"),
  lastInfo: document.getElementById("lastInfo"),
  btnOpenLast: document.getElementById("btnOpenLast"),

  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
};

let deviceKey = "";
let roomName = "";
let deviceIndex = 0;

let stream = null;
let track = null;
let torchOn = false;

let use4k = false;
let zoom = 1;

let selectedKind = "overview";

let previewUrl = null;
let modalZoom = 1;

async function getMeta(key, fallback = "") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function getProjectName() { return await getMeta("projectName",""); }

async function upsertDeviceByKey(key) {
  const updatedAt = Date.now();
  const existing = await db.devices.get(key);

  if (existing) {
    await db.devices.put({ ...existing, roomName, deviceIndex, updatedAt });
    return;
  }

  await db.devices.put({
    deviceKey: key,
    roomName,
    deviceIndex,
    checked: false,
    updatedAt
  });
}

async function recomputeChecked(key) {
  const shots = await db.shots.where("deviceKey").equals(key).toArray();
  const done = new Set(shots.map(s=>s.kind));
  const checked = REQUIRED_KINDS.every(k => done.has(k));
  const dev = await db.devices.get(key);
  if (dev) await db.devices.put({ ...dev, checked, updatedAt: Date.now() });
  return checked;
}

async function makeThumbnail(blob, maxSide = 320, quality = 0.7) {
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

async function startCamera() {
  if (stream) return;

  const constraints = {
    audio:false,
    video: {
      facingMode: "environment",
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

async function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t=>t.stop());
  stream = null;
  track = null;
  el.video.srcObject = null;
}

async function restartCamera() {
  await stopCamera();
  await startCamera();
}

async function applyTorch(on) {
  if (!track) return false;
  const caps = track.getCapabilities?.();
  if (!caps || !caps.torch) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    return true;
  } catch {
    return false;
  }
}

function applyZoom(val) {
  zoom = val;
  if (el.zoomVal) el.zoomVal.textContent = `${zoom.toFixed(1)}x`;

  const caps = track?.getCapabilities?.();
  if (track && caps && caps.zoom) {
    const z = Math.min(caps.zoom.max, Math.max(caps.zoom.min, zoom));
    track.applyConstraints({ advanced: [{ zoom: z }] }).catch(()=>{});
    el.video.style.transform = "none";
  } else {
    el.video.style.transformOrigin = "center center";
    el.video.style.transform = `scale(${zoom})`;
  }
}

function openDrawer() { el.drawer?.classList.remove("hidden"); }
function closeDrawer() { el.drawer?.classList.add("hidden"); }

function openPreview(title, blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);

  modalZoom = 1;
  el.previewImg.style.transformOrigin = "0 0";
  el.previewImg.style.transform = `scale(${modalZoom})`;
  el.previewImg.src = previewUrl;
  el.previewTitle.textContent = title;

  el.preview.classList.remove("hidden");
}

function closePreview() {
  el.preview.classList.add("hidden");
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function setModalZoom(next) {
  modalZoom = Math.max(0.25, Math.min(6, next));
  el.previewImg.style.transform = `scale(${modalZoom})`;
}

async function renderKindStrip() {
  if (!el.kindStrip) return;
  el.kindStrip.innerHTML = "";

  for (const k of KINDS) {
    const b = document.createElement("button");
    b.textContent = KIND_LABEL[k] || k;
    if (k === selectedKind) b.classList.add("sel");
    b.addEventListener("click", () => {
      selectedKind = k;
      renderKindStrip();
      renderKindStatus();
    });
    el.kindStrip.appendChild(b);
  }
}

async function renderKindStatus() {
  if (!el.kindStatus) return;
  const shots = await db.shots.where("deviceKey").equals(deviceKey).toArray();
  const done = new Set(shots.map(s=>s.kind));
  const must = REQUIRED_KINDS.map(k => `${KIND_LABEL[k]}${done.has(k) ? "✅" : "□"}`).join(" / ");
  el.kindStatus.textContent = `選択:${KIND_LABEL[selectedKind]} / 必須:${must}`;
}

async function takeShot() {
  if (!deviceKey) return alert("機器が未選択です");
  if (!stream) return alert("カメラ起動に失敗しています");

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
    kind: selectedKind,
    createdAt: Date.now(),
    mime: blob.type,
    blob,
    thumbMime: thumb.type,
    thumbBlob: thumb,
    w, h, tw, th
  });

  await db.meta.put({ key: "lastShotId", value: String(shotId) });

  await recomputeChecked(deviceKey);
  await renderDrawer();
  await renderKindStatus();
}

async function renderDrawer() {
  const lastId = (await db.meta.get("lastShotId"))?.value || "";
  if (!el.lastInfo || !el.lastImg || !el.btnOpenLast) return;

  if (!lastId) {
    el.lastInfo.textContent = "直前の写真なし";
    el.lastImg.removeAttribute("src");
    el.btnOpenLast.disabled = true;
    return;
  }

  const shot = await db.shots.get(Number(lastId));
  if (!shot) {
    el.lastInfo.textContent = "直前の写真なし";
    el.lastImg.removeAttribute("src");
    el.btnOpenLast.disabled = true;
    return;
  }

  el.btnOpenLast.disabled = false;

  const label = makeRoomDeviceLabel(roomName, deviceIndex);
  el.lastInfo.textContent = `${label} / ${KIND_LABEL[shot.kind] || shot.kind} / ${new Date(shot.createdAt).toLocaleString()}`;

  const url = URL.createObjectURL(shot.thumbBlob || shot.blob);
  el.lastImg.src = url;
  setTimeout(()=>URL.revokeObjectURL(url), 30_000);

  el.btnOpenLast.onclick = () => openPreview(el.lastInfo.textContent, shot.blob);
}

async function init() {
  deviceKey = qparam("deviceKey");
  if (!deviceKey) {
    alert("deviceKeyがありません。");
    location.href = "./index.html";
    return;
  }

  {
    const [r, idx] = String(deviceKey).split("::");
    roomName = normalizeRoomName(r);
    deviceIndex = Number(idx);
  }

  await upsertDeviceByKey(deviceKey);

  const pj = (await getProjectName()).trim();
  const label = makeRoomDeviceLabel(roomName, deviceIndex);
  if (el.camTitle) el.camTitle.textContent = `撮影 ${label} ${pj ? "["+pj+"]" : ""}`;

  el.btnBack?.addEventListener("click", async () => {
    await stopCamera();
    location.href = "./index.html";
  });

  el.btnDrawer?.addEventListener("click", () => openDrawer());
  el.btnCloseDrawer?.addEventListener("click", () => closeDrawer());

  el.closePreview?.addEventListener("click", closePreview);
  el.preview?.addEventListener("click", (e) => { if (e.target === el.preview) closePreview(); });
  el.zoomIn?.addEventListener("click", () => setModalZoom(modalZoom * 1.25));
  el.zoomOut?.addEventListener("click", () => setModalZoom(modalZoom / 1.25));
  el.zoomReset?.addEventListener("click", () => setModalZoom(1));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePreview(); closeDrawer(); }
  });

  el.zoom?.addEventListener("input", () => applyZoom(Number(el.zoom.value)));
  if (el.zoom) el.zoom.value = String(zoom);

  el.btnTorch?.addEventListener("click", async () => {
    torchOn = !torchOn;
    const ok = await applyTorch(torchOn);
    if (!ok) {
      torchOn = false;
      alert("この端末/ブラウザではライト制御に対応していません。");
    }
    if (el.btnTorch) el.btnTorch.textContent = torchOn ? "ライトON" : "ライト";
  });

  el.btnRes?.addEventListener("click", async () => {
    use4k = !use4k;
    if (el.btnRes) el.btnRes.textContent = use4k ? "解像度 3840×2160" : "解像度 1280×720";
    await restartCamera();
  });

  el.btnShutter?.addEventListener("click", takeShot);

  await renderKindStrip();
  await renderDrawer();
  await renderKindStatus();

  try {
    await startCamera();
  } catch (e) {
    console.error(e);
    alert("カメラ起動に失敗。権限/HTTPS/設定を確認してください。");
  }
}

init();
