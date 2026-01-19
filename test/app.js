import { openDb } from "./db.js";
const db = openDb();

const el = {
  // Status Bar
  stProject: document.getElementById("stProject"),
  stRoom: document.getElementById("stRoom"),
  stDevice: document.getElementById("stDevice"),

  // Step 1
  projectName: document.getElementById("projectName"),
  floorName: document.getElementById("floorName"),
  btnAddRoom: document.getElementById("btnAddRoom"),
  btnExport: document.getElementById("btnExport"),
  btnWipe: document.getElementById("btnWipe"),
  storageWarn: document.getElementById("storageWarn"),

  // Step 2
  roomList: document.getElementById("roomList"),
  onlyIncomplete: document.getElementById("onlyIncomplete"),

  // Step 3
  deviceAdderPanel: document.getElementById("deviceAdderPanel"),
  targetRoomDisplay: document.getElementById("targetRoomDisplay"),
  manualDeviceNo: document.getElementById("manualDeviceNo"),
  btnAddManualDevice: document.getElementById("btnAddManualDevice"),
  deviceNoPicker: document.getElementById("deviceNoPicker"),
  devicePad: document.getElementById("devicePad"),

  // Step 4
  targetDeviceDisplay: document.getElementById("targetDeviceDisplay"),
  photoMeta: document.getElementById("photoMeta"),
  photoGrid: document.getElementById("photoGrid"),

  // Footer
  btnOpenCamera: document.getElementById("btnOpenCamera"),

  // Preview
  preview: document.getElementById("preview"),
  previewImg: document.getElementById("previewImg"),
  previewTitle: document.getElementById("previewTitle"),
  closePreview: document.getElementById("closePreview"),
  zoomReset: document.getElementById("zoomReset"),
};

const REQUIRED_KINDS = ["overview","lamp","port","label"];
const KIND_LABEL = { overview:"全景", lamp:"ランプ", port:"ポート", label:"ラベル", ipaddress:"IPアドレス" };

