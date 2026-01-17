import { zipSync, strToU8 } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/index.js";

function pad(n) { return String(n).padStart(2, "0"); }
function ts(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function sanitizeFileName(s) {
  return (s || "noname").replace(/[\\/:*?"<>|]/g, "_").trim();
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function buildZip({ projectName, devices, progresses, shots }) {
  // files: { "path/file": Uint8Array }
  const files = {};

  // CSV
  const devHeader = "deviceNo,type,maker,model,serial,ip,mac,notes\n";
  const devRows = devices.map(d => [
    d.deviceNo, d.type, d.maker, d.model, d.serial, d.ip, d.mac, d.notes
  ].map(v => `"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
  files["devices.csv"] = strToU8(devHeader + devRows + "\n");

  const prHeader = "deviceNo,done_overview,done_lamp,done_port,done_label,checked\n";
  const prRows = progresses.map(p => {
    const done = new Set(p.doneKinds || []);
    return [
      p.deviceNo,
      done.has("overview") ? 1 : 0,
      done.has("lamp") ? 1 : 0,
      done.has("port") ? 1 : 0,
      done.has("label") ? 1 : 0,
      p.checked ? 1 : 0
    ].join(",");
  }).join("\n");
  files["progress.csv"] = strToU8(prHeader + prRows + "\n");

  // Photos
  // shots: {deviceNo, kind, createdAt, blob, mime}
  for (const s of shots) {
    const dt = new Date(s.createdAt);
    const name = `${s.kind}_${ts(dt)}.jpg`; // ここは常にjpgに寄せる（保存時にjpg化してる前提）
    const path = `photos/${sanitizeFileName(s.deviceNo)}/${name}`;
    const buf = new Uint8Array(await s.blob.arrayBuffer());
    files[path] = buf;
  }

  const zipped = zipSync(files, { level: 6 });
  const zipName = `${sanitizeFileName(projectName)}_${ts()}.zip`;
  return { zipped, zipName };
}

