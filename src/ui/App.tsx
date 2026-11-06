import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppCtx, AppCtxT } from './components';
import { usePersistent, DEFAULT_SETTINGS, Settings, SavedItem, Job, uid } from './store';
import { Calculator } from './Calculator';
import { LayoutTools } from './LayoutTools';
import { FittingTools } from './FittingTools';
import { PipeTools } from './PipeTools';
import { JobsView } from './Jobs';
import { BrandLogo } from './brand';

type Tab = 'calc' | 'layout' | 'fittings' | 'pipe' | 'jobs';

// tool id -> [main tab, sub-tab tool, sub-tab key value]
const TOOL_ROUTE: Record<string, [Tab, string, string]> = {
  simple: ['layout', 'layout', 'simple'], rolling: ['layout', 'layout', 'rolling'], slope: ['layout', 'layout', 'slope'],
  cutback: ['layout', 'layout', 'cutback'], combo: ['layout', 'layout', 'combo'],
  takeout: ['fittings', 'fittings', 'takeout'], cutlen: ['fittings', 'fittings', 'cut'], trim: ['fittings', 'fittings', 'trim'], f2f: ['fittings', 'fittings', 'f2f'],
  pipedata: ['pipe', 'pipe', 'data'], flow: ['pipe', 'pipe', 'flow'], pfa: ['pipe', 'pipe', 'pfa'], loss: ['pipe', 'pipe', 'loss'], circle: ['pipe', 'pipe', 'circle'],
};

const ICONS: Record<Tab, React.ReactNode> = {
  calc: <svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" /></svg>,
  layout: <svg viewBox="0 0 24 24"><path d="M3 18h5l8-12h5" /><circle cx="8" cy="18" r="1.6" /><circle cx="16" cy="6" r="1.6" /></svg>,
  fittings: <svg viewBox="0 0 24 24"><path d="M4 20V13a9 9 0 0 1 9-9h7" /><path d="M9 20v-6a5 5 0 0 1 5-5h6" /></svg>,
  pipe: <svg viewBox="0 0 24 24"><ellipse cx="7" cy="12" rx="3" ry="6" /><path d="M7 6h11a3 6 0 0 1 0 12H7" /></svg>,
  jobs: <svg viewBox="0 0 24 24"><path d="M4 7h16v12H4z" /><path d="M9 7V5h6v2M4 12h16" /></svg>,
};
const TAB_LABEL: Record<Tab, string> = { calc: 'Calc', layout: 'Layout', fittings: 'Fittings', pipe: 'Pipe', jobs: 'Jobs' };

export function App() {
  const [tab, setTab] = usePersistent<Tab>('tab', 'calc');
  const [settings, setSettingsRaw] = usePersistent<Settings>('settings', DEFAULT_SETTINGS);
  const [tools, setTools] = usePersistent<Record<string, Record<string, string>>>('tools', {});
  const [items, setItems] = usePersistent<SavedItem[]>('items', []);
  const [jobs, setJobs] = usePersistent<Job[]>('jobs', []);
  const [jobsSection, setJobsSection] = useState('history');
  const [toastMsg, setToast] = useState<string | null>(null);

  const s: Settings = { ...DEFAULT_SETTINGS, ...settings, prefs: { ...DEFAULT_SETTINGS.prefs, ...settings.prefs } };

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#100f0d');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [s.theme]);

  const toast = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(null), 1800); }, []);
  const ctx: AppCtxT = useMemo(() => ({
    tools,
    setToolField: (tool, key, value) => setTools((p) => ({ ...p, [tool]: { ...(p[tool] ?? {}), [key]: value } })),
    replaceTool: (tool, inputs) => setTools((p) => ({ ...p, [tool]: inputs })),
    settings: s,
    setSettings: (f) => setSettingsRaw((p) => f({ ...DEFAULT_SETTINGS, ...p, prefs: { ...DEFAULT_SETTINGS.prefs, ...p.prefs } })),
    saveItem: (it) => setItems((p) => [{ ...it, id: uid(), ts: Date.now(), fav: false }, ...p].slice(0, 500)),
    toast,
  }), [tools, settings]);

  const open = (it: SavedItem) => {
    const route = it.tool ? TOOL_ROUTE[it.tool] : null;
    if (!route || !it.inputs) return;
    setTools((p) => ({ ...p, [it.tool!]: it.inputs!, [route[1]]: { ...(p[route[1]] ?? {}), tab: route[2] } }));
    setTab(route[0]);
    toast(`Opened: ${it.title}`);
  };

  return (
    <AppCtx.Provider value={ctx}>
      <div className={'app tab-' + tab}>
        <header className="top">
          <BrandLogo />
          <div className="appname">Pipe<br />Calculator</div>
          <button className="topbtn" aria-label="Settings" onClick={() => { setJobsSection('settings'); setTab('jobs'); }}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
          </button>
        </header>
        <main className="content">
          {tab === 'calc' && <Calculator onOpenPrefs={() => { setJobsSection('settings'); setTab('jobs'); }} />}
          {tab === 'layout' && <LayoutTools />}
          {tab === 'fittings' && <FittingTools />}
          {tab === 'pipe' && <PipeTools />}
          {tab === 'jobs' && <JobsView items={items} setItems={setItems} jobs={jobs} setJobs={setJobs} open={open} section={jobsSection} setSection={setJobsSection} />}
        </main>
        <nav className="tabs" aria-label="Sections">
          {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
            <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)} aria-current={t === tab ? 'page' : undefined}>
              {ICONS[t]}<span>{TAB_LABEL[t]}</span>
            </button>
          ))}
        </nav>
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
