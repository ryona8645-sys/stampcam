import { openDb } from "./db.js";
const db = openDb();

const el = {
  projectName: document.getElementById("projectName"),
  floorName: document.getElementById("floorName"),

  devicePicker: document.getElementById("devicePicker"),
  roomList: document.getElementById("roomList"),
  activeDeviceLabel: document.getElementById("activeDeviceLabel"),
  onlyIncomplete: document.getElementById("onlyIncomplete"),

  btnExport: document.getElementById("btnExport"),
  btnWipe: document.getElementById("btnWipe"),

  btnOpenCamera: document.getElementById("btnOpenCamera"),
  photoMeta: document.getElementById("photoMeta"),
  photoGrid: document.getElementById("photoGrid"),

  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomIn: document.getElementById("zoomIn"),
  zoomOut: document.getElementById("zoomOut"),
  zoomReset: document.getElementById("zoomReset"),
};

const REQUIRED_KINDS = ["overview","lamp","port","label"];
const KIND_LABEL = { overview:"全景", lamp:"ランプ", port:"ポート", label:"ラベル", ipaddress:"IPアドレス" };

function normalizeRoomName(s) {
  return String(s || "").trim() || "（未設定）";
}
function formatDeviceIndex(n) {
  return String(n).padStart(2, "0");
}
function makeDeviceKey(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return `${room}::${idx}`;
}
function makeRoomDeviceLabel(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return `${room}_機器${idx}`;
}
function sanitizeFile(s) {
  return String(s).replace(/[\\/:*?"<>|\s]/g, "_");
}

async function getMeta(key, fallback="") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value) {
  await db.meta.put({ key, value: String(value ?? "") });
}
async function getProjectName() { return await getMeta("projectName",""); }
async function getRoomInput() { return normalizeRoomName(el.floorName?.value); }
async function getActiveDeviceKey() { return await getMeta("activeDeviceKey",""); }
async function loadOnlyIncomplete() { return (await getMeta("onlyIncomplete","0")) === "1"; }

async function upsertDevice(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = Number(deviceIndex);
  const deviceKey = makeDeviceKey(room, idx);

  const existing = await db.devices.get(deviceKey);
  const updatedAt = Date.now();

  if (existing) {
    await db.devices.put({ ...existing, roomName: room, deviceIndex: idx, updatedAt });
    return deviceKey;
  }

  await db.devices.put({
    deviceKey,
    roomName: room,
    deviceIndex: idx,
    checked: false,
    updatedAt
  });
  return deviceKey;
}

async function computeChecked(deviceKey) {
  const shots = await db.shots.where("deviceKey").equals(deviceKey).toArray();
  const done = new Set(shots.map(s=>s.kind));
  return REQUIRED_KINDS.every(k => done.has(k));
}

let modalZoom = 1;
function setModalZoom(next) {
  modalZoom = Math.max(0.25, Math.min(6, next));
  el.previewImg.style.transformOrigin = "0 0";
  el.previewImg.style.transform = `scale(${modalZoom})`;
}

async function openPreview(title, blob) {
  const url = URL.createObjectURL(blob);
  el.previewImg.src = url;
  el.previewTitle.textContent = title;
  el.preview.classList.remove("hidden");
  setModalZoom(1);
  setTimeout(()=>URL.revokeObjectURL(url), 60_000);
}

async function renderRooms() {
  const onlyInc = await loadOnlyIncomplete();
  if (el.onlyIncomplete) el.onlyIncomplete.checked = onlyInc;

  const devicesAll = await db.devices.toArray();

  const groups = new Map();
  for (const d of devicesAll) {
    const room = normalizeRoomName(d.roomName);
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room).push(d);
  }

  const currentRoom = await getRoomInput();
  if (currentRoom && !groups.has(currentRoom)) groups.set(currentRoom, []);

  const rooms = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b,"ja"));
  const activeKey = await getActiveDeviceKey();

  el.roomList.innerHTML = "";

  for (const room of rooms) {
    const card = document.createElement("div");
    card.className = "roomCard";

    const head = document.createElement("div");
    head.className = "roomHead";
    head.innerHTML = `
      <div class="roomTitle">${room}</div>
      <button data-add class="primary">＋追加</button>
    `;

    const btnBox = document.createElement("div");
    btnBox.className = "roomBtns";

    const items = groups.get(room)
      .slice()
      .sort((a,b)=>Number(a.deviceIndex)-Number(b.deviceIndex));

    for (const d of items) {
      if (onlyInc && d.checked) continue;

      const b = document.createElement("button");
      b.textContent = formatDeviceIndex(d.deviceIndex);
      const key = d.deviceKey;

      if (key === activeKey) b.classList.add("sel");
      if (d.checked) b.classList.add("ok");

      b.addEventListener("click", async () => {
        await setMeta("activeDeviceKey", key);
        await render();
        if (el.devicePicker) el.devicePicker.open = false;
      });
      btnBox.appendChild(b);
    }

    head.querySelector("[data-add]").addEventListener("click", async () => {
      const used = new Set(items.map(x=>Number(x.deviceIndex)));
      let n = 1;
      while (used.has(n) && n <= 199) n++;
      if (n > 199) return alert("199まで埋まっています");

      const key = await upsertDevice(room, n);
      await setMeta("activeDeviceKey", key);
      await render();
      if (el.devicePicker) el.devicePicker.open = false;
    });

    card.appendChild(head);
    card.appendChild(btnBox);
    el.roomList.appendChild(card);
  }

  const ak = await getActiveDeviceKey();
  if (el.activeDeviceLabel) {
    if (!ak) el.activeDeviceLabel.textContent = "未選択";
    else {
      const [r, idx] = ak.split("::");
      el.activeDeviceLabel.textContent = makeRoomDeviceLabel(r, Number(idx));
    }
  }
}

