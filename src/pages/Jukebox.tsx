import { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import { 
  getAssetsFromAddress, 
  Arc69, 
  getARC19AssetMetadataData 
} from "../utils";
import { IPFS_ENDPOINT } from "../constants";
import ConnectButton from "../components/ConnectButton";
import axios from "axios";
import { toast } from "react-toastify";
import { 
  PlayArrow, 
  Pause, 
  SkipNext, 
  SkipPrevious, 
  Shuffle, 
  Repeat, 
  List, 
  MusicNote,
  VolumeUp,
  Search
} from "@mui/icons-material";

interface MusicNFT {
  assetId: number;
  name: string;
  unitName: string;
  url: string;
  audioUrl: string;
  image: string;
  artist?: string;
  album?: string;
  mimeType?: string;
}

export function Jukebox() {
  const { activeAddress, activeNetwork, algodClient } = useWallet();
  const [assets, setAssets] = useState<number[]>([]);
  const [songs, setSongs] = useState<MusicNFT[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [currentSongIndex, setCurrentSongIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const arc69 = new Arc69();

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const fetchAssets = useCallback(async () => {
    if (!activeAddress) return;
    setLoading(true);
    try {
      const userAssets = await getAssetsFromAddress(activeAddress, activeNetwork);
      setAssets(userAssets);
    } catch (error) {
      console.error("Error fetching assets:", error);
      toast.error("Failed to fetch wallet assets.");
    } finally {
      setLoading(false);
    }
  }, [activeAddress, activeNetwork]);

  useEffect(() => {
    if (activeAddress) {
      fetchAssets();
    } else {
      setAssets([]);
      setSongs([]);
    }
  }, [activeAddress, activeNetwork, fetchAssets]);

  const ipfsToGateway = (url: string) => {
    if (!url) return "";
    if (url.startsWith("ipfs://")) {
      return url.replace("ipfs://", IPFS_ENDPOINT);
    }
    if (url.includes("ipfs.io/ipfs/")) {
        return url.replace("https://ipfs.io/ipfs/", IPFS_ENDPOINT);
    }
    return url;
  };

  const scanForMusic = useCallback(async () => {
    if (assets.length === 0) {
      toast.info("No assets found in wallet.");
      return;
    }
    setScanning(true);
    setSongs([]);
    const assetsToScan = [...assets].sort((a, b) => b - a);
    setScanProgress({ current: 0, total: assetsToScan.length });

    const foundSongs: MusicNFT[] = [];
    const batchSize = 10; // Process in small batches to respect rate limits
    
    for (let i = 0; i < assetsToScan.length; i += batchSize) {
      const batch = assetsToScan.slice(i, i + batchSize);
      const promises = batch.map(async (assetId) => {
        try {
          const assetInfo = await algodClient.getAssetByID(assetId).do();
          const url = assetInfo.params.url || "";
          const reserve = assetInfo.params.reserve || "";
          let metadata: any = null;

          // Check ARC19
          if (url.includes("template-ipfs")) {
            metadata = await getARC19AssetMetadataData(url, reserve);
          } 
          // Check ARC69
          else if (url === "" || url.startsWith("ipfs://") || url.includes("#arc69")) {
            metadata = await arc69.fetch(assetId, activeNetwork);
          }
          // Check ARC3
          if (!metadata || (!metadata.animation_url && !metadata.properties?.file_url)) {
            if (url.startsWith("ipfs://")) {
                try {
                    const resp = await axios.get(ipfsToGateway(url), { timeout: 5000 });
                    metadata = resp.data;
                } catch {
                    // Silently fail for individual metadata fetch
                }
            }
          }

          if (metadata) {
            let audioUrl = "";
            let mimeType = "";

            // Check common music NFT fields
            if (metadata.properties?.file_url) {
              audioUrl = ipfsToGateway(metadata.properties.file_url);
              mimeType = metadata.properties.file_url_mimetype || "";
            } else if (metadata.animation_url) {
              audioUrl = ipfsToGateway(metadata.animation_url);
              mimeType = metadata.animation_url_mime_type || "";
            }

            // Verify it's actually audio or video (music NFTs sometimes use animation_url for the song)
            if (audioUrl && (mimeType.includes("audio") || mimeType.includes("video") || audioUrl.endsWith(".mp3") || audioUrl.endsWith(".wav") || audioUrl.endsWith(".m4a"))) {
              const song: MusicNFT = {
                assetId,
                name: metadata.name || assetInfo.params.name,
                unitName: assetInfo.params["unit-name"],
                url,
                audioUrl,
                image: ipfsToGateway(metadata.image || ""),
                artist: metadata.properties?.artist || metadata.properties?.traits?.Artist || "",
                album: metadata.properties?.album || metadata.properties?.traits?.Album || "",
                mimeType
              };
              return song;
            }
          }
        } catch {
          // Silently fail for individual assets
        }
        return null;
      });

      const results = await Promise.all(promises);
      results.forEach(song => {
        if (song) {
          foundSongs.push(song);
          setSongs(prev => [...prev, song]);
        }
      });

      setScanProgress(prev => ({ ...prev, current: Math.min(i + batchSize, assetsToScan.length) }));
      
      // Small delay between batches to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    setScanning(false);
    if (foundSongs.length === 0) {
      toast.info("No music NFTs found.");
    } else {
      toast.success(`Found ${foundSongs.length} songs!`);
    }
  }, [algodClient, assets, activeNetwork, arc69]);

  // Auto-scan when assets are loaded
  useEffect(() => {
    if (assets.length > 0 && songs.length === 0 && !scanning) {
      scanForMusic();
    }
  }, [assets, songs.length, scanning, scanForMusic]);

  const togglePlay = () => {
    if (!audioRef.current || currentSongIndex === null) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const playSong = (index: number) => {
    setCurrentSongIndex(index);
    setIsPlaying(true);
    // Audio element source update happens via effect or directly
    if (audioRef.current) {
        audioRef.current.src = songs[index].audioUrl;
        audioRef.current.play();
    }
  };

  const nextSong = () => {
    if (songs.length === 0) return;
    let nextIndex;
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * songs.length);
    } else {
      nextIndex = (currentSongIndex! + 1) % songs.length;
    }
    playSong(nextIndex);
  };

  const prevSong = () => {
    if (songs.length === 0) return;
    const prevIndex = (currentSongIndex! - 1 + songs.length) % songs.length;
    playSong(prevIndex);
  };

  const onTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
      setDuration(audioRef.current.duration);
    }
  };

  const onEnded = () => {
    if (repeat) {
      audioRef.current?.play();
    } else {
      nextSong();
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setProgress(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const currentSong = currentSongIndex !== null ? songs[currentSongIndex] : null;

  return (
    <div className="mx-auto text-white mb-4 flex flex-col items-center max-w-6xl w-full px-4 min-h-screen">
      <h1 className="text-4xl font-black mt-8 mb-2 bg-gradient-to-r from-primary-yellow to-secondary-orange bg-clip-text text-transparent">
        JUKEBOX
      </h1>
      <p className="text-slate-400 mb-6 italic">The ultimate player for your Algorand Music NFTs</p>
      
      <ConnectButton inmain={true} />

      {!activeAddress ? (
        <div className="mt-20 p-10 bg-primary-black/60 border border-slate-800 rounded-2xl text-center backdrop-blur-xl">
           <MusicNote className="text-6xl text-slate-700 mb-4" />
           <p className="text-xl font-bold text-slate-300">Connect your wallet to start the show</p>
        </div>
      ) : (
        <div className="w-full mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Player View */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="bg-gradient-to-br from-slate-900 to-black p-8 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden group">
              {/* Background Glow */}
              <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary-yellow/10 rounded-full blur-3xl group-hover:bg-primary-yellow/20 transition-all duration-700"></div>
              
              <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
                {/* Album Art */}
                <div className="w-64 h-64 bg-slate-800 rounded-2xl shadow-2xl overflow-hidden flex-shrink-0 border-2 border-slate-700">
                  {currentSong?.image ? (
                    <img src={currentSong.image} alt={currentSong.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-slate-900">
                      <MusicNote className="text-6xl text-slate-700" />
                    </div>
                  )}
                </div>

                {/* Track Info & Controls */}
                <div className="flex-grow w-full text-center md:text-left">
                  <h2 className="text-3xl font-bold mb-1 truncate">
                    {currentSong?.name || "Ready to Play"}
                  </h2>
                  <p className="text-primary-yellow font-medium mb-4">
                    {currentSong?.artist || "Scan your wallet to find music"}
                  </p>
                  
                  {/* Progress Bar */}
                  <div className="mb-6">
                    <input 
                      type="range" 
                      min="0" 
                      max={duration || 0} 
                      value={progress} 
                      onChange={handleProgressChange}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-primary-yellow"
                    />
                    <div className="flex justify-between text-xs text-slate-500 mt-2 font-mono">
                      <span>{formatTime(progress)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Main Controls */}
                  <div className="flex items-center justify-center md:justify-start gap-6">
                    <button onClick={prevSong} className="text-slate-400 hover:text-white transition">
                      <SkipPrevious fontSize="large" />
                    </button>
                    <button 
                      onClick={togglePlay} 
                      className="w-16 h-16 bg-primary-yellow rounded-full flex items-center justify-center text-black hover:scale-110 active:scale-95 transition shadow-lg shadow-primary-yellow/20"
                    >
                      {isPlaying ? <Pause fontSize="large" /> : <PlayArrow fontSize="large" />}
                    </button>
                    <button onClick={nextSong} className="text-slate-400 hover:text-white transition">
                      <SkipNext fontSize="large" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Extra Controls Footer */}
              <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setShuffle(!shuffle)} 
                    className={`${shuffle ? 'text-primary-yellow' : 'text-slate-500'} hover:text-white transition`}
                  >
                    <Shuffle fontSize="small" />
                  </button>
                  <button 
                    onClick={() => setRepeat(!repeat)} 
                    className={`${repeat ? 'text-primary-yellow' : 'text-slate-500'} hover:text-white transition`}
                  >
                    <Repeat fontSize="small" />
                  </button>
                </div>

                <div className="flex items-center gap-3 w-32">
                  <VolumeUp className="text-slate-500" fontSize="small" />
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={volume} 
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400"
                  />
                </div>
              </div>
            </div>

            {/* Hidden Audio Element */}
            <audio 
              ref={audioRef} 
              onTimeUpdate={onTimeUpdate} 
              onEnded={onEnded}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
            />

            {/* Action Bar */}
            <div className="flex gap-4">
               <button 
                 onClick={scanForMusic}
                 disabled={scanning || loading}
                 className="flex-grow bg-white text-black font-bold py-4 rounded-2xl hover:bg-primary-yellow transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
               >
                 {scanning ? (
                   <>
                     <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
                     SCANNING {scanProgress.current}/{scanProgress.total}
                   </>
                 ) : (
                   <>
                     <Search /> SCAN WALLET FOR MUSIC
                   </>
                 )}
               </button>
            </div>
          </div>

          {/* Right Column: Playlist */}
          <div className="bg-primary-black/40 border border-slate-800 rounded-3xl p-6 flex flex-col max-h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <List className="text-primary-yellow" /> PLAYLIST
              </h3>
              <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-400 font-mono">
                {songs.length} TRACKS
              </span>
            </div>

            <div className="flex-grow overflow-y-auto pr-2 space-y-2 custom-scrollbar">
              {songs.length === 0 ? (
                <div className="text-center py-20 text-slate-600">
                  <MusicNote className="text-4xl mb-2 opacity-20" />
                  <p className="text-sm">No songs found yet</p>
                </div>
              ) : (
                songs.map((song, index) => (
                  <button 
                    key={song.assetId}
                    onClick={() => playSong(index)}
                    className={`w-full text-left p-3 rounded-xl flex items-center gap-4 transition group ${currentSongIndex === index ? 'bg-primary-yellow/10 border border-primary-yellow/20' : 'hover:bg-slate-800/50 border border-transparent'}`}
                  >
                    <div className="w-12 h-12 rounded-lg bg-slate-800 overflow-hidden flex-shrink-0">
                      {song.image ? (
                        <img src={song.image} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <MusicNote className="text-slate-600" />
                        </div>
                      )}
                    </div>
                    <div className="flex-grow overflow-hidden">
                      <p className={`font-bold truncate ${currentSongIndex === index ? 'text-primary-yellow' : 'text-white'}`}>
                        {song.name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">{song.artist || "Unknown Artist"}</p>
                    </div>
                    {currentSongIndex === index && isPlaying && (
                       <div className="flex gap-0.5 items-end h-3">
                         <div className="w-1 bg-primary-yellow animate-music-bar-1"></div>
                         <div className="w-1 bg-primary-yellow animate-music-bar-2"></div>
                         <div className="w-1 bg-primary-yellow animate-music-bar-3"></div>
                       </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

        </div>
      )}

      {/* CSS for custom scrollbar and animations */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
        
        @keyframes music-bar-1 {
          0%, 100% { height: 4px; }
          50% { height: 12px; }
        }
        @keyframes music-bar-2 {
          0%, 100% { height: 10px; }
          50% { height: 4px; }
        }
        @keyframes music-bar-3 {
          0%, 100% { height: 6px; }
          50% { height: 14px; }
        }
        .animate-music-bar-1 { animation: music-bar-1 0.8s infinite; }
        .animate-music-bar-2 { animation: music-bar-2 1.0s infinite; }
        .animate-music-bar-3 { animation: music-bar-3 0.6s infinite; }
      `}</style>
    </div>
  );
}
