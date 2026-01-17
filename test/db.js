const DB_NAME = "phototool_test_db";
const DB_VER = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("projects")) {
        const s = db.createObjectStore("projects", { keyPath: "projectId" });
        s.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("devices")) {
        const s = db.createObjectStore("devices", { keyPath: ["projectId", "deviceNo"] });
        s.createIndex("projectId", "projectId", { unique: false });
      }

      if (!db.objectStoreNames.contains("shots")) {
        const s = db.createObjectStore("shots", { keyPath: "shotId" });
        s.createIndex("byProjectDevice", ["projectId", "deviceNo"], { unique: false });
        s.createIndex("byProject", "projectId", { unique: false });
      }

      if (!db.objectStoreNames.contains("progress")) {
        const s = db.createObjectStore("progress", { keyPath: ["projectId", "deviceNo"] });
        s.createIndex("projectId", "projectId", { unique: false });
        s.createIndex("checked", "checked", { unique: false });
      }

      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = storeNames.map(n => t.objectStore(n));
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    out = fn(...stores);
  });
}

export async function dbPut(store, value) {
  const db = await openDB();
  return tx(db, [store], "readwrite", (s) => s.put(value));
}

export async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction([store], "readonly");
    const s = t.objectStore(store);
    const req = s.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function dbDelete(store, key) {
  const db = await openDB();
  return tx(db, [store], "readwrite", (s) => s.delete(key));
}

export async function dbClearAll() {
  const db = await openDB();
  return tx(db, ["projects", "devices", "shots", "progress", "kv"], "readwrite",
    (p, d, s, pr, kv) => {
      p.clear(); d.clear(); s.clear(); pr.clear(); kv.clear();
    }
  );
}

export async function kvSet(key, value) {
  return dbPut("kv", { key, value });
}
export async function kvGet(key) {
  const v = await dbGet("kv", key);
  return v ? v.value : null;
}

export async function ensureProject(name) {
  const projectId = "p_" + Date.now();
  const now = Date.now();
  const project = { projectId, name, createdAt: now, updatedAt: now, retentionDays: 30 };
  await dbPut("projects", project);
  await kvSet("currentProjectId", projectId);
  return project;
}

export async function getCurrentProjectId() {
  return await kvGet("currentProjectId");
}

export async function getProject(projectId) {
  return await dbGet("projects", projectId);
}

export async function upsertDevice(projectId, deviceNo) {
  const key = [projectId, deviceNo];
  const existing = await dbGet("devices", key);
  const now = Date.now();
  const rec = existing || {
    projectId, deviceNo,
    type: "", maker: "", model: "", serial: "", ip: "", mac: "",
    notes: "", updatedAt: now
  };
  rec.updatedAt = now;
  await dbPut("devices", rec);

  // progressも作る
  const pKey = [projectId, deviceNo];
  const prog = await dbGet("progress", pKey);
  if (!prog) {
    await dbPut("progress", {
      projectId, deviceNo,
      requiredKinds: ["overview", "lamp", "port", "label"],
      doneKinds: [],
      checked: false,
      updatedAt: now
    });
  }
  return rec;
}

export async function listDevices(projectId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["devices"], "readonly");
    const s = t.objectStore("devices").index("projectId");
    const req = s.getAll(IDBKeyRange.only(projectId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getProgress(projectId, deviceNo) {
  return await dbGet("progress", [projectId, deviceNo]);
}

export async function setProgress(projectId, deviceNo, patch) {
  const key = [projectId, deviceNo];
  const cur = await dbGet("progress", key);
  const now = Date.now();
  const next = { ...(cur || { projectId, deviceNo }), ...patch, updatedAt: now };
  await dbPut("progress", next);
  return next;
}

export async function addShot({ projectId, deviceNo, kind, blob, mime, width, height }) {
  const shotId = "s_" + crypto.randomUUID();
  const rec = { shotId, projectId, deviceNo, kind, blob, mime, width, height, createdAt: Date.now() };
  await dbPut("shots", rec);
  return rec;
}

export async function deleteShot(shotId) {
  await dbDelete("shots", shotId);
}

export async function listShotsByDevice(projectId, deviceNo) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["shots"], "readonly");
    const idx = t.objectStore("shots").index("byProjectDevice");
    const req = idx.getAll(IDBKeyRange.only([projectId, deviceNo]));
    req.onsuccess = () => resolve((req.result || []).sort((a,b)=>b.createdAt-a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function listAllShots(projectId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(["shots"], "readonly");
    const idx = t.objectStore("shots").index("byProject");
    const req = idx.getAll(IDBKeyRange.only(projectId));
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function cleanupExpiredProjects() {
  // retentionDays超過のプロジェクトを全削除（必要なら後で”完了後のみ削除”に変更）
  const db = await openDB();
  const projects = await new Promise((resolve, reject) => {
    const t = db.transaction(["projects"], "readonly");
    const s = t.objectStore("projects");
    const req = s.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const now = Date.now();
  for (const p of projects) {
    const keepMs = (p.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    if (now - p.updatedAt > keepMs) {
      // projectIdに紐づくdevices/progress/shotsも消す（簡易：全件走査）
      const pid = p.projectId;
      const devs = await listDevices(pid);
      for (const d of devs) {
        await dbDelete("devices", [pid, d.deviceNo]);
        await dbDelete("progress", [pid, d.deviceNo]);
      }
      const shots = await listAllShots(pid);
      for (const s of shots) await dbDelete("shots", s.shotId);
      await dbDelete("projects", pid);
      const cur = await getCurrentProjectId();
      if (cur === pid) await kvSet("currentProjectId", null);
    }
  }
}

