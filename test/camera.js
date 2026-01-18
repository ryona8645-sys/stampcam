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

const el = {
  camTitle: document.getElementById("camTitle"),
  btnBack: document.getElementById("btnBack"),
  btnDrawer: document.getElementById("btnDrawer"),

  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),

  btnShot: document.getElementById("btnShot"),
  btnTorch: document.getElementById("btnTorch"),
  btnRes: document.getElementById("btnRes"),

  zoom: document.getElementById("zoom"),
  zoomVal: document.getElementById("zoomVal"),

  kindRow: document.getElementById("kindRow"),

  shots: document.getElementById("shots"),
  shotMeta: document.getElementById("shotMeta"),

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

let deviceNo = "";
let stream = null;
let track = null;
let torchOn = false;
let use4k = true;
let zoom = 1;

let previewUrl = null;
let modalZoom = 1;

function qparam(name) {
  const url = new URL(location.href);
  return url.searchParams.get(name) || "";
}

async function getMeta(key, fallback = "") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}

async function getProjectName() { return await getMeta("projectName",""); }
async function getFloorName() { return await getMeta("floorName",""); }

async function upsertDevice(no) {
  const existing = await db.devices.where("deviceNo").equals(no).first();
  const updatedAt = Date.now();
  const roomName = (await getFloorName()).trim();
  if (existing) {
    await db.devices.update(existing.id, { updatedAt, roomName });
    return existing.id;
  }
  return await db.devices.add({
    deviceNo: no,
    deviceType: "",
    roomName,
    checked: false,
    updatedAt
  });
}

async function computeDoneKinds(no) {
  const shots = await db.shots.where("deviceNo").equals(no).toArray();
  return new Set(shots.map(s=>s.kind));
}

async function recomputeChecked(no) {
  const done = await computeDoneKinds(no);
  const ok = REQUIRED_KINDS.every(k=>done.has(k));
  const dev = await db.devices.where("deviceNo").equals(no).first();
  if (dev) await db.devices.update(dev.id, { checked: ok, updatedAt: Date.now() });
  return ok;
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
  el.zoomVal.textContent = `${zoom.toFixed(1)}x`;

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

function openPreview(title, blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);

  modalZoom = 1;
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

async function takeShot(kind) {
  if (!deviceNo) return alert("機器Noがありません");
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
    deviceNo,
    kind,
    createdAt: Date.now(),
    mime: blob.type,
    blob,
    thumbMime: thumb.type,
    thumbBlob: thumb,
    w, h, tw, th
  });

  await db.meta.put({ key: "lastShotId", value: String(shotId) });

  await recomputeChecked(deviceNo);

  await renderShots();
  await renderDrawer();
}

async function renderShots() {
  el.shots.innerHTML = "";
  const shots = await db.shots.where("deviceNo").equals(deviceNo).toArray();
  shots.sort((a,b)=>b.createdAt-a.createdAt);

  const done = await computeDoneKinds(deviceNo);
  const must = REQUIRED_KINDS.map(k=>`${KIND_LABEL[k]}${done.has(k) ? "✅" : "□"}`).join(" / ");
  el.shotMeta.textContent = `${must} / 枚数: ${shots.length}`;

  for (const s of shots) {
    const url = URL.createObjectURL(s.thumbBlob || s.blob);
    const div = document.createElement("div");
    div.className = "shot";
    div.innerHTML = `
      <img src="${url}" alt="">
      <div class="cap">
        <span>${KIND_LABEL[s.kind]}</span>
        <div style="display:flex; gap:6px;">
          <button data-open="${s.id}">確認</button>
          <button data-del="${s.id}" class="danger">削除</button>
        </div>
      </div>
    `;

    div.querySelector(`[data-open="${s.id}"]`).addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const shot = await db.shots.get(s.id);
      if (!shot) return;
      openPreview(`${deviceNo} / ${KIND_LABEL[shot.kind]} / ${new Date(shot.createdAt).toLocaleString()}`, shot.blob);
    });

    div.querySelector(`[data-del="${s.id}"]`).addEventListener("click", async (ev) => {
      ev.stopPropagation();
      URL.revokeObjectURL(url);
      const shot = await db.shots.get(s.id);
      if (!shot) return;
      await db.shots.delete(s.id);
      await recomputeChecked(deviceNo);

      const lastId = (await db.meta.get("lastShotId"))?.value || "";
      if (String(lastId) === String(s.id)) {
        const left = await db.shots.where("deviceNo").equals(deviceNo).toArray();
        left.sort((a,b)=>b.createdAt-a.createdAt);
        await db.meta.put({ key:"lastShotId", value: left[0] ? String(left[0].id) : "" });
      }

      await renderShots();
      await renderDrawer();
    });

    el.shots.appendChild(div);
    setTimeout(()=>URL.revokeObjectURL(url), 30_000);
  }
}

async function renderDrawer() {
  const lastId = (await db.meta.get("lastShotId"))?.value || "";
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
  el.lastInfo.textContent = `${deviceNo} / ${KIND_LABEL[shot.kind]} / ${new Date(shot.createdAt).toLocaleString()}`;

  const url = URL.createObjectURL(shot.thumbBlob || shot.blob);
  el.lastImg.src = url;
  setTimeout(()=>URL.revokeObjectURL(url), 30_000);

  el.btnOpenLast.onclick = () => openPreview(el.lastInfo.textContent, shot.blob);
}

function openDrawer() { el.drawer.classList.remove("hidden"); }
function closeDrawer() { el.drawer.classList.add("hidden"); }

function buildKindButtons() {
  el.kindRow.innerHTML = "";
  for (const k of KINDS) {
    const b = document.createElement("button");
    b.textContent = KIND_LABEL[k] || k;
    b.addEventListener("click", () => takeShot(k));
    el.kindRow.appendChild(b);
  }
}

async function init() {
  deviceNo = qparam("deviceNo");
  if (!deviceNo) {
    alert("deviceNoがありません。");
    location.href = "./index.html";
    return;
  }

  await upsertDevice(deviceNo);

  const pj = (await getProjectName()).trim();
  const fl = (await getFloorName()).trim();
  el.camTitle.textContent = `撮影 ${deviceNo}  ${pj ? "["+pj+"]" : ""}${fl ? "["+fl+"]" : ""}`;

  buildKindButtons();

  el.btnBack.addEventListener("click", async () => {
    await stopCamera();
    location.href = "./index.html";
  });

  el.btnDrawer.addEventListener("click", () => openDrawer());
  el.btnCloseDrawer.addEventListener("click", () => closeDrawer());

  el.closePreview.addEventListener("click", closePreview);
  el.preview.addEventListener("click", (e) => { if (e.target === el.preview) closePreview(); });
  el.zoomIn.addEventListener("click", () => setModalZoom(modalZoom * 1.25));
  el.zoomOut.addEventListener("click", () => setModalZoom(modalZoom / 1.25));
  el.zoomReset.addEventListener("click", () => setModalZoom(1));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePreview(); closeDrawer(); } });

  el.zoom.addEventListener("input", () => applyZoom(Number(el.zoom.value)));
  el.zoom.value = String(zoom);

  el.btnTorch.addEventListener("click", async () => {
    torchOn = !torchOn;
    const ok = await applyTorch(torchOn);
    if (!ok) {
      torchOn = false;
      alert("この端末/ブラウザではライト制御に対応していません。");
    }
    el.btnTorch.textContent = torchOn ? "ライトON" : "ライト";
  });

  el.btnRes.addEventListener("click", async () => {
    use4k = !use4k;
    el.btnRes.textContent = use4k ? "解像度 3840×2160" : "解像度 1280×720";
    await restartCamera();
  });

  // 「撮影」ボタンはoverviewで撮影（種別ボタンも別途あり）
  el.btnShot.addEventListener("click", () => takeShot("overview"));

  try {
    await startCamera();
  } catch (e) {
    console.error(e);
    alert("カメラ起動に失敗。権限/HTTPS/設定を確認してください。");
  }

  await renderShots();
  await renderDrawer();
}

init();
