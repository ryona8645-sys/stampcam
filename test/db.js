// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  // v3: 部屋名 + 部屋内番号で機器を管理。通し番号(serialNo)はCSV用に後から付与。
  db.version(3).stores({
    devices: "++id, [roomName+localNo], roomName, localNo, serialNo, updatedAt, checked",
    shots: "++id, deviceId, kind, createdAt",
    meta: "key"
  }).upgrade(async () => {
    // v1/v2 -> v3: 互換が大きく変わるので、必要ならアプリの「全削除」を実行してください。
  });

  return db;
}
