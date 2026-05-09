import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, addDoc, deleteDoc, query, serverTimestamp } from 'firebase/firestore';
import { BrainCircuit, Aperture, FileText, Image as ImageIcon, Link as LinkIcon, Trash2, X, Upload, Loader2, Globe, Sparkles, Database, Activity, Settings, Search, AlertCircle } from 'lucide-react';

/**
 * 【重要部署說明】
 * 請至 Firebase Console (https://console.firebase.google.com/) 建立專案
 * 並將你的 Web App 設定貼在下方。
 */
const GOOGLE_AI_API_KEY = "AIzaSyDzlWLTW4PL1XyAT35u6g_wneztjE8sHXY"; 
const firebaseConfig = {
  apiKey: "AIzaSyCKuLpm5AjitgbbQKKjGkuB694eANok84k",
  authDomain: "k123-2b785.firebaseapp.com",
  projectId: "k123-2b785",
  storageBucket: "k123-2b785.firebasestorage.app",
  messagingSenderId: "629459061220",
  appId: "1:629459061220:web:15caf92147313899fd1ff1"
};

// 檢查是否已填寫設定，避免初始報錯
const isConfigValid = firebaseConfig.apiKey !== "AIzaSyCKuLpm5AjitgbbQKKjGkuB694eANok84k";

