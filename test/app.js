import { openDb } from "./db.js";

const REQUIRED_KINDS = ["overview", "lamp", "port", "label"];
const KIND_LABEL = {
  overview: "全景",
  lamp: "ランプ",
  port: "ポート",
  label: "ラベル"
};

const db = openDb();

const el = {
  deviceNo: document.getElementById("deviceNo"),
  deviceType: document.getElementById("deviceType"),
  btnAdd: document.getElementById("btnAdd"),
  deviceList: document.getElementById("deviceList"),
  onlyIncomplete: document.getElementById("onlyIncomplete"),

  kind: document.getElementById("kind"),
  activeDevice: document.getElementById("activeDevice"),
  btnStart: document.getElementById("btnStart"),
  btnShot: document.getElementById("btnShot"),
  btnStop: document.getElementById("btnStop"),

  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),
  shots: document.getElementById("shots"),
  shotMeta: document.getElementById("shotMeta"),

  btnExport: document.getElementById("btnExport"),
  btnWipe: document.getElementById("btnWipe"),

  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
};

let stream = null;

let previewUrl = null;
let zoom = 1;

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (e) {
    console.warn("SW register failed:", e);
  }
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

function openPreview(title, blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);

  zoom = 1;
  el.previewImg.style.transform = `scale(${zoom})`;
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

function setZoom(next) {
  zoom = Math.max(0.25, Math.min(6, next));
  el.previewImg.style.transform = `scale(${zoom})`;
}

function nowIsoSafe() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function sanitizeFile(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, "_");
}

async function upsertDevice(deviceNo, deviceType) {
  const existing = await db.devices.where("deviceNo").equals(deviceNo).first();
  const updatedAt = Date.now();
  if (existing) {
    await db.devices.update(existing.id, { deviceType, updatedAt });
    return existing.id;
  }
  return await db.devices.add({
    deviceNo,
    deviceType: deviceType || "",
    checked: false,
    updatedAt
  });
}

async function setActiveDevice(deviceNo) {
  await db.meta.put({ key: "activeDeviceNo", value: deviceNo });
  await render();
}

async function getActiveDeviceNo() {
  const v = await db.meta.get("activeDeviceNo");
  return v?.value || "";
}

async function computeDoneKinds(deviceNo) {
  const shots = await db.shots.where("deviceNo").equals(deviceNo).toArray();
  const done = new Set(shots.map(s => s.kind));
  return done;
}

async function recomputeChecked(deviceNo) {
  const done = await computeDoneKinds(deviceNo);
  const ok = REQUIRED_KINDS.every(k => done.has(k));
  const dev = await db.devices.where("deviceNo").equals(deviceNo).first();
  if (dev) await db.devices.update(dev.id, { checked: ok, updatedAt: Date.now() });
  return ok;
}

async function addDeviceFromUi() {
  const deviceNo = el.deviceNo.value.trim();
  if (!deviceNo) return alert("機器Noが空です");
  await upsertDevice(deviceNo, el.deviceType.value.trim());
  el.deviceNo.value = "";
  el.deviceType.value = "";
  await setActiveDevice(deviceNo);
}

async function toggleOnlyIncomplete() {
  await db.meta.put({ key: "onlyIncomplete", value: el.onlyIncomplete.checked ? "1" : "0" });
  await render();
}

async function loadOnlyIncomplete() {
  const v = await db.meta.get("onlyIncomplete");
  return v?.value === "1";
}

async function startCamera() {
  if (stream) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });
    el.video.srcObject = stream;
    await el.video.play();
  } catch (e) {
    console.error(e);
    alert("カメラ開始に失敗。権限/HTTPS/ブラウザ設定を確認してください。");
  }
}

async function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  el.video.srcObject = null;
}

async function takeShot() {
  const deviceNo = el.activeDevice.value;
  const kind = el.kind.value;
  if (!deviceNo) return alert("機器を選択してください");
  if (!stream) return alert("先にカメラ開始してください");

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
    deviceNo,
    kind,
    createdAt: Date.now(),
    mime: blob.type,
    blob,
    thumbMime: thumb.type,
    thumbBlob: thumb,
    w, h,
    tw, th
  });

  await db.meta.put({ key: "lastShotId", value: String(shotId) });

  await recomputeChecked(deviceNo);
  await setActiveDevice(deviceNo);
}

