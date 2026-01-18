import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initMeta } from '../db';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Camera, Download, AlertTriangle, Home as HomeIcon } from 'lucide-react';
import { DeviceGrid } from './DeviceGrid';
import { getStorageEstimate, formatBytes } from '../services/storageService';
import { generateZip } from '../services/exportService';
import { clsx } from 'clsx';
import { MANDATORY_KINDS } from '../types';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const meta = useLiveQuery(() => db.meta.get('state'));
  const devices = useLiveQuery(() => db.devices.toArray());
  const shots = useLiveQuery(() => db.shots.toArray());

  const [storageStats, setStorageStats] = useState({ percent: 0, usage: 0, quota: 0 });
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  // Load Meta & Stats
  useEffect(() => {
    initMeta();
    const interval = setInterval(async () => {
      const stats = await getStorageEstimate();
      setStorageStats(stats);
    }, 5000);
    getStorageEstimate().then(setStorageStats);
    return () => clearInterval(interval);
  }, []);

  if (!meta) return <div className="p-4">Loading App State...</div>;

  // Handlers
  const updateProjectName = (name: string) => db.meta.update('state', { projectName: name });
  const updateCurrentRoomInput = (name: string) => db.meta.update('state', { currentRoom: name });

  const addRoom = async () => {
    const name = meta.currentRoom.trim();
    if (!name || name === '-') return;
    if (meta.registeredRooms.includes(name)) {
      alert('既に登録されています');
      return;
    }
    const newRooms = [...meta.registeredRooms, name];
    await db.meta.update('state', { 
      registeredRooms: newRooms, 
      activeRoom: name,
      currentRoom: '-' // Reset input
    });
  };

  const selectRoom = (name: string) => db.meta.update('state', { activeRoom: name });

  const deleteRoom = async (name: string) => {
    if (!confirm(`${name} とその配下のデータを全て削除しますか？`)) return;
    
    // Delete devices and shots for this room
    const roomDevices = await db.devices.where('roomName').equals(name).toArray();
    const deviceKeys = roomDevices.map(d => d.deviceKey);
    
    await db.devices.where('roomName').equals(name).delete();
    await db.shots.where('deviceKey').anyOf(deviceKeys).delete();

    const newRooms = meta.registeredRooms.filter(r => r !== name);
    await db.meta.update('state', { 
      registeredRooms: newRooms, 
      activeRoom: meta.activeRoom === name ? null : meta.activeRoom 
    });
  };

  const handleDeviceSelect = async (num: number) => {
    if (!meta.activeRoom) return;
    const deviceIndex = num;
    const roomName = meta.activeRoom;
    const deviceKey = `${roomName}::${deviceIndex.toString().padStart(3, '0')}`;

    // Create if not exists
    const exists = await db.devices.where('deviceKey').equals(deviceKey).first();
    if (!exists) {
      await db.devices.add({
        deviceKey,
        roomName,
        deviceIndex,
        checked: false,
        updatedAt: Date.now()
      });
    }

    await db.meta.update('state', { activeDeviceKey: deviceKey });
    navigate(`/camera/${encodeURIComponent(deviceKey)}`);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportMsg('Preparing...');
    try {
      const zipBlob = await generateZip(meta.projectName, setExportMsg);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Survey_${meta.projectName}_${new Date().toISOString().slice(0,10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Export failed');
    } finally {
      setExporting(false);
      setExportMsg('');
    }
  };

  // Filtered devices for the active room
  const activeRoomDevices = devices?.filter(d => d.roomName === meta.activeRoom)
    .sort((a,b) => a.deviceIndex - b.deviceIndex) || [];

  const displayDevices = onlyIncomplete ? activeRoomDevices.filter(d => !d.checked) : activeRoomDevices;

  return (
    <div className="min-h-screen pb-20 max-w-2xl mx-auto bg-gray-50 shadow-xl">
      {/* Header */}
      <header className="bg-blue-900 text-white p-4 shadow-lg sticky top-0 z-20">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Camera className="w-6 h-6" /> ICT Survey Cam
        </h1>
        {storageStats.percent > 85 && (
          <div className={clsx("mt-2 text-xs p-2 rounded flex items-center gap-2", storageStats.percent > 92 ? "bg-red-600" : "bg-yellow-600")}>
            <AlertTriangle size={14} />
            Storage: {storageStats.percent.toFixed(1)}% used ({formatBytes(storageStats.usage)})
          </div>
        )}
      </header>

      <div className="p-4 space-y-6">
        {/* Project Info */}
        <section className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
          <label className="block text-xs font-bold text-gray-500 uppercase">案件名</label>
          <input 
            type="text" 
            value={meta.projectName} 
            onChange={e => updateProjectName(e.target.value)}
            className="w-full mt-1 p-2 border rounded font-mono bg-gray-50"
          />
        </section>

        {/* Room Management */}
        <section className="space-y-4">
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
             <label className="block text-xs font-bold text-gray-500 uppercase mb-2">部屋登録</label>
             <div className="flex gap-2">
               <input 
                  type="text" 
                  value={meta.currentRoom} 
                  onChange={e => updateCurrentRoomInput(e.target.value)}
                  placeholder="部屋名を入力"
                  className="flex-1 p-2 border rounded"
                  onFocus={(e) => e.target.select()}
                />
                <button onClick={addRoom} className="bg-blue-600 text-white px-4 rounded hover:bg-blue-700 flex items-center">
                  <Plus /> 追加
                </button>
             </div>
          </div>

          {/* Room List (Horizontal Scroll) */}
          {meta.registeredRooms.length > 0 && (
             <div className="flex overflow-x-auto gap-3 pb-2 no-scrollbar">
               {meta.registeredRooms.map(room => (
                 <div 
                  key={room} 
                  className={clsx(
                    "flex-shrink-0 w-48 p-3 rounded-lg border-2 transition-all cursor-pointer relative group",
                    meta.activeRoom === room ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white"
                  )}
                  onClick={() => selectRoom(room)}
                 >
                    <div className="font-bold truncate pr-6">{room}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Devices: {devices?.filter(d => d.roomName === room).length}
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteRoom(room); }}
                      className="absolute top-2 right-2 text-gray-400 hover:text-red-500 p-1"
                    >
                      <Trash2 size={16} />
                    </button>
                    {meta.activeRoom === room && (
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                        Active
                      </div>
                    )}
                 </div>
               ))}
             </div>
          )}
        </section>

        {/* Active Room Area */}
        {meta.activeRoom && (
          <section className="animate-fade-in">
             <div className="flex items-center justify-between mb-2">
               <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                 <HomeIcon size={20} />
                 {meta.activeRoom}
               </h2>
               <label className="flex items-center text-sm gap-2">
                 <input 
                  type="checkbox" 
                  checked={onlyIncomplete} 
                  onChange={e => setOnlyIncomplete(e.target.checked)} 
                  className="rounded text-blue-600"
                />
                 未完了のみ
               </label>
             </div>

             {/* Device List Grid */}
             <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {displayDevices.map(d => {
                  const dShots = shots?.filter(s => s.deviceKey === d.deviceKey);
                  const count = dShots?.length || 0;
                  const percent = Math.round((count / MANDATORY_KINDS.length) * 100); // Rough estimate
                  // Better percent logic based on unique mandatory kinds
                  const uniqueKinds = new Set(dShots?.map(s => s.kind));
                  const mandatoryCount = MANDATORY_KINDS.filter(k => uniqueKinds.has(k)).length;
                  const isDone = mandatoryCount === MANDATORY_KINDS.length;

                  return (
                    <button
                      key={d.deviceKey}
                      onClick={() => navigate(`/camera/${encodeURIComponent(d.deviceKey)}`)}
                      className={clsx(
                        "p-3 rounded-lg border shadow-sm flex flex-col items-center justify-center relative min-h-[80px]",
                        isDone ? "bg-green-50 border-green-300" : "bg-white border-gray-200"
                      )}
                    >
                      <span className="font-mono text-lg font-bold">No.{d.deviceIndex.toString().padStart(3, '0')}</span>
                      <div className="w-full bg-gray-200 h-1.5 mt-2 rounded-full overflow-hidden">
                        <div className={clsx("h-full", isDone ? "bg-green-500" : "bg-blue-500")} style={{ width: `${(mandatoryCount/4)*100}%` }} />
                      </div>
                      {isDone && <CheckCircleIcon />}
                    </button>
                  );
                })}
             </div>
             
             {displayDevices.length === 0 && (
               <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-lg">
                 {onlyIncomplete ? "未完了の機器はありません" : "まだ機器が登録されていません"}
               </div>
             )}

             <DeviceGrid onSelect={handleDeviceSelect} />
          </section>
        )}
      </div>

      {/* Floating Action Button for Export */}
      {devices && devices.length > 0 && (
        <div className="fixed bottom-6 right-6 z-30">
          <button 
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-4 rounded-full shadow-xl hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-95"
          >
             {exporting ? (
               <span className="animate-pulse">{exportMsg}</span>
             ) : (
               <>
                 <Download /> ZIP保存
               </>
             )}
          </button>
        </div>
      )}
    </div>
  );
};

const CheckCircleIcon = () => (
  <div className="absolute top-1 right-1 text-green-500">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>
  </div>
);
