import React from 'react';
import useStore from '../store/store';

export default function MarketQuantPanel() {
    const quantIndex = useStore(s => s.quantIndex);
    const scanned = useStore(s => s.scanned);

    if (!scanned) return null;

    const colorMap = {
        momentum: '#00b0ff',
        value: '#7c4dff',
        volatility: '#69f0ae',
    };

    return (
        <div className="animate-slide-up bg-[var(--color-bg-card)] border border-[var(--color-border)]/30 rounded-2xl p-4 sm:p-6" style={{ animationDelay: '900ms' }}>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">📈 오늘의 시장 퀀트 지수</h3>
            <div className="space-y-3">
                {Object.entries(quantIndex).map(([key, data]) => (
                    <div key={key} className="flex items-center gap-3">
                        <span className="text-sm text-[var(--color-text-secondary)] w-24 shrink-0">{data.label}</span>
                        <div className="flex-1 h-4 bg-[var(--color-bg-primary)] rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full"
                                style={{
                                    width: `${data.value}%`,
                                    backgroundColor: colorMap[key],
                                    transition: 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                    boxShadow: `0 0 6px ${colorMap[key]}40`,
                                }}
                            />
                        </div>
                        <span className="text-xs text-[var(--color-text-secondary)] w-28 text-right">
                            <span className="font-semibold" style={{ color: colorMap[key] }}>{data.status}</span>
                        </span>
                    </div>
                ))}
            </div>
            <div className="mt-3 text-xs text-[var(--color-text-muted)] text-right">
                변동성 낮음 = 매수 우호적 환경
            </div>
        </div>
    );
}
