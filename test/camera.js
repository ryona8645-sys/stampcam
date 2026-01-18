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

// ブレ判定（簡易）：縮小グレースケールに対してラプラシアンの分散
// 値が小さいほどボケ。閾値は端末差があるので実運用で調整前提。
// 初期値はやや緩め。
const BLUR_THRESHOLD = 65; // 目安: 40-120くらいで調整

function normalizeRoomName(s) {
  return String(s || "").trim() || "-";
}
function formatDeviceIndex(n) {
  return String(n).padStart(3, "0");
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
  statusLine: document.getElementById("statusLine"),

  toast: document.getElementById("toast"),

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

let use4k = false; // デフォルト 1280×720
let zoom = 1;

let selectedKind = "overview";

let previewUrl = null;
let modalZoom = 1;

function toast(msg, ms = 1200) {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.remove("hidden");
  if (toast._t) clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.add("hidden"), ms);
}

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

async function recomputeDone(key) {
  const shots = await db.shots.where("deviceKey").equals(key).toArray();
  return new Set(shots.map(s=>s.kind));
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

function renderKindGrid() {
  if (!el.kindStrip) return;
  el.kindStrip.innerHTML = "";

  for (const k of KINDS) {
    const b = document.createElement("button");
    b.textContent = KIND_LABEL[k] || k;
    if (k === selectedKind) b.classList.add("sel");
    b.addEventListener("click", () => {
      selectedKind = k;
      renderKindGrid();
      renderStatusLine();
    });
    el.kindStrip.appendChild(b);
  }
}

let lastDone = new Set();
function renderStatusLine() {
  if (!el.statusLine) return;
  const label = makeRoomDeviceLabel(roomName, deviceIndex);
  const must = REQUIRED_KINDS.map(k => `${KIND_LABEL[k]}${lastDone.has(k) ? "✅" : "□"}`).join(" ");
  el.statusLine.textContent = `${label} / ${KIND_LABEL[selectedKind]} / ${must}`;
}

/** blur score (variance of Laplacian) */
function blurScoreFromImageData(imgData) {
  const data = imgData.data;
  const width = imgData.width;
  const height = imgData.height;

  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299*data[p] + 0.587*data[p+1] + 0.114*data[p+2];
  }

  let sum = 0;
  let sum2 = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = (g[i - width] + g[i - 1] + g[i + 1] + g[i + width]) - 4*g[i];
      sum += lap;
      sum2 += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  const variance = (sum2 / count) - mean * mean;
  return variance;
}

function getDownsampleImageData(srcCanvas, targetMax = 240) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const scale = Math.min(1, targetMax / Math.max(w, h));
  const tw = Math.max(64, Math.round(w * scale));
  const th = Math.max(64, Math.round(h * scale));

  const c = document.createElement("canvas");
  c.width = tw; c.height = th;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(srcCanvas, 0, 0, tw, th);
  return ctx.getImageData(0, 0, tw, th);
}

async function takeShot() {
  if (!deviceKey) return alert("機器が未選択です");
  if (!stream) return alert("カメラ起動に失敗しています");

  const v = el.video;
  const w = v.videoWidth || (use4k ? 3840 : 1280);
  const h = v.videoHeight || (use4k ? 2160 : 720);

  const c = el.canvas;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { alpha:false, willReadFrequently: true });
  ctx.drawImage(v, 0, 0, w, h);

  // ブレ判定（保存前に破棄）
  try {
    const small = getDownsampleImageData(c, 240);
    const score = blurScoreFromImageData(small);
    if (score < BLUR_THRESHOLD) {
      toast(`ブレ判定:破棄（${Math.round(score)}）`);
      return;
    }
  } catch (e) {
    console.warn("blur check failed", e);
  }

  const blob = await new Promise((resolve)=>c.toBlob(resolve,"image/jpeg",0.85));
  if (!blob) return alert("撮影失敗");

  const th = await makeThumbnail(blob);

  await db.shots.add({
    deviceKey,
    kind: selectedKind,
    createdAt: Date.now(),
    mime: blob.type,
    blob,
    thumbMime: th.thumb.type,
    thumbBlob: th.thumb,
    w, h, tw: th.w, th: th.h
  });

  // checked更新
  lastDone = await recomputeDone(deviceKey);
  const checked = REQUIRED_KINDS.every(k => lastDone.has(k));
  const dev = await db.devices.get(deviceKey);
  if (dev) await db.devices.put({ ...dev, checked, updatedAt: Date.now() });

  renderStatusLine();
  toast("保存しました");
}

async function init() {
  deviceKey = qparam("deviceKey");
  if (!deviceKey) {
    alert("deviceKeyがありません。");
    location.href = "./index.html";
    return;
  }

  const parts = String(deviceKey).split("::");
  roomName = normalizeRoomName(parts[0]);
  deviceIndex = Number(parts[1]);

  await upsertDeviceByKey(deviceKey);

  const label = makeRoomDeviceLabel(roomName, deviceIndex);
  if (el.camTitle) el.camTitle.textContent = `撮影 / ${label}`;

  el.btnBack?.addEventListener("click", async () => {
    await stopCamera();
    location.href = "./index.html";
  });

  el.closePreview?.addEventListener("click", closePreview);
  el.preview?.addEventListener("click", (e) => { if (e.target === el.preview) closePreview(); });
  el.zoomIn?.addEventListener("click", () => setModalZoom(modalZoom * 1.25));
  el.zoomOut?.addEventListener("click", () => setModalZoom(modalZoom / 1.25));
  el.zoomReset?.addEventListener("click", () => { modalZoom = 1; el.previewImg.style.transform = "scale(1)"; });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePreview();
  });

  el.zoom?.addEventListener("input", () => applyZoom(Number(el.zoom.value)));
  if (el.zoom) el.zoom.value = String(zoom);

  el.btnTorch?.addEventListener("click", async () => {
    torchOn = !torchOn;
    const ok = await applyTorch(torchOn);
    if (!ok) {
      torchOn = false;
      toast("ライト非対応");
    }
    if (el.btnTorch) el.btnTorch.textContent = torchOn ? "ライトON" : "ライト";
  });

  el.btnRes?.addEventListener("click", async () => {
    use4k = !use4k;
    if (el.btnRes) el.btnRes.textContent = use4k ? "3840×2160" : "1280×720";
    await restartCamera();
  });

  el.btnShutter?.addEventListener("click", takeShot);

  if (el.btnRes) el.btnRes.textContent = use4k ? "3840×2160" : "1280×720";

  renderKindGrid();

  lastDone = await recomputeDone(deviceKey);
  renderStatusLine();

  try {
    await startCamera();
  } catch (e) {
    console.error(e);
    alert("カメラ起動に失敗。権限/HTTPS/設定を確認してください。");
  }
}

init();
