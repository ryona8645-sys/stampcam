import { exportProjectZipTest } from "./export.js";

console.log("app.js loaded");

document.getElementById("btnExport").addEventListener("click", async () => {
  console.log("export start");
  await exportProjectZipTest();
  console.log("export done");
  alert("ZIPを作成しました");
});
