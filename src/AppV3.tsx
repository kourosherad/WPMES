import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, Barcode, Boxes, Camera,
  ChevronLeft, CircleAlert, CircleCheck, ClipboardList, Factory,
  FilePlus2, Flashlight, FolderKanban, GripVertical, Layers3, Menu, PackageOpen,
  LogOut, PenLine, Plus, QrCode, Radio, Route, Save, ScanLine, ShieldCheck,
  Trash2, UserRound, Wrench, X,
} from 'lucide-react';

type Page = 'scan' | 'queue' | 'flow' | 'engineering' | 'projects';
type RoleId = 'operator' | 'qc' | 'production' | 'packaging' | 'engineering';
type Step = { id: string; name: string; execution: 'internal' | 'external'; qcRequired: boolean; productionControlRequired: boolean; barcodeAfter: boolean };
type ProductionSet = { id: string; name: string; code: string; kind: 'single' | 'assembly'; operatorRole: string; steps: Step[] };
type Project = { id: string; name: string; code: string; itemType: 'single' | 'assembly'; drawings: string[]; sets: ProductionSet[] };
type SessionUser = { username: string; displayName: string; role: RoleId };

const roles = [
  { id: 'operator' as const, title: 'اپراتور تولید', action: 'ثبت پایان عملیات' },
  { id: 'qc' as const, title: 'کنترل کیفیت', action: 'ثبت تأیید کنترل کیفیت' },
  { id: 'production' as const, title: 'کنترل تولید', action: 'ثبت تأیید کنترل تولید' },
  { id: 'packaging' as const, title: 'پکیجینگ', action: 'ثبت در پکیج' },
  { id: 'engineering' as const, title: 'امور مهندسی', action: 'مشاهده شناسنامه فنی' },
];

const nav = [
  { id: 'scan' as const, title: 'اسکن', icon: ScanLine },
  { id: 'queue' as const, title: 'صف کار', icon: ClipboardList },
  { id: 'flow' as const, title: 'جریان تولید', icon: Activity },
  { id: 'engineering' as const, title: 'مهندسی', icon: Route },
  { id: 'projects' as const, title: 'پروژه‌ها', icon: FolderKanban },
];

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export default function AppV3() {
  const [page, setPage] = useState<Page>('engineering');
  const [railOpen, setRailOpen] = useState(false);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [time, setTime] = useState(() => new Date());
  const role = roles.find((item) => item.id === session?.role) || roles[0];
  const visibleNav = session?.role === 'engineering'
    ? nav.filter((item) => ['engineering', 'projects', 'flow'].includes(item.id))
    : nav.filter((item) => ['scan', 'queue', 'flow'].includes(item.id));

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/session').then((response) => response.ok ? response.json() : Promise.reject()),
      fetch('/api/projects').then((response) => response.ok ? response.json() : { projects: [] }),
    ]).then(([sessionData, projectData]) => {
      setSession(sessionData.user);
      setProjects((projectData.projects || []).map((project: Project) => ({ ...project, sets: Array.isArray(project.sets) ? project.sets : [] })));
      setPage(sessionData.user?.role === 'engineering' ? 'engineering' : 'scan');
    }).catch(() => { window.location.reload(); });
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const navigate = (target: Page) => { setPage(target); setRailOpen(false); };
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); };

  if (!session) return <div className="forge-loading" dir="rtl"><span className="forge-mark"><i /><i /><i /></span><b>در حال آماده‌سازی فضای کاری</b></div>;

  return <div className="forge-app" dir="rtl">
    <div className="forge-ambient a" /><div className="forge-ambient b" />
    <aside className={`forge-rail ${railOpen ? 'open' : ''}`}>
      <div className="forge-brand"><span className="forge-mark"><i /><i /><i /></span><div><b>خط‌نگار</b><small>سامانه کنترل تولید</small></div></div>
      <div className="rail-section-label">فضای کاری</div>
      <nav className="forge-nav" aria-label="ماژول‌های سامانه">{visibleNav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.title}</span>{page === item.id && <ChevronLeft size={15} />}</button>; })}</nav>
      <div className="rail-foot"><div className="connection"><Radio size={15} /><span><b>{session.displayName}</b><small>{role.title}</small></span></div></div>
    </aside>
    {railOpen && <button className="forge-scrim" type="button" onClick={() => setRailOpen(false)} aria-label="بستن منو" />}

    <section className="forge-workspace">
      <header className="forge-topbar">
        <div className="topbar-title"><button className="menu-button" type="button" onClick={() => setRailOpen(true)}><Menu size={20} /></button><span>{nav.find((item) => item.id === page)?.title}</span></div>
        <div className="topbar-actions"><div className="live-time"><i /><span>{time.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span></div><div className="identity-chip"><span className="role-avatar"><UserRound size={17} /></span><span><small>{role.title}</small><b>{session.displayName}</b></span></div><button className="logout-button" type="button" onClick={() => void logout()} aria-label="خروج از سامانه"><LogOut size={17} /></button></div>
      </header>

      <main className="forge-main">
        {page === 'scan' && <ScanPage role={role} />}
        {page === 'queue' && <EmptyPage eyebrow="صف عملیات" title="صف کاری وجود ندارد" text="پس از تعریف پروژه و ورود قطعات به مسیر تولید، موارد قابل اقدام در این بخش نمایش داده می‌شوند." icon={<ClipboardList size={32} />} />}
        {page === 'flow' && <FlowPage projects={projects} onProjects={() => navigate('projects')} />}
        {page === 'engineering' && <EngineeringPage projects={projects} onProjects={setProjects} notify={notify} onCreateProject={() => navigate('projects')} />}
        {page === 'projects' && <ProjectsPage projects={projects} onProjects={setProjects} notify={notify} />}
      </main>
      <nav className="forge-dock">{visibleNav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.title}</span></button>; })}</nav>
    </section>
    {toast && <div className="forge-toast"><CircleCheck size={18} /><span>{toast}</span></div>}
  </div>;
}

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return <header className="page-heading"><div><span>{eyebrow}</span><h1>{title}</h1></div>{children}</header>;
}

