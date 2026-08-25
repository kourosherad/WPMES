import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import {
  Activity, ArrowDown, ArrowLeft, ArrowUp, Barcode, Boxes, Camera, Check,
  ChevronDown, ChevronLeft, CircleAlert, CircleCheck, ClipboardList, Factory,
  FilePlus2, Flashlight, FolderKanban, GripVertical, Layers3, Menu, PackageOpen,
  PenLine, Plus, QrCode, Radio, Route, Save, ScanLine, ShieldCheck,
  Trash2, UserRound, Wrench, X,
} from 'lucide-react';

type Page = 'scan' | 'queue' | 'flow' | 'engineering' | 'projects';
type RoleId = 'operator' | 'qc' | 'production' | 'packaging' | 'engineering';
type Step = { id: string; name: string; execution: 'internal' | 'external'; qcRequired: boolean; productionControlRequired: boolean; barcodeAfter: boolean };
type ProductionSet = { id: string; name: string; code: string; kind: 'single' | 'assembly'; steps: Step[]; createdAt?: string; updatedAt?: string };
type Project = { id: string; name: string; code: string; itemType: 'single' | 'assembly'; drawings: string[] };

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
  const [page, setPage] = useState<Page>('scan');
  const [roleId, setRoleId] = useState<RoleId>('operator');
  const [roleOpen, setRoleOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sets, setSets] = useState<ProductionSet[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [time, setTime] = useState(() => new Date());
  const role = roles.find((item) => item.id === roleId)!;

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/sets').then((response) => response.ok ? response.json() : { sets: [] }),
      fetch('/api/projects').then((response) => response.ok ? response.json() : { projects: [] }),
    ]).then(([setData, projectData]) => { setSets(setData.sets || []); setProjects(projectData.projects || []); }).catch(() => undefined);
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const navigate = (target: Page) => { setPage(target); setRailOpen(false); };

  return <div className="forge-app" dir="rtl">
    <div className="forge-ambient a" /><div className="forge-ambient b" />
    <aside className={`forge-rail ${railOpen ? 'open' : ''}`}>
      <div className="forge-brand"><span className="forge-mark"><i /><i /><i /></span><div><b>خط‌نگار</b><small>سامانه کنترل تولید</small></div></div>
      <div className="rail-section-label">فضای کاری</div>
      <nav className="forge-nav" aria-label="ماژول‌های سامانه">{nav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.title}</span>{page === item.id && <ChevronLeft size={15} />}</button>; })}</nav>
      <div className="rail-foot"><div className="connection"><Radio size={15} /><span><b>فاز یک</b><small>کنترل عملیات تولید</small></span></div></div>
    </aside>
    {railOpen && <button className="forge-scrim" type="button" onClick={() => setRailOpen(false)} aria-label="بستن منو" />}

    <section className="forge-workspace">
      <header className="forge-topbar">
        <div className="topbar-title"><button className="menu-button" type="button" onClick={() => setRailOpen(true)}><Menu size={20} /></button><span>{nav.find((item) => item.id === page)?.title}</span></div>
        <div className="topbar-actions"><div className="live-time"><i /><span>{time.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span></div><div className="role-picker"><button type="button" className="role-trigger" onClick={() => setRoleOpen((value) => !value)}><span className="role-avatar"><UserRound size={17} /></span><span><small>نقش فعال</small><b>{role.title}</b></span><ChevronDown size={15} /></button>{roleOpen && <div className="role-menu">{roles.map((item) => <button type="button" key={item.id} className={item.id === roleId ? 'selected' : ''} onClick={() => { setRoleId(item.id); setRoleOpen(false); }}><span>{item.title}</span>{item.id === roleId && <Check size={15} />}</button>)}</div>}</div></div>
      </header>

      <main className="forge-main">
        {page === 'scan' && <ScanPage role={role} />}
        {page === 'queue' && <EmptyPage eyebrow="صف عملیات" title="صف کاری وجود ندارد" text="پس از تعریف پروژه و ورود قطعات به مسیر تولید، موارد قابل اقدام در این بخش نمایش داده می‌شوند." icon={<ClipboardList size={32} />} />}
        {page === 'flow' && <FlowPage projects={projects} onProjects={() => navigate('projects')} />}
        {page === 'engineering' && <EngineeringPage sets={sets} onSets={setSets} notify={notify} />}
        {page === 'projects' && <ProjectsPage projects={projects} onProjects={setProjects} notify={notify} />}
      </main>
      <nav className="forge-dock">{nav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.title}</span></button>; })}</nav>
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
  return <><PageHeader eyebrow="جریان تولید" title="پروژه‌های ثبت‌شده" /><section className="entity-grid">{projects.map((project) => <article className="entity-card" key={project.id}><span className="entity-icon"><FolderKanban size={22} /></span><small>{project.code}</small><h3>{project.name}</h3><p>{project.itemType === 'assembly' ? 'مونتاژی' : 'تکی'} · {project.drawings.length.toLocaleString('fa-IR')} نقشه</p></article>)}</section></>;
}

