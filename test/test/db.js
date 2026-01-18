// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  db.version(2).stores({
    devices: "++id, deviceNo, updatedAt, checked",
    shots: "++id, deviceNo, kind, createdAt",
    meta: "key"
  }).upgrade(async () => {
    // v1 -> v2: 既存データのサムネ一括生成は重いので実施しない。
  });

  return db;
}
