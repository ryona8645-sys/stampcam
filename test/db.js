// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  db.version(2).stores({
    devices: "++id, deviceNo, updatedAt, checked",
    // kind + createdAtで並べ替えしやすく
    shots: "++id, deviceNo, kind, createdAt",
    meta: "key"
  }).upgrade(async (tx) => {
    // v1 -> v2 で、既存shotsにthumbを後付けしたいならここで生成もできるが、
    // 1000枚生成は重いので「今後の新規撮影からthumb付き」にするのが現実的。
  });

  return db;
}