// --- Utilities ---
function normalizeRoomName(s) { return String(s || "").trim() || "（未設定）"; }
function formatDeviceIndex(n) { return String(n).padStart(3, "0"); }
function makeDeviceKey(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return `${room}::${idx}`;
}
function makeRoomDeviceLabel(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = formatDeviceIndex(deviceIndex);
  return (Number(deviceIndex) === 0) ? `${room}_FREE` : `${room}_機器${idx}`;
}
function sanitizeFile(s) { return String(s).replace(/[\\/:*?"<>|\s]/g, "_"); }

// --- DB Access ---
async function getMeta(key, fallback="") {
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value) {
  await db.meta.put({ key, value: String(value ?? "") });
}

async function getProjectName() { return await getMeta("projectName",""); }
async function getActiveRoom() { return await getMeta("activeRoom",""); }
async function getActiveDeviceKey() { return await getMeta("activeDeviceKey",""); }

async function getRooms() {
  const raw = await getMeta("rooms","[]");
  try { return JSON.parse(raw); } catch { return []; }
}
async function setRooms(arr) {
  const uniq = Array.from(new Set(arr.map(normalizeRoomName)));
  await setMeta("rooms", JSON.stringify(uniq));
}

// --- Logic ---

async function ensureDefaults() {
  const pj = await getMeta("projectName","");
  if (pj === "") await setMeta("projectName","");
}

async function upsertDevice(roomName, deviceIndex) {
  const room = normalizeRoomName(roomName);
  const idx = Number(deviceIndex);
  const deviceKey = makeDeviceKey(room, idx);

  const existing = await db.devices.get(deviceKey);
  const updatedAt = Date.now();

  if (existing) {
    await db.devices.put({ ...existing, roomName: room, deviceIndex: idx, updatedAt });
  } else {
    await db.devices.put({
      deviceKey,
      roomName: room,
      deviceIndex: idx,
      checked: false,
      updatedAt
    });
  }
  return deviceKey;
}

async function computeChecked(deviceKey) {
  const shots = await db.shots.where("deviceKey").equals(deviceKey).toArray();
  const done = new Set(shots.map(s=>s.kind));
  return REQUIRED_KINDS.every(k => done.has(k));
}

// --- Rendering ---

function updateStatusBar(pj, room, key) {
  el.stProject.textContent = pj || "（未入力）";
  el.stRoom.textContent = room || "（未選択）";
  
  if (key) {
    const [r, idx] = key.split("::");
    const num = Number(idx);
    el.stDevice.textContent = num === 0 ? "FREE" : `No.${idx}`;
    el.stDevice.classList.add("active");
  } else {
    el.stDevice.textContent = "-";
    el.stDevice.classList.remove("active");
  }
}

async function renderRooms() {
  const rooms = await getRooms();
  const activeRoom = await getActiveRoom();
  const activeKey = await getActiveDeviceKey();
  const onlyInc = (await getMeta("onlyIncomplete","0")) === "1";
  el.onlyIncomplete.checked = onlyInc;

  const devicesAll = await db.devices.toArray();
  const groups = new Map();
  for (const r of rooms) groups.set(r, []);
  for (const d of devicesAll) {
    const r = normalizeRoomName(d.roomName);
    if (groups.has(r)) groups.get(r).push(d);
  }

  el.roomList.innerHTML = "";

  for (const room of rooms) {
    const card = document.createElement("div");
    card.className = "roomCard";
    if (room === activeRoom) card.classList.add("active");

    // Header
    const head = document.createElement("div");
    head.className = "roomHead";
    
    // Title (Click to select room)
    const titleDiv = document.createElement("div");
    titleDiv.className = "roomTitle";
    titleDiv.textContent = room;
    titleDiv.style.flex = "1";
    titleDiv.addEventListener("click", async () => {
      await setMeta("activeRoom", room);
      // Reset device selection when switching rooms to avoid confusion
      if (room !== activeRoom) {
         // Optionally keep device if same room, but prompt implies clear flow
         // await setMeta("activeDeviceKey", ""); 
      }
      await render();
      // Scroll to device picker
      el.deviceAdderPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    head.appendChild(titleDiv);

    // Delete Button
    const btnDel = document.createElement("button");
    btnDel.textContent = "削除";
    btnDel.style.fontSize = "10px";
    btnDel.style.padding = "4px 8px";
    btnDel.className = "danger";
    btnDel.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`部屋「${room}」を削除しますか？\n含まれる写真も全て削除されます。`)) return;
      
      const keys = (await db.devices.where("roomName").equals(room).toArray()).map(d => d.deviceKey);
      for (const k of keys) {
        await db.devices.delete(k);
        const shots = await db.shots.where("deviceKey").equals(k).toArray();
        for (const s of shots) await db.shots.delete(s.id);
      }
      const nextRooms = (await getRooms()).filter(r => r !== room);
      await setRooms(nextRooms);
      
      if (activeRoom === room) {
        await setMeta("activeRoom", "");
        await setMeta("activeDeviceKey", "");
      }
      await render();
    });
    head.appendChild(btnDel);
    card.appendChild(head);

    // Device Buttons List
    const btnBox = document.createElement("div");
    btnBox.className = "roomBtns";

    // FREE button (Always first)
    const freeBtn = document.createElement("button");
    freeBtn.textContent = "FREE";
    const freeKey = makeDeviceKey(room, 0);
    if (freeKey === activeKey) freeBtn.classList.add("sel");
    
    // Click FREE
    freeBtn.addEventListener("click", async () => {
      await setMeta("activeRoom", room); // Ensure room is active
      await setMeta("activeDeviceKey", freeKey);
      await upsertDevice(room, 0); // Ensure record exists
      await render();
      el.photoGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    btnBox.appendChild(freeBtn);

    // Sorted devices
    const items = (groups.get(room) || []).slice().sort((a, b) => Number(a.deviceIndex) - Number(b.deviceIndex));
    let hasMatch = false;

    for (const d of items) {
      if (Number(d.deviceIndex) === 0) continue; // Skip free (handled above)
      if (onlyInc && d.checked) continue; // Filter

      const b = document.createElement("button");
      b.textContent = formatDeviceIndex(d.deviceIndex);
      if (d.deviceKey === activeKey) b.classList.add("sel");
      if (d.checked) b.classList.add("ok");

      b.addEventListener("click", async () => {
        await setMeta("activeRoom", room);
        await setMeta("activeDeviceKey", d.deviceKey);
        await render();
        el.photoGrid.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      btnBox.appendChild(b);
      hasMatch = true;
    }
    
    if (onlyInc && !hasMatch && items.length > 0) {
      // Show placeholder if filtered out
      const p = document.createElement("span");
      p.style.fontSize = "10px";
      p.style.color = "#555";
      p.textContent = "(完了済み非表示)";
      btnBox.appendChild(p);
    }

    card.appendChild(btnBox);
    el.roomList.appendChild(card);
  }
}

async function renderDeviceAdder(activeRoom) {
  if (!activeRoom) {
    el.deviceAdderPanel.classList.add("disabled");
    el.targetRoomDisplay.textContent = "（部屋を選択してください）";
    return;
  }
  el.deviceAdderPanel.classList.remove("disabled");
  el.targetRoomDisplay.textContent = activeRoom;

  // Grid is static, but logic needs activeRoom
  // Re-generate grid only once or on load? 
  // We can just keep the listeners aware of activeRoom state.
}

async function renderPhotos() {
  const deviceKey = await getActiveDeviceKey();
  el.photoGrid.innerHTML = "";

  if (!deviceKey) {
    el.targetDeviceDisplay.textContent = "（未選択）";
    el.photoMeta.textContent = "上の部屋リストから機器番号を選択してください";
    el.btnOpenCamera.disabled = true;
    el.btnOpenCamera.innerHTML = "機器を選択してください";
    return;
  }

  const [r, idx] = deviceKey.split("::");
  const label = makeRoomDeviceLabel(r, Number(idx));
  el.targetDeviceDisplay.textContent = Number(idx) === 0 ? "FREE" : formatDeviceIndex(idx);

  const shots = await db.shots.where("deviceKey").equals(deviceKey).toArray();
  shots.sort((a,b)=>b.createdAt-a.createdAt);

  const done = new Set(shots.map(s=>s.kind));
  // Simple check visual
  const missing = REQUIRED_KINDS.filter(k => !done.has(k)).length;
  el.photoMeta.textContent = missing === 0 
    ? "✅ 必須撮影完了" 
    : `残り必須: ${missing}枚 (${REQUIRED_KINDS.filter(k=>!done.has(k)).map(k=>KIND_LABEL[k]).join(", ")})`;

  el.btnOpenCamera.disabled = false;
  el.btnOpenCamera.innerHTML = `<span style="font-size:24px">📷</span> 撮影へ (現在${shots.length}枚)`;

  for (const s of shots) {
    const url = URL.createObjectURL(s.thumbBlob || s.blob);
    const div = document.createElement("div");
    div.className = "shot";
    div.innerHTML = `
      <img src="${url}">
      <div class="shotCap">
        <span>${KIND_LABEL[s.kind] || s.kind}</span>
        <button class="danger" style="padding:4px 8px; font-size:10px;">×</button>
      </div>
    `;
    
    // Preview
    div.querySelector("img").addEventListener("click", async () => {
       const shot = await db.shots.get(s.id);
       if(shot) openPreview(shot);
    });

    // Delete
    div.querySelector("button").addEventListener("click", async (e) => {
      e.stopPropagation();
      if(!confirm("写真を削除しますか？")) return;
      URL.revokeObjectURL(url);
      await db.shots.delete(s.id);
      
      const checked = await computeChecked(deviceKey);
      const dev = await db.devices.get(deviceKey);
      if (dev) await db.devices.put({ ...dev, checked, updatedAt: Date.now() });
      await render();
    });

    el.photoGrid.appendChild(div);
  }
}

async function openPreview(shot) {
  const url = URL.createObjectURL(shot.blob);
  el.previewImg.src = url;
  el.previewTitle.textContent = KIND_LABEL[shot.kind] || shot.kind;
  el.preview.classList.remove("hidden");
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}

// --- Main Render ---
async function render() {
  const pj = await getProjectName();
  const room = await getActiveRoom();
  const key = await getActiveDeviceKey();

  if (el.projectName) el.projectName.value = pj;
  
  updateStatusBar(pj, room, key);
  await renderRooms();
  await renderDeviceAdder(room);
  await renderPhotos();
  await checkStorage();
}

async function checkStorage() {
  if (!navigator.storage?.estimate) return;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const u = Math.round(usage/1024/1024);
    const q = Math.round(quota/1024/1024);
    el.storageWarn.textContent = `使用量: ${u}MB / ${q}MB`;
  } catch {}
}

// --- Event Listeners ---

async function init() {
  await ensureDefaults();

  // Project Name
  el.projectName.addEventListener("input", async () => {
    await setMeta("projectName", el.projectName.value.trim());
    updateStatusBar(el.projectName.value.trim(), await getActiveRoom(), await getActiveDeviceKey());
  });

  // Add Room
  el.btnAddRoom.addEventListener("click", async () => {
    const name = normalizeRoomName(el.floorName.value);
    if (!name) return;
    const rooms = await getRooms();
    if (!rooms.includes(name)) {
      rooms.push(name);
      await setRooms(rooms);
    }
    await setMeta("activeRoom", name);
    // Optional: Clear active device when adding new room? No, maybe user wants to continue.
    el.floorName.value = ""; // Clear input
    await render();
  });

  // Manual Device Add
  el.btnAddManualDevice.addEventListener("click", async () => {
    const room = await getActiveRoom();
    if (!room) return alert("部屋を選択してください");
    
    const num = el.manualDeviceNo.value.trim();
    if (!num) return;
    
    const key = await upsertDevice(room, num);
    await setMeta("activeDeviceKey", key);
    el.manualDeviceNo.value = "";
    await render();
    // Scroll to photos
    el.photoGrid.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Grid Generator
  for (let i = 1; i <= 199; i++) {
    const b = document.createElement("button");
    b.textContent = formatDeviceIndex(i);
    b.addEventListener("click", async () => {
      const room = await getActiveRoom();
      if (!room) return alert("部屋を選択してください");
      const key = await upsertDevice(room, i);
      await setMeta("activeDeviceKey", key);
      // Close grid?
      el.deviceNoPicker.removeAttribute("open");
      await render();
      el.photoGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    el.devicePad.appendChild(b);
  }

  // Camera Button
  el.btnOpenCamera.addEventListener("click", async () => {
    const key = await getActiveDeviceKey();
    if (!key) return;
    const isFree = key.endsWith("::000");
    location.href = `./camera.html?deviceKey=${encodeURIComponent(key)}${isFree ? "&free=1" : ""}`;
  });

  // Filter
  el.onlyIncomplete.addEventListener("change", async () => {
    await setMeta("onlyIncomplete", el.onlyIncomplete.checked ? "1" : "0");
    await renderRooms();
  });

  // Preview / Export / Wipe
  el.closePreview.addEventListener("click", () => el.preview.classList.add("hidden"));
  el.zoomReset.addEventListener("click", () => { el.previewImg.style.transform = "scale(1)"; });
  el.btnExport.addEventListener("click", async () => {
     // Re-import original export logic or simplify
     const { exportZip } = await import("./export.js").catch(() => ({exportZip:null})); // Assuming split, but for single file:
     // Copy-paste original export logic here or define below.
     // For brevity in this response, I'll invoke the original logic structure.
     await _doExport(); 
  });
  el.btnWipe.addEventListener("click", async () => {
    if(confirm("全データを削除しますか？復元できません。")) {
      await db.devices.clear();
      await db.shots.clear();
      await db.meta.clear();
      await ensureDefaults();
      location.reload();
    }
  });

  await render();
}

// Restore Export Logic (Simplified for inclusion)
async function _doExport() {
  const ts = new Date().toISOString().replace(/[-:T.]/g,"").slice(0,14);
  const devices = await db.devices.toArray();
  const shots = await db.shots.toArray();
  
  let csv = "deviceKey,room,idx,checked,updated\n" + devices.map(d=>
    `${d.deviceKey},${d.roomName},${d.deviceIndex},${d.checked?1:0},${d.updatedAt}`
  ).join("\n");
  
  const { zipSync, strToU8 } = window.fflate;
  const files = { "devices.csv": strToU8(csv) };
  
  const pj = sanitizeFile(await getProjectName());
  
  for(const s of shots) {
     const [r,i] = s.deviceKey.split("::");
     const name = `${pj}_${sanitizeFile(r)}_${i}_${s.kind}_${s.id}.jpg`;
     files[`photos/${sanitizeFile(r)}/${name}`] = new Uint8Array(await s.blob.arrayBuffer());
  }
  
  const zipped = zipSync(files);
  const blob = new Blob([zipped], {type:"application/zip"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stampcam_${ts}.zip`;
  a.click();
}

init();