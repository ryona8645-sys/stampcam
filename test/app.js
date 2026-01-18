import { openDb } from "./db.js";

const REQUIRED_KINDS = ["overview", "lamp", "port", "label"]; // 必須はこの4つのみ
const OPTIONAL_KINDS = ["ipaddress"];
const ALL_KINDS = [...REQUIRED_KINDS, ...OPTIONAL_KINDS];

const KIND_LABEL = {
  overview: "全景",
  lamp: "ランプ",
  port: "ポート",
  label: "ラベル",
  ipaddress: "IPアドレス",
};

const db = openDb();

const el = {
  projectName: document.getElementById("projectName"),
  roomName: document.getElementById("roomName"),
  btnSaveMeta: document.getElementById("btnSaveMeta"),

  noFilter: document.getElementById("noFilter"),
  btnClearFilter: document.getElementById("btnClearFilter"),
  noGrid: document.getElementById("noGrid"),
  selectedNo: document.getElementById("selectedNo"),

  deviceType: document.getElementById("deviceType"),
  btnUpdateType: document.getElementById("btnUpdateType"),

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

function pad3(n) { return String(n).padStart(3, "0"); }

function formatShotTime(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function sanitizeFile(s) {
  // Windowsの禁止文字だけ置換。角括弧[]は残す（要求の形式に合わせる）
  return String(s).replace(/[\\/:*?"<>|]/g, "_").trim();
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

async function metaGet(key, def = "") {
  const v = await db.meta.get(key);
  return v?.value ?? def;
}

async function metaSet(key, value) {
  await db.meta.put({ key, value: String(value ?? "") });
}

async function upsertDevice(deviceNo) {
  const existing = await db.devices.where("deviceNo").equals(deviceNo).first();
  const updatedAt = Date.now();
  if (existing) {
    await db.devices.update(existing.id, { updatedAt });
    return existing.id;
  }
  return await db.devices.add({
    deviceNo,
    deviceType: "",
    checked: false,
    updatedAt
  });
}

async function setActiveDevice(deviceNo) {
  await metaSet("activeDeviceNo", deviceNo);
  await metaSet("selectedDeviceNo", deviceNo);
  await render();
}

async function getActiveDeviceNo() {
  return await metaGet("activeDeviceNo", "");
}

async function computeDoneKinds(deviceNo) {
  const shots = await db.shots.where("deviceNo").equals(deviceNo).toArray();
  return new Set(shots.map(s => s.kind));
}

async function recomputeChecked(deviceNo) {
  const done = await computeDoneKinds(deviceNo);
  const ok = REQUIRED_KINDS.every(k => done.has(k));
  const dev = await db.devices.where("deviceNo").equals(deviceNo).first();
  if (dev) await db.devices.update(dev.id, { checked: ok, updatedAt: Date.now() });
  return ok;
}

async function saveMeta() {
  await metaSet("projectName", el.projectName.value.trim());
  await metaSet("roomName", el.roomName.value.trim());
  await render();
}

async function updateTypeForSelected() {
  const no = await metaGet("selectedDeviceNo", "");
  if (!no) return alert("機器Noが選択されていません");
  await upsertDevice(no);
  const dev = await db.devices.where("deviceNo").equals(no).first();
  if (dev) await db.devices.update(dev.id, { deviceType: el.deviceType.value.trim(), updatedAt: Date.now() });
  await render();
}

async function toggleOnlyIncomplete() {
  await metaSet("onlyIncomplete", el.onlyIncomplete.checked ? "1" : "0");
  await render();
}

async function loadOnlyIncomplete() {
  return (await metaGet("onlyIncomplete", "0")) === "1";
}

function buildNoGrid(filterText, devicesMap, activeNo, selectedNo) {
  el.noGrid.innerHTML = "";
  const ft = (filterText || "").trim();

  for (let i = 1; i <= 199; i++) {
    const no = pad3(i);
    if (ft && !no.includes(ft)) continue;

    const btn = document.createElement("button");
    btn.className = "noBtn";
    btn.textContent = no;

    const dev = devicesMap.get(no);
    if (dev?.checked) btn.classList.add("done");
    if (no === selectedNo || no === activeNo) btn.classList.add("sel");

    btn.addEventListener("click", async () => {
      await upsertDevice(no);
      await metaSet("selectedDeviceNo", no);
      await setActiveDevice(no);
    });

    el.noGrid.appendChild(btn);
  }
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
    w, h, tw, th
  });

  await metaSet("lastShotId", String(shotId));

  await recomputeChecked(deviceNo);
  await setActiveDevice(deviceNo);
}

async function deleteShot(id) {
  const shot = await db.shots.get(id);
  if (!shot) return;
  await db.shots.delete(id);
  await recomputeChecked(shot.deviceNo);
}

async function renderDeviceList(devices) {
  el.deviceList.innerHTML = "";
  for (const d of devices) {
    const done = await computeDoneKinds(d.deviceNo);

    const badgesReq = REQUIRED_KINDS.map(k => {
      const ok = done.has(k);
      return `<span class="badge ${ok ? "ok" : ""}">${KIND_LABEL[k]}</span>`;
    }).join("");

    const badgesOpt = OPTIONAL_KINDS.map(k => {
      const ok = done.has(k);
      return `<span class="badge opt ${ok ? "ok" : ""}">${KIND_LABEL[k]}</span>`;
    }).join("");

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div>
        <div><b>${d.deviceNo}</b> <span style="opacity:.8">${d.deviceType || ""}</span></div>
        <div style="opacity:.7;font-size:12px">更新: ${new Date(d.updatedAt).toLocaleString()}</div>
      </div>
      <div class="badges">${badgesReq}${badgesOpt}</div>
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

  const lastShotId = await metaGet("lastShotId", "");
  const shots = await db.shots.where("deviceNo").equals(deviceNo).toArray();
  shots.sort((a,b) => b.createdAt - a.createdAt);

  const doneKinds = await computeDoneKinds(deviceNo);
  const reqText = REQUIRED_KINDS.map(k => `${KIND_LABEL[k]}${doneKinds.has(k) ? "✅" : "□"}`).join(" / ");
  const optText = OPTIONAL_KINDS.map(k => `${KIND_LABEL[k]}${doneKinds.has(k) ? "✅" : "□"}`).join(" / ");
  el.shotMeta.textContent = `必須: ${reqText} / 任意: ${optText} / 枚数: ${shots.length}`;

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

      const shot = await db.shots.get(s.id);
      await deleteShot(s.id);

      if (shot && String(shot.id) === String(lastShotId)) {
        const left = await db.shots.where("deviceNo").equals(deviceNo).toArray();
        left.sort((a,b)=>b.createdAt-a.createdAt);
        await metaSet("lastShotId", left[0] ? String(left[0].id) : "");
      }

      await render();
    });

    el.shots.appendChild(div);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

async function exportZip() {
  const zipTs = formatShotTime(Date.now());
  const zipName = `stampcam_${zipTs}.zip`;

  const projectName = sanitizeFile(await metaGet("projectName", ""));
  const roomName = sanitizeFile(await metaGet("roomName", ""));

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
    "deviceNo,overview,lamp,port,label,ipaddress,checked",
    ...(await Promise.all(devices.map(async d => {
      const done = await computeDoneKinds(d.deviceNo);
      return [
        d.deviceNo,
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

  // ファイル名: [案件名][フロア名][機器No][写真種別][撮影時間].jpg
  for (const s of shots) {
    const shotTime = formatShotTime(s.createdAt);

    const parts = [
      `[${projectName}]`,
      `[${roomName}]`,
      `[${sanitizeFile(s.deviceNo)}]`,
      `[${sanitizeFile(s.kind)}]`,
      `[${shotTime}]`,
    ].join("");

    const fname = `photos/${sanitizeFile(s.deviceNo)}/${parts}.jpg`;
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
  const t = String(s ?? "");
  if (/[,"\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function wipeAll() {
  const ok = confirm("端末内データ（機器・写真・進捗・案件情報）を全削除します。よろしいですか？");
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
  el.projectName.value = await metaGet("projectName", "");
  el.roomName.value = await metaGet("roomName", "");

  const onlyInc = await loadOnlyIncomplete();
  el.onlyIncomplete.checked = onlyInc;

  const allDevices = await db.devices.orderBy("deviceNo").toArray();
  const devicesMap = new Map(allDevices.map(d => [d.deviceNo, d]));

  let listDevices = allDevices;
  if (onlyInc) listDevices = listDevices.filter(d => !d.checked);

  const activeNo = await getActiveDeviceNo();
  const selectedNo = await metaGet("selectedDeviceNo", activeNo || "");
  el.selectedNo.textContent = selectedNo || "(未選択)";
  el.deviceType.value = (devicesMap.get(selectedNo)?.deviceType) || "";

  const ft = el.noFilter.value || "";
  buildNoGrid(ft, devicesMap, activeNo, selectedNo);

  await renderActiveDeviceSelect(allDevices, activeNo);
  el.activeDevice.value = activeNo || "";

  await renderDeviceList(listDevices);
  await renderShots(activeNo);

  await checkStorage();
}

async function init() {
  await registerSw();

  // meta
  el.btnSaveMeta.addEventListener("click", saveMeta);
  el.projectName.addEventListener("change", saveMeta);
  el.roomName.addEventListener("change", saveMeta);

  // filter
  el.noFilter.addEventListener("input", () => render());
  el.btnClearFilter.addEventListener("click", () => { el.noFilter.value = ""; render(); });

  // type
  el.btnUpdateType.addEventListener("click", updateTypeForSelected);

  // list
  el.onlyIncomplete.addEventListener("change", toggleOnlyIncomplete);
  el.activeDevice.addEventListener("change", (e) => setActiveDevice(e.target.value));

  // camera
  el.btnStart.addEventListener("click", startCamera);
  el.btnStop.addEventListener("click", stopCamera);
  el.btnShot.addEventListener("click", takeShot);

  // export / wipe
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