function ScanPage({ role }: { role: (typeof roles)[number] }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [usbCode, setUsbCode] = useState('');
  const [result, setResult] = useState<{ code: string; found: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const process = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (code.length < 2) return;
    setBusy(true); setCameraOpen(false); setManualOpen(false);
    try {
      const response = await fetch(`/api/scan/${encodeURIComponent(code)}`);
      const data = await response.json();
      setResult({ code, found: response.ok, message: response.ok ? 'کد شناسایی شد.' : data.error || 'رکوردی برای این کد ثبت نشده است.' });
    } catch { setResult({ code, found: false, message: 'ارتباط با سرور برقرار نشد.' }); }
    finally { setBusy(false); }
  };

  const usbSubmit = (event: FormEvent) => { event.preventDefault(); void process(usbCode); setUsbCode(''); };

  return <>
    <PageHeader eyebrow="ایستگاه اسکن" title="اسکن مجموعه"><div className="active-operation"><span>عملیات این کاربر</span><b>{role.action}</b></div></PageHeader>
    <section className="scan-console">
      <div className="scan-console-head"><div className="secure-indicator"><ShieldCheck size={17} /><span>جلسه فعال</span></div><div className="operator-chip"><UserRound size={16} /><span>{role.title}</span></div></div>
      {!result && <div className="scan-core">
        <div className="scanner-art"><div className="scanner-grid" /><div className="scanner-ring one" /><div className="scanner-ring two" /><div className="scanner-glyph"><QrCode size={62} strokeWidth={1.35} /></div><span className="scanner-beam" /></div>
        <div className="scan-copy"><span>آماده اسکن</span><h2>کد QR را داخل قاب قرار دهید</h2></div>
        <button className="camera-primary" type="button" onClick={() => setCameraOpen(true)} disabled={busy}><Camera size={20} /><span>باز کردن دوربین</span><ArrowLeft size={18} /></button>
        <div className="scan-alternatives"><form onSubmit={usbSubmit}><Barcode size={18} /><input value={usbCode} onChange={(event) => setUsbCode(event.target.value)} placeholder="بارکدخوان رومیزی" /><kbd>Enter</kbd></form><button type="button" onClick={() => setManualOpen(true)}><PenLine size={17} /><span>ورود دستی</span></button></div>
      </div>}
      {result && <div className={`scan-result ${result.found ? 'found' : 'missing'}`}><span className="result-icon">{result.found ? <CircleCheck size={32} /> : <CircleAlert size={32} />}</span><small>کد خوانده‌شده</small><h2>{result.code}</h2><p>{result.message}</p><button type="button" onClick={() => setResult(null)}><ScanLine size={17} /> اسکن کد دیگر</button></div>}
      <div className="scan-console-foot"><span><i /> وضعیت: آماده</span><span>نوع اقدام: {role.action}</span></div>
      {cameraOpen && <CameraReader role={role} onClose={() => setCameraOpen(false)} onRead={(code) => void process(code)} />}
    </section>
    {manualOpen && <ManualEntry onClose={() => setManualOpen(false)} onDone={(code) => void process(code)} />}
  </>;
}

