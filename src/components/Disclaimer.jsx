import React from 'react';

export default function Disclaimer() {
    return (
        <footer className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-primary)]/95 backdrop-blur-sm border-t border-[var(--color-border)]/30 z-40">
            <div className="max-w-7xl mx-auto px-4 py-2.5 text-center">
                <p className="text-[10px] sm:text-xs text-[var(--color-text-muted)] leading-relaxed">
                    ⚠️ 본 서비스는 수급, 기술적 분석, 퀀트 팩터를 결합한 참고 정보를 제공하며 <span className="text-[var(--color-stop)]">투자 권유가 아닙니다</span>.
                    모든 투자 결정과 손실의 책임은 투자자 본인에게 있습니다. 과거 패턴이 미래 수익을 보장하지 않습니다.
                </p>
            </div>
        </footer>
    );
}
