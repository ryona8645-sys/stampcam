import {
  kvGet, kvSet, ensureProject, getCurrentProjectId, getProject,
  upsertDevice, listDevices, getProgress, setProgress,
  addShot, listShotsByDevice, deleteShot, listAllShots,
  cleanupExpiredProjects, dbClearAll
} from "./db.js";

import { buildZip, downloadBlob } from "./zip.js";

const $ = (id) => document.getElementById(id);

const ui = {
  status: $("status"),
  btnInstall: $("btnInstall"),
  btnExport: $("btnExport"),
  btnWipe: $("btnWipe"),
  projectName: $("projectName"),
  btnNewProject: $("btnNewProject"),
  deviceNo: $("deviceNo"),
  btnOpenDevice: $("btnOpenDevice"),
  search: $("search"),
  onlyPending: $("onlyPending"),
  btnRefresh: $("btnRefresh"),
  deviceList: $("deviceList"),

  currentDevice: $("currentDevice"),
  reqState: $("reqState"),
  btnMarkDone: $("btnMarkDone"),

  video: $("video"),
  btnShot: $("btnShot"),
  btnTorch: $("btnTorch"),
  btnSwitchCam: $("btnSwitchCam"),
  shots: $("shots")
};

const REQUIRED = ["overview", "lamp", "port", "label"];

let state = {
  projectId: null,
  project: null,
  deviceNo: null,
  stream: null,
  facingMode: "environment", // environment / user
  torchOn: false,
  pendingKind: "overview"
};

function setStatus(msg) {
  ui.status.textContent = msg || "";
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/test/sw.js", { scope: "/test/" });
  } catch (e) {
    console.error(e);
    setStatus("SW登録失敗");
  }
}

let deferredPrompt = null;
function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    ui.btnInstall.hidden = false;
  });
  ui.btnInstall.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    ui.btnInstall.hidden = true;
  });
}

async function ensureCurrentProject() {
  let pid = await getCurrentProjectId();
  if (!pid) {
    const p = await ensureProject(ui.projectName.value || "project");
    state.projectId = p.projectId;
    state.project = p;
    ui.projectName.value = p.name;
    return;
  }
  const p = await getProject(pid);
  if (!p) {
    const np = await ensureProject(ui.projectName.value || "project");
    state.projectId = np.projectId;