function CameraReader({ role, onClose, onRead }: { role: (typeof roles)[number]; onClose: () => void; onRead: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onReadRef = useRef(onRead);
  const lock = useRef(false);
  const [state, setState] = useState<'starting' | 'reading' | 'insecure' | 'denied' | 'unsupported'>('starting');
  const [torch, setTorch] = useState(false);
  useEffect(() => { onReadRef.current = onRead; }, [onRead]);
  useEffect(() => {
    let disposed = false;
    const start = async () => {
      if (!window.isSecureContext) { setState('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
      try {
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 800 });
        const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, videoRef.current || undefined, (decoded) => {
          if (decoded && !lock.current && !disposed) { lock.current = true; controlsRef.current?.stop(); onReadRef.current(decoded.getText()); }
        });
        if (disposed) controls.stop(); else { controlsRef.current = controls; setState('reading'); }
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        setState(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unsupported');
      }
    };
    void start();
    return () => { disposed = true; controlsRef.current?.stop(); };
  }, []);
  const toggleTorch = async () => { if (!controlsRef.current?.switchTorch) return; const next = !torch; try { await controlsRef.current.switchTorch(next); setTorch(next); } catch { /* device capability */ } };
  return <div className="camera-live"><video ref={videoRef} muted playsInline /><div className="camera-vignette" /><div className="camera-bar"><button type="button" onClick={onClose}><X size={20} /></button><span><small>{role.title}</small><b>{role.action}</b></span><button type="button" className={torch ? 'active' : ''} onClick={toggleTorch}><Flashlight size={19} /></button></div><div className="camera-frame"><i /><i /><i /><i /><span /></div>{state === 'starting' && <CameraState icon={<Radio size={23} />} title="راه‌اندازی دوربین" text="چند لحظه صبر کنید" />}{state === 'insecure' && <CameraState icon={<ShieldCheck size={24} />} title="نشانی امن معتبر نیست" text="سامانه باید از نشانی HTTPS معتبر باز شود." />}{state === 'denied' && <CameraState icon={<CircleAlert size={24} />} title="دسترسی دوربین بسته است" text="دسترسی Camera را در مرورگر فعال کنید." />}{state === 'unsupported' && <CameraState icon={<CircleAlert size={24} />} title="دوربین در دسترس نیست" text="این مرورگر یا دستگاه از اسکن پشتیبانی نمی‌کند." />}{state === 'reading' && <div className="camera-tip"><i /> QR را داخل قاب نگه دارید</div>}</div>;
}

function CameraState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="camera-state">{icon}<b>{title}</b><span>{text}</span></div>; }

