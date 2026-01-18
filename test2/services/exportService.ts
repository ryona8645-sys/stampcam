import JSZip from 'jszip';
import { db } from '../db';
import { Shot, Device } from '../types';

const sanitizeFilename = (str: string) => {
  return str.replace(/[^a-z0-9\-]/gi, '_');
};

const formatDate = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

export const generateZip = async (projectName: string, setProgress: (msg: string) => void) => {
  const zip = new JSZip();
  const shots = await db.shots.toArray();
  const devices = await db.devices.toArray();

  const deviceMap = new Map(devices.map(d => [d.deviceKey, d] as [string, Device]));

  setProgress(`Found ${shots.length} photos...`);

  let count = 0;
  for (const shot of shots) {
    const device = deviceMap.get(shot.deviceKey);
    const roomName = device ? device.roomName : 'unknown';
    const deviceIdx = device ? device.deviceIndex.toString().padStart(3, '0') : '000';
    
    // Format: [Project][Room_Device][Kind][Date].jpg
    const safeProject = sanitizeFilename(projectName);
    const safeRoom = sanitizeFilename(roomName);
    const safeKind = shot.kind;
    const dateStr = formatDate(shot.createdAt);

    const fileName = `${safeProject}_${safeRoom}_機器${deviceIdx}_${safeKind}_${dateStr}.jpg`;

    zip.file(fileName, shot.blob);
    count++;
    if (count % 5 === 0) {
      setProgress(`Packing ${count}/${shots.length}...`);
    }
  }

  setProgress('Compressing...');
  const content = await zip.generateAsync({ type: 'blob' });
  return content;
};