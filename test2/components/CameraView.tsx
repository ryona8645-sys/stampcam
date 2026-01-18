import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Zap, ZapOff, ZoomIn, Image as ImageIcon, CheckCircle, X } from 'lucide-react';
import { db, checkDeviceStatus } from '../db';
import { PhotoKind, MANDATORY_KINDS } from '../types';
import { clsx } from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';

const VIDEO_CONSTRAINTS_HD = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' };
const VIDEO_CONSTRAINTS_4K = { width: { ideal: 3840 }, height: { ideal: 2160 }, facingMode: 'environment' };

export const CameraView: React.FC = () => {
  const { deviceKey } = useParams<{ deviceKey: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  // State
  const [activeKind, setActiveKind] = useState<PhotoKind>(PhotoKind.OVERVIEW);
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [is4K, setIs4K] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [lastPhotoBlob, setLastPhotoBlob] = useState<string | null>(null);
  const [shutterEffect, setShutterEffect] = useState(false);

  // DB Data
  const device = useLiveQuery(() => db.devices.where('deviceKey').equals(deviceKey || '').first(), [deviceKey]);
  const shots = useLiveQuery(() => db.shots.where('deviceKey').equals(deviceKey || '').toArray(), [deviceKey]);

  // Derived State
  const takenKinds = new Set(shots?.map(s => s.kind));
  const completionPercent = (MANDATORY_KINDS.filter(k => takenKinds.has(k)).length / MANDATORY_KINDS.length) * 100;

  // Initialize Camera
  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }

    try {
      const constraints = {
        video: is4K ? VIDEO_CONSTRAINTS_4K : VIDEO_CONSTRAINTS_HD,
        audio: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const track = stream.getVideoTracks()[0];
      trackRef.current = track;

      // Capabilities (Zoom, Torch)
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      
      // @ts-ignore
      if (capabilities.zoom) {
        // @ts-ignore
        setMaxZoom(capabilities.zoom.max || 1);
      }
    } catch (err) {
      console.error("Camera Init Error", err);
      alert("カメラの起動に失敗しました。権限を確認してください。");
    }
  }, [is4K]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [startCamera]);

  // Apply Constraints (Zoom, Torch)
  const applyTrackConstraints = async (newConstraints: any) => {
    if (trackRef.current) {
      try {
        await trackRef.current.applyConstraints({ advanced: [newConstraints] });
      } catch (e) {
        console.warn("Constraints apply failed", e);
      }
    }
  };

  useEffect(() => {
    applyTrackConstraints({ zoom });
  }, [zoom]);

  useEffect(() => {
    applyTrackConstraints({ torch });
  }, [torch]);

  // Capture Logic
  const takePhoto = async () => {
    if (!videoRef.current || !deviceKey) return;

    setShutterEffect(true);
    setTimeout(() => setShutterEffect(false), 150);

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0);

    // Create blobs
    canvas.toBlob(async (blob) => {
      if (!blob) return;

      // Create thumbnail
      const thumbCanvas = document.createElement('canvas');
      const scale = 200 / canvas.width;
      thumbCanvas.width = 200;
      thumbCanvas.height = canvas.height * scale;
      const thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx?.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      
      thumbCanvas.toBlob(async (thumbBlob) => {
        if (!thumbBlob) return;

        const shotId = await db.shots.add({
          deviceKey,
          kind: activeKind,
          createdAt: Date.now(),
          blob: blob,
          thumbBlob: thumbBlob
        });

        await db.meta.update('state', { lastShotId: shotId });
        await checkDeviceStatus(deviceKey);

        const url = URL.createObjectURL(thumbBlob);
        setLastPhotoBlob(url);

        // Auto-advance logic could go here if requested, 
        // but user spec doesn't explicitly ask for auto-switch.
      }, 'image/jpeg', 0.6);
    }, 'image/jpeg', 0.9);
  };

  // UI Components
  if (!device) return <div className="h-screen flex items-center justify-center bg-black text-white">Loading...</div>;

  return (
    <div className="fixed inset-0 bg-black overflow-hidden flex flex-col">
      {/* Video Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Shutter Flash Effect */}
      <div className={clsx("absolute inset-0 bg-white pointer-events-none transition-opacity duration-150", shutterEffect ? "opacity-70" : "opacity-0")} />

      {/* Top Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 pt-safe-top bg-gradient-to-b from-black/70 to-transparent flex items-center z-10">
        <button onClick={() => navigate(-1)} className="text-white p-2 rounded-full bg-black/20 backdrop-blur-md">
          <ArrowLeft size={24} />
        </button>
        <div className="ml-4 text-white drop-shadow-md">
          <div className="text-xs opacity-80">{device.roomName}</div>
          <div className="font-bold text-xl tracking-wider">機器 {device.deviceIndex.toString().padStart(3, '0')}</div>
        </div>
        <div className="ml-auto">
             <div className="relative w-12 h-12">
               <svg className="w-full h-full transform -rotate-90">
                 <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-gray-500/50" />
                 <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-green-500 transition-all duration-300" strokeDasharray={125.6} strokeDashoffset={125.6 - (125.6 * completionPercent) / 100} />
               </svg>
               <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-bold">
                 {Math.round(completionPercent)}%
               </div>
             </div>
        </div>
      </div>

      {/* Right Drawer Trigger (Last Photo) */}
      {lastPhotoBlob && (
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-16 h-16 rounded-lg border-2 border-white shadow-lg overflow-hidden bg-black/50 z-20"
        >
          <img src={lastPhotoBlob} alt="Last shot" className="w-full h-full object-cover" />
        </button>
      )}

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-8 pb-safe-bottom z-10 flex flex-col gap-4">
        
        {/* Tools Row */}
        <div className="flex items-center justify-between px-6 text-white">
           {/* Resolution */}
           <button onClick={() => setIs4K(!is4K)} className="px-3 py-1 rounded bg-white/20 text-xs font-bold backdrop-blur">
            {is4K ? '4K' : 'HD'}
          </button>

          {/* Zoom Slider */}
          {maxZoom > 1 && (
            <div className="flex items-center gap-2 mx-4 flex-1">
              <span className="text-xs">1x</span>
              <input
                type="range"
                min="1"
                max={maxZoom}
                step="0.1"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-yellow-400"
              />
              <span className="text-xs">{maxZoom}x</span>
            </div>
          )}

          {/* Torch */}
          <button onClick={() => setTorch(!torch)} className={clsx("p-2 rounded-full backdrop-blur", torch ? "bg-yellow-400 text-black" : "bg-white/20")}>
            {torch ? <Zap size={20} /> : <ZapOff size={20} />}
          </button>
        </div>

        {/* Photo Kinds Scroll */}
        <div className="flex overflow-x-auto no-scrollbar gap-2 px-4 py-2">
          {Object.values(PhotoKind).map((kind) => {
            const isTaken = takenKinds?.has(kind);
            const isMandatory = MANDATORY_KINDS.includes(kind);
            return (
              <button
                key={kind}
                onClick={() => setActiveKind(kind)}
                className={clsx(
                  "flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all border",
                  activeKind === kind 
                    ? "bg-yellow-400 text-black border-yellow-400 scale-105 shadow-lg" 
                    : "bg-black/40 text-white border-white/30 backdrop-blur-sm",
                  isTaken && activeKind !== kind && "opacity-60 bg-green-900/40 border-green-500/50"
                )}
              >
                <div className="flex items-center gap-1">
                  {isTaken && <CheckCircle size={12} className="text-green-400" />}
                  <span>{kind.toUpperCase()}</span>
                  {isMandatory && <span className="text-red-400 text-[10px] ml-1">*</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Shutter Button Area */}
        <div className="flex justify-center pb-6">
          <button
            onClick={takePhoto}
            className="w-20 h-20 rounded-full border-4 border-white bg-white/20 flex items-center justify-center active:scale-95 transition-transform"
          >
            <div className="w-16 h-16 rounded-full bg-white shadow-inner" />
          </button>
        </div>
      </div>

      {/* Right Drawer (Gallery) */}
      {isDrawerOpen && (
        <div className="absolute inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setIsDrawerOpen(false)} />
          <div className="w-80 bg-gray-900 h-full overflow-y-auto p-4 shadow-2xl border-l border-gray-800">
            <div className="flex justify-between items-center mb-4 text-white">
              <h3 className="font-bold">撮影済み写真</h3>
              <button onClick={() => setIsDrawerOpen(false)}><X /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {shots?.sort((a,b) => b.createdAt - a.createdAt).map(shot => (
                <div key={shot.id} className="relative aspect-square rounded overflow-hidden border border-gray-700">
                  <img 
                    src={URL.createObjectURL(shot.thumbBlob)} 
                    className="w-full h-full object-cover" 
                    alt={shot.kind}
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] px-1 py-0.5 truncate">
                    {shot.kind}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};