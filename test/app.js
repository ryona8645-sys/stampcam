import { openDb } from "./db.js";
const db = openDb();

function normalizeRoomName(s){ return String(s||"").trim() || "（未設定）"; }

const el = {
  projectName: document.getElementById("projectName"),
  floorName: document.getElementById("floorName"),
  btnAddRoom: document.getElementById("btnAddRoom"),
  roomList: document.getElementById("roomList"),};

async function getMeta(key, fallback=""){
  const v = await db.meta.get(key);
  return v?.value ?? fallback;
}
async function setMeta(key, value){
  await db.meta.put({ key, value });
}
async function getProjectName(){ return await getMeta("projectName",""); }
async function getRoomDraft(){ return await getMeta("floorName",""); }

async function getRooms(){
  const v = await db.meta.get("rooms");
  try { return JSON.parse(v?.value || "[]"); } catch { return []; }
}
async function setRooms(arr){
  const uniq = Array.from(new Set(arr.map(normalizeRoomName))).filter(Boolean);
  await db.meta.put({ key:"rooms", value: JSON.stringify(uniq) });
}


async function renderRooms(){
  const rooms = await getRooms();
  const devicesAll = await db.devices.toArray();

  el.roomList.innerHTML = "";

  for (const room of rooms){
    const card = document.createElement("div");
    card.className = "roomCard";

    const devs = devicesAll.filter(d=>normalizeRoomName(d.roomName)===room);
    const total = devs.length;
    const done = devs.filter(d=>d.checked).length;

    const head = document.createElement("div");
    head.className = "roomHead";

    const titleRow = document.createElement("div");
    titleRow.className = "roomTitleRow";
    titleRow.innerHTML = `
      <div class="roomTitle">${room}</div>
      <span class="badge">${total ? `完了 ${done}/${total}` : "未登録"}</span>
    `;

    const btnRow = document.createElement("div");
    btnRow.style.display="flex";
    btnRow.style.gap="8px";
    btnRow.style.alignItems="center";

    const btnOpen = document.createElement("button");
    btnOpen.className = "primary cta";
    btnOpen.textContent = "開く";
    btnOpen.addEventListener("click", ()=>{
      location.href = `./room.html?room=${encodeURIComponent(room)}`;
    });

    const btnDel = document.createElement("button");
    btnDel.className = "danger";
    btnDel.textContent = "削除";
    btnDel.addEventListener("click", async ()=>{
      const ok = confirm(`部屋「${room}」を削除します。\\nこの部屋の機器と写真も削除します。`);
      if (!ok) return;

      const keys = (await db.devices.where("roomName").equals(room).toArray()).map(d=>d.deviceKey);
      for (const k of keys){
        await db.devices.delete(k);
        const shots = await db.shots.where("deviceKey").equals(k).toArray();
        for (const s of shots) await db.shots.delete(s.id);
      }
      const next = (await getRooms()).filter(r=>r!==room);
      await setRooms(next);
      await renderRooms();
    });

    btnRow.appendChild(btnOpen);
    btnRow.appendChild(btnDel);

    head.appendChild(titleRow);
    head.appendChild(btnRow);

    card.addEventListener("click", (e)=>{
      if (e.target.closest("button")) return;
      location.href = `./room.html?room=${encodeURIComponent(room)}`;
    });

    card.appendChild(head);
    el.roomList.appendChild(card);
  }
}

async function ensureDefaults(){
  const pj = await getProjectName();
  if (pj === "") await setMeta("projectName","");
  const fl = await getRoomDraft();
  if (fl === "") await setMeta("floorName","");
  const rooms = await getRooms();
  if (!Array.isArray(rooms)) await setRooms([]);
}

async function init(){
  await ensureDefaults();

  el.projectName.value = await getProjectName();
  el.floorName.value = await getRoomDraft();

  el.projectName?.addEventListener("change", async ()=>{
    await setMeta("projectName", String(el.projectName.value||"").trim());
  });
  el.floorName?.addEventListener("change", async ()=>{
    await setMeta("floorName", String(el.floorName.value||"").trim());
  });

  el.btnAddRoom?.addEventListener("click", async ()=>{
    const room = normalizeRoomName(el.floorName.value);
    if (!room || room === "（未設定）") {
      alert("部屋名を入力してください。");
      return;
    }
    const rooms = await getRooms();
    if (!rooms.includes(room)) rooms.push(room);
    await setRooms(rooms);
    await renderRooms();
  });

  await renderRooms();
}

init();
