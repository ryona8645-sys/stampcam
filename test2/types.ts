export enum PhotoKind {
  OVERVIEW = 'overview',
  LAMP = 'lamp',
  PORT = 'port',
  LABEL = 'label',
  IPADDRESS = 'ipaddress',
}

export const MANDATORY_KINDS = [
  PhotoKind.OVERVIEW,
  PhotoKind.LAMP,
  PhotoKind.PORT,
  PhotoKind.LABEL,
];

export interface Device {
  id?: number;
  deviceKey: string; // "RoomName::001"
  roomName: string;
  deviceIndex: number; // 1 to 199
  checked: boolean;
  updatedAt: number;
}

export interface Shot {
  id?: number;
  deviceKey: string;
  kind: PhotoKind;
  createdAt: number; // timestamp
  blob: Blob;
  thumbBlob: Blob;
}

export interface AppMeta {
  key: string; // 'state'
  projectName: string;
  currentRoom: string; // Input field value
  registeredRooms: string[];
  activeRoom: string | null;
  activeDeviceKey: string | null;
  lastShotId: number | null;
  showIncompleteOnly: boolean;
}

export interface StorageStats {
  usage: number;
  quota: number;
  percent: number;
}