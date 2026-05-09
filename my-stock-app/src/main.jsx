import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, addDoc, deleteDoc, query, serverTimestamp } from 'firebase/firestore';
import { BrainCircuit, Aperture, FileText, Image as ImageIcon, Link as LinkIcon, Trash2, X, Upload, Loader2, Globe, Sparkles, Database, Activity, Settings, Search, AlertCircle, CheckCircle2 } from 'lucide-react';

/**
 * 【環境配置說明】
 * 此版本為單一檔案執行版，已移除外部路徑引用 (App.jsx / index.css)
 * 部署至外部時，請務必填寫下方的 Firebase 與 Google AI API Key。
 */

const GOOGLE_AI_API_KEY = "AIzaSyDzlWLTW4PL1XyAT35u6g_wneztjE8sHXY"; 
const firebaseConfig = JSON.parse(__firebase_config || "{}"); // 優先使用系統環境變數

// 建立 Firebase 連線
const isConfigValid = firebaseConfig && firebaseConfig.apiKey;
let app, auth, db;
if (isConfigValid) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const appId = typeof __app_id !== 'undefined' ? __app_id : 'twse-ai-brain-shared-v8';

// --- 主要應用程式組件 ---
function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [kb, setKb] = useState([]);
  const [settings, setSettings] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [modal, setModal] = useState({ show: false, type: null });
  const [isLoadingKB, setIsLoadingKB] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState(isConfigValid ? null : "系統初始化中，請檢查 Firebase 配置。");

  const STRATEGIES = {
    standard: "你是台股專家。請分析 K 線圖。1. 風控 2% 規則。2. 標註位階 0-1-2-3。輸出詳盡報告並附帶 JSON：{\"score\":1-5, \"trend\":\"階段\", \"buy_point\":\"買點\", \"sl\":\"停損\", \"tp\":\"目標\"}",
    aggressive: "你是短線高手。分析 K 線並給出進場點。JSON：{\"score\":1-5, \"trend\":\"攻擊\", \"buy_point\":\"進場\", \"sl\":\"停損\", \"tp\":\"目標\"}"
  };

  // 1. 初始化與認證
  useEffect(() => {
    if (!isConfigValid) return;

    const performAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Failed:", err);
        setErrorMessage("網路連線或 Firebase 設定異常。");
      }
    };

    performAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setAuthReady(true);
        setErrorMessage(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. 數據同步
  useEffect(() => {
    if (!authReady || !user || !db) return;

    const kbRef = collection(db, 'artifacts', appId, 'public', 'data', 'knowledge');
    const unsubscribeKB = onSnapshot(kbRef, 
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setKb(items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      }, 
      (err) => console.error("Snapshot Error:", err)
    );

    const settingsDoc = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global_core');
    getDoc(settingsDoc).then(snap => {
      if (snap.exists()) setSettings(snap.data().prompt);
      else setSettings(STRATEGIES.standard);
    });

    return () => unsubscribeKB();
  }, [authReady, user]);

  const addKB = async (type, data) => {
    if (!user || !db) return;
    try {
      const kbRef = collection(db, 'artifacts', appId, 'public', 'data', 'knowledge');
      await addDoc(kbRef, {
        type,
        ...data,
        contributor: user.uid,
        createdAt: serverTimestamp()
      });
    } catch (err) { console.error("Upload Error:", err); }
  };

  const runAnalysis = async (base64) => {
    if (!GOOGLE_AI_API_KEY) {
      alert("請填寫 Google AI API Key。");
      return;
    }
    setIsAnalyzing(true);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GOOGLE_AI_API_KEY}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [ { text: "分析此股票 K 線，提供支撐壓力與 JSON 格式結果。" }, { inlineData: { mimeType: "image/png", data: base64 } } ] }],
          systemInstruction: { parts: [{ text: settings || STRATEGIES.standard }] },
          tools: [{ "google_search": {} }]
        })
      });
      const data = await res.json();
      const reportText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let json = {};
      const matches = reportText.match(/\{[\s\S]*?\}/g);
      if (matches) json = JSON.parse(matches[matches.length-1]);
      
      setScanResult({ report: reportText.replace(/\{[\s\S]*?\}/g, ""), data: json });
    } catch (err) { alert("分析失敗。"); }
    finally { setIsAnalyzing(false); }
  };

  const TabButton = ({ index, icon: Icon, label }) => (
    <button onClick={() => setActiveTab(index)} className={`flex flex-col items-center gap-1 flex-1 py-3 transition-colors ${activeTab === index ? 'text-blue-400' : 'text-slate-500'}`}>
      <div className={`p-2 rounded-xl ${activeTab === index ? 'bg-blue-500/10' : ''}`}><Icon size={24} /></div>
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#050b18] text-slate-300 font-sans pb-32">
      <nav className="fixed top-0 left-0 right-0 z-[100] bg-[#0d1526]/90 backdrop-blur-xl border-b border-[#1e2d4d] px-5 py-4 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-3">
          <BrainCircuit className="text-blue-500 w-8 h-8" />
          <h1 className="text-sm font-black text-white uppercase tracking-tighter">AI 共享大腦 V8.8.2</h1>
        </div>
        <div className="text-[8px] font-mono text-emerald-500 px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
          ONLINE: {authReady ? "YES" : "NO"}
        </div>
      </nav>

      <main className="max-w-md mx-auto px-4 pt-24 space-y-6">
        {activeTab === 0 && (
          <div className="space-y-6 animate-in fade-in duration-500">
            {!scanResult ? (
              <div onClick={()=>document.getElementById('f').click()} className="bg-[#0d1526]/50 rounded-[2.5rem] p-16 text-center border-2 border-dashed border-[#1e2d4d] hover:border-blue-500/50 cursor-pointer transition-all active:scale-95 group">
                <input type="file" id="f" hidden accept="image/*" onChange={(e)=>{
                  if (!e.target.files[0]) return;
                  const r = new FileReader(); r.readAsDataURL(e.target.files[0]);
                  r.onload = (ev) => runAnalysis(ev.target.result.split(',')[1]);
                }} />
                <Aperture className="text-blue-500 w-12 h-12 mx-auto mb-4 group-hover:rotate-45 transition-transform duration-700" />
                <h2 className="text-white font-black uppercase tracking-widest">啟動 AI 掃描</h2>
                {isAnalyzing && (
                  <div className="mt-6 flex flex-col items-center">
                    <Loader2 className="animate-spin text-blue-400 mb-2" />
                    <span className="text-[10px] text-blue-400 animate-pulse font-black uppercase">處理數據中...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[#0d1526] p-7 rounded-[2.5rem] border border-[#1e2d4d] animate-in slide-in-from-bottom-4">
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-black/40 p-4 rounded-2xl border border-white/5"><div className="text-[9px] text-slate-500 uppercase">買點</div><div className="text-emerald-400 font-black">{scanResult.data.buy_point || "--"}</div></div>
                  <div className="bg-black/40 p-4 rounded-2xl border border-white/5"><div className="text-[9px] text-slate-500 uppercase">停損</div><div className="text-red-400 font-black">{scanResult.data.sl || "--"}</div></div>
                </div>
                <div className="text-[13px] leading-relaxed text-slate-300 whitespace-pre-wrap font-medium">{scanResult.report}</div>
                <button onClick={()=>setScanResult(null)} className="w-full mt-6 py-4 border border-[#1e2d4d] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5">返回</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 1 && (
          <div className="space-y-4 animate-in fade-in">
            <div className="grid grid-cols-3 gap-2">
              <button onClick={()=>setModal({show:true, type:'note'})} className="bg-[#0d1526] p-4 rounded-2xl flex flex-col items-center border border-white/5 active:scale-95"><FileText className="text-blue-400 mb-1" size={20}/><span className="text-[10px] font-bold uppercase">筆記</span></button>
              <button onClick={()=>setModal({show:true, type:'image'})} className="bg-[#0d1526] p-4 rounded-2xl flex flex-col items-center border border-white/5 active:scale-95"><ImageIcon className="text-emerald-400 mb-1" size={20}/><span className="text-[10px] font-bold uppercase">圖片</span></button>
              <button onClick={()=>setModal({show:true, type:'link'})} className="bg-[#0d1526] p-4 rounded-2xl flex flex-col items-center border border-white/5 active:scale-95"><LinkIcon className="text-purple-400 mb-1" size={20}/><span className="text-[10px] font-bold uppercase">連結</span></button>
            </div>
            {kb.map(item => (
              <div key={item.id} className="bg-[#0d1526] p-5 rounded-2xl border-l-4 border-blue-500 shadow-xl group">
                <div className="flex justify-between items-center mb-3">
                  <span className="font-black text-white text-[11px] uppercase truncate">{item.title}</span>
                  {item.contributor === user?.uid && <Trash2 size={14} className="text-slate-700 hover:text-red-500 transition-colors" onClick={()=>deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'knowledge', item.id))}/>}
                </div>
                {item.type === 'image' ? <img src={item.content} className="rounded-xl w-full border border-white/5" /> : <p className="text-[11px] text-slate-400 leading-relaxed bg-black/20 p-3 rounded-xl">{item.content}</p>}
              </div>
            ))}
          </div>
        )}

        {activeTab === 2 && (
          <div className="bg-[#0d1526] border border-[#1e2d4d] rounded-[2.5rem] p-8 space-y-6 shadow-2xl animate-in fade-in">
            <h3 className="text-xs font-black text-white uppercase tracking-[0.2em] flex items-center gap-2"><Sparkles size={16} className="text-blue-400" />核心同步指令</h3>
            <textarea value={settings} onChange={(e)=>setSettings(e.target.value)} className="w-full h-64 bg-black/40 border border-[#1e2d4d] rounded-2xl p-4 text-[11px] text-slate-300 font-mono outline-none focus:border-blue-500/50" />
            <button onClick={async ()=>{
              const settingsDoc = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global_core');
              await setDoc(settingsDoc, { prompt: settings, updatedAt: serverTimestamp() });
              alert("已廣播至雲端大腦！");
            }} className="w-full py-5 bg-blue-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.3em] shadow-xl active:scale-95 transition-all">更新指令</button>
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-[200] bg-[#0d1526]/95 backdrop-blur-2xl border-t border-[#1e2d4d] pb-10 pt-2 px-8 flex justify-between shadow-2xl">
        <TabButton index={0} icon={Search} label="掃描" />
        <TabButton index={1} icon={Database} label="數據" />
        <TabButton index={2} icon={Settings} label="核心" />
      </div>

      {modal.show && (
        <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-end p-4 animate-in fade-in duration-200">
          <div className="bg-[#0d1526] w-full max-w-sm mx-auto rounded-[3rem] p-8 space-y-4 mb-24 border border-[#1e2d4d] animate-in slide-in-from-bottom-full duration-300">
            <div className="flex justify-between items-center text-white font-black uppercase text-sm tracking-widest">
              <span>發布 {modal.type}</span>
              <button onClick={()=>setModal({show:false, type:null})} className="p-2 hover:bg-white/5 rounded-full"><X size={20}/></button>
            </div>
            {modal.type === 'image' ? (
              <input type="file" id="im" accept="image/*" className="w-full text-xs" />
            ) : (
              <>
                <input id="nt" placeholder="標題" className="w-full bg-black/40 border border-[#1e2d4d] p-4 rounded-xl outline-none text-sm text-white" />
                <textarea id="nc" placeholder="描述..." className="w-full h-24 bg-black/40 border border-[#1e2d4d] p-4 rounded-xl outline-none text-sm text-white" />
              </>
            )}
            <button disabled={isLoadingKB} onClick={async ()=>{
              setIsLoadingKB(true);
              if(modal.type==='image') {
                const f = document.getElementById('im').files[0];
                if(f) {
                  const r = new FileReader(); r.readAsDataURL(f);
                  r.onload = async (e) => { await addKB('image', {title: f.name, content: e.target.result}); setIsLoadingKB(false); setModal({show:false}); };
                }
              } else {
                await addKB(modal.type, {title: document.getElementById('nt').value, content: document.getElementById('nc').value});
                setIsLoadingKB(false); setModal({show:false});
              }
            }} className="w-full py-5 bg-blue-600 rounded-2xl text-white font-black uppercase text-[11px] tracking-widest shadow-xl">{isLoadingKB ? '處理中...' : '確認上傳'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 渲染到 root
import { createRoot } from 'react-dom/client';
const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<App />);
}