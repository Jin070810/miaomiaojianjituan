"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

type SearchItem = { id: string; title: string; subtitle: string; section: string; search: string };
type SearchResult = { query: string; groups: Array<{ id: string; label: string; items: SearchItem[] }> };

export function AdminGlobalSearch({ onNavigate, onActivity }: { onNavigate: (section: string, search: string) => void; onActivity: (item: SearchItem) => void }) {
  const [query, setQuery] = useState(""); const [data, setData] = useState<SearchResult | null>(null); const [open, setOpen] = useState(false); const [error, setError] = useState("");
  useEffect(() => { const value = query.trim(); if (!value) { setData(null); setError(""); return; } const controller = new AbortController(); const timer = window.setTimeout(async () => { try { const response = await fetch(`/api/admin/search?q=${encodeURIComponent(value)}`, { cache: "no-store", signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "搜索失败"); setData(result); setOpen(true); setError(""); } catch (searchError) { if (!controller.signal.aborted) setError(searchError instanceof Error ? searchError.message : "搜索失败"); } }, 220); return () => { controller.abort(); window.clearTimeout(timer); }; }, [query]);
  return <div className="admin-global-search"><Search size={16} /><input value={query} onFocus={() => query && setOpen(true)} onChange={(event) => setQuery(event.target.value)} placeholder="搜索成员、photoId、订单或礼品" aria-label="全局搜索" />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => { setQuery(""); setOpen(false); }}><X size={15} /></button>}{open && <div className="admin-search-results" role="dialog" aria-label="全局搜索结果">{error ? <p className="form-error">{error}</p> : data?.groups.length ? data.groups.map((group) => <section key={group.id}><small>{group.label}</small>{group.items.map((item) => <div className="admin-search-result" key={`${group.id}-${item.id}`}><button onClick={() => { onNavigate(item.section, `search:${item.search}`); setOpen(false); }}><strong>{item.title}</strong><span>{item.subtitle}</span></button><button className="text-button" onClick={() => { onActivity(item); setOpen(false); }}>动态</button></div>)}</section>) : <p className="field-hint">没有找到匹配记录</p>}</div>}</div>;
}