let app, auth, db;
if (isConfigValid) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const appId = "twse-ai-brain-shared-v8";

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [kb, setKb] = useState([]);
  const [settings, setSettings] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [modal, setModal] = useState({ show: false, type: null });
  const [isLoadingKB, setIsLoadingKB] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState(isConfigValid ? null : "請在 App.jsx 中設定 Firebase 設定值以啟用資料庫功能。");

  const STRATEGIES = {
    standard: "你是台股專家。請分析 K 線圖。1. 風控 2% 規則。2. 標註位階 0-1-2-3。輸出詳盡報告並附帶 JSON：{\"score\":1-5, \"trend\":\"階段\", \"buy_point\":\"買點\", \"sl\":\"停損\", \"tp\":\"目標\"}",
    aggressive: "你是短線高手。分析 K 線並給出進場點。JSON：{\"score\":1-5, \"trend\":\"攻擊\", \"buy_point\":\"進場\", \"sl\":\"停損\", \"tp\":\"目標\"}"
  };

  // 認證邏輯：增加指數退避重試
  useEffect(() => {
    if (!isConfigValid) return;

    let retryCount = 0;
    const maxRetries = 5;

    const performAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Attempt Failed:", err);
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          retryCount++;
          setTimeout(performAuth, delay);
        } else {
          setErrorMessage("無法連線至 Firebase，請檢查網路連線或 API Key 是否正確。");
        }
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

  // 數據同步
  useEffect(() => {
    if (!authReady || !user || !db) return;

    const kbRef = collection(db, 'artifacts', appId, 'public', 'data', 'knowledge');
    const unsubscribeKB = onSnapshot(kbRef, 
      (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setKb(items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
      }, 
      (err) => {
        console.error("Sync Error:", err);
        // 如果是權限錯誤，通常是因為 Firestore Rules 未設定好
        if (err.code === 'permission-denied') {
          setErrorMessage("資料庫存取被拒絕。請確保 Firestore Rules 已開啟讀寫權限。");
        }
      }
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
    } catch (err) { 
      console.error("Upload Error:", err);
      alert("上傳失敗: " + err.message);
    }
  };

  const runAnalysis = async (base64) => {
    if (!GOOGLE_AI_API_KEY) {
      alert("請先設定 GOOGLE_AI_API_KEY 以啟用 AI 分析。");
      return;
    }
    setIsAnalyzing(true);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GOOGLE_AI_API_KEY}`;

    try {
      const visionRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "辨識台股代碼與名稱，僅輸出 JSON: {\"code\":\"\", \"name\":\"\"}" }, { inlineData: { mimeType: "image/png", data: base64 } }] }]
        })
      });
      const visionData = await visionRes.json();
      const text = visionData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const stockInfo = JSON.parse(text.match(/\{[\s\S]*?\}/g)?.[0] || "{}");
      const targetStock = stockInfo.code ? `${stockInfo.name}(${stockInfo.code})` : "未知股票";

      const finalRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [ { text: `分析對象: ${targetStock}。搜索該股時事、營收、法人動向，並給出建議。最後附帶 JSON。` }, { inlineData: { mimeType: "image/png", data: base64 } } ] }],
          systemInstruction: { parts: [{ text: settings || STRATEGIES.standard }] },
          tools: [{ "google_search": {} }]
        })
      });

      const finalData = await finalRes.json();
      const rawReport = finalData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let json = {};
      const matches = rawReport.match(/\{[\s\S]*?\}/g);
      if (matches) { try { json = JSON.parse(matches[matches.length-1]); } catch(e){} }
      
      setScanResult({ report: rawReport.replace(/\{[\s\S]*?\}/g, "").trim(), data: json, stockIdentified: targetStock });
    } catch (err) { 
      console.error("Analysis Error:", err);
      alert("AI 分析過程發生錯誤。");
    } finally { setIsAnalyzing(false); }
  };

  const TabButton = ({ index, icon: Icon, label }) => (
    <button onClick={() => setActiveTab(index)} className={`flex flex-col items-center gap-1 flex-1 py-3 ${activeTab === index ? 'text-blue-400' : 'text-slate-500'}`}>
      <div className={`p-2 rounded-xl ${activeTab === index ? 'bg-blue-500/10' : ''}`}><Icon size={24} /></div>
      <span className="text-[10px] font-bold uppercase">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#050b18] text-slate-300 font-sans pb-32">
      <nav className="fixed top-0 left-0 right-0 z-[100] bg-[#0d1526]/90 backdrop-blur-xl border-b border-[#1e2d4d] px-5 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <BrainCircuit className="text-blue-500 w-8 h-8" />
          <h1 className="text-sm font-black text-white uppercase tracking-tighter">AI 共享大腦</h1>
        </div>
        <div className="text-[8px] font-mono text-emerald-500 px-2 py-1 bg-emerald-500/10 rounded border border-emerald-500/20">
          STATUS: {authReady ? "CONNECTED" : "OFFLINE"}
        </div>
      </nav>

      {errorMessage && (
        <div className="max-w-md mx-auto px-4 pt-24">
          <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-2xl flex items-start gap-3">
            <AlertCircle className="text-red-500 shrink-0" size={18} />
            <p className="text-xs text-red-200">{errorMessage}</p>
          </div>
        </div>
      )}

      <main className="max-w-md mx-auto px-4 pt-6 space-y-6">
        {activeTab === 0 && (
          <div className="space-y-6">
            {!scanResult ? (
              <div onClick={()=>document.getElementById('f').click()} className="bg-[#0d1526]/50 rounded-[2.5rem] p-16 text-center border-2 border-dashed border-[#1e2d4d] hover:border-blue-500/50 cursor-pointer transition-all">
                <input type="file" id="f" hidden accept="image/*" onChange={(e)=>{
                  if (!e.target.files[0]) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => runAnalysis(ev.target.result.split(',')[1]);
                  reader.readAsDataURL(e.target.files[0]);
                }} />
                <Aperture className="text-blue-500 w-12 h-12 mx-auto mb-4" />
                <h2 className="text-white font-black uppercase">啟動 AI 掃描</h2>
                <p className="text-[10px] text-slate-500 mt-2 italic">請上傳包含 K 線與個股名稱的截圖</p>
                {isAnalyzing && (
                  <div className="mt-4 flex flex-col items-center">
                    <Loader2 className="animate-spin text-blue-400 mb-2" />
                    <span className="text-[10px] text-blue-400 animate-pulse font-bold">正在深度分析數據...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[#0d1526] p-7 rounded-[2.5rem] border border-[#1e2d4d] animate-in slide-in-from-bottom-4">
                <h3 className="text-2xl font-black text-white text-center mb-4">{scanResult.stockIdentified}</h3>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                  <div className="bg-black/30 p-3 rounded-xl border border-white/5">買點: <span className="text-emerald-400">{scanResult.data.buy_point || "待定"}</span></div>
                  <div className="bg-black/30 p-3 rounded-xl border border-white/5">停損: <span className="text-red-400">{scanResult.data.sl || "待定"}</span></div>
                </div>
                <div className="mt-4 text-[13px] leading-relaxed text-slate-300 whitespace-pre-wrap">{scanResult.report}</div>
                <button onClick={()=>setScanResult(null)} className="w-full mt-6 py-4 border border-[#1e2d4d] rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/5 transition-colors">返回重新掃描</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <button onClick={()=>setModal({show:true, type:'note'})} className="bg-[#0d1526] p-4 rounded-2xl flex flex-col items-center border border-white/5 active:scale-95 transition-all"><FileText className="text-blue-400 mb-1" size={20}/><span className="text-[10px] font-bold">筆記</span></button>
              <button onClick={()=>setModal({show:true, type:'image'})} className="bg-[#0d1526] p-4 rounded-2xl flex flex-col items-center border border-white/5 active:scale-95 transition-all"><ImageIcon className="text-emerald-400 mb-1" size={20}/><span className="text-[10px] font-bold">圖片</span></button>
              <button onClick={()=>setModal({show:true, type:'link'})} className="bg-[#0d1526] p-4 rounded-2xl flex flex-col items-center border border-white/5 active:scale-95 transition-all"><LinkIcon className="text-purple-400 mb-1" size={20}/><span className="text-[10px] font-bold">連結</span></button>
            </div>
            
            <div className="pt-2">
              <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">實時數據流 ({kb.length})</h4>
              <div className="space-y-3">
                {kb.length === 0 && <div className="text-center py-10 text-[10px] text-slate-600 italic">尚未有共用數據...</div>}
                {kb.map(item => (
                  <div key={item.id} className="bg-[#0d1526] p-4 rounded-2xl border-l-4 border-blue-500 shadow-xl animate-in fade-in">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-black text-white text-[11px] truncate pr-2 uppercase">{item.title || "未命名資料"}</span>
                      {item.contributor === user?.uid && (
                        <Trash2 size={14} className="text-slate-600 hover:text-red-500 transition-colors" onClick={()=>deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'knowledge', item.id))}/>
                      )}
                    </div>
                    {item.type === 'image' ? (
                      <img src={item.content} className="rounded-lg w-full h-auto border border-white/5 mt-2" alt="knowledge" />
                    ) : (
                      <p className="text-[11px] text-slate-400 leading-relaxed bg-black/20 p-3 rounded-lg">{item.content}</p>
                    )}
                    <div className="mt-3 flex justify-between items-center text-[8px] font-mono text-slate-600">
                      <span>USER: {item.contributor?.substring(0,6)}</span>
                      <span>{item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleDateString() : '同步中'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 2 && (
          <div className="bg-[#0d1526] border border-[#1e2d4d] rounded-[2.5rem] p-8 space-y-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-2"><Sparkles size={16} className="text-blue-400" /><h3 className="text-xs font-black text-white uppercase tracking-widest">核心分析邏輯設定</h3></div>
            <textarea 
              value={settings} 
              onChange={(e)=>setSettings(e.target.value)} 
              className="w-full h-64 bg-black/40 border border-[#1e2d4d] rounded-2xl p-4 text-[11px] text-slate-300 font-mono outline-none focus:border-blue-500/50" 
              placeholder="輸入 AI 分析指令..."
            />
            <button 
              onClick={async ()=>{
                if (!db) return;
                const settingsDoc = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global_core');
                await setDoc(settingsDoc, { prompt: settings, updatedAt: serverTimestamp() });
                alert("已成功更新全域邏輯！");
              }} 
              className="w-full py-5 bg-blue-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all"
            >
              更新雲端核心指令
            </button>
          </div>
        )}
      </main>

      {/* 導覽列 */}
      <div className="fixed bottom-0 left-0 right-0 z-[200] bg-[#0d1526]/95 backdrop-blur-2xl border-t border-[#1e2d4d] pb-10 pt-2 px-8 flex justify-between">
        <TabButton index={0} icon={Search} label="AI 掃描" />
        <TabButton index={1} icon={Database} label="共享數據" />
        <TabButton index={2} icon={Settings} label="核心設定" />
      </div>

      {/* 彈窗 UI */}
      {modal.show && (
        <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-end p-4 animate-in fade-in duration-200">
          <div className="bg-[#0d1526] w-full max-w-sm mx-auto rounded-[3rem] p-8 space-y-4 mb-24 border border-[#1e2d4d] animate-in slide-in-from-bottom-full duration-300">
            <div className="flex justify-between items-center text-white font-black uppercase">
              <span className="text-sm tracking-widest">發布 {modal.type}</span>
              <button onClick={()=>setModal({show:false, type:null})} className="p-2 hover:bg-white/5 rounded-full"><X size={20}/></button>
            </div>
            
            <div className="space-y-3">
              {modal.type === 'image' ? (
                <div className="bg-black/40 border border-dashed border-[#1e2d4d] p-10 rounded-2xl text-center">
                  <input type="file" id="im" accept="image/*" className="hidden" onChange={(e)=>{
                    const label = document.getElementById('file-label');
                    if (label && e.target.files[0]) label.innerText = e.target.files[0].name;
                  }} />
                  <label htmlFor="im" id="file-label" className="text-[10px] text-blue-400 font-bold cursor-pointer uppercase">點擊選取圖片</label>
                </div>
              ) : (
                <>
                  <input id="nt" placeholder="標題" className="w-full bg-black/40 border border-[#1e2d4d] p-4 rounded-xl outline-none text-sm text-white" />
                  <textarea id="nc" placeholder="內容描述..." className="w-full h-24 bg-black/40 border border-[#1e2d4d] p-4 rounded-xl outline-none text-sm text-white" />
                </>
              )}
            </div>

            <button 
              disabled={isLoadingKB} 
              onClick={async ()=>{
                setIsLoadingKB(true);
                try {
                  if(modal.type === 'image') {
                    const file = document.getElementById('im').files[0];
                    if (!file) throw new Error("尚未選擇檔案");
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                      await addKB('image', {title: file.name, content: e.target.result});
                      setIsLoadingKB(false);
                      setModal({show:false, type:null});
                    };
                    reader.readAsDataURL(file);
                  } else {
                    const title = document.getElementById('nt').value;
                    const content = document.getElementById('nc').value;
                    if (!title || !content) throw new Error("請填寫內容");
                    await addKB(modal.type, {title, content});
                    setIsLoadingKB(false);
                    setModal({show:false, type:null});
                  }
                } catch (e) {
                  alert(e.message);
                  setIsLoadingKB(false);
                }
              }} 
              className="w-full py-5 bg-blue-600 rounded-2xl text-white font-black uppercase text-[11px] tracking-widest shadow-xl active:scale-95 transition-all"
            >
              {isLoadingKB ? '處理中...' : '確認發布至共享庫'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}