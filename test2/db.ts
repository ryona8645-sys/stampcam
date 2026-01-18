import Dexie, { Table } from 'dexie';
import { Device, Shot, AppMeta, PhotoKind, MANDATORY_KINDS } from './types';

class SurveyDatabase extends Dexie {
  devices!: Table<Device>;
  shots!: Table<Shot>;
  meta!: Table<AppMeta>;

  constructor() {
    super('ICTSurveyDB');
    (this as any).version(1).stores({
      devices: '++id, &deviceKey, roomName, deviceIndex, checked',
      shots: '++id, deviceKey, kind, createdAt',
      meta: '&key'
    });
  }
}

export const db = new SurveyDatabase();

// Initial Meta Setup
export const initMeta = async () => {
  const exists = await db.meta.get('state');
  if (!exists) {
    await db.meta.add({
      key: 'state',
      projectName: '-',
      currentRoom: '-',
      registeredRooms: [],
      activeRoom: null,
      activeDeviceKey: null,
      lastShotId: null,
      showIncompleteOnly: false,
    });
  }
};

// Check if a device is complete
export const checkDeviceStatus = async (deviceKey: string) => {
  const shots = await db.shots.where('deviceKey').equals(deviceKey).toArray();
  const takenKinds = new Set(shots.map((s) => s.kind));
  const isComplete = MANDATORY_KINDS.every((kind) => takenKinds.has(kind));

  await db.devices.where('deviceKey').equals(deviceKey).modify({ checked: isComplete, updatedAt: Date.now() });
};