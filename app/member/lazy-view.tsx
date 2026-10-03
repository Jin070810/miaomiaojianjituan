"use client";

import { Component, type ReactNode } from "react";

export function MemberViewLoading() {
  return <div className="member-content journal-page" role="status" aria-live="polite"><div className="growth-local-state"><span className="growth-loading-bar" /><p>正在打开页面…</p></div></div>;
}

// A failed chunk remains rejected in the module loader; a full reload fetches the
// current release manifest. Navigation back home stays available without reload.
export class MemberViewBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="member-content journal-page"><section className="growth-local-state is-error" role="alert"><p>页面资源暂时没有加载成功，请检查网络后重新加载。</p><button onClick={() => window.location.reload()}>重新加载页面</button><button onClick={this.props.onBack}>返回首页</button></section></div>;
  }
}
