import { useEffect } from 'react';
import Header from './components/Header';
import ScanButton from './components/ScanButton';
import SignalCard from './components/SignalCard';
import SectorHeatmap from './components/SectorHeatmap';
import MarketQuantPanel from './components/MarketQuantPanel';
import Disclaimer from './components/Disclaimer';
import useStore from './store/store';

export default function App() {
  const signals = useStore(s => s.signals);
  const scanned = useStore(s => s.scanned);
  const error = useStore(s => s.error);
  const requestNotification = useStore(s => s.requestNotification);
  const fetchMarketData = useStore(s => s.fetchMarketData);
  const runScan = useStore(s => s.runScan);

  useEffect(() => {
    // 알림 권한 요청
    requestNotification();

    // 페이지 로딩 시 시장 지수(KOSPI/KOSDAQ)만 1회 fetch — 스캔은 버튼 클릭 시 실행
    fetchMarketData();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)] pb-16">
      {/* DEPLOY TEST 0313 */}
      <div style={{background:'red',color:'white',textAlign:'center',padding:'8px',fontWeight:'bold',fontSize:'18px',letterSpacing:'2px'}}>
        DEPLOY TEST 0313
      </div>
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Scan Section */}
        <ScanButton />

        {/* Signal Cards */}
        {scanned && signals.length > 0 && (
          <div className="space-y-4 sm:space-y-6 mb-8">
            {signals.map((signal, i) => (
              <SignalCard key={signal.ticker} signal={signal} index={i} />
            ))}
          </div>
        )}

        {/* No Results */}
        {scanned && signals.length === 0 && (
          <div className="text-center py-16 animate-slide-up">
            {error ? (
              <>
                <div className="text-4xl mb-4">⚠️</div>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                  실시간 데이터 오류
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)] mb-2">
                  {error}
                </p>
                <button
                  onClick={() => runScan()}
                  className="mt-3 px-5 py-2 rounded-lg bg-[var(--color-supply-bar)]/20 border border-[var(--color-supply-bar)]/50 text-[var(--color-supply-bar)] text-sm font-semibold hover:bg-[var(--color-supply-bar)]/30 transition-colors cursor-pointer"
                >
                  🔄 지금 재시도
                </button>
                <p className="text-xs text-[var(--color-text-secondary)] mt-3 font-mono bg-[var(--color-bg-secondary)] px-3 py-2 rounded inline-block">
                  백엔드: {import.meta.env.VITE_BACKEND_URL || '(env 미설정 — localhost:5000)'}
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                  30초 후 자동 재시도됩니다. 브라우저 F12 → Console 탭에서 상세 오류를 확인하세요.
                </p>
              </>
            ) : (
              <>
                <div className="text-4xl mb-4">🔍</div>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                  오늘은 통과 종목이 없습니다
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  3중 필터 기준을 충족하는 종목이 없습니다. 잠시 후 다시 시도해보세요.
                </p>
              </>
            )}
          </div>
        )}

        {/* Bottom Panels */}
        {scanned && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-8">
            <SectorHeatmap />
            <MarketQuantPanel />
          </div>
        )}
      </main>

      <Disclaimer />
    </div>
  );
}