async function deleteShot(id) {
  const shot = await db.shots.get(id);
  if (!shot) return;
  await db.shots.delete(id);
  await recomputeChecked(shot.deviceNo);
  await render();
}

async function renderDeviceList(devices) {
  el.deviceList.innerHTML = "";
  for (const d of devices) {
    const done = await computeDoneKinds(d.deviceNo);
    const badges = REQUIRED_KINDS.map(k => {
      const ok = done.has(k);
      return `<span class="badge ${ok ? "ok" : ""}">${KIND_LABEL[k]}</span>`;
    }).join("");

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <div><b>${d.deviceNo}</b> <span style="opacity:.8">${d.deviceType || ""}</span></div>
        <div style="opacity:.7;font-size:12px">更新: ${new Date(d.updatedAt).toLocaleString()}</div>
      </div>
      <div class="badges">${badges}</div>
    `;
    item.addEventListener("click", () => setActiveDevice(d.deviceNo));
    el.deviceList.appendChild(item);
  }
}

async function renderActiveDeviceSelect(devices, activeNo) {
  el.activeDevice.innerHTML = `<option value="">-- 機器選択 --</option>`;
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = d.deviceNo;
    opt.textContent = `${d.deviceNo}${d.deviceType ? " / " + d.deviceType : ""}`;
    if (d.deviceNo === activeNo) opt.selected = true;
    el.activeDevice.appendChild(opt);
  }
}

async function renderShots(deviceNo) {
  el.shots.innerHTML = "";
  if (!deviceNo) {
    el.shotMeta.textContent = "";
    return;
  }

  const lastShotId = (await db.meta.get("lastShotId"))?.value || "";
  const shots = await db.shots.where("deviceNo").equals(deviceNo).toArray();
  shots.sort((a,b) => b.createdAt - a.createdAt);

  const doneKinds = await computeDoneKinds(deviceNo);
  el.shotMeta.textContent =
    `必須: ${REQUIRED_KINDS.map(k => `${KIND_LABEL[k]}${doneKinds.has(k) ? "✅" : "□"}`).join(" / ")}`
    + ` / 枚数: ${shots.length}`;

  for (const s of shots) {
    const isLast = String(s.id) === String(lastShotId);

    const showBlob = isLast ? s.blob : (s.thumbBlob || s.blob);
    const url = URL.createObjectURL(showBlob);

    const div = document.createElement("div");
    div.className = "shot";
    div.innerHTML = `
      <img src="${url}" alt="">
      <div class="cap">
        <span>${KIND_LABEL[s.kind]}${isLast ? "（直前）" : ""}</span>
        <div style="display:flex; gap:6px;">
          <button data-open="${s.id}">プレビュー</button>
          <button data-del="${s.id}" class="danger">削除</button>
        </div>
      </div>
    `;

    div.querySelector(`[data-open="${s.id}"]`).addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const shot = await db.shots.get(s.id);
      if (!shot) return;
      const last = String(shot.id) === String(lastShotId);
      const b = last ? shot.blob : (shot.thumbBlob || shot.blob);
      openPreview(`${shot.deviceNo} / ${KIND_LABEL[shot.kind]} / ${new Date(shot.createdAt).toLocaleString()}`, b);
    });

    div.querySelector(`[data-del="${s.id}"]`).addEventListener("click", async (ev) => {
      ev.stopPropagation();
      URL.revokeObjectURL(url);
      await deleteShot(s.id);

      if (isLast) {
        const left = await db.shots.where("deviceNo").equals(deviceNo).toArray();
        left.sort((a,b)=>b.createdAt-a.createdAt);
        await db.meta.put({ key: "lastShotId", value: left[0] ? String(left[0].id) : "" });
      }
      await render();
    });

    el.shots.appendChild(div);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

async function exportZip() {
  const ts = nowIsoSafe();
  const zipName = `stampcam_${ts}.zip`;

  const devices = await db.devices.orderBy("deviceNo").toArray();
  const shots = await db.shots.toArray();

  const devicesCsv = [
    "deviceNo,deviceType,checked,updatedAt",
    ...devices.map(d => [
      d.deviceNo,
      csvEscape(d.deviceType || ""),
      d.checked ? "1" : "0",
      new Date(d.updatedAt).toISOString()
    ].join(","))
  ].join("\n");

  const progressCsv = [
    "deviceNo,overview,lamp,port,label,checked",
    ...(await Promise.all(devices.map(async d => {
      const done = await computeDoneKinds(d.deviceNo);
      return [
        d.deviceNo,
        done.has("overview") ? "1" : "0",
        done.has("lamp") ? "1" : "0",
        done.has("port") ? "1" : "0",
        done.has("label") ? "1" : "0",
        d.checked ? "1" : "0"
      ].join(",");
    })))
  ].join("\n");

  const { zipSync, strToU8 } = window.fflate;

  const files = {};
  files["devices.csv"] = strToU8(devicesCsv);
  files["progress.csv"] = strToU8(progressCsv);

  for (const s of shots) {
    const fname = `photos/${sanitizeFile(s.deviceNo)}/${s.kind}_${new Date(s.createdAt).toISOString().replace(/[:.]/g, "-")}.jpg`;
    const buf = new Uint8Array(await s.blob.arrayBuffer());
    files[fname] = buf;
  }

  const zipped = zipSync(files, { level: 6 });
  const blob = new Blob([zipped], { type: "application/zip" });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

function csvEscape(s) {
  const t = String(s);
  if (/[,"\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function wipeAll() {
  const ok = confirm("端末内データ（機器・写真・進捗）を全削除します。よろしいですか？");
  if (!ok) return;
  await db.devices.clear();
  await db.shots.clear();
  await db.meta.clear();
  await render();
}

async function checkStorage() {
  const out = document.getElementById("storageWarn");
  if (!out) return;

  if (!navigator.storage?.estimate) {
    out.textContent = "容量:取得不可";
    return;
  }

  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!usage || !quota) {
      out.textContent = "容量:不明";
      return;
    }

    const ratio = usage / quota;
    const usedMB = Math.round(usage / (1024 * 1024));
    const quotaMB = Math.round(quota / (1024 * 1024));

    if (ratio >= 0.92) {
      out.textContent = `容量:危険 ${usedMB}/${quotaMB}MB（ZIP出力して削除推奨）`;
    } else if (ratio >= 0.85) {
      out.textContent = `容量:警告 ${usedMB}/${quotaMB}MB`;
    } else {
      out.textContent = `容量:${usedMB}/${quotaMB}MB`;
    }
  } catch {
    out.textContent = "容量:エラー";
  }
}

async function render() {
  const onlyInc = await loadOnlyIncomplete();
  el.onlyIncomplete.checked = onlyInc;

  let devices = await db.devices.orderBy("deviceNo").toArray();
  if (onlyInc) devices = devices.filter(d => !d.checked);

  const activeNo = await getActiveDeviceNo();
  const allDevices = devices.length ? devices : await db.devices.orderBy("deviceNo").toArray();
  await renderActiveDeviceSelect(allDevices, activeNo);

  el.activeDevice.value = activeNo || "";

  await renderDeviceList(devices);
  await renderShots(activeNo);
  await checkStorage();
}

async function init() {
  await registerSw();

  el.btnAdd.addEventListener("click", addDeviceFromUi);
  el.onlyIncomplete.addEventListener("change", toggleOnlyIncomplete);
  el.activeDevice.addEventListener("change", (e) => setActiveDevice(e.target.value));

  el.btnStart.addEventListener("click", startCamera);
  el.btnStop.addEventListener("click", stopCamera);
  el.btnShot.addEventListener("click", takeShot);

  el.btnExport.addEventListener("click", exportZip);
  el.btnWipe.addEventListener("click", wipeAll);

  // preview controls
  el.closePreview.addEventListener("click", closePreview);
  el.preview.addEventListener("click", (e) => {
    if (e.target === el.preview) closePreview();
  });
  el.zoomIn.addEventListener("click", () => setZoom(zoom * 1.25));
  el.zoomOut.addEventListener("click", () => setZoom(zoom / 1.25));
  el.zoomReset.addEventListener("click", () => setZoom(1));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePreview();
  });

  await render();
}

init();
