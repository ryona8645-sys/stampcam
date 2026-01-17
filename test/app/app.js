import { exportProjectZipTest } from "./export.js";

// Service Worker 登録（PWA化の必須）
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

document.getElementById("btnExport").addEventListener("click", async () => {
  await exportProjectZipTest();
  alert("ZIPをダウンロードしました（テスト）");
});

