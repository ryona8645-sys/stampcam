// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  db.version(1).stores({
    devices: "++id, deviceNo, updatedAt, checked", // deviceNo unique扱いはアプリ側で制御
    shots: "++id, deviceNo, kind, createdAt",
    meta: "key" // {key, value}
  });

  return db;
}