function ManualEntry({ onClose, onDone }: { onClose: () => void; onDone: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal small"><header><div><span>ثبت جایگزین</span><h2>ورود دستی کد</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><label>کد مجموعه<input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="کد روی لیبل" /></label><label>دلیل ورود دستی<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">انتخاب کنید</option><option>لیبل ناخوانا</option><option>دوربین در دسترس نیست</option><option>بارکدخوان ایستگاه در دسترس نیست</option></select></label><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={code.trim().length < 2 || !reason} onClick={() => onDone(code.trim())}>بررسی کد</button></footer></section></div>;
}

function EmptyPage({ eyebrow, title, text, icon, action }: { eyebrow: string; title: string; text: string; icon: React.ReactNode; action?: React.ReactNode }) {
  return <><PageHeader eyebrow={eyebrow} title={title} /><EmptyCanvas title={title} text={text} icon={icon} action={action} /></>;
}

function EmptyCanvas({ title, text, icon, action }: { title: string; text: string; icon: React.ReactNode; action?: React.ReactNode }) {
  return <section className="empty-canvas"><div className="empty-visual"><span>{icon}</span><i /><i /><i /></div><h2>{title}</h2><p>{text}</p>{action}</section>;
}

function FlowPage({ projects, onProjects }: { projects: Project[]; onProjects: () => void }) {
  if (!projects.length) return <EmptyPage eyebrow="جریان تولید" title="هنوز جریانی ساخته نشده" text="ابتدا پروژه را تعریف کنید؛ مسیر واقعی همان پروژه در این بخش تشکیل می‌شود." icon={<Activity size={32} />} action={<button className="empty-action" type="button" onClick={onProjects}><FilePlus2 size={17} /> تعریف پروژه</button>} />;
  return <><PageHeader eyebrow="جریان تولید" title="پروژه‌های ثبت‌شده" /><section className="entity-grid">{projects.map((project) => <article className="entity-card" key={project.id}><span className="entity-icon"><FolderKanban size={22} /></span><small>{project.code}</small><h3>{project.name}</h3><p>{project.itemType === 'assembly' ? 'مونتاژی' : 'تکی'} · {project.drawings.length.toLocaleString('fa-IR')} نقشه · {(project.sets?.length || 0).toLocaleString('fa-IR')} مجموعه</p></article>)}</section></>;
}

function EngineeringPage({ projects, onProjects, notify, onCreateProject }: { projects: Project[]; onProjects: (projects: Project[]) => void; notify: (message: string) => void; onCreateProject: () => void }) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.id || null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(projects[0]?.sets?.[0]?.id || null);
  const [draft, setDraft] = useState<Project | null>(projects[0] ? structuredClone(projects[0]) : null);
  const [newSetOpen, setNewSetOpen] = useState(false);
  const [newStep, setNewStep] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (projects.length && (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId))) {
      const project = projects[0];
      setSelectedProjectId(project.id); setDraft(structuredClone(project)); setSelectedSetId(project.sets?.[0]?.id || null);
    }
  }, [projects, selectedProjectId]);

  const selectProject = (project: Project) => {
    setSelectedProjectId(project.id); setDraft(structuredClone(project)); setSelectedSetId(project.sets?.[0]?.id || null); setNewStep('');
  };
  const activeSet = draft?.sets.find((set) => set.id === selectedSetId) || null;
  const updateActiveSet = (patch: Partial<ProductionSet>) => {
    if (!draft || !selectedSetId) return;
    setDraft({ ...draft, sets: draft.sets.map((set) => set.id === selectedSetId ? { ...set, ...patch } : set) });
  };
  const createSet = (input: Pick<ProductionSet, 'name' | 'code' | 'kind' | 'operatorRole'>) => {
    if (!draft) return;
    const set: ProductionSet = { id: uid(), ...input, steps: [] };
    setDraft({ ...draft, sets: [...draft.sets, set] }); setSelectedSetId(set.id); setNewSetOpen(false); notify('مجموعه به مسیر پروژه اضافه شد؛ چینش را ذخیره کنید.');
  };
  const moveSet = (index: number, delta: number) => {
    if (!draft) return; const target = index + delta; if (target < 0 || target >= draft.sets.length) return;
    const sets = [...draft.sets]; [sets[index], sets[target]] = [sets[target], sets[index]]; setDraft({ ...draft, sets });
  };
  const removeSet = (id: string) => {
    if (!draft) return; const sets = draft.sets.filter((set) => set.id !== id); setDraft({ ...draft, sets });
    if (selectedSetId === id) setSelectedSetId(sets[0]?.id || null);
  };
  const addStep = () => {
    if (!activeSet || newStep.trim().length < 2) return;
    updateActiveSet({ steps: [...activeSet.steps, { id: uid(), name: newStep.trim(), execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] }); setNewStep('');
  };
  const updateStep = (index: number, patch: Partial<Step>) => { if (activeSet) updateActiveSet({ steps: activeSet.steps.map((step, i) => i === index ? { ...step, ...patch } : step) }); };
  const moveStep = (index: number, delta: number) => {
    if (!activeSet) return; const target = index + delta; if (target < 0 || target >= activeSet.steps.length) return;
    const steps = [...activeSet.steps]; [steps[index], steps[target]] = [steps[target], steps[index]]; updateActiveSet({ steps });
  };
  const removeStep = (index: number) => { if (activeSet) updateActiveSet({ steps: activeSet.steps.filter((_, i) => i !== index) }); };
  const save = async () => {
    if (!draft) return; setSaving(true);
    try {
      const response = await fetch(`/api/projects/${draft.id}/route`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sets: draft.sets }) });
      const data = await response.json(); if (!response.ok) { notify(data.error || 'چینش پروژه ذخیره نشد.'); return; }
      onProjects(projects.map((project) => project.id === draft.id ? data.project : project)); setDraft(structuredClone(data.project)); notify('مسیر پروژه ذخیره شد.');
    } finally { setSaving(false); }
  };

  if (!projects.length) return <EmptyPage eyebrow="امور مهندسی" title="پروژه‌ای برای طراحی مسیر وجود ندارد" text="ابتدا پروژه را ثبت کنید؛ سپس مجموعه‌های همان پروژه را در این صفحه می‌چینید." icon={<FolderKanban size={32} />} action={<button className="empty-action" type="button" onClick={onCreateProject}><FilePlus2 size={17} /> تعریف پروژه</button>} />;

  return <>
    <PageHeader eyebrow="امور مهندسی" title="طراحی مسیر پروژه"><div className="engineering-summary"><span>پروژه انتخاب‌شده</span><b>{draft?.name}</b><small>{draft?.sets.length.toLocaleString('fa-IR')} مجموعه در مسیر</small></div></PageHeader>
    <section className="project-engineering-shell">
      <aside className="project-library"><header><span>پروژه‌ها</span><b>{projects.length.toLocaleString('fa-IR')}</b></header><div className="project-list">{projects.map((project) => <button type="button" key={project.id} className={selectedProjectId === project.id ? 'active' : ''} onClick={() => selectProject(project)}><span className="set-symbol"><FolderKanban size={18} /></span><span><b>{project.name}</b><small>{project.code} · {(project.sets?.length || 0).toLocaleString('fa-IR')} مجموعه</small></span><ChevronLeft size={15} /></button>)}</div><button className="new-project-link" type="button" onClick={onCreateProject}><Plus size={15} /> پروژه جدید</button></aside>
      <div className="project-route-studio">{draft && <>
        <header className="project-studio-head"><div><span>{draft.code}</span><h2>{draft.name}</h2><small>{draft.itemType === 'assembly' ? 'پروژه مونتاژی' : 'قطعه تکی'} · {draft.drawings.length.toLocaleString('fa-IR')} نقشه</small></div><button className="save-route" type="button" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? 'در حال ذخیره' : 'ذخیره چینش پروژه'}</button></header>
        <div className="route-builder-head"><div><span>ترتیب اجرای مجموعه‌ها</span><small>ترتیب از راست به چپ اجرا می‌شود</small></div><button type="button" onClick={() => setNewSetOpen(true)}><Plus size={16} /> افزودن مجموعه</button></div>
        {draft.sets.length ? <div className="project-set-route">{draft.sets.map((set, index) => <article key={set.id} className={`project-set-card ${selectedSetId === set.id ? 'active' : ''}`} onClick={() => setSelectedSetId(set.id)}><div className="set-order"><GripVertical size={15} /><b>{(index + 1).toLocaleString('fa-IR')}</b></div><button className="set-card-main" type="button" onClick={() => setSelectedSetId(set.id)}><span><Boxes size={18} /></span><div><small>{set.code || 'بدون کد'}</small><h3>{set.name}</h3><p>{set.operatorRole}</p></div></button><div className="set-card-actions"><button type="button" onClick={(event) => { event.stopPropagation(); moveSet(index, -1); }} disabled={index === 0} aria-label="انتقال مجموعه به قبل"><ArrowUp size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); moveSet(index, 1); }} disabled={index === draft.sets.length - 1} aria-label="انتقال مجموعه به بعد"><ArrowDown size={14} /></button><button className="remove" type="button" onClick={(event) => { event.stopPropagation(); removeSet(set.id); }} aria-label="حذف مجموعه از پروژه"><Trash2 size={14} /></button></div>{index < draft.sets.length - 1 && <span className="route-connector"><ArrowLeft size={16} /></span>}</article>)}</div> : <div className="project-route-empty"><Layers3 size={31} /><h3>مسیر پروژه هنوز مجموعه‌ای ندارد</h3><button type="button" onClick={() => setNewSetOpen(true)}><Plus size={16} /> تعریف اولین مجموعه</button></div>}
        {activeSet ? <section className="set-workbench"><header><div><span>تنظیمات مجموعه انتخاب‌شده</span><h3>{activeSet.name}</h3></div><div className="scan-meaning"><Barcode size={18} /><span><small>مفهوم اسکن اپراتور</small><b>ثبت اتمام «{activeSet.name}»</b></span></div></header><div className="set-identity-grid"><label>نام مجموعه<input value={activeSet.name} onChange={(event) => updateActiveSet({ name: event.target.value })} /></label><label>کد مجموعه<input value={activeSet.code} onChange={(event) => updateActiveSet({ code: event.target.value.toUpperCase() })} /></label><label>نقش اپراتور<input value={activeSet.operatorRole} onChange={(event) => updateActiveSet({ operatorRole: event.target.value })} /></label></div><div className="subprocess-heading"><div><b>زیرفرآیندهای مجموعه</b><small>{activeSet.steps.length.toLocaleString('fa-IR')} مرحله</small></div></div><div className="add-step"><span className="add-step-icon"><Plus size={19} /></span><input value={newStep} onChange={(event) => setNewStep(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addStep(); }} placeholder="نام زیرفرآیند جدید" /><button type="button" onClick={addStep} disabled={newStep.trim().length < 2}>افزودن</button></div>{activeSet.steps.length ? <div className="route-list">{activeSet.steps.map((step, index) => <article className="route-step" key={step.id}><div className="step-handle"><GripVertical size={17} /><span>{(index + 1).toLocaleString('fa-IR')}</span></div><div className="step-main"><div className="step-name"><input value={step.name} onChange={(event) => updateStep(index, { name: event.target.value })} /><span className={`execution ${step.execution}`}>{step.execution === 'internal' ? 'داخلی' : 'خارجی'}</span></div><div className="step-controls"><div className="execution-switch"><button type="button" className={step.execution === 'internal' ? 'active' : ''} onClick={() => updateStep(index, { execution: 'internal' })}>داخلی</button><button type="button" className={step.execution === 'external' ? 'active' : ''} onClick={() => updateStep(index, { execution: 'external' })}>خارجی</button></div><label><input type="checkbox" checked={step.qcRequired} onChange={(event) => updateStep(index, { qcRequired: event.target.checked })} /> کنترل کیفیت</label><label><input type="checkbox" checked={step.productionControlRequired} onChange={(event) => updateStep(index, { productionControlRequired: event.target.checked })} /> کنترل تولید</label><label><input type="checkbox" checked={step.barcodeAfter} onChange={(event) => updateStep(index, { barcodeAfter: event.target.checked })} /> نصب بارکد</label></div></div><div className="step-actions"><button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="انتقال به بالا"><ArrowUp size={15} /></button><button type="button" onClick={() => moveStep(index, 1)} disabled={index === activeSet.steps.length - 1} aria-label="انتقال به پایین"><ArrowDown size={15} /></button><button className="remove" type="button" onClick={() => removeStep(index)} aria-label="حذف زیرفرآیند"><Trash2 size={15} /></button></div></article>)}</div> : <div className="subprocess-empty"><Route size={26} /><span>زیرفرآیندی برای این مجموعه تعریف نشده است</span></div>}</section> : draft.sets.length > 0 && <div className="studio-empty"><Wrench size={30} /><h3>یک مجموعه را از مسیر انتخاب کنید</h3></div>}
      </>}</div>
    </section>
    {newSetOpen && <NewSetModal onClose={() => setNewSetOpen(false)} onCreate={createSet} />}
  </>;
}

