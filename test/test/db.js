// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  // v4: deviceKey (roomName + deviceIndex) に統一
  db.version(4).stores({
    devices: "deviceKey, roomName, deviceIndex, checked, updatedAt",
    shots: "++id, deviceKey, kind, createdAt",
    meta: "key"
  }).upgrade(async () => {
    // 旧データ移行はしない（必要なら全削除）
  });

  return db;
}
