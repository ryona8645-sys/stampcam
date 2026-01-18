import { openDb } from "./db.js";

const REQUIRED_KINDS = ["overview", "lamp", "port", "label"]; // checkedはこれのみ必須
const KIND_LABEL = {
  overview: "全景",
  lamp: "ランプ",
  port: "ポート",
  label: "ラベル",
  ipaddress: "IPアドレス"
};

const db = openDb();

const el = {
  projectName: document.getElementById("projectName"),
  floorName: document.getElementById("floorName"), // ここは「部屋名」入力として使う（機器に紐づけ）
  devicePad: document.getElementById("devicePad"),

  deviceNo: document.getElementById("deviceNo"),
  deviceType: document.getElementById("deviceType"),
  btnAdd: document.getElementById("btnAdd"),

  deviceList: document.getElementById("deviceList"),
  onlyIncomplete: document.getElementById("onlyIncomplete"),

  btnExport: document.getElementById("btnExport"),
  btnWipe: document.getElementById("btnWipe"),
};

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
async function getProjectName() { return await getMeta("projectName",""); }
async function getRoomNameCurrent() { return await getMeta("roomNameCurrent",""); }

function sanitizeFile(s) {
  return String(s ?? "").replace(/[\\/:*?"<>|]/g, "_");
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

async function upsertDevice(deviceNo, deviceType, roomName) {
  const existing = await db.devices.where("deviceNo").equals(deviceNo).first();
  const updatedAt = Date.now();
  const room = roomName ?? "";
  if (existing) {
    await db.devices.update(existing.id, { deviceType: deviceType ?? existing.deviceType ?? "", roomName: room, updatedAt });
    return existing.id;
  }
  return await db.devices.add({
    deviceNo,
    deviceType: deviceType || "",
    roomName: room,
    checked: false,
    updatedAt
  });
}

async function setActiveDevice(deviceNo) {
  await db.meta.put({ key: "activeDeviceNo", value: deviceNo });
}

function buildDevicePad() {
  if (!el.devicePad) return;
  el.devicePad.innerHTML = "";
  for (let i = 1; i <= 199; i++) {
    const no = String(i).padStart(3, "0");
    const b = document.createElement("button");
    b.textContent = no;
    b.addEventListener("click", async () => {
      const roomName = (el.floorName?.value ?? "").trim(); // 部屋名
      if (el.deviceNo) el.deviceNo.value = no;

      const existing = await db.devices.where("deviceNo").equals(no).first();
      if (!existing) {
        await upsertDevice(no, el.deviceType?.value?.trim() || "", roomName);
      } else if (roomName && existing.roomName !== roomName) {
        await db.devices.update(existing.id, { roomName, updatedAt: Date.now() });
      }
      await recomputeChecked(no);
      await setActiveDevice(no);

      // 機器No選択で撮影画面へ
      location.href = "./camera.html";
    });
    el.devicePad.appendChild(b);
  }
}

async function addDeviceFromUi() {
  const deviceNo = (el.deviceNo?.value ?? "").trim();
  if (!deviceNo) return alert("機器Noが空です");
  const roomName = (el.floorName?.value ?? "").trim();
  await upsertDevice(deviceNo, (el.deviceType?.value ?? "").trim(), roomName);
  await recomputeChecked(deviceNo);
  await setActiveDevice(deviceNo);
  if (el.deviceNo) el.deviceNo.value = "";
  if (el.deviceType) el.deviceType.value = "";
  location.href = "./camera.html";
}

async function toggleOnlyIncomplete() {
  await setMeta("onlyIncomplete", el.onlyIncomplete.checked ? "1" : "0");
  await render();
}

async function loadOnlyIncomplete() {
  return (await getMeta("onlyIncomplete","0")) === "1";
}

function groupByRoom(devices) {
  const m = new Map();
  for (const d of devices) {
    const room = (d.roomName || "（部屋名なし）");
    if (!m.has(room)) m.set(room, []);
    m.get(room).push(d);
  }
  const rooms = [...m.keys()].sort((a,b)=>a.localeCompare(b, "ja"));
  return rooms.map(r => [r, m.get(r).sort((x,y)=>String(x.deviceNo).localeCompare(String(y.deviceNo)))]);
}

async function renderDeviceList(devices) {
  el.deviceList.innerHTML = "";
  const groups = groupByRoom(devices);

  for (const [room, list] of groups) {
    const sec = document.createElement("div");
    sec.className = "panel";
    sec.innerHTML = `<h2 style="margin-top:0">${room}</h2><div class="list"></div>`;
    const container = sec.querySelector(".list");

    for (const d of list) {
      const done = await computeDoneKinds(d.deviceNo);
      const reqOk = REQUIRED_KINDS.every(k => done.has(k));
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div>
          <div><b>${d.deviceNo}</b> <span style="opacity:.8">${d.deviceType || ""}</span></div>
        </div>
        <div class="badges">
          <span class="badge ${reqOk ? "ok" : ""}">${reqOk ? "完了" : "未完"}</span>
        </div>
      `;
      item.addEventListener("click", async () => {
        if (el.floorName) el.floorName.value = d.roomName || "";
        await setMeta("roomNameCurrent", d.roomName || "");
        await setActiveDevice(d.deviceNo);
        location.href = "./camera.html";
      });
      container.appendChild(item);
    }

    el.deviceList.appendChild(sec);
  }
}

function nowIsoSafe() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function csvEscape(t) {
  const s = String(t ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

async function exportZip() {
  const ts = nowIsoSafe();
  const zipName = `stampcam_${ts}.zip`;

  const devices = await db.devices.orderBy("deviceNo").toArray();
  const shots = await db.shots.toArray();

  const devicesCsv = [
    "deviceNo,deviceType,roomName,checked,updatedAt",
    ...devices.map(d => [
      d.deviceNo,
      csvEscape(d.deviceType || ""),
      csvEscape(d.roomName || ""),
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
      ].join(","))
    })))
  ].join("\n");

  const { zipSync, strToU8 } = window.fflate;
  const files = { "devices.csv": strToU8(devicesCsv), "progress.csv": strToU8(progressCsv) };

  const roomMap = new Map(devices.map(d => [d.deviceNo, d.roomName || ""]));
  const pj = sanitizeFile(await getProjectName());

  for (const s of shots) {
    const room = sanitizeFile(roomMap.get(s.deviceNo) || "");
    const tsShot = new Date(s.createdAt);
    const pad2 = (n) => String(n).padStart(2, "0");
    const shotTime = `${tsShot.getFullYear()}-${pad2(tsShot.getMonth()+1)}-${pad2(tsShot.getDate())}_${pad2(tsShot.getHours())}-${pad2(tsShot.getMinutes())}-${pad2(tsShot.getSeconds())}`;

    const base = `${pj}${room}${sanitizeFile(s.deviceNo)}${sanitizeFile(s.kind)}${shotTime}`;
    const fname = `photos/${sanitizeFile(s.deviceNo)}/${base}.jpg`;

    files[fname] = new Uint8Array(await s.blob.arrayBuffer());
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

async function render() {
  const onlyInc = await loadOnlyIncomplete();
  el.onlyIncomplete.checked = onlyInc;

  if (el.projectName) el.projectName.value = await getProjectName();
  if (el.floorName) el.floorName.value = await getRoomNameCurrent();

  let devices = await db.devices.orderBy("deviceNo").toArray();
  if (onlyInc) devices = devices.filter(d => !d.checked);

  await renderDeviceList(devices);
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
      await setMeta("roomNameCurrent", el.floorName.value.trim());
    });
  }

  buildDevicePad();

  el.btnAdd?.addEventListener("click", addDeviceFromUi);
  el.onlyIncomplete?.addEventListener("change", toggleOnlyIncomplete);
  el.btnExport?.addEventListener("click", exportZip);
  el.btnWipe?.addEventListener("click", wipeAll);

  await render();
}

init();