function NewSetModal({ onClose, onCreate }: { onClose: () => void; onCreate: (value: Pick<ProductionSet, 'name' | 'code' | 'kind' | 'operatorRole'>) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [operatorRole, setOperatorRole] = useState(''); const [kind, setKind] = useState<'single' | 'assembly'>('assembly');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal"><header><div><span>مسیر پروژه</span><h2>افزودن مجموعه</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="modal-grid"><label>نام مجموعه<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="نام فنی مجموعه" /></label><label>کد مجموعه <em>اختیاری</em><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="کد داخلی" /></label></div><label>نقش اپراتور مجموعه<input value={operatorRole} onChange={(event) => setOperatorRole(event.target.value)} placeholder="عنوان نقش مسئول این مجموعه" /></label><label>نوع ساخت</label><div className="kind-selector"><button type="button" className={kind === 'assembly' ? 'active' : ''} onClick={() => setKind('assembly')}><Boxes size={21} /><span><b>مونتاژی</b><small>دارای چند زیرفرآیند</small></span></button><button type="button" className={kind === 'single' ? 'active' : ''} onClick={() => setKind('single')}><PackageOpen size={21} /><span><b>تکی</b><small>مسیر مستقل</small></span></button></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={name.trim().length < 2 || operatorRole.trim().length < 2} onClick={() => onCreate({ name: name.trim(), code: code.trim(), kind, operatorRole: operatorRole.trim() })}>افزودن به پروژه</button></footer></section></div>;
}

function ProjectsPage({ projects, onProjects, notify }: { projects: Project[]; onProjects: (projects: Project[]) => void; notify: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const create = async (input: Omit<Project, 'id' | 'sets'>) => { const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) { notify(data.error || 'پروژه ذخیره نشد.'); return; } onProjects([...projects, data.project]); setOpen(false); notify('پروژه ایجاد شد؛ اکنون مسیر آن را در مهندسی تعریف کنید.'); };
  return <><PageHeader eyebrow="دفتر پروژه‌ها" title="پروژه‌ها"><button className="heading-action" type="button" onClick={() => setOpen(true)}><Plus size={18} /> پروژه جدید</button></PageHeader>{projects.length ? <section className="entity-grid">{projects.map((project) => <article className="entity-card" key={project.id}><span className="entity-icon"><Factory size={22} /></span><small>{project.code}</small><h3>{project.name}</h3><p>{project.itemType === 'assembly' ? 'مونتاژی' : 'تکی'} · {project.drawings.length.toLocaleString('fa-IR')} نقشه · {(project.sets?.length || 0).toLocaleString('fa-IR')} مجموعه</p></article>)}</section> : <EmptyCanvas title="پروژه‌ای ثبت نشده" text="نام پروژه، کد، نقشه‌ها و نوع ساخت را ثبت کنید." icon={<FolderKanban size={32} />} action={<button className="empty-action" type="button" onClick={() => setOpen(true)}><Plus size={17} /> تعریف اولین پروژه</button>} />}{open && <NewProjectModal onClose={() => setOpen(false)} onCreate={(input) => void create(input)} />}</>;
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (value: Omit<Project, 'id' | 'sets'>) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [drawings, setDrawings] = useState(''); const [itemType, setItemType] = useState<'single' | 'assembly'>('assembly');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal"><header><div><span>دفتر پروژه‌ها</span><h2>تعریف پروژه</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="modal-grid"><label>نام پروژه<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>کد پروژه<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label></div><label>شماره نقشه‌ها <em>هر شماره در یک خط</em><textarea value={drawings} onChange={(event) => setDrawings(event.target.value)} rows={4} /></label><label>نوع قطعه</label><div className="kind-selector compact"><button type="button" className={itemType === 'assembly' ? 'active' : ''} onClick={() => setItemType('assembly')}><Boxes size={19} /><span><b>مونتاژی</b></span></button><button type="button" className={itemType === 'single' ? 'active' : ''} onClick={() => setItemType('single')}><PackageOpen size={19} /><span><b>تکی</b></span></button></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={name.trim().length < 2 || code.trim().length < 2} onClick={() => onCreate({ name, code, itemType, drawings: drawings.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })}>ثبت پروژه</button></footer></section></div>;
}
