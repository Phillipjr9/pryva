export default function AdminLoading() {
  return <div className="console-loading" role="status" aria-label="Loading console page"><span className="visually-hidden">Loading console page…</span><div className="skeleton" style={{ width: 220, height: 32 }} /><div className="stat-grid">{[0, 1, 2, 3].map((key) => <div className="skeleton" key={key} style={{ height: 145 }} />)}</div><div className="overview-grid"><div className="skeleton" style={{ height: 330 }} /><div className="skeleton" style={{ height: 330 }} /></div><div className="skeleton" style={{ height: 280 }} /></div>;
}