function EngineeringPage({ sets, onSets, notify }: { sets: ProductionSet[]; onSets: (sets: ProductionSet[]) => void; notify: (message: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(sets[0]?.id || null);
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState<ProductionSet | null>(sets[0] ? structuredClone(sets[0]) : null);
  const [newStep, setNewStep] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!selectedId && sets[0]) { setSelectedId(sets[0].id); setDraft(structuredClone(sets[0])); } }, [sets, selectedId]);
  const select = (item: ProductionSet) => { setSelectedId(item.id); setDraft(structuredClone(item)); };
  const create = async (input: Pick<ProductionSet, 'name' | 'code' | 'kind'>) => {
    const response = await fetch('/api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, steps: [] }) });
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'مجموعه ذخیره نشد.'); return; }
    const next = [...sets, data.set]; onSets(next); select(data.set); setNewOpen(false); notify('مجموعه ایجاد شد.');
  };
  const addStep = () => { if (!draft || newStep.trim().length < 2) return; setDraft({ ...draft, steps: [...draft.steps, { id: uid(), name: newStep.trim(), execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] }); setNewStep(''); };
  const updateStep = (index: number, patch: Partial<Step>) => { if (!draft) return; setDraft({ ...draft, steps: draft.steps.map((step, i) => i === index ? { ...step, ...patch } : step) }); };
  const move = (index: number, delta: number) => { if (!draft) return; const target = index + delta; if (target < 0 || target >= draft.steps.length) return; const steps = [...draft.steps]; [steps[index], steps[target]] = [steps[target], steps[index]]; setDraft({ ...draft, steps }); };
  const removeStep = (index: number) => { if (!draft) return; setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) }); };
  const save = async () => { if (!draft) return; setSaving(true); try { const response = await fetch(`/api/sets/${draft.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); const data = await response.json(); if (!response.ok) { notify(data.error || 'ذخیره انجام نشد.'); return; } onSets(sets.map((item) => item.id === draft.id ? data.set : item)); setDraft(structuredClone(data.set)); notify('مسیر مجموعه ذخیره شد.'); } finally { setSaving(false); } };

  return <>
    <PageHeader eyebrow="امور مهندسی" title="کتابخانه مجموعه‌ها"><button className="heading-action" type="button" onClick={() => setNewOpen(true)}><Plus size={18} /> مجموعه جدید</button></PageHeader>
    <section className="engineering-shell">
      <aside className="set-library"><header><span>مجموعه‌ها</span><b>{sets.length.toLocaleString('fa-IR')}</b></header>{sets.length ? <div className="set-list">{sets.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => select(item)}><span className="set-symbol"><Boxes size={18} /></span><span><b>{item.name}</b><small>{item.kind === 'assembly' ? 'مونتاژی' : 'تکی'}{item.code ? ` · ${item.code}` : ''}</small></span><em>{item.steps.length.toLocaleString('fa-IR')}</em></button>)}</div> : <div className="library-empty"><Layers3 size={27} /><b>مجموعه‌ای تعریف نشده</b><button type="button" onClick={() => setNewOpen(true)}><Plus size={15} /> تعریف اولین مجموعه</button></div>}</aside>
      <div className="route-studio">{draft ? <>
        <header className="studio-head"><div><span>{draft.kind === 'assembly' ? 'مجموعه مونتاژی' : 'قطعه تکی'}</span><h2>{draft.name}</h2></div><button className="save-route" type="button" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? 'در حال ذخیره' : 'ذخیره مسیر'}</button></header>
        <div className="add-step"><span className="add-step-icon"><Plus size={19} /></span><input value={newStep} onChange={(event) => setNewStep(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addStep(); }} placeholder="نام زیر‌فرآیند جدید" /><button type="button" onClick={addStep} disabled={newStep.trim().length < 2}>افزودن</button></div>
        {draft.steps.length ? <div className="route-list">{draft.steps.map((step, index) => <article className="route-step" key={step.id}><div className="step-handle"><GripVertical size={17} /><span>{(index + 1).toLocaleString('fa-IR')}</span></div><div className="step-main"><div className="step-name"><input value={step.name} onChange={(event) => updateStep(index, { name: event.target.value })} /><span className={`execution ${step.execution}`}>{step.execution === 'internal' ? 'داخلی' : 'خارجی'}</span></div><div className="step-controls"><div className="execution-switch"><button type="button" className={step.execution === 'internal' ? 'active' : ''} onClick={() => updateStep(index, { execution: 'internal' })}>داخلی</button><button type="button" className={step.execution === 'external' ? 'active' : ''} onClick={() => updateStep(index, { execution: 'external' })}>خارجی</button></div><label><input type="checkbox" checked={step.qcRequired} onChange={(event) => updateStep(index, { qcRequired: event.target.checked })} /> کنترل کیفیت</label><label><input type="checkbox" checked={step.productionControlRequired} onChange={(event) => updateStep(index, { productionControlRequired: event.target.checked })} /> کنترل تولید</label><label><input type="checkbox" checked={step.barcodeAfter} onChange={(event) => updateStep(index, { barcodeAfter: event.target.checked })} /> نصب بارکد پس از این مرحله</label></div></div><div className="step-actions"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="انتقال به بالا"><ArrowUp size={15} /></button><button type="button" onClick={() => move(index, 1)} disabled={index === draft.steps.length - 1} aria-label="انتقال به پایین"><ArrowDown size={15} /></button><button className="remove" type="button" onClick={() => removeStep(index)} aria-label="حذف زیر فرآیند"><Trash2 size={15} /></button></div></article>)}</div> : <div className="studio-empty"><Route size={34} /><h3>مسیر این مجموعه خالی است</h3><p>اولین زیر‌فرآیند را از کادر بالا اضافه کنید.</p></div>}
      </> : <div className="studio-empty full"><Wrench size={37} /><h3>یک مجموعه را انتخاب کنید</h3><p>یا مجموعه جدید بسازید و مسیر تولید آن را تعریف کنید.</p><button type="button" onClick={() => setNewOpen(true)}><Plus size={17} /> مجموعه جدید</button></div>}</div>
    </section>
    {newOpen && <NewSetModal onClose={() => setNewOpen(false)} onCreate={(value) => void create(value)} />}
  </>;
}

function NewSetModal({ onClose, onCreate }: { onClose: () => void; onCreate: (value: Pick<ProductionSet, 'name' | 'code' | 'kind'>) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [kind, setKind] = useState<'single' | 'assembly'>('assembly');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal"><header><div><span>کتابخانه مهندسی</span><h2>تعریف مجموعه جدید</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="modal-grid"><label>نام مجموعه<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="نام فنی مجموعه" /></label><label>کد مجموعه <em>اختیاری</em><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="کد داخلی" /></label></div><label>نوع ساخت</label><div className="kind-selector"><button type="button" className={kind === 'assembly' ? 'active' : ''} onClick={() => setKind('assembly')}><Boxes size={21} /><span><b>مونتاژی</b><small>دارای چند زیر‌فرآیند</small></span></button><button type="button" className={kind === 'single' ? 'active' : ''} onClick={() => setKind('single')}><PackageOpen size={21} /><span><b>تکی</b><small>دارای یک مسیر مستقل</small></span></button></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={name.trim().length < 2} onClick={() => onCreate({ name, code, kind })}>ساخت مجموعه</button></footer></section></div>;
}

function ProjectsPage({ projects, onProjects, notify }: { projects: Project[]; onProjects: (projects: Project[]) => void; notify: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const create = async (input: Omit<Project, 'id'>) => { const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) { notify(data.error || 'پروژه ذخیره نشد.'); return; } onProjects([...projects, data.project]); setOpen(false); notify('پروژه ایجاد شد.'); };
  return <><PageHeader eyebrow="دفتر پروژه‌ها" title="پروژه‌ها"><button className="heading-action" type="button" onClick={() => setOpen(true)}><Plus size={18} /> پروژه جدید</button></PageHeader>{projects.length ? <section className="entity-grid">{projects.map((project) => <article className="entity-card" key={project.id}><span className="entity-icon"><Factory size={22} /></span><small>{project.code}</small><h3>{project.name}</h3><p>{project.itemType === 'assembly' ? 'مونتاژی' : 'تکی'} · {project.drawings.length.toLocaleString('fa-IR')} نقشه</p></article>)}</section> : <EmptyCanvas title="پروژه‌ای ثبت نشده" text="نام پروژه، کد، نقشه‌ها و نوع ساخت را ثبت کنید." icon={<FolderKanban size={32} />} action={<button className="empty-action" type="button" onClick={() => setOpen(true)}><Plus size={17} /> تعریف اولین پروژه</button>} />}{open && <NewProjectModal onClose={() => setOpen(false)} onCreate={(input) => void create(input)} />}</>;
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (value: Omit<Project, 'id'>) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [drawings, setDrawings] = useState(''); const [itemType, setItemType] = useState<'single' | 'assembly'>('assembly');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal"><header><div><span>دفتر پروژه‌ها</span><h2>تعریف پروژه</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="modal-grid"><label>نام پروژه<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>کد پروژه<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label></div><label>شماره نقشه‌ها <em>هر شماره در یک خط</em><textarea value={drawings} onChange={(event) => setDrawings(event.target.value)} rows={4} /></label><label>نوع قطعه</label><div className="kind-selector compact"><button type="button" className={itemType === 'assembly' ? 'active' : ''} onClick={() => setItemType('assembly')}><Boxes size={19} /><span><b>مونتاژی</b></span></button><button type="button" className={itemType === 'single' ? 'active' : ''} onClick={() => setItemType('single')}><PackageOpen size={19} /><span><b>تکی</b></span></button></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={name.trim().length < 2 || code.trim().length < 2} onClick={() => onCreate({ name, code, itemType, drawings: drawings.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })}>ثبت پروژه</button></footer></section></div>;
}
