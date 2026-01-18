// db.js
export function openDb() {
  const db = new Dexie("stampcam_test_v1");

  // v3: devicesにroomName追加
  db.version(3).stores({
    devices: "++id, deviceNo, roomName, updatedAt, checked",
    shots: "++id, deviceNo, kind, createdAt",
    meta: "key"
  }).upgrade(async (tx) => {
    await tx.table("devices").toCollection().modify((d) => {
      if (d.roomName === undefined) d.roomName = "";
    });
  });

  return db;
}
