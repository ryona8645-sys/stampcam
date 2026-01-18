import { openDb } from "./db.js";

const KIND_LIST = ["overview", "lamp", "port", "label", "ipaddress"];
const KIND_LABEL = {
  overview: "全景",
  lamp: "ランプ",
  port: "ポート",
  label: "ラベル",
  ipaddress: "IPアドレス"
};

const db = openDb();

const el = {
  camTitle: document.getElementById("camTitle"),
  storageWarn: document.getElementById("storageWarn"),

  btnBack: document.getElementById("btnBack"),
  btnDrawer: document.getElementById("btnDrawer"),

  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),

  btnShot: document.getElementById("btnShot"),
  btnTorch: document.getElementById("btnTorch"),
  btnRes: document.getElementById("btnRes"),
  kindSeg: document.getElementById("kindSeg"),
  zoom: document.getElementById("zoom"),
  zoomVal: document.getElementById("zoomVal"),

  drawer: document.getElementById("drawer"),
  drawerClose: document.getElementById("drawerClose"),
  lastShotBox: document.getElementById("lastShotBox"),
  shotThumbs: document.getElementById("shotThumbs"),

  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
};

let stream = null;
let track = null;
let activeDeviceNo = "";
let activeKind = "overview";

let torchOn = false;
let useHighRes = true;
let supportsTorch = false;
let supportsZoom = false;

let previewUrl = null;
let previewZoom = 1;

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); } catch {}
}

async function getMeta(key, fallback = "") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value) {
  await db.meta.put({ key, value: String(value ?? "") });
}

async function makeThumbnail(blob, maxSide = 320, quality = 0.7) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { alpha: false });
  ctx.drawImage(bmp, 0, 0, w, h);

  const thumb = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", quality));
  bmp.close?.();
  if (!thumb) throw new Error("thumb gen failed");
  return { thumb, w, h };
}

async function checkStorage() {
  if (!el.storageWarn) return;
  if (!navigator.storage?.estimate) {
    el.storageWarn.textContent = "容量:取得不可";
    return;
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) {
      el.storageWarn.textContent = "容量:不明";
      return;
    }
    const ratio = usage / quota;
    const usedMB = Math.round(usage / (1024 * 1024));
    const quotaMB = Math.round(quota / (1024 * 1024));
    if (ratio >= 0.92) el.storageWarn.textContent = `容量:危険 ${usedMB}/${quotaMB}MB`;
    else if (ratio >= 0.85) el.storageWarn.textContent = `容量:警告 ${usedMB}/${quotaMB}MB`;
    else el.storageWarn.textContent = `容量:${usedMB}/${quotaMB}MB`;
  } catch {
    el.storageWarn.textContent = "容量:エラー";
  }
}

