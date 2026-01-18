// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  // v3: devicesに roomName を追加（既存データはそのまま）
  db.version(3).stores({
    devices: "++id, deviceNo, updatedAt, checked, roomName",
    shots: "++id, deviceNo, kind, createdAt",
    meta: "key"
  }).upgrade(async () => {
    // 旧データの移行は不要（roomNameは未設定扱い）
  });

  return db;
}
