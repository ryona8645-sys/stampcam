import { openDb } from "./db.js";

const db = openDb();

const el = {
  projectName: document.getElementById("projectName"),
  floorName: document.getElementById("floorName"),
  devicePad: document.getElementById("devicePad"),

  deviceList: document.getElementById("deviceList"),
  onlyIncomplete: document.getElementById("onlyIncomplete"),

  btnExport: document.getElementById("btnExport"),
  btnWipe: document.getElementById("btnWipe"),
};

function sanitizeFile(s) {
  return String(s).replace(/[\\/:*?"<>|\s]/g, "_");
}

async function getMeta(key, fallback = "") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value) {
  await db.meta.put({ key, value: String(value ?? "") });
}

async function getProjectName() { return await getMeta("projectName", ""); }
async function getFloorName() { return await getMeta("floorName", ""); }
async function loadOnlyIncomplete() { return (await getMeta("onlyIncomplete","0")) === "1"; }

async function upsertDevice(deviceNo) {
  const existing = await db.devices.where("deviceNo").equals(deviceNo).first();
  const updatedAt = Date.now();
  const roomName = (await getFloorName()).trim();
  if (existing) {
    await db.devices.update(existing.id, { updatedAt, roomName });
    return existing.id;
  }
  return await db.devices.add({
    deviceNo,
    deviceType: "",
    roomName,
    checked: false,
    updatedAt
  });
}

function buildDevicePad() {
  if (!el.devicePad) return;
  el.devicePad.innerHTML = "";
  for (let i = 1; i <= 199; i++) {
    const no = String(i).padStart(3, "0");
    const b = document.createElement("button");
    b.textContent = no;
    b.addEventListener("click", async () => {
      await upsertDevice(no);
      await setMeta("activeDeviceNo", no);
      location.href = `./camera.html?deviceNo=${encodeURIComponent(no)}`;
    });
    el.devicePad.appendChild(b);
  }
}

async function renderDeviceList() {
  if (!el.deviceList) return;
  el.deviceList.innerHTML = "";

  const onlyInc = await loadOnlyIncomplete();
  if (el.onlyIncomplete) el.onlyIncomplete.checked = onlyInc;

  let devices = await db.devices.orderBy("deviceNo").toArray();
  if (onlyInc) devices = devices.filter(d => !d.checked);

  const groups = new Map();
  for (const d of devices) {
    const room = (d.roomName || "（未設定）").trim() || "（未設定）";
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room).push(d);
  }

  const rooms = Array.from(groups.keys()).sort((a,b)=>a.localeCompare(b,"ja"));

  for (const room of rooms) {
    const header = document.createElement("div");
    header.style.marginTop = "10px";
    header.style.fontWeight = "700";
    header.textContent = room;
    el.deviceList.appendChild(header);

    const list = document.createElement("div");
    list.className = "list";
    list.style.marginTop = "6px";

    const items = groups.get(room).slice().sort((a,b)=>a.deviceNo.localeCompare(b.deviceNo));
    for (const d of items) {
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div><b>${d.deviceNo}</b></div>
        <div style="opacity:.9">${d.checked ? "✅" : "□"}</div>
      `;
      item.addEventListener("click", async () => {
        await setMeta("activeDeviceNo", d.deviceNo);
        location.href = `./camera.html?deviceNo=${encodeURIComponent(d.deviceNo)}`;
      });
      list.appendChild(item);
    }
    el.deviceList.appendChild(list);
  }
}

function nowIsoSafe() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

async function exportZip() {
  const ts = nowIsoSafe();
  const zipName = `stampcam_${ts}.zip`;

  const devices = await db.devices.orderBy("deviceNo").toArray();
  const shots = await db.shots.toArray();

  const devicesCsv = [
    "deviceNo,roomName,checked,updatedAt",
    ...devices.map(d => [
      d.deviceNo,
      csvEscape(d.roomName || ""),
      d.checked ? "1" : "0",
      new Date(d.updatedAt).toISOString()
    ].join(","))
  ].join("\n");

  const { zipSync, strToU8 } = window.fflate;
  const files = {};
  files["devices.csv"] = strToU8(devicesCsv);

  for (const s of shots) {
    const pj = sanitizeFile(await getProjectName());
    const fl = sanitizeFile(await getFloorName());

    const tsShot = new Date(s.createdAt);
    const pad2 = (n) => String(n).padStart(2, "0");
    const shotTime = `${tsShot.getFullYear()}-${pad2(tsShot.getMonth()+1)}-${pad2(tsShot.getDate())}_${pad2(tsShot.getHours())}-${pad2(tsShot.getMinutes())}-${pad2(tsShot.getSeconds())}`;

    const base = `${pj}${fl}${sanitizeFile(s.deviceNo)}${sanitizeFile(s.kind)}${shotTime}`;
    const fname = `photos/${sanitizeFile(s.deviceNo)}/${base}.jpg`;

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
  if (el.projectName) el.projectName.value = await getProjectName();
  if (el.floorName) el.floorName.value = await getFloorName();

  await renderDeviceList();
  await checkStorage();
}

async function init() {
  if (el.projectName) {
    el.projectName.addEventListener("input", async () => {
      await setMeta("projectName", el.projectName.value.trim());
    });
  }
  if (el.floorName) {
    el.floorName.addEventListener("input", async () => {
      await setMeta("floorName", el.floorName.value.trim());
      await renderDeviceList();
    });
  }
  if (el.onlyIncomplete) {
    el.onlyIncomplete.addEventListener("change", async () => {
      await setMeta("onlyIncomplete", el.onlyIncomplete.checked ? "1" : "0");
      await renderDeviceList();
    });
  }

  buildDevicePad();

  el.btnExport?.addEventListener("click", exportZip);
  el.btnWipe?.addEventListener("click", wipeAll);

  await render();
}

init();