function buildKindButtons() {
  el.kindSeg.innerHTML = "";
  for (const k of KIND_LIST) {
    const b = document.createElement("button");
    b.textContent = KIND_LABEL[k];
    if (k === activeKind) b.classList.add("active");
    b.addEventListener("click", () => {
      activeKind = k;
      [...el.kindSeg.querySelectorAll("button")].forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
    el.kindSeg.appendChild(b);
  }
}

async function startCamera() {
  await stopCamera();

  const constraints = useHighRes
    ? { video: { facingMode: "environment", width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false }
    : { video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  el.video.srcObject = stream;
  await el.video.play();

  track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  supportsTorch = !!caps.torch;
  supportsZoom = (caps.zoom !== undefined);

  el.btnTorch.disabled = !supportsTorch;

  if (supportsZoom) {
    const minZ = caps.zoom.min ?? 1;
    const maxZ = caps.zoom.max ?? 1;
    el.zoom.min = String(minZ);
    el.zoom.max = String(maxZ);
    el.zoom.step = String(caps.zoom.step ?? 0.1);
    const init = Math.max(minZ, 1);
    el.zoom.value = String(init);
    el.zoomVal.textContent = `${Number(init).toFixed(1)}x`;
    await applyZoom(init);
  } else {
    el.zoom.value = "1";
    el.zoomVal.textContent = "1.0x";
  }

  await applyTorch(false);
}

async function stopCamera() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  track = null;
}

async function applyTorch(on) {
  torchOn = on;
  if (!track || !supportsTorch) return;
  try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch {}
}

async function applyZoom(z) {
  if (!track || !supportsZoom) return;
  try { await track.applyConstraints({ advanced: [{ zoom: z }] }); } catch {}
}

async function toggleRes() {
  useHighRes = !useHighRes;
  el.btnRes.textContent = useHighRes ? "3840×2160" : "1280×720";
  await startCamera();
}

async function toggleTorch() {
  await applyTorch(!torchOn);
  el.btnTorch.textContent = torchOn ? "ライトON" : "ライト";
}

function openPreview(title, blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  previewZoom = 1;
  el.previewImg.style.transform = `scale(${previewZoom})`;
  el.previewImg.src = previewUrl;
  el.previewTitle.textContent = title;
  el.preview.classList.remove("hidden");
}

function closePreview() {
  el.preview.classList.add("hidden");
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

function setPreviewZoom(next) {
  previewZoom = Math.max(0.25, Math.min(6, next));
  el.previewImg.style.transform = `scale(${previewZoom})`;
}

async function takeShot() {
  if (!activeDeviceNo) return alert("機器Noが未選択です");
  if (!stream) return alert("カメラが起動していません");

  const v = el.video;
  const w = v.videoWidth || 1280;
  const h = v.videoHeight || 720;

  const c = el.canvas;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { alpha: false });
  ctx.drawImage(v, 0, 0, w, h);

  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) return alert("撮影失敗");

  const { thumb, w: tw, h: th } = await makeThumbnail(blob);

  const shotId = await db.shots.add({
    deviceNo: activeDeviceNo,
    kind: activeKind,
    createdAt: Date.now(),
    mime: blob.type,
    blob,
    thumbMime: thumb.type,
    thumbBlob: thumb,
    w, h, tw, th
  });

  await setMeta("lastShotId", String(shotId));
  await renderDrawer();
  await checkStorage();
}

async function updateTitle() {
  const dev = await db.devices.where("deviceNo").equals(activeDeviceNo).first();
  const room = dev?.roomName ? ` / ${dev.roomName}` : "";
  el.camTitle.textContent = `撮影 ${activeDeviceNo}${room}`;
}

async function renderDrawer() {
  const lastId = await getMeta("lastShotId", "");
  el.lastShotBox.innerHTML = "";

  if (lastId) {
    const s = await db.shots.get(Number(lastId));
    if (s && s.deviceNo === activeDeviceNo) {
      const url = URL.createObjectURL(s.blob);
      const box = document.createElement("div");
      box.innerHTML = `
        <div style="margin-bottom:8px;opacity:.9;font-size:12px">${KIND_LABEL[s.kind]} / ${new Date(s.createdAt).toLocaleString()}</div>
        <img src="${url}" alt="">
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button id="btnOpenLast">フル表示</button>
        </div>
      `;
      box.querySelector("#btnOpenLast").addEventListener("click", () => {
        openPreview(`${activeDeviceNo} / ${KIND_LABEL[s.kind]} / ${new Date(s.createdAt).toLocaleString()}`, s.blob);
      });
      el.lastShotBox.appendChild(box);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } else {
      el.lastShotBox.textContent = "直前の写真はありません";
    }
  } else {
    el.lastShotBox.textContent = "直前の写真はありません";
  }

  const shots = await db.shots.where("deviceNo").equals(activeDeviceNo).toArray();
  shots.sort((a,b)=>b.createdAt-a.createdAt);

  el.shotThumbs.innerHTML = "";
  for (const s of shots) {
    const tblob = s.thumbBlob || s.blob;
    const url = URL.createObjectURL(tblob);
    const d = document.createElement("div");
    d.className = "thumb";
    d.innerHTML = `
      <img src="${url}" alt="">
      <div class="cap">
        <span>${KIND_LABEL[s.kind]}</span>
        <button data-open="${s.id}">表示</button>
      </div>
    `;
    d.querySelector("button").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const shot = await db.shots.get(s.id);
      if (!shot) return;
      openPreview(`${activeDeviceNo} / ${KIND_LABEL[shot.kind]} / ${new Date(shot.createdAt).toLocaleString()}`, shot.blob);
    });
    el.shotThumbs.appendChild(d);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

function openDrawer() { el.drawer.classList.remove("hidden"); }
function closeDrawer() { el.drawer.classList.add("hidden"); }

async function init() {
  await registerSw();

  activeDeviceNo = String(await getMeta("activeDeviceNo", "")) || "";
  if (!activeDeviceNo) { location.href = "./index.html"; return; }

  buildKindButtons();
  await startCamera();
  await updateTitle();
  await renderDrawer();
  await checkStorage();

  el.btnBack.addEventListener("click", async () => {
    await stopCamera();
    location.href = "./index.html";
  });

  el.btnDrawer.addEventListener("click", () => {
    if (el.drawer.classList.contains("hidden")) openDrawer();
    else closeDrawer();
  });
  el.drawerClose.addEventListener("click", closeDrawer);

  el.btnShot.addEventListener("click", takeShot);
  el.btnRes.addEventListener("click", toggleRes);
  el.btnTorch.addEventListener("click", toggleTorch);

  el.zoom.addEventListener("input", async () => {
    const z = Number(el.zoom.value);
    el.zoomVal.textContent = `${z.toFixed(1)}x`;
    await applyZoom(z);
  });

  // preview controls
  el.closePreview.addEventListener("click", closePreview);
  el.preview.addEventListener("click", (e) => { if (e.target === el.preview) closePreview(); });
  el.zoomIn.addEventListener("click", () => setPreviewZoom(previewZoom * 1.25));
  el.zoomOut.addEventListener("click", () => setPreviewZoom(previewZoom / 1.25));
  el.zoomReset.addEventListener("click", () => setPreviewZoom(1));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePreview(); });

  // prevent freeze on task switching
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) { await stopCamera(); }
    else {
      if (!stream) {
        try { await startCamera(); } catch {}
      }
    }
  });
}

init();
