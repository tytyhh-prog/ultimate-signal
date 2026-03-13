import React from 'react';
import useStore from '../store/store';

export default function SectorHeatmap() {
    const sectors = useStore(s => s.sectors);
    const scanned = useStore(s => s.scanned);
    const marketOpen = useStore(s => s.marketOpen);

    if (!scanned) return null;

    // 수급 데이터 집계 상태
    const withData = sectors.filter(s => s.netBuy !== null && s.netBuy !== undefined && s.supplyDataAvailable);
    const hasAnySupplyData = withData.length > 0;
    const validNetBuys = sectors.filter(s => s.netBuy !== null && s.netBuy !== undefined);
    const maxNetBuy = validNetBuys.length > 0
        ? Math.max(...validNetBuys.map(s => Math.abs(s.netBuy)), 1)
        : 1;

    return (
        <div className="animate-slide-up bg-[var(--color-bg-card)] border border-[var(--color-border)]/30 rounded-2xl p-4 sm:p-6" style={{ animationDelay: '800ms' }}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">📊 업종별 수급 히트맵</h3>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                    {marketOpen ? '🟢 실시간' : '🟡 장마감 기준'}
                </span>
            </div>

            {!hasAnySupplyData ? (
                <div className="text-center py-8">
                    <div className="text-2xl mb-2">📊</div>
                    <p className="text-sm text-[var(--color-text-secondary)] font-medium">수급 데이터 집계 불가</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                        집계된 업종: 0 / {sectors.length}개 —
                        종목 수급 API 응답이 없거나 모두 0입니다.
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 font-mono">
                        등락률은 정상 표시됩니다 (pykrx 지수 기준)
                    </p>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {sectors.map((sector, i) => {
                        const netBuy = sector.netBuy;
                        const hasData = sector.supplyDataAvailable && netBuy !== null && netBuy !== undefined;
                        const width = hasData ? Math.abs(netBuy) / maxNetBuy * 100 : 0;
                        const isPositive = hasData ? netBuy >= 0 : true;
                        const trendIcon = sector.trend === 'up' ? '🔥' : sector.trend === 'down' ? '↓' : '→';

                        return (
                            <div key={i} className="flex items-center gap-3">
                                <span className="text-sm text-[var(--color-text-secondary)] w-24 shrink-0 truncate">{sector.name}</span>
                                <div className="flex-1 h-5 bg-[var(--color-bg-primary)] rounded-full overflow-hidden relative">
                                    {hasData && (
                                        <div
                                            className="h-full rounded-full transition-all duration-700"
                                            style={{
                                                width: `${width}%`,
                                                background: isPositive
                                                    ? `linear-gradient(90deg, rgba(0, 176, 255, 0.3), rgba(0, 176, 255, 0.7))`
                                                    : `linear-gradient(90deg, rgba(255, 23, 68, 0.3), rgba(255, 23, 68, 0.7))`,
                                            }}
                                        />
                                    )}
                                </div>
                                <span className={`text-xs font-mono font-semibold w-16 text-right ${!hasData ? 'text-[var(--color-text-muted)]' : isPositive ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                                    {hasData
                                        ? `${isPositive ? '+' : ''}${netBuy}억`
                                        : 'N/A'}
                                </span>
                                <span className="text-sm w-5">{trendIcon}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
