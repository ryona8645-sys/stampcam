import { openDb } from "./db.js";

const REQUIRED_KINDS = ["overview", "lamp", "port", "label"]; // 必須
const KINDS = ["overview", "lamp", "port", "label", "ipaddress"]; // 選択肢（ipaddressは任意）
const KIND_LABEL = {
  overview: "全景",
  lamp: "ランプ",
  port: "ポート",
  label: "ラベル",
  ipaddress: "IPアドレス"
};

const db = openDb();

const el = {
  // project / room
  projectName: document.getElementById("projectName"),
  floorName: document.getElementById("floorName"), // ここでは「部屋名」として扱う
  roomOrder: document.getElementById("roomOrder"),
  startSerial: document.getElementById("startSerial"),
  btnAssignSerial: document.getElementById("btnAssignSerial"),

  // device pad + add
  devicePad: document.getElementById("devicePad"),
  deviceNo: document.getElementById("deviceNo"),
  deviceType: document.getElementById("deviceType"),
  btnAdd: document.getElementById("btnAdd"),

  // list
  deviceList: document.getElementById("deviceList"),
  onlyIncomplete: document.getElementById("onlyIncomplete"),

  // camera
  kind: document.getElementById("kind"),
  activeDevice: document.getElementById("activeDevice"),
  btnStart: document.getElementById("btnStart"),
  btnShot: document.getElementById("btnShot"),
  btnStop: document.getElementById("btnStop"),
  video: document.getElementById("video"),
  canvas: document.getElementById("canvas"),

  // shots
  shots: document.getElementById("shots"),
  shotMeta: document.getElementById("shotMeta"),

  // export / wipe
  btnExport: document.getElementById("btnExport"),
  btnWipe: document.getElementById("btnWipe"),

  // preview
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

async function getMeta(key, fallback = "") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value) {
  await db.meta.put({ key, value: String(value ?? "") });
}
async function getProjectName() {
  return await getMeta("projectName", "");
}
async function getRoomName() {
  return await getMeta("roomName", "");
}
async function getRoomOrderText() {
  return await getMeta("roomOrder", "");
}
async function getStartSerial() {
  const v = await getMeta("startSerial", "1");
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sanitizeFile(s) {
  return String(s ?? "").replace(/[\\/:*?"<>|]/g, "_");
}

function nowIsoSafe() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function pad2(n) { return String(n).padStart(2, "0"); }
function shotTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}

// ---- thumbnail / preview ----
async function makeThumbnail(blob, maxSide = 320, quality = 0.7) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
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

// ---- camera ----
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

// ---- device model ----
async function getActiveDeviceId() {
  const v = await db.meta.get("activeDeviceId");
  return v?.value ? parseInt(v.value, 10) : null;
}
async function setActiveDeviceId(deviceId) {
  await db.meta.put({ key: "activeDeviceId", value: String(deviceId ?? "") });

  // 要件: 機器Noを選択したら撮影機能起動（=カメラ開始）
  if (deviceId) await startCamera();

  await render();
}

function deviceLabel(d) {
  const room = d.roomName || "";
  const no = d.localNo ?? "";
  return `${room} 機器${no}`;
}

async function upsertDevice(roomName, localNo, deviceType) {
  const existing = await db.devices.where("[roomName+localNo]").equals([roomName, localNo]).first();
  const updatedAt = Date.now();
  if (existing) {
    await db.devices.update(existing.id, { deviceType: deviceType || "", updatedAt });
    return existing.id;
  }
  return await db.devices.add({
    roomName,
    localNo,
    deviceType: deviceType || "",
    serialNo: null,
    checked: false,
    updatedAt
  });
}

async function computeDoneKinds(deviceId) {
  const shots = await db.shots.where("deviceId").equals(deviceId).toArray();
  return new Set(shots.map(s => s.kind));
}

async function recomputeChecked(deviceId) {
  const done = await computeDoneKinds(deviceId);
  const ok = REQUIRED_KINDS.every(k => done.has(k));
  await db.devices.update(deviceId, { checked: ok, updatedAt: Date.now() });
  return ok;
}

// ---- UI: device pad ----
function buildDevicePad() {
  if (!el.devicePad) return;
  el.devicePad.innerHTML = "";
  for (let i = 1; i <= 199; i++) {
    const b = document.createElement("button");
    b.textContent = String(i);
    b.addEventListener("click", async () => {
      const room = (el.floorName?.value || "").trim();
      if (!room) return alert("部屋名を入力してください（部屋ごとに機器番号を振ります）");

      await setMeta("roomName", room);
      if (el.deviceNo) el.deviceNo.value = String(i);

      const deviceId = await upsertDevice(room, i, (el.deviceType?.value || "").trim());
      await setActiveDeviceId(deviceId);
    });
    el.devicePad.appendChild(b);
  }
}

// ---- capture ----
async function takeShot() {
  const deviceId = await getActiveDeviceId();
  if (!deviceId) return alert("機器Noを選択してください");
  if (!stream) return alert("カメラが開始できていません");

  const kind = el.kind.value;
  const v = el.video;
  const w = v.videoWidth || 1280;
  const h = v.videoHeight || 720;

  const c = el.canvas;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { alpha: false });
  ctx.drawImage(v, 0, 0, w, h);

  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) return alert("撮影失敗");

  const { thumb, w: tw, h: th } = await makeThumbnail(blob);

  const shotId = await db.shots.add({
    deviceId,
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
  await recomputeChecked(deviceId);
  await render();
}

async function deleteShot(id) {
  const shot = await db.shots.get(id);
  if (!shot) return;
  await db.shots.delete(id);
  await recomputeChecked(shot.deviceId);
  await render();
}

// ---- rendering ----
async function loadOnlyIncomplete() {
  const v = await db.meta.get("onlyIncomplete");
  return v?.value === "1";
}
async function toggleOnlyIncomplete() {
  await db.meta.put({ key: "onlyIncomplete", value: el.onlyIncomplete.checked ? "1" : "0" });
  await render();
}

async function renderDeviceList(devices) {
  el.deviceList.innerHTML = "";
  for (const d of devices) {
    const done = await computeDoneKinds(d.id);
    const badges = REQUIRED_KINDS.map(k => {
      const ok = done.has(k);
      return `<span class="badge ${ok ? "ok" : ""}">${KIND_LABEL[k]}</span>`;
    }).join("");

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <div><b>${deviceLabel(d)}</b> <span style="opacity:.8">${d.deviceType || ""}</span></div>
        <div style="opacity:.7;font-size:12px">更新: ${new Date(d.updatedAt).toLocaleString()}</div>
      </div>
      <div class="badges">${badges}</div>
    `;
    item.addEventListener("click", () => setActiveDeviceId(d.id));
    el.deviceList.appendChild(item);
  }
}

async function renderActiveDeviceSelect(devices, activeId) {
  el.activeDevice.innerHTML = `<option value="">-- 機器選択 --</option>`;
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = String(d.id);
    opt.textContent = deviceLabel(d);
    if (d.id === activeId) opt.selected = true;
    el.activeDevice.appendChild(opt);
  }
}

async function renderShots(activeDeviceId) {
  el.shots.innerHTML = "";
  if (!activeDeviceId) {
    el.shotMeta.textContent = "";
    return;
  }

  const dev = await db.devices.get(activeDeviceId);
  const shots = await db.shots.where("deviceId").equals(activeDeviceId).toArray();
  shots.sort((a,b) => b.createdAt - a.createdAt);

  const doneKinds = await computeDoneKinds(activeDeviceId);
  el.shotMeta.textContent =
    `${deviceLabel(dev)} / 必須: ${REQUIRED_KINDS.map(k => `${KIND_LABEL[k]}${doneKinds.has(k) ? "✅" : "□"}`).join(" / ")} / 枚数: ${shots.length}`;

  for (const s of shots) {
    const thumb = s.thumbBlob || s.blob;
    const url = URL.createObjectURL(thumb);

    const div = document.createElement("div");
    div.className = "shot";
    div.innerHTML = `
      <img src="${url}" alt="">
      <div class="cap">
        <span>${KIND_LABEL[s.kind]} / ${new Date(s.createdAt).toLocaleString()}</span>
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
      const title = `${deviceLabel(dev)} / ${KIND_LABEL[shot.kind]} / ${new Date(shot.createdAt).toLocaleString()}`;
      openPreview(title, shot.blob);
    });

    div.querySelector(`[data-del="${s.id}"]`).addEventListener("click", async (ev) => {
      ev.stopPropagation();
      URL.revokeObjectURL(url);
      await deleteShot(s.id);
      await render();
    });

    el.shots.appendChild(div);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

// ---- storage warning ----
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

// ---- serial assignment (CSV only) ----
async function assignSerialNumbers() {
  const start = parseInt(el.startSerial?.value || "1", 10);
  const startSerial = Number.isFinite(start) && start > 0 ? start : await getStartSerial();

  const orderText = (el.roomOrder?.value || "").trim();
  await setMeta("roomOrder", orderText);
  await setMeta("startSerial", String(startSerial));

  const orderLines = orderText.split("\n").map(s => s.trim()).filter(Boolean);
  const orderMap = new Map();
  orderLines.forEach((name, idx) => orderMap.set(name, idx));

  const devices = await db.devices.toArray();
  devices.sort((a, b) => {
    const oa = orderMap.has(a.roomName) ? orderMap.get(a.roomName) : 9999;
    const ob = orderMap.has(b.roomName) ? orderMap.get(b.roomName) : 9999;
    if (oa !== ob) return oa - ob;
    if (a.roomName !== b.roomName) return String(a.roomName).localeCompare(String(b.roomName));
    return (a.localNo ?? 0) - (b.localNo ?? 0);
  });

  let n = startSerial;
  for (const d of devices) {
    await db.devices.update(d.id, { serialNo: n });
    n++;
  }

  alert(`通し番号を割当しました（開始 ${startSerial} / 末尾 ${n-1}）`);
  await render();
}

// ---- export ----
function csvEscape(s) {
  const t = String(s ?? "");
  if (/[,"\n]/.test(t)) return `\"${t.replace(/"/g, '""')}\"`;
  return t;
}

async function exportZip() {
  const ts = nowIsoSafe();
  const zipName = `stampcam_${ts}.zip`;

  const project = sanitizeFile(await getProjectName());

  const devices = await db.devices.toArray();
  devices.sort((a,b) => (a.serialNo ?? 999999) - (b.serialNo ?? 999999));

  const shots = await db.shots.toArray();

  const devicesCsv = [
    "projectName,roomName,localNo,serialNo,deviceType,checked,updatedAt",
    ...devices.map(d => [
      csvEscape(project),
      csvEscape(d.roomName || ""),
      d.localNo ?? "",
      d.serialNo ?? "",
      csvEscape(d.deviceType || ""),
      d.checked ? "1" : "0",
      new Date(d.updatedAt).toISOString()
    ].join(","))
  ].join("\n");

  const progressCsv = [
    "projectName,roomName,localNo,serialNo,overview,lamp,port,label,ipaddress,checked",
    ...(await Promise.all(devices.map(async d => {
      const done = await computeDoneKinds(d.id);
      return [
        csvEscape(project),
        csvEscape(d.roomName || ""),
        d.localNo ?? "",
        d.serialNo ?? "",
        done.has("overview") ? "1" : "0",
        done.has("lamp") ? "1" : "0",
        done.has("port") ? "1" : "0",
        done.has("label") ? "1" : "0",
        done.has("ipaddress") ? "1" : "0",
        d.checked ? "1" : "0"
      ].join(",");
    })))
  ].join("\n");

  const { zipSync, strToU8 } = window.fflate;

  const files = {};
  files["devices.csv"] = strToU8(devicesCsv);
  files["progress.csv"] = strToU8(progressCsv);

  for (const s of shots) {
    const dev = await db.devices.get(s.deviceId);
    if (!dev) continue;

    const room = sanitizeFile(dev.roomName || "");
    const localNo = sanitizeFile(String(dev.localNo ?? ""));
    const kind = sanitizeFile(String(s.kind ?? ""));
    const t = shotTime(s.createdAt);

    const base = `${project}${room}${localNo}${kind}${t}`;
    const folder = `photos/${sanitizeFile(dev.roomName || "room")}/機器${localNo}`;
    const fname = `${folder}/${base}.jpg`;

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

// ---- misc ----
async function wipeAll() {
  const ok = confirm("端末内データ（機器・写真・進捗）を全削除します。よろしいですか？");
  if (!ok) return;
  await db.devices.clear();
  await db.shots.clear();
  await db.meta.clear();
  await render();
}

async function addDeviceFromUi() {
  const room = (el.floorName?.value || "").trim();
  if (!room) return alert("部屋名を入力してください");
  const localNo = parseInt((el.deviceNo?.value || "").trim(), 10);
  if (!Number.isFinite(localNo) || localNo < 1 || localNo > 199) return alert("機器Noは 1〜199 の範囲で入力してください");

  await setMeta("roomName", room);
  const deviceId = await upsertDevice(room, localNo, (el.deviceType?.value || "").trim());
  await setActiveDeviceId(deviceId);
}

async function render() {
  const onlyInc = await loadOnlyIncomplete();
  el.onlyIncomplete.checked = onlyInc;

  if (el.projectName) el.projectName.value = await getProjectName();
  if (el.floorName) el.floorName.value = await getRoomName();

  if (el.roomOrder) el.roomOrder.value = await getRoomOrderText();
  if (el.startSerial) el.startSerial.value = String(await getStartSerial());

  let devices = await db.devices.toArray();
  devices.sort((a,b) => {
    if ((a.roomName || "") !== (b.roomName || "")) return String(a.roomName).localeCompare(String(b.roomName));
    return (a.localNo ?? 0) - (b.localNo ?? 0);
  });

  const filtered = onlyInc ? devices.filter(d => !d.checked) : devices;

  const activeId = await getActiveDeviceId();
  await renderActiveDeviceSelect(devices, activeId);
  el.activeDevice.value = activeId ? String(activeId) : "";

  await renderDeviceList(filtered);
  await renderShots(activeId);
  await checkStorage();
}

async function init() {
  await registerSw();

  if (el.projectName) {
    el.projectName.addEventListener("input", async () => {
      await setMeta("projectName", el.projectName.value.trim());
    });
  }
  if (el.floorName) {
    el.floorName.addEventListener("input", async () => {
      await setMeta("roomName", el.floorName.value.trim());
      await render();
    });
  }

  buildDevicePad();

  el.btnAdd.addEventListener("click", addDeviceFromUi);
  el.onlyIncomplete.addEventListener("change", toggleOnlyIncomplete);

  el.activeDevice.addEventListener("change", async (e) => {
    const id = e.target.value ? parseInt(e.target.value, 10) : null;
    await setActiveDeviceId(id);
  });

  el.btnStart.addEventListener("click", startCamera);
  el.btnStop.addEventListener("click", stopCamera);
  el.btnShot.addEventListener("click", takeShot);

  el.btnExport.addEventListener("click", exportZip);
  el.btnWipe.addEventListener("click", wipeAll);

  if (el.btnAssignSerial) el.btnAssignSerial.addEventListener("click", assignSerialNumbers);

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