async function renderPhotos() {
  const deviceKey = await getActiveDeviceKey();
  el.photoGrid.innerHTML = "";

  if (!deviceKey) {
    el.photoMeta.textContent = "機器を選択してください。";
    return;
  }

  const [r, idx] = deviceKey.split("::");
  const label = makeRoomDeviceLabel(r, Number(idx));

  const shots = await db.shots.where("deviceKey").equals(deviceKey).toArray();
  shots.sort((a,b)=>b.createdAt-a.createdAt);

  const done = new Set(shots.map(s=>s.kind));
  const must = REQUIRED_KINDS.map(k=>`${KIND_LABEL[k]}${done.has(k) ? "✅" : "□"}`).join(" / ");
  el.photoMeta.textContent = `${label} / ${must} / 枚数:${shots.length}`;

  for (const s of shots) {
    const url = URL.createObjectURL(s.thumbBlob || s.blob);

    const div = document.createElement("div");
    div.className = "shot";
    div.innerHTML = `
      <img src="${url}" alt="">
      <div class="cap">
        <span>${KIND_LABEL[s.kind] || s.kind}</span>
        <div style="display:flex; gap:6px;">
          <button data-open>確認</button>
          <button data-del class="danger">削除</button>
        </div>
      </div>
    `;

    div.querySelector("[data-open]").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const shot = await db.shots.get(s.id);
      if (!shot) return;
      await openPreview(`${label} / ${KIND_LABEL[shot.kind] || shot.kind} / ${new Date(shot.createdAt).toLocaleString()}`, shot.blob);
    });

    div.querySelector("[data-del]").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const ok = confirm("この写真を削除します。よろしいですか？");
      if (!ok) return;
      URL.revokeObjectURL(url);
      await db.shots.delete(s.id);

      const checked = await computeChecked(deviceKey);
      const dev = await db.devices.get(deviceKey);
      if (dev) await db.devices.put({ ...dev, checked, updatedAt: Date.now() });

      await render();
    });

    el.photoGrid.appendChild(div);
    setTimeout(()=>URL.revokeObjectURL(url), 30_000);
  }
}

function nowIsoSafe() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function csvEscape(s) {
  const t = String(s);
  if (/[,"\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

async function exportZip() {
  const ts = nowIsoSafe();
  const zipName = `stampcam_${ts}.zip`;

  const devices = await db.devices.toArray();
  const shots = await db.shots.toArray();

  const devicesCsv = [
    "deviceKey,roomName,deviceIndex,checked,updatedAt",
    ...devices.map(d => [
      csvEscape(d.deviceKey),
      csvEscape(d.roomName || ""),
      String(d.deviceIndex ?? ""),
      d.checked ? "1" : "0",
      new Date(d.updatedAt || Date.now()).toISOString()
    ].join(","))
  ].join("\n");

  const { zipSync, strToU8 } = window.fflate;
  const files = {};
  files["devices.csv"] = strToU8(devicesCsv);

  const pj = sanitizeFile(await getProjectName());

  for (const s of shots) {
    const [r, idx] = String(s.deviceKey).split("::");
    const roomDevice = sanitizeFile(makeRoomDeviceLabel(r, Number(idx)));

    const tsShot = new Date(s.createdAt);
    const pad2 = (n) => String(n).padStart(2, "0");
    const shotTime = `${tsShot.getFullYear()}-${pad2(tsShot.getMonth()+1)}-${pad2(tsShot.getDate())}_${pad2(tsShot.getHours())}-${pad2(tsShot.getMinutes())}-${pad2(tsShot.getSeconds())}`;

    const base = `${pj}${roomDevice}${sanitizeFile(s.kind)}${shotTime}`;
    const fname = `photos/${roomDevice}/${base}.jpg`;

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
  if (el.projectName) el.projectName.value = await getProjectName();
  if (el.floorName) el.floorName.value = String(await getMeta("floorName",""));

  await renderRooms();
  await renderPhotos();
  await checkStorage();
}

async function init() {
  el.projectName?.addEventListener("input", async () => {
    await setMeta("projectName", el.projectName.value.trim());
  });

  el.floorName?.addEventListener("input", async () => {
    await setMeta("floorName", el.floorName.value.trim());
    await renderRooms();
  });

  el.onlyIncomplete?.addEventListener("change", async () => {
    await setMeta("onlyIncomplete", el.onlyIncomplete.checked ? "1" : "0");
    await renderRooms();
  });

  el.btnOpenCamera?.addEventListener("click", async () => {
    const key = await getActiveDeviceKey();
    if (!key) return alert("先に機器を選択してください。");
    location.href = `./camera.html?deviceKey=${encodeURIComponent(key)}`;
  });

  el.btnExport?.addEventListener("click", exportZip);
  el.btnWipe?.addEventListener("click", wipeAll);

  el.closePreview?.addEventListener("click", () => el.preview.classList.add("hidden"));
  el.preview?.addEventListener("click", (e) => { if (e.target === el.preview) el.preview.classList.add("hidden"); });
  el.zoomIn?.addEventListener("click", () => setModalZoom(modalZoom * 1.25));
  el.zoomOut?.addEventListener("click", () => setModalZoom(modalZoom / 1.25));
  el.zoomReset?.addEventListener("click", () => setModalZoom(1));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") el.preview.classList.add("hidden");
  });

  await render();
}

init();
