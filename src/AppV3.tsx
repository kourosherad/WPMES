import { FormEvent, useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import readXlsxFile from 'read-excel-file/browser';
import QRCode from 'qrcode';
import {
  Activity, Archive, ArrowDown, ArrowLeft, ArrowUp, Barcode, Boxes, Camera, Download,
  Check, ChevronLeft, CircleAlert, CircleCheck, Factory,
  FilePlus2, FileSpreadsheet, Flashlight, FolderKanban, GripVertical, Layers3, Menu, PackageOpen,
  KeyRound, LogOut, PenLine, Plus, QrCode, Radio, Route, Save, ScanLine, ShieldCheck,
  Trash2, UserRound, UsersRound, Wrench, X,
} from 'lucide-react';

type Page = 'scan' | 'flow' | 'engineering' | 'projects' | 'access';
type RoleId = 'qc' | 'production' | 'engineering';
type PermissionId = 'projects' | 'project_create' | 'engineering' | 'production_flow' | 'scanner' | 'qc' | 'production_control' | 'packaging' | 'access_matrix';
type Step = { id: string; name: string; execution: 'internal' | 'external'; qcRequired: boolean; productionControlRequired: boolean; barcodeAfter: boolean };
type ProductionSet = { id: string; name: string; code: string; kind: 'single' | 'assembly'; operatorRole: string; steps: Step[] };
type ProjectProfile = { mainDrawingNumber: string; componentDrawings: { id: string; drawingNumber: string; description: string }[]; customFields: Record<string, string>; importedHeaders: string[]; importedRows: Record<string, string>[]; sourceFileName: string; importedRowCount: number; updatedAt?: string };
type Project = { id: string; name: string; code: string; itemType: 'single' | 'assembly'; drawings: string[]; sets: ProductionSet[]; profile?: ProjectProfile | null };
type ProjectInput = { name: string; code: string; itemType: 'single' | 'assembly'; drawings: string[] };
type IssuedWorkItem = { id: string; serialNumber: string; barcode: string; status: string; currentSet: string | null; currentStep: string | null; issuedAt: string; completedAt: string | null };
type SessionUser = { username: string; displayName: string; role: RoleId; accountRole?: 'admin'; scope?: string | null; permissions: PermissionId[] };
type AccessUser = { username: string; displayName: string; role: RoleId | 'admin'; scope: string; permissions: PermissionId[]; isAdmin: boolean };
type ScanResolution = {
  code: string; project: { id: string; code: string; name: string }; set: { id: string; code: string; name: string };
  step: { id: string; name: string } | null; serialNumber: string; status: string; executionStatus: string | null;
  allowed: boolean; action: { code: string; title: string } | null; rejectionReason: string | null;
  processes: { id: string; order: number; name: string; execution: 'internal' | 'external'; status: string; current: boolean }[];
};

const defaultOperatorStations = ['مونتاژ', 'جوش', 'سندبلاست', 'رنگ میانی', 'رنگ نهایی', 'بسته‌بندی'];

const roles = [
  { id: 'production' as const, title: 'کنترل تولید', action: 'ثبت و تأیید عملیات تولید' },
  { id: 'qc' as const, title: 'کنترل کیفیت', action: 'ثبت تأیید کنترل کیفیت' },
  { id: 'engineering' as const, title: 'امور مهندسی', action: 'تعریف مسیر پروژه' },
];

const nav = [
  { id: 'scan' as const, title: 'ایستگاه اسکن', icon: ScanLine },
  { id: 'flow' as const, title: 'جریان تولید', icon: Activity },
  { id: 'engineering' as const, title: 'مهندسی', icon: Route },
  { id: 'projects' as const, title: 'پروژه‌ها', icon: FolderKanban },
  { id: 'access' as const, title: 'ماتریس دسترسی', icon: KeyRound },
];

const pagePermissions: Record<Page, PermissionId> = {
  scan: 'scanner', flow: 'production_flow', engineering: 'engineering', projects: 'projects', access: 'access_matrix',
};

const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const adminRoleKey = 'wpmes_admin_active_role';

function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const activeRole = window.sessionStorage.getItem(adminRoleKey);
  if (activeRole) headers.set('X-WPMES-Role', activeRole);
  return fetch(input, { ...init, headers });
}

function firstPageFor(user: SessionUser): Page {
  const allowed = user.accountRole === 'admin' ? nav : nav.filter((item) => user.permissions?.includes(pagePermissions[item.id]));
  if (user.role === 'engineering' && allowed.some((item) => item.id === 'projects')) return 'projects';
  if (user.role === 'qc' && allowed.some((item) => item.id === 'projects')) return 'projects';
  if (allowed.some((item) => item.id === 'scan')) return 'scan';
  return allowed[0]?.id || 'projects';
}

export default function AppV3() {
  const [page, setPage] = useState<Page>('engineering');
  const [railOpen, setRailOpen] = useState(false);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [engineeringProjectId, setEngineeringProjectId] = useState<string | null>(null);
  const [scanProjectId, setScanProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [time, setTime] = useState(() => new Date());
  const role = roles.find((item) => item.id === session?.role) || roles[0];
  const visibleNav = session
    ? (session.accountRole === 'admin' ? nav : nav.filter((item) => item.id !== 'engineering' && session.permissions?.includes(pagePermissions[item.id])))
    : [];

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/auth/session').then((response) => response.ok ? response.json() : Promise.reject()),
      apiFetch('/api/projects').then((response) => response.ok ? response.json() : { projects: [] }),
    ]).then(([sessionData, projectData]) => {
      setSession(sessionData.user);
      setProjects((projectData.projects || []).map((project: Project) => ({ ...project, sets: Array.isArray(project.sets) ? project.sets : [] })));
      setPage(firstPageFor(sessionData.user));
    }).catch(() => { window.location.reload(); });
  }, []);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };

  const navigate = (target: Page) => { setPage(target); setRailOpen(false); };
  const logout = async () => { window.sessionStorage.removeItem(adminRoleKey); await apiFetch('/api/auth/logout', { method: 'POST' }); window.location.assign('/'); };
  const switchAdminRole = (nextRole: RoleId) => {
    if (session?.accountRole !== 'admin') return;
    window.sessionStorage.setItem(adminRoleKey, nextRole);
    setSession({ ...session, role: nextRole });
    setScanProjectId(null);
    setPage(nextRole === 'engineering' || nextRole === 'qc' ? 'projects' : 'scan');
  };

  if (!session) return <div className="forge-loading" dir="rtl"><span className="forge-mark"><i /><i /><i /></span><b>در حال آماده‌سازی فضای کاری</b></div>;

  return <div className="forge-app" dir="rtl">
    <div className="forge-ambient a" /><div className="forge-ambient b" />
    <aside className={`forge-rail ${railOpen ? 'open' : ''}`}>
      <div className="forge-brand"><span className="forge-mark"><i /><i /><i /></span><div><b>WPMES</b><small>سامانه اجرای تولید</small></div></div>
      <div className="rail-section-label">فضای کاری</div>
      <nav className="forge-nav" aria-label="ماژول‌های سامانه">{visibleNav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.title}</span>{page === item.id && <ChevronLeft size={15} />}</button>; })}</nav>
      <div className="rail-foot"><div className="connection"><Radio size={15} /><span><b>{session.displayName}</b><small>{role.id === 'production' && session.accountRole !== 'admin' ? `کنترل تولید · ${session.scope || 'بدون مجموعه'}` : role.title}</small></span></div></div>
    </aside>
    {railOpen && <button className="forge-scrim" type="button" onClick={() => setRailOpen(false)} aria-label="بستن منو" />}

    <section className="forge-workspace">
      <header className="forge-topbar">
        <div className="topbar-title"><button className="menu-button" type="button" onClick={() => setRailOpen(true)}><Menu size={20} /></button><span>{nav.find((item) => item.id === page)?.title}</span></div>
        <div className="topbar-actions"><div className="live-time"><i /><span>{time.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</span></div>{session.accountRole === 'admin' && <label className="admin-role-switch"><ShieldCheck size={16} /><span><small>نقش فعال مدیر</small><select value={session.role} onChange={(event) => switchAdminRole(event.target.value as RoleId)}>{roles.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></span></label>}<div className="identity-chip"><span className="role-avatar"><UserRound size={17} /></span><span><small>{session.accountRole === 'admin' ? 'مدیر کل سامانه' : role.title}</small><b>{session.displayName}</b></span></div><button className="logout-button" type="button" onClick={() => void logout()} aria-label="خروج از سامانه"><LogOut size={17} /></button></div>
      </header>

      <main className="forge-main">
        {page === 'scan' && <ScanPage role={role} session={session} projects={projects} selectedProjectId={scanProjectId} onSelectProject={(projectId) => setScanProjectId(projectId)} onProjects={() => navigate('projects')} />}
        {page === 'flow' && <FlowPage projects={projects} onProjects={() => navigate('projects')} canCreateProject={session.accountRole === 'admin' || session.permissions.includes('project_create')} />}
        {page === 'engineering' && <EngineeringPage projects={projects} requestedProjectId={engineeringProjectId} onProjects={setProjects} notify={notify} onCreateProject={() => navigate('projects')} />}
        {page === 'projects' && <ProjectsPage projects={projects} onProjects={setProjects} notify={notify} canManage={session.accountRole === 'admin' || session.permissions.includes('project_create')} canEngineer={session.accountRole === 'admin' || session.permissions.includes('engineering')} isQc={session.role === 'qc'} onOpenScanner={(project) => { setScanProjectId(project.id); navigate('scan'); }} onDesignRoute={(project) => { setEngineeringProjectId(project.id); navigate('engineering'); }} />}
        {page === 'access' && session.accountRole === 'admin' && <AccessMatrixPage notify={notify} projects={projects} />}
      </main>
      <nav className="forge-dock">{visibleNav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.title}</span></button>; })}</nav>
    </section>
    {toast && <div className="forge-toast"><CircleCheck size={18} /><span>{toast}</span></div>}
  </div>;
}

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return <header className="page-heading"><div><span>{eyebrow}</span><h1>{title}</h1></div>{children}</header>;
}

function ScanPage({ role, session, projects, selectedProjectId, onSelectProject, onProjects }: { role: (typeof roles)[number]; session: SessionUser; projects: Project[]; selectedProjectId: string | null; onSelectProject: (projectId: string | null) => void; onProjects: () => void }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [usbCode, setUsbCode] = useState('');
  const [result, setResult] = useState<{ code: string; found: boolean; message: string; scan?: ScanResolution; inputSource: 'camera' | 'usb' | 'manual'; manualReason?: string; confirmed?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  const productionStation = role.id === 'production' ? (session.accountRole === 'admin' ? 'تمام مجموعه‌ها' : session.scope || 'تخصیص‌نیافته') : null;
  const scannerMeaning = productionStation ? `کنترل تولید «${productionStation}»` : role.action;
  const process = async (raw: string, inputSource: 'camera' | 'usb' | 'manual', manualReason?: string) => {
    const code = raw.trim().toUpperCase();
    if (code.length < 2) return;
    setBusy(true); setCameraOpen(false); setManualOpen(false);
    try {
      const projectQuery = role.id === 'qc' && selectedProject ? `?projectId=${encodeURIComponent(selectedProject.id)}` : '';
      const response = await apiFetch(`/api/scan/${encodeURIComponent(code)}${projectQuery}`);
      const data = await response.json();
      const scan = data.scan as ScanResolution | undefined;
      const blockedMessage = scan?.rejectionReason === 'PRODUCTION_STATION_REQUIRED'
        ? 'برای این کاربر کنترل تولید هنوز مجموعه مسئول تعیین نشده است.'
        : scan?.rejectionReason === 'PRODUCTION_STATION_MISMATCH'
          ? `این QR متعلق به مجموعه «${productionStation}» نیست.`
          : 'این کد برای نقش فعلی قابل اقدام نیست.';
      setResult({ code, found: response.ok, scan, inputSource, manualReason, message: response.ok ? (scan?.allowed ? scan.action?.title || 'کد آماده ثبت است.' : blockedMessage) : data.error || 'رکوردی برای این کد ثبت نشده است.' });
    } catch { setResult({ code, found: false, inputSource, manualReason, message: 'ارتباط با سرور برقرار نشد.' }); }
    finally { setBusy(false); }
  };

  const confirm = async (decision: 'approve' | 'reject' = 'approve', rework?: { mode: 'same_step' | 'independent'; comment: string }) => {
    if (!result?.scan?.allowed) return;
    setBusy(true); setReworkOpen(false);
    try {
      const response = await apiFetch('/api/scan/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: result.code, projectId: role.id === 'qc' ? selectedProject?.id : undefined, inputSource: result.inputSource, manualReason: result.manualReason, clientRequestId: crypto.randomUUID(), decision, reworkMode: rework?.mode, comment: rework?.comment }) });
      const data = await response.json();
      if (!response.ok) { setResult({ ...result, message: data.error || 'عملیات ثبت نشد.' }); return; }
      setResult({ ...result, confirmed: true, scan: data.next || result.scan, message: data.duplicate ? 'این درخواست قبلاً ثبت شده است.' : `${data.action} با موفقیت ثبت شد.` });
    } catch { setResult({ ...result, message: 'ارتباط با سرور برقرار نشد.' }); }
    finally { setBusy(false); }
  };

  const usbSubmit = (event: FormEvent) => { event.preventDefault(); void process(usbCode, 'usb'); setUsbCode(''); };

  if (role.id === 'qc' && !selectedProject) {
    const readyProjects = projects.filter((project) => project.sets?.length);
    return <>
      <PageHeader eyebrow="کنترل کیفیت" title="انتخاب پروژه جاری" />
      <section className="qc-project-workspace">
        <header><span><ShieldCheck size={22} /></span><div><h2>بارکدخوان کنترل کیفیت</h2><p>پروژه را انتخاب کنید؛ بارکدخوان فقط کدهای همان پروژه را بررسی می‌کند.</p></div></header>
        {readyProjects.length ? <div className="qc-project-grid">{readyProjects.map((project) => <article key={project.id}><div className="qc-project-card-head"><span><Factory size={20} /></span><small>{project.code}</small></div><h3>{project.name}</h3><p>{project.sets.length.toLocaleString('fa-IR')} مجموعه در مسیر تولید</p><div className="qc-route-mini">{project.sets.slice(0, 4).map((set) => <span key={set.id}>{set.name}</span>)}</div><button type="button" onClick={() => onSelectProject(project.id)}><ScanLine size={17} /> باز کردن بارکدخوان QC <ArrowLeft size={16} /></button></article>)}</div> : <EmptyCanvas title="پروژه آماده‌ای وجود ندارد" text="پس از تعریف مسیر مهندسی، پروژه برای کنترل کیفیت در این بخش نمایش داده می‌شود." icon={<FolderKanban size={30} />} />}
      </section>
    </>;
  }

  return <>
    <PageHeader eyebrow="ایستگاه اسکن" title="اسکن مجموعه"><div className={`active-operation ${productionStation ? 'station-bound' : ''}`}><span>{selectedProject ? 'پروژه فعال بارکدخوان' : productionStation ? 'بارکدخوان کنترل تولید' : 'عملیات این کاربر'}</span><b>{selectedProject ? selectedProject.name : scannerMeaning}</b>{selectedProject ? <button type="button" className="change-scan-project" onClick={() => { setResult(null); onSelectProject(null); onProjects(); }}>تغییر پروژه</button> : productionStation && <small>فقط QR مرحله مرتبط با «{productionStation}» قابل ثبت است</small>}</div></PageHeader>
    <section className="scan-console">
      <div className="scan-console-head"><div className="secure-indicator"><ShieldCheck size={17} /><span>جلسه فعال</span></div><div className={`operator-chip ${productionStation ? 'station-chip' : ''}`}><Barcode size={16} /><span>{productionStation ? `کنترل تولید ${productionStation}` : role.title}</span></div></div>
      {!result && <div className="scan-core">
        <div className="scanner-art"><div className="scanner-grid" /><div className="scanner-ring one" /><div className="scanner-ring two" /><div className="scanner-glyph"><QrCode size={62} strokeWidth={1.35} /></div><span className="scanner-beam" /></div>
        <div className="scan-copy"><span>{selectedProject ? `کنترل کیفیت · ${selectedProject.code}` : productionStation ? `کنترل تولید مجموعه ${productionStation}` : 'آماده اسکن'}</span><h2>کد QR را داخل قاب قرار دهید</h2></div>
        <button className={`camera-primary ${role.id === 'qc' ? 'qc-primary' : ''}`} type="button" onClick={() => setCameraOpen(true)} disabled={busy || (role.id === 'production' && !session.scope && session.accountRole !== 'admin')}><Camera size={20} /><span>{role.id === 'qc' ? 'اسکن برای کنترل کیفیت' : productionStation ? `اسکن در ایستگاه ${productionStation}` : 'باز کردن بارکدخوان'}</span><ArrowLeft size={18} /></button>
        <div className="scan-alternatives"><form onSubmit={usbSubmit}><Barcode size={18} /><input value={usbCode} onChange={(event) => setUsbCode(event.target.value)} placeholder="بارکدخوان رومیزی" /><kbd>Enter</kbd></form><button type="button" onClick={() => setManualOpen(true)}><PenLine size={17} /><span>ورود دستی</span></button></div>
      </div>}
      {result && <div className={`scan-result ${result.found && result.scan?.allowed ? 'found' : 'missing'}`}>
        <span className="result-icon">{result.confirmed || (result.found && result.scan?.allowed) ? <CircleCheck size={32} /> : <CircleAlert size={32} />}</span><small>کد خوانده‌شده</small><h2>{result.code}</h2>
        {result.scan && <><div className="scan-resolved-card"><span><small>پروژه</small><b>{result.scan.project.name}</b></span><span><small>مجموعه</small><b>{result.scan.set.name}</b></span><span><small>مرحله جاری</small><b>{result.scan.step?.name || 'پایان مسیر'}</b></span><span><small>شماره سریال</small><b>{result.scan.serialNumber}</b></span></div>
          {result.scan.processes?.length > 0 && <section className="scan-processes"><header><span><Route size={17} /><b>فرایندهای مجموعه {result.scan.set.name}</b></span><small>{result.scan.processes.length.toLocaleString('fa-IR')} زیرفرآیند</small></header><div>{result.scan.processes.map((item) => <article className={`${item.current ? 'current' : ''} ${item.status === 'COMPLETED' ? 'done' : ''}`} key={item.id}><span>{item.status === 'COMPLETED' ? <Check size={14} /> : item.order.toLocaleString('fa-IR')}</span><b>{item.name}</b><small>{item.execution === 'internal' ? 'داخلی' : 'خارجی'}</small>{item.current && <em>مرحله جاری</em>}</article>)}</div></section>}
        </>}
        <p>{result.message}</p><div className="scan-result-actions">{result.scan?.allowed && !result.confirmed && <><button className="confirm-scan" type="button" onClick={() => void confirm()} disabled={busy}><CircleCheck size={17} /> {busy ? 'در حال ثبت' : result.scan.action?.title}</button>{role.id === 'qc' && result.scan.action?.code === 'QC_APPROVE' && <button className="reject-scan" type="button" onClick={() => setReworkOpen(true)} disabled={busy}><CircleAlert size={17} /> رد و تعیین بازکاری</button>}</>}<button type="button" onClick={() => setResult(null)}><ScanLine size={17} /> اسکن کد دیگر</button></div>
      </div>}
      <div className="scan-console-foot"><span><i /> وضعیت: آماده</span><span>{selectedProject ? `پروژه فعال: ${selectedProject.name}` : `مفهوم اسکن: ${scannerMeaning}`}</span></div>
      {cameraOpen && <CameraReader role={role} onClose={() => setCameraOpen(false)} onRead={(code) => void process(code, 'camera')} />}
    </section>
    {manualOpen && <ManualEntry onClose={() => setManualOpen(false)} onDone={(code, reason) => void process(code, 'manual', reason)} />}
    {reworkOpen && <ReworkDecisionModal onClose={() => setReworkOpen(false)} onSubmit={(mode, comment) => void confirm('reject', { mode, comment })} />}
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

function ManualEntry({ onClose, onDone }: { onClose: () => void; onDone: (code: string, reason: string) => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal small"><header><div><span>ثبت جایگزین</span><h2>ورود دستی کد</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><label>کد مجموعه<input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="کد روی لیبل" /></label><label>دلیل ورود دستی<select value={reason} onChange={(event) => setReason(event.target.value)}><option value="">انتخاب کنید</option><option>لیبل ناخوانا</option><option>دوربین در دسترس نیست</option><option>بارکدخوان ایستگاه در دسترس نیست</option></select></label><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={code.trim().length < 2 || !reason} onClick={() => onDone(code.trim(), reason)}>بررسی کد</button></footer></section></div>;
}

function ReworkDecisionModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (mode: 'same_step' | 'independent', comment: string) => void }) {
  const [mode, setMode] = useState<'same_step' | 'independent'>('same_step');
  const submit = () => onSubmit(mode, mode === 'same_step' ? 'بازگشت به همان مجموعه و رفع ایراد' : 'ارجاع به فرآیند بازکاری مستقل');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal rework-modal"><header><div><span>تصمیم کنترل کیفیت</span><h2>مسیر قطعه پس از رد QC</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><p className="rework-intro">فقط یکی از دو مسیر زیر را انتخاب کنید.</p><div className="rework-options"><button type="button" className={mode === 'same_step' ? 'active' : ''} onClick={() => setMode('same_step')}><span className="rework-option-icon"><Route size={21} /></span><span><b>بازگشت به همین مجموعه</b><small>رفع ایراد در همان مجموعه و کنترل مجدد QC و کنترل مجدد QC</small></span><i>{mode === 'same_step' && <CircleCheck size={16} />}</i></button><button type="button" className={mode === 'independent' ? 'active' : ''} onClick={() => setMode('independent')}><span className="rework-option-icon"><Wrench size={21} /></span><span><b>بازکاری مستقل</b><small>توقف مسیر جاری و ارجاع برای تعریف فرآیند بازکاری جداگانه</small></span><i>{mode === 'independent' && <CircleCheck size={16} />}</i></button></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="danger" type="button" onClick={submit}>ثبت رد و ارجاع</button></footer></section></div>;
}

function EmptyPage({ eyebrow, title, text, icon, action }: { eyebrow: string; title: string; text: string; icon: React.ReactNode; action?: React.ReactNode }) {
  return <><PageHeader eyebrow="فضای کاری" title={eyebrow} /><EmptyCanvas title={title} text={text} icon={icon} action={action} /></>;
}

function EmptyCanvas({ title, text, icon, action }: { title: string; text: string; icon: React.ReactNode; action?: React.ReactNode }) {
  return <section className="empty-canvas"><div className="empty-signal"><div className="empty-visual"><span>{icon}</span><i /><i /><i /></div><span className="empty-state-label"><i /> وضعیت فعلی</span></div><div className="empty-copy"><h2>{title}</h2><p>{text}</p>{action}</div><div className="empty-track" aria-hidden="true"><i /><i /><i /><i /><span /></div></section>;
}

function FlowPage({ projects, onProjects, canCreateProject }: { projects: Project[]; onProjects: () => void; canCreateProject: boolean }) {
  if (!projects.length) return <EmptyPage eyebrow="جریان تولید" title="هنوز جریانی ساخته نشده" text="پس از تعریف پروژه و مسیر مهندسی، جریان واقعی تولید در این بخش نمایش داده می‌شود." icon={<Activity size={32} />} action={canCreateProject ? <button className="empty-action" type="button" onClick={onProjects}><FilePlus2 size={17} /> تعریف پروژه</button> : undefined} />;
  return <><PageHeader eyebrow="جریان تولید" title="پروژه‌های ثبت‌شده" /><section className="entity-grid">{projects.map((project) => <article className="entity-card" key={project.id}><span className="entity-icon"><FolderKanban size={22} /></span><small>{project.code}</small><h3>{project.name}</h3><p>{project.itemType === 'assembly' ? 'Assembly Part' : 'Single Part'} · {project.drawings.length.toLocaleString('fa-IR')} نقشه · {(project.sets?.length || 0).toLocaleString('fa-IR')} مجموعه</p></article>)}</section></>;
}

const permissionOptions: Array<{ id: PermissionId; title: string; group: string }> = [
  { id: 'projects', title: 'مشاهده پروژه‌ها', group: 'پروژه' },
  { id: 'project_create', title: 'تعریف و حذف پروژه', group: 'پروژه' },
  { id: 'engineering', title: 'تعریف مسیر مهندسی', group: 'مهندسی' },
  { id: 'production_flow', title: 'جریان تولید', group: 'گزارش' },
  { id: 'scanner', title: 'ایستگاه اسکن', group: 'عملیات' },
  { id: 'qc', title: 'تأیید کنترل کیفیت', group: 'عملیات' },
  { id: 'production_control', title: 'تأیید کنترل تولید', group: 'عملیات' },
];

function AccessMatrixPage({ notify, projects }: { notify: (message: string) => void; projects: Project[] }) {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [deleteUser, setDeleteUser] = useState<AccessUser | null>(null);
  const productionStations = [...new Map([
    ...defaultOperatorStations.map((name) => [name, { key: name, title: name }] as const),
    ...projects.flatMap((project) => project.sets.map((set) => [set.operatorRole || set.name, { key: set.operatorRole || set.name, title: set.name }] as const)),
  ]).values()];
  useEffect(() => {
    apiFetch('/api/admin/access-matrix').then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setUsers(data.users || []);
    }).catch(() => notify('ماتریس دسترسی دریافت نشد.')).finally(() => setLoading(false));
  }, []);
  const patchUser = (username: string, patch: Partial<AccessUser>) => setUsers((current) => current.map((user) => user.username === username ? { ...user, ...patch } : user));
  const changeRole = (user: AccessUser, role: RoleId) => {
    let permissions = [...user.permissions];
    const operational: PermissionId[] = ['qc', 'production_control'];
    permissions = permissions.filter((permission) => !operational.includes(permission));
    if (role === 'qc') permissions.push('projects', 'scanner', 'qc');
    if (role === 'production') permissions.push('scanner', 'production_control');
    if (role === 'engineering') permissions.push('projects', 'engineering');
    patchUser(user.username, { role, scope: role === 'production' ? user.scope : '', permissions: [...new Set(permissions)] });
  };
  const togglePermission = (user: AccessUser, permission: PermissionId) => {
    const enabled = user.permissions.includes(permission);
    let permissions = enabled ? user.permissions.filter((item) => item !== permission) : [...user.permissions, permission];
    let role = user.role;
    if (!enabled && permission === 'project_create') permissions = [...permissions, 'projects'];
    if (!enabled && permission === 'engineering') { role = 'engineering'; permissions = [...permissions, 'projects']; }
    if (!enabled && permission === 'qc') { role = 'qc'; permissions = [...permissions, 'projects', 'scanner']; }
    if (!enabled && permission === 'production_control') { role = 'production'; permissions = [...permissions, 'scanner']; }
    if (permission === 'projects' && enabled) permissions = permissions.filter((item) => !['project_create', 'engineering'].includes(item));
    patchUser(user.username, { role, permissions: [...new Set(permissions)] });
  };
  const save = async () => {
    setSaving(true);
    try {
      const response = await apiFetch('/api/admin/access-matrix', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users }) });
      const data = await response.json();
      if (!response.ok) { notify(data.error || 'دسترسی‌ها ذخیره نشد.'); return; }
      setUsers(data.users || users); notify('ماتریس دسترسی کاربران ذخیره شد.');
    } finally { setSaving(false); }
  };
  const createUser = async (input: { username: string; displayName: string; password: string; role: RoleId; scope: string }) => {
    const response = await apiFetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'کاربر ایجاد نشد.'); return; }
    setUsers((current) => [...current, data.user]); setNewUserOpen(false); notify(input.role === 'production' ? `کنترل تولید «${input.scope}» با بارکدخوان اختصاصی ایجاد شد.` : 'کاربر محلی ایجاد شد؛ دسترسی‌های او را در همین صفحه تنظیم کنید.');
  };
  const removeUser = async (user: AccessUser) => {
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(user.username)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'کاربر حذف نشد.'); return; }
    setUsers((current) => current.filter((item) => item.username !== user.username)); setDeleteUser(null); notify(`کاربر «${user.displayName}» حذف شد.`);
  };
  return <>
    <PageHeader eyebrow="مدیریت سامانه" title="ماتریس دسترسی کاربران"><div className="access-heading-actions"><button className="heading-action secondary" type="button" onClick={() => setNewUserOpen(true)}><Plus size={17} /> کاربر محلی جدید</button><button className="heading-action access-save" type="button" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? 'در حال ذخیره' : 'ذخیره دسترسی‌ها'}</button></div></PageHeader>
    <section className="access-overview"><div><span className="access-overview-icon"><ShieldCheck size={23} /></span><span><b>کنترل نقش و ایستگاه اسکن</b><small>QR رهگیری مجموعه ثابت است؛ اما مفهوم و مجوز اسکن از نقش کاربر و مجموعه اختصاص‌یافته به او تعیین می‌شود.</small></span></div><div className="access-legend"><span><i className="green" />فعال</span><span><i />غیرفعال</span></div></section>
    {loading ? <section className="access-loading">در حال دریافت کاربران…</section> : <section className="access-matrix">
      {users.map((user) => <article className={`access-user ${user.isAdmin ? 'system-admin' : ''}`} key={user.username}>
        <header><span className="access-avatar"><UserRound size={19} /></span><span><b>{user.displayName}</b><small>{user.username}</small></span>{user.isAdmin ? <em><KeyRound size={13} /> مدیر کل</em> : <button className="delete-user" type="button" onClick={() => setDeleteUser(user)}><Trash2 size={14} /> حذف کاربر</button>}</header>
        <div className="access-role"><label>نقش عملیاتی<select value={user.role} disabled={user.isAdmin} onChange={(event) => changeRole(user, event.target.value as RoleId)}>{user.isAdmin ? <option value="admin">مدیر کل سامانه</option> : roles.map((role) => <option key={role.id} value={role.id}>{role.title}</option>)}</select></label><span><small>مفهوم بارکدخوان</small><b>{user.isAdmin ? 'تمام عملیات‌ها' : user.role === 'production' ? (user.scope ? `ثبت اتمام «${user.scope}»` : 'در انتظار تخصیص مجموعه') : roles.find((role) => role.id === user.role)?.action}</b></span></div>
        <div className="access-permissions">{permissionOptions.map((permission) => { const active = user.isAdmin || user.permissions.includes(permission.id); return <button type="button" key={permission.id} disabled={user.isAdmin} className={active ? 'active' : ''} onClick={() => togglePermission(user, permission.id)}><span>{active ? <Check size={14} /> : null}</span><b>{permission.title}</b><small>{permission.group}</small></button>; })}</div>
        {!user.isAdmin && user.role === 'production' && <label className={`operator-scope ${user.scope ? 'assigned' : 'unassigned'}`}><span><b>بارکدخوان اختصاصی کنترل تولید</b><small>{user.scope ? `این حساب کنترل تولید فقط عملیات مجموعه «${user.scope}» را ثبت می‌کند.` : 'برای فعال‌شدن اسکن، مجموعه مسئول کنترل تولید را انتخاب کنید.'}</small></span><select value={user.scope} onChange={(event) => patchUser(user.username, { scope: event.target.value })}><option value="">انتخاب مجموعه تحت کنترل</option>{user.scope && !productionStations.some((station) => station.key === user.scope) && <option value={user.scope}>{user.scope} (تخصیص فعلی)</option>}{productionStations.map((station) => <option key={station.key} value={station.key}>{station.title}</option>)}</select><em>{user.scope ? <><CircleCheck size={14} /> متصل به ایستگاه</> : <><CircleAlert size={14} /> بدون ایستگاه</>}</em></label>}
      </article>)}
      {!users.length && <div className="access-loading"><UsersRound size={28} /> کاربری برای تخصیص دسترسی ثبت نشده است.</div>}
    </section>}
    {newUserOpen && <NewAccessUserModal productionStations={productionStations} onClose={() => setNewUserOpen(false)} onCreate={(input) => void createUser(input)} />}
    {deleteUser && <DeleteAccessUserModal user={deleteUser} onClose={() => setDeleteUser(null)} onDelete={() => void removeUser(deleteUser)} />}
  </>;
}

function DeleteAccessUserModal({ user, onClose, onDelete }: { user: AccessUser; onClose: () => void; onDelete: () => void }) {
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal small delete-project-modal"><header><div><span>مدیریت کاربران</span><h2>حذف کاربر محلی</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="delete-warning"><span><Trash2 size={23} /></span><div><b>{user.displayName}</b><small>دسترسی کاربر «{user.username}» به سامانه بلافاصله قطع می‌شود.</small></div></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="danger" type="button" onClick={onDelete}><Trash2 size={15} /> حذف کاربر</button></footer></section></div>;
}

function NewAccessUserModal({ productionStations, onClose, onCreate }: { productionStations: { key: string; title: string }[]; onClose: () => void; onCreate: (input: { username: string; displayName: string; password: string; role: RoleId; scope: string }) => void }) {
  const [displayName, setDisplayName] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<RoleId>('production'); const [scope, setScope] = useState('');
  const stationReady = role !== 'production' || scope.length >= 2;
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal"><header><div><span>هویت محلی سامانه</span><h2>ایجاد کاربر جدید</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="modal-grid"><label>نام و نام خانوادگی<input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="نام نمایشی کاربر" /></label><label>نام کاربری انگلیسی<input dir="ltr" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="username" /></label></div><div className="modal-grid"><label>نقش عملیاتی<select value={role} onChange={(event) => { setRole(event.target.value as RoleId); setScope(''); }}>{roles.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>رمز عبور اولیه<input dir="ltr" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="حداقل ۱۰ کاراکتر" /></label></div>{role === 'production' && <label className="new-user-station"><span>مجموعه مسئول کنترل تولید <em>الزامی</em></span><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="">انتخاب مجموعه تولید</option>{productionStations.map((station) => <option key={station.key} value={station.key}>{station.title}</option>)}</select><small>کنترل تولید این کاربر فقط پایان فرایندهای همین مجموعه را تأیید می‌کند.</small></label>}<div className="modal-assurance"><ShieldCheck size={18} /><span><b>{role === 'production' && scope ? `کنترل تولید اختصاصی ${scope}` : 'رمز عبور به‌صورت Hash ذخیره می‌شود'}</b><small>{role === 'production' ? 'مجموعه‌های تعریف‌شده مهندسی، حوزه مجاز اسکن این کاربر را تعیین می‌کنند.' : 'پس از ایجاد کاربر، مجوزهای دقیق او را از ماتریس همین صفحه تعیین کنید.'}</small></span></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={displayName.trim().length < 2 || username.length < 3 || password.length < 10 || !stationReady} onClick={() => onCreate({ displayName: displayName.trim(), username, password, role, scope })}>ایجاد کاربر</button></footer></section></div>;
}

function EngineeringPage({ projects, requestedProjectId, onProjects, notify, onCreateProject }: { projects: Project[]; requestedProjectId: string | null; onProjects: (projects: Project[]) => void; notify: (message: string) => void; onCreateProject: () => void }) {
  const initialProject = projects.find((project) => project.id === requestedProjectId) || projects[0];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialProject?.id || null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(initialProject?.sets?.[0]?.id || null);
  const [draft, setDraft] = useState<Project | null>(initialProject ? structuredClone(initialProject) : null);
  const [newSetOpen, setNewSetOpen] = useState(false);
  const [newStep, setNewStep] = useState('');
  const [saving, setSaving] = useState(false);
  const [draggedSetId, setDraggedSetId] = useState<string | null>(null);
  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);

  useEffect(() => {
    if (projects.length && (!selectedProjectId || !projects.some((project) => project.id === selectedProjectId))) {
      const project = projects[0];
      setSelectedProjectId(project.id); setDraft(structuredClone(project)); setSelectedSetId(project.sets?.[0]?.id || null);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!requestedProjectId || requestedProjectId === selectedProjectId) return;
    const project = projects.find((item) => item.id === requestedProjectId);
    if (project) selectProject(project);
  }, [requestedProjectId, projects]);

  const selectProject = (project: Project) => {
    setSelectedProjectId(project.id); setDraft(structuredClone(project)); setSelectedSetId(project.sets?.[0]?.id || null); setNewStep('');
  };
  const activeSet = draft?.sets.find((set) => set.id === selectedSetId) || null;
  const updateActiveSet = (patch: Partial<ProductionSet>) => {
    if (!draft || !selectedSetId) return;
    setDraft({ ...draft, sets: draft.sets.map((set) => set.id === selectedSetId ? { ...set, ...patch } : set) });
  };
  const createSet = (input: Pick<ProductionSet, 'name' | 'code'>) => {
    if (!draft) return;
    const set: ProductionSet = { id: uid(), ...input, operatorRole: input.name, kind: draft.itemType, steps: [{ id: uid(), name: input.name, execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] };
    setDraft({ ...draft, sets: [...draft.sets, set] }); setSelectedSetId(set.id); setNewSetOpen(false); notify('مجموعه به مسیر پروژه اضافه شد؛ چینش را ذخیره کنید.');
  };
  const moveSet = (index: number, delta: number) => {
    if (!draft) return; const target = index + delta; if (target < 0 || target >= draft.sets.length) return;
    const sets = [...draft.sets]; [sets[index], sets[target]] = [sets[target], sets[index]]; setDraft({ ...draft, sets });
  };
  const dropSet = (targetId: string) => {
    if (!draft || !draggedSetId || draggedSetId === targetId) return;
    const from = draft.sets.findIndex((set) => set.id === draggedSetId);
    const to = draft.sets.findIndex((set) => set.id === targetId);
    if (from < 0 || to < 0) return;
    const sets = [...draft.sets]; const [moved] = sets.splice(from, 1); sets.splice(to, 0, moved);
    setDraft({ ...draft, sets }); setDraggedSetId(null);
  };
  const removeSet = (id: string) => {
    if (!draft) return; const sets = draft.sets.filter((set) => set.id !== id); setDraft({ ...draft, sets });
    if (selectedSetId === id) setSelectedSetId(sets[0]?.id || null);
  };
  const addStep = () => {
    if (!activeSet || newStep.trim().length < 2) return;
    updateActiveSet({ steps: [...activeSet.steps, { id: uid(), name: newStep.trim(), execution: 'internal', qcRequired: true, productionControlRequired: true, barcodeAfter: false }] }); setNewStep('');
  };
  const dropStep = (targetId: string) => {
    if (!activeSet || !draggedStepId || draggedStepId === targetId) return;
    const from = activeSet.steps.findIndex((step) => step.id === draggedStepId);
    const to = activeSet.steps.findIndex((step) => step.id === targetId);
    if (from < 0 || to < 0) return;
    const steps = [...activeSet.steps]; const [moved] = steps.splice(from, 1); steps.splice(to, 0, moved);
    updateActiveSet({ steps }); setDraggedStepId(null);
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
      const response = await apiFetch(`/api/projects/${draft.id}/route`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sets: draft.sets }) });
      const data = await response.json(); if (!response.ok) { notify(data.error || 'چینش پروژه ذخیره نشد.'); return; }
      onProjects(projects.map((project) => project.id === draft.id ? data.project : project)); setDraft(structuredClone(data.project)); notify('مسیر ذخیره شد؛ پروژه آماده صدور QR و ورود به چرخه تولید است.');
    } finally { setSaving(false); }
  };

  if (!projects.length) return <EmptyPage eyebrow="امور مهندسی" title="پروژه‌ای برای طراحی مسیر وجود ندارد" text="ابتدا پروژه را ثبت کنید؛ سپس مجموعه‌های همان پروژه را در این صفحه می‌چینید." icon={<FolderKanban size={32} />} action={<button className="empty-action" type="button" onClick={onCreateProject}><FilePlus2 size={17} /> تعریف پروژه</button>} />;

  return <>
    <PageHeader eyebrow="امور مهندسی" title="طراحی مسیر پروژه"><div className="engineering-summary"><span>پروژه انتخاب‌شده</span><b>{draft?.name}</b><small>{draft?.sets.length.toLocaleString('fa-IR')} مجموعه در مسیر</small></div></PageHeader>
    <section className="project-engineering-shell">
      <aside className="project-library"><header><span>پروژه‌ها</span><b>{projects.length.toLocaleString('fa-IR')}</b></header><div className="project-list">{projects.map((project) => <button type="button" key={project.id} className={selectedProjectId === project.id ? 'active' : ''} onClick={() => selectProject(project)}><span className="set-symbol"><FolderKanban size={18} /></span><span><b>{project.name}</b><small>{project.code} · {(project.sets?.length || 0).toLocaleString('fa-IR')} مجموعه</small></span><ChevronLeft size={15} /></button>)}</div><button className="new-project-link" type="button" onClick={onCreateProject}><Plus size={15} /> پروژه جدید</button></aside>
      <div className="project-route-studio">{draft && <>
        <header className="project-studio-head"><div><span>{draft.code}</span><h2>{draft.name}</h2><small>{draft.itemType === 'assembly' ? 'Assembly Part' : 'Single Part'} · {draft.drawings.length.toLocaleString('fa-IR')} نقشه</small></div><button className="save-route" type="button" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? 'در حال ذخیره' : 'ذخیره چینش پروژه'}</button></header>
        <div className="route-builder-head"><div><span>ترتیب اجرای مجموعه‌ها</span><small>ترتیب از راست به چپ اجرا می‌شود</small></div><button type="button" onClick={() => setNewSetOpen(true)}><Plus size={16} /> افزودن مجموعه</button></div>
        {draft.sets.length ? <div className="project-set-route">{draft.sets.map((set, index) => <article draggable key={set.id} className={`project-set-card ${selectedSetId === set.id ? 'active' : ''} ${draggedSetId === set.id ? 'dragging' : ''}`} onDragStart={() => setDraggedSetId(set.id)} onDragEnd={() => setDraggedSetId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropSet(set.id)} onClick={() => setSelectedSetId(set.id)}><div className="set-order"><GripVertical size={15} /><b>{(index + 1).toLocaleString('fa-IR')}</b></div><button className="set-card-main" type="button" onClick={() => setSelectedSetId(set.id)}><span><Boxes size={18} /></span><div><small>{set.code || 'بدون کد'}</small><h3>{set.name}</h3><p>{set.operatorRole}</p></div></button><div className="set-card-actions"><button type="button" onClick={(event) => { event.stopPropagation(); moveSet(index, -1); }} disabled={index === 0} aria-label="انتقال مجموعه به قبل"><ArrowUp size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); moveSet(index, 1); }} disabled={index === draft.sets.length - 1} aria-label="انتقال مجموعه به بعد"><ArrowDown size={14} /></button><button className="remove" type="button" onClick={(event) => { event.stopPropagation(); removeSet(set.id); }} aria-label="حذف مجموعه از پروژه"><Trash2 size={14} /></button></div>{index < draft.sets.length - 1 && <span className="route-connector"><ArrowLeft size={16} /></span>}</article>)}</div> : <div className="project-route-empty"><Layers3 size={31} /><h3>مسیر پروژه هنوز مجموعه‌ای ندارد</h3><button type="button" onClick={() => setNewSetOpen(true)}><Plus size={16} /> تعریف اولین مجموعه</button></div>}
        {activeSet ? <section className="set-workbench"><header><div><span>تنظیمات مجموعه انتخاب‌شده</span><h3>{activeSet.name}</h3></div><div className="scan-meaning"><Barcode size={18} /><span><small>بارکدخوان کنترل تولید مجموعه</small><b>ثبت اتمام «{activeSet.operatorRole || activeSet.name}»</b></span></div></header><div className="set-identity-grid"><label>نام مجموعه<input value={activeSet.name} onChange={(event) => updateActiveSet({ name: event.target.value })} /></label><label>کد مجموعه<input value={activeSet.code} onChange={(event) => updateActiveSet({ code: event.target.value.toUpperCase() })} /></label><label>شناسه ایستگاه کنترل تولید<input value={activeSet.operatorRole} onChange={(event) => updateActiveSet({ operatorRole: event.target.value })} placeholder="مثلاً جوش یا گالوانیزه" /></label></div><div className="mandatory-gates"><ShieldCheck size={17} /><span><b>کنترل‌های اجباری فعال‌اند</b><small>بعد از هر زیرفرآیند: کنترل تولید مجموعه ← کنترل کیفیت ← تأیید نهایی کنترل تولید</small></span></div><div className="subprocess-heading"><div><b>زیرفرآیندهای مجموعه</b><small>برای جابه‌جایی، کارت مرحله را بکشید</small></div></div><div className="add-step"><span className="add-step-icon"><Plus size={19} /></span><input value={newStep} onChange={(event) => setNewStep(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addStep(); }} placeholder="نام زیرفرآیند جدید" /><button type="button" onClick={addStep} disabled={newStep.trim().length < 2}>افزودن</button></div>{activeSet.steps.length ? <div className="route-list">{activeSet.steps.map((step, index) => <article draggable className={`route-step ${draggedStepId === step.id ? 'dragging' : ''}`} key={step.id} onDragStart={() => setDraggedStepId(step.id)} onDragEnd={() => setDraggedStepId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropStep(step.id)}><div className="step-handle"><GripVertical size={17} /><span>{(index + 1).toLocaleString('fa-IR')}</span></div><div className="step-main"><div className="step-name"><input value={step.name} onChange={(event) => updateStep(index, { name: event.target.value })} /><span className={`execution ${step.execution}`}>{step.execution === 'internal' ? 'داخلی' : 'خارجی'}</span></div><div className="step-controls"><div className="execution-switch"><button type="button" className={step.execution === 'internal' ? 'active' : ''} onClick={() => updateStep(index, { execution: 'internal' })}>داخلی</button><button type="button" className={step.execution === 'external' ? 'active' : ''} onClick={() => updateStep(index, { execution: 'external' })}>خارجی</button></div><span className="gate-chip"><CircleCheck size={13} /> QC اجباری</span><span className="gate-chip"><CircleCheck size={13} /> کنترل تولید اجباری</span></div></div><div className="step-actions"><button type="button" onClick={() => moveStep(index, -1)} disabled={index === 0} aria-label="انتقال به بالا"><ArrowUp size={15} /></button><button type="button" onClick={() => moveStep(index, 1)} disabled={index === activeSet.steps.length - 1} aria-label="انتقال به پایین"><ArrowDown size={15} /></button><button className="remove" type="button" onClick={() => removeStep(index)} aria-label="حذف زیرفرآیند"><Trash2 size={15} /></button></div></article>)}</div> : <div className="subprocess-empty"><Route size={26} /><span>زیرفرآیندی برای این مجموعه تعریف نشده است</span></div>}</section> : draft.sets.length > 0 && <div className="studio-empty"><Wrench size={30} /><h3>یک مجموعه را از مسیر انتخاب کنید</h3></div>}
      </>}</div>
    </section>
    {newSetOpen && <NewSetModal onClose={() => setNewSetOpen(false)} onCreate={createSet} />}
  </>;
}

function NewSetModal({ onClose, onCreate }: { onClose: () => void; onCreate: (value: Pick<ProductionSet, 'name' | 'code'>) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState('');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal set-quick-modal"><header><div><span>مسیر تولید پروژه</span><h2>افزودن مجموعه به مسیر</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="set-modal-number"><span>۱</span><div><b>نام مجموعه را وارد کنید</b><small>مرحله اولیه و کنترل‌های QC و کنترل تولید به‌صورت خودکار ساخته می‌شوند.</small></div></div><div className="modal-grid"><label>نام مجموعه<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً: مونتاژ، جوش یا پکیجینگ" /></label><label>کد مجموعه <em>اختیاری</em><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="در صورت وجود" /></label></div><div className="modal-assurance"><ShieldCheck size={18} /><span><b>کنترل تولید همین مجموعه تعیین می‌شود</b><small>بارکدخوان کنترل تولید مفهوم «اتمام {name || 'این مجموعه'}» خواهد داشت.</small></span></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={name.trim().length < 2} onClick={() => onCreate({ name: name.trim(), code: code.trim() })}><Plus size={15} /> افزودن به انتهای مسیر</button></footer></section></div>;
}

function ProjectsPage({ projects, onProjects, notify, onDesignRoute, onOpenScanner, canManage, canEngineer, isQc }: { projects: Project[]; onProjects: (projects: Project[]) => void; notify: (message: string) => void; onDesignRoute: (project: Project) => void; onOpenScanner: (project: Project) => void; canManage: boolean; canEngineer: boolean; isQc: boolean }) {
  const [open, setOpen] = useState(false);
  const [issueProject, setIssueProject] = useState<Project | null>(null);
  const [barcodeProject, setBarcodeProject] = useState<Project | null>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [profileProject, setProfileProject] = useState<Project | null>(null);
  const create = async (input: ProjectInput) => { const response = await apiFetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) { notify(data.error || 'پروژه ذخیره نشد.'); return; } onProjects([...projects, data.project]); setOpen(false); notify(input.itemType === 'assembly' ? 'Assembly Part با مسیر پیش‌فرض ایجاد شد؛ مسیر و شناسنامه فنی قابل ویرایش‌اند.' : 'Single Part ایجاد شد.'); };
  const issue = async (input: { projectId: string; serialNumber: string }) => { const response = await apiFetch('/api/work-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const data = await response.json(); if (!response.ok) { notify(data.error || 'شناسه تولید صادر نشد.'); return null; } if (data.project) onProjects(projects.map((item) => item.id === data.project.id ? data.project : item)); notify(data.routeInitialized ? `مسیر استاندارد پروژه فعال و بارکد ${data.item.barcode} صادر شد.` : `بارکد ${data.item.barcode} برای کل مجموعه صادر شد.`); return data.item as { barcode: string; serialNumber: string }; };
  const remove = async (project: Project) => { const response = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' }); const data = await response.json(); if (!response.ok) { notify(data.error || 'پروژه حذف نشد.'); return; } onProjects(projects.filter((item) => item.id !== project.id)); setDeleteProject(null); notify(`پروژه «${project.name}» حذف شد.`); };
  const archive = async (project: Project) => { const response = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/archive`, { method: 'POST' }); const data = await response.json(); if (!response.ok) { notify(data.error || 'پروژه بایگانی نشد.'); return; } onProjects(projects.filter((item) => item.id !== project.id)); setDeleteProject(null); notify(`پروژه «${project.name}» بایگانی و از پروژه‌های جاری خارج شد.`); };
  const saveProfile = async (project: Project, profile: ProjectProfile) => { const response = await apiFetch(`/api/projects/${encodeURIComponent(project.id)}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }); const data = await response.json(); if (!response.ok) { notify(data.error || 'شناسنامه فنی پروژه ذخیره نشد.'); return; } onProjects(projects.map((item) => item.id === project.id ? data.project : item)); setProfileProject(null); notify('شناسنامه فنی Assembly Part ذخیره شد.'); };
  return <><PageHeader eyebrow={isQc ? 'کنترل کیفیت' : 'دفتر پروژه‌ها'} title={isQc ? 'پروژه‌های جاری' : 'پروژه‌ها'}>{canManage && <button className="heading-action" type="button" onClick={() => setOpen(true)}><Plus size={18} /> پروژه جدید</button>}</PageHeader>{projects.length ? <section className="entity-grid">{projects.map((project) => <article className={`entity-card project-card ${isQc ? 'qc-project-card' : ''}`} key={project.id}><div className="project-card-top"><span className="entity-icon"><Factory size={22} /></span><span className={`route-state ${project.sets?.length ? 'ready' : ''}`}>{project.sets?.length ? 'مسیر تعریف شده' : 'در انتظار تعریف مسیر'}</span></div><small>{project.code}</small><h3>{project.name}</h3><p>{project.itemType === 'assembly' ? 'Assembly Part' : 'Single Part'} · {project.drawings.length.toLocaleString('fa-IR')} نقشه · {(project.sets?.length || 0).toLocaleString('fa-IR')} مجموعه</p><div className="project-route-preview">{project.sets?.length ? project.sets.slice(0, 4).map((set, index) => <span key={set.id}><b>{(index + 1).toLocaleString('fa-IR')}</b>{set.name}</span>) : <span className="empty-preview">مسیر تولید هنوز چیده نشده است</span>}</div><div className="entity-card-actions project-actions">{isQc && <button className="open-qc-scanner" type="button" disabled={!project.sets?.length} onClick={() => onOpenScanner(project)}><ScanLine size={16} /> باز کردن بارکدخوان QC</button>}{canEngineer && project.itemType === 'assembly' && <button className="project-profile-action" type="button" onClick={() => setProfileProject(project)}><FileSpreadsheet size={15} /> شناسنامه فنی</button>}{canEngineer && <button className="barcode-register-action" type="button" onClick={() => setBarcodeProject(project)}><QrCode size={15} /> شناسه‌های تولید</button>}{canEngineer && <button className="design-route" type="button" onClick={() => onDesignRoute(project)}><Route size={15} /> {project.sets?.length ? 'ویرایش مجموعه‌ها' : 'تعریف مجموعه‌ها'}</button>}{canEngineer && <button type="button" disabled={project.itemType === 'single' && !project.sets?.length} onClick={() => setIssueProject(project)}><Barcode size={15} /> صدور QR</button>}{canManage && <button className="danger-action" type="button" onClick={() => setDeleteProject(project)}><Trash2 size={15} /> حذف</button>}</div></article>)}</section> : <EmptyCanvas title="پروژه‌ای ثبت نشده" text="نام پروژه، کد و نوع ساخت را ثبت کنید." icon={<FolderKanban size={32} />} action={canManage ? <button className="empty-action" type="button" onClick={() => setOpen(true)}><Plus size={17} /> تعریف اولین پروژه</button> : undefined} />}{open && <NewProjectModal onClose={() => setOpen(false)} onCreate={(input) => void create(input)} />}{profileProject && <AssemblyProfileModal project={profileProject} onClose={() => setProfileProject(null)} onSave={(profile) => void saveProfile(profileProject, profile)} notify={notify} />}{issueProject && <IssueWorkItemModal project={issueProject} onClose={() => setIssueProject(null)} onIssue={issue} />}{barcodeProject && <BarcodeRegisterModal project={barcodeProject} onClose={() => setBarcodeProject(null)} />}{deleteProject && <DeleteProjectModal project={deleteProject} onClose={() => setDeleteProject(null)} onDelete={() => void remove(deleteProject)} onArchive={() => void archive(deleteProject)} />}</>;
}

function BarcodeRegisterModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [items, setItems] = useState<IssuedWorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch(`/api/projects/${encodeURIComponent(project.id)}/work-items`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems(data.items || []);
    }).finally(() => setLoading(false));
  }, [project.id]);
  const downloadSvg = async (item: IssuedWorkItem) => {
    const svg = await QRCode.toString(item.barcode, { type: 'svg', errorCorrectionLevel: 'H', margin: 3, color: { dark: '#101d21', light: '#ffffff' } });
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${project.code}-${item.serialNumber}-QR.svg`; anchor.click(); URL.revokeObjectURL(url);
  };
  const statusTitle = (status: string) => ({ READY: 'آماده شروع', WAITING_QC: 'منتظر QC', WAITING_PRODUCTION_CONTROL: 'منتظر کنترل تولید', ON_HOLD: 'متوقف', COMPLETED: 'تکمیل‌شده' }[status] || status);
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal barcode-register-modal"><header><div><span>{project.code}</span><h2>شناسه‌های تولید پروژه</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="barcode-register-summary"><span><QrCode size={22} /></span><div><b>دفتر بارکدهای صادرشده</b><small>هر QR به یک مجموعه کلی، شماره سریال و مسیر تولید متصل است و در SQL Server نگهداری می‌شود.</small></div><em>{items.length.toLocaleString('fa-IR')} شناسه</em></div>{loading ? <div className="barcode-register-loading">در حال دریافت شناسه‌ها…</div> : items.length ? <div className="barcode-register-list">{items.map((item) => <article key={item.id}><span className="barcode-register-icon"><QrCode size={24} /></span><div className="barcode-register-code"><small>شماره سریال</small><b>{item.serialNumber}</b><code>{item.barcode}</code></div><div className="barcode-register-location"><small>موقعیت فعلی</small><b>{item.currentSet || 'پایان مسیر'}</b><span>{item.currentStep || statusTitle(item.status)}</span></div><span className={`barcode-status ${item.status.toLowerCase()}`}>{statusTitle(item.status)}</span><button type="button" onClick={() => void downloadSvg(item)}><Download size={15} /> SVG حک</button></article>)}</div> : <div className="barcode-register-empty"><QrCode size={32} /><b>هنوز QR صادر نشده است</b><small>پس از صدور، شناسه برای بازیابی و حک مجدد در همین بخش باقی می‌ماند.</small></div>}<footer><button className="primary" type="button" onClick={onClose}>بستن</button></footer></section></div>;
}

function DeleteProjectModal({ project, onClose, onDelete, onArchive }: { project: Project; onClose: () => void; onDelete: () => void; onArchive: () => void }) {
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal small delete-project-modal"><header><div><span>مدیریت پروژه</span><h2>{project.name}</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="archive-option"><span><Archive size={23} /></span><div><b>خروج از پروژه‌های جاری</b><small>پروژه، بارکدها و سوابق تولید حفظ می‌شوند؛ اما دیگر برای کنترل تولید و کنترل کیفیت نمایش داده نخواهد شد.</small></div><button type="button" onClick={onArchive}><Archive size={15} /> بایگانی پروژه</button></div><div className="delete-warning"><span><Trash2 size={23} /></span><div><b>حذف قطعی فقط پیش از شروع تولید</b><small>اگر هنوز بارکدی صادر نشده باشد، پروژه و مسیر مهندسی آن برای همیشه حذف می‌شوند.</small></div></div><div className="delete-project-facts"><span><small>کد پروژه</small><b>{project.code}</b></span><span><small>تعداد مجموعه‌ها</small><b>{project.sets.length.toLocaleString('fa-IR')}</b></span></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="danger" type="button" onClick={onDelete}><Trash2 size={15} /> حذف قطعی</button></footer></section></div>;
}

function AssemblyProfileModal({ project, onClose, onSave, notify }: { project: Project; onClose: () => void; onSave: (profile: ProjectProfile) => void; notify: (message: string) => void }) {
  const emptyProfile: ProjectProfile = { mainDrawingNumber: '', componentDrawings: [], customFields: {}, importedHeaders: [], importedRows: [], sourceFileName: '', importedRowCount: 0 };
  const [profile, setProfile] = useState<ProjectProfile>(() => structuredClone(project.profile || emptyProfile));
  const [section, setSection] = useState<'header' | 'parts' | 'import'>('header');
  const [reading, setReading] = useState(false);
  const addDrawing = () => setProfile((current) => ({ ...current, componentDrawings: [...current.componentDrawings, { id: uid(), drawingNumber: '', description: '' }] }));
  const updateDrawing = (id: string, patch: Partial<ProjectProfile['componentDrawings'][number]>) => setProfile((current) => ({ ...current, componentDrawings: current.componentDrawings.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  const removeDrawing = (id: string) => setProfile((current) => ({ ...current, componentDrawings: current.componentDrawings.filter((item) => item.id !== id) }));
  const field = (key: string) => profile.customFields[key] || '';
  const updateField = (key: string, value: string) => setProfile((current) => ({ ...current, customFields: { ...current.customFields, [key]: value } }));
  const importExcel = async (file?: File) => {
    if (!file) return;
    setReading(true);
    try {
      const workbook = await readXlsxFile(file);
      const sheet = workbook[0]?.data || [];
      if (sheet.length < 2) { notify('فایل Excel باید سربرگ و حداقل یک ردیف داده داشته باشد.'); return; }
      const headers = sheet[0].map((cell: unknown, index: number) => String(cell ?? '').trim() || `ستون ${index + 1}`);
      const rows: Record<string, string>[] = sheet.slice(1).filter((row: unknown[]) => row.some((cell: unknown) => cell !== null && String(cell).trim())).map((row: unknown[]) => Object.fromEntries(headers.map((header: string, index: number) => [header, String(row[index] ?? '').trim()])));
      const drawingHeader = headers.find((header) => /شماره.*نقشه|نقشه|drawing|part([_\s-]*(no|number|pos))?|قطعه/i.test(header));
      const descriptionHeader = headers.find((header) => /شرح|نام.*قطعه|description|name|profile/i.test(header));
      const importedDrawings: ProjectProfile['componentDrawings'] = drawingHeader ? [...new Map(rows.filter((row) => row[drawingHeader]).map((row) => [row[drawingHeader], { id: uid(), drawingNumber: row[drawingHeader], description: descriptionHeader ? row[descriptionHeader] : '' }])).values()] : [];
      setProfile((current) => ({ ...current, importedHeaders: headers, importedRows: rows, sourceFileName: file.name, importedRowCount: rows.length, componentDrawings: importedDrawings.length ? importedDrawings : current.componentDrawings }));
      notify(`${rows.length.toLocaleString('fa-IR')} ردیف از Excel خوانده شد.`);
    } catch { notify('فایل Excel خوانده نشد؛ ساختار فایل را بررسی کنید.'); }
    finally { setReading(false); }
  };
  const detectedDrawingHeader = profile.importedHeaders.find((header) => /شماره.*نقشه|نقشه|drawing|part([_\s-]*(no|number|pos))?|قطعه/i.test(header));
  const titleBlockFields = ['client', 'orderNumber', 'drawingTitle', 'drawingDescription', 'scale', 'revision', 'drawnBy', 'designedBy', 'checkedBy', 'approvedBy'];
  const completedHeaderFields = titleBlockFields.filter((key) => field(key).trim()).length + (profile.mainDrawingNumber.trim() ? 1 : 0);
  const registeredParts = profile.componentDrawings.filter((item) => item.drawingNumber.trim()).length;

  return <div className="modal-layer">
    <button className="modal-scrim" type="button" onClick={onClose} />
    <section className="forge-modal assembly-profile-modal dossier-modal">
      <header className="dossier-header">
        <div className="dossier-project-mark"><span><Boxes size={24} /></span><div><small>ASSEMBLY TECHNICAL DOSSIER</small><h2>{project.name}</h2><p><b>{project.code}</b> · شناسنامه مهندسی و ساخت</p></div></div>
        <div className="dossier-header-actions"><span className="dossier-state"><i /> در حال تدوین</span><button type="button" onClick={onClose}><X size={19} /></button></div>
      </header>

      <div className="dossier-commandbar">
        <div className="dossier-tabs">
          <button className={section === 'header' ? 'active' : ''} type="button" onClick={() => setSection('header')}><span>۰۱</span><b>سربرگ نقشه</b><small>{completedHeaderFields.toLocaleString('fa-IR')} فیلد تکمیل</small></button>
          <button className={section === 'parts' ? 'active' : ''} type="button" onClick={() => setSection('parts')}><span>۰۲</span><b>ساختار محصول</b><small>{registeredParts.toLocaleString('fa-IR')} قطعه ثبت‌شده</small></button>
          <button className={section === 'import' ? 'active' : ''} type="button" onClick={() => setSection('import')}><span>۰۳</span><b>ورود از Excel</b><small>{profile.importedRows.length ? `${profile.importedRows.length.toLocaleString('fa-IR')} ردیف خوانده‌شده` : 'آماده دریافت فایل'}</small></button>
        </div>
        <div className="dossier-metrics"><span><small>نقشه مادر</small><b>{profile.mainDrawingNumber || 'ثبت نشده'}</b></span><span><small>وضعیت داده</small><b>{profile.sourceFileName ? 'Excel متصل' : 'ورود دستی'}</b></span></div>
      </div>

      <main className="dossier-body">
        {section === 'header' && <section className="dossier-panel titleblock-panel">
          <header><div><span>TEKLA TITLE BLOCK</span><h3>اطلاعات سربرگ نقشه</h3><p>فیلدها مستقیماً از قالب TITEL ASSEMBLY واحد مهندسی استخراج شده‌اند.</p></div><em>{completedHeaderFields.toLocaleString('fa-IR')} / ۱۱</em></header>
          <div className="titleblock-canvas">
            <div className="titleblock-brand"><span>WPMES</span><div><b>{project.name}</b><small>Wagon Pars Manufacturing Execution System</small></div></div>
            <div className="titleblock-fields primary-fields">
              <label className="wide">عنوان نقشه / TITLE<input value={field('drawingTitle')} onChange={(event) => updateField('drawingTitle', event.target.value)} placeholder="عنوان کامل نقشه مونتاژی" /></label>
              <label>شماره نقشه / DWG NO.<input value={profile.mainDrawingNumber} onChange={(event) => setProfile({ ...profile, mainDrawingNumber: event.target.value.toUpperCase() })} placeholder="ASSY-WP-1001" /></label>
              <label>بازنگری / REV.<input value={field('revision')} onChange={(event) => updateField('revision', event.target.value.toUpperCase())} placeholder="00" /></label>
              <label>مقیاس / SCALE<input value={field('scale')} onChange={(event) => updateField('scale', event.target.value)} placeholder="1:10" /></label>
              <label className="wide">شرح / DESCRIPTION<input value={field('drawingDescription')} onChange={(event) => updateField('drawingDescription', event.target.value)} placeholder="شرح فنی نقشه یا مجموعه" /></label>
            </div>
            <div className="titleblock-fields project-fields">
              <label>نام پروژه / PROJECT<input value={project.name} disabled /></label>
              <label>شماره پروژه / PROJECT NO.<input value={project.code} disabled /></label>
              <label>کارفرما / CLIENT<input value={field('client')} onChange={(event) => updateField('client', event.target.value)} placeholder="نام کارفرما" /></label>
              <label>شماره سفارش / ORDER NO.<input value={field('orderNumber')} onChange={(event) => updateField('orderNumber', event.target.value.toUpperCase())} placeholder="شماره قرارداد یا سفارش" /></label>
              <label>سازنده / BUILDER<input value={field('builder')} onChange={(event) => updateField('builder', event.target.value)} placeholder="نام سازنده" /></label>
              <label>طراح / DESIGNER<input value={field('designer')} onChange={(event) => updateField('designer', event.target.value)} placeholder="شرکت یا واحد طراح" /></label>
              <label className="wide">آدرس پروژه / PROJECT ADDRESS<input value={field('projectAddress')} onChange={(event) => updateField('projectAddress', event.target.value)} placeholder="محل اجرای پروژه" /></label>
            </div>
            <div className="approval-strip">
              {[['drawnBy', 'ترسیم / DRAWN'], ['designedBy', 'طراحی / DESIGNED'], ['checkedBy', 'کنترل / CHECKED'], ['approvedBy', 'تأیید / APPROVED']].map(([key, label]) => <label key={key}><span>{label}</span><input value={field(key)} onChange={(event) => updateField(key, event.target.value)} placeholder="نام و نام خانوادگی" /><input type="date" value={field(`${key}Date`)} onChange={(event) => updateField(`${key}Date`, event.target.value)} /></label>)}
            </div>
          </div>
        </section>}

        {section === 'parts' && <section className="dossier-panel parts-panel">
          <header><div><span>PRODUCT STRUCTURE</span><h3>اجزای تشکیل‌دهنده Assembly</h3><p>هر ردیف، یک قطعه یا زیرمونتاژ با شماره نقشه مستقل است.</p></div><button type="button" onClick={addDrawing}><Plus size={15} /> افزودن قطعه</button></header>
          <div className="parts-table-head"><span>ردیف</span><span>شماره نقشه / PART NO.</span><span>نام یا شرح قطعه</span><span>عملیات</span></div>
          <div className="dossier-parts-list">
            {profile.componentDrawings.map((drawing, index) => <article key={drawing.id}><span>{(index + 1).toLocaleString('fa-IR')}</span><input value={drawing.drawingNumber} onChange={(event) => updateDrawing(drawing.id, { drawingNumber: event.target.value.toUpperCase() })} placeholder="شماره نقشه قطعه" /><input value={drawing.description} onChange={(event) => updateDrawing(drawing.id, { description: event.target.value })} placeholder="نام، Profile یا شرح فنی" /><button type="button" onClick={() => removeDrawing(drawing.id)} aria-label="حذف قطعه"><Trash2 size={15} /></button></article>)}
            {!profile.componentDrawings.length && <div className="dossier-empty"><Layers3 size={34} /><b>ساختار محصول هنوز ثبت نشده است</b><p>قطعات را دستی اضافه کنید یا از بخش «ورود از Excel» فایل BOM را بخوانید.</p><button type="button" onClick={() => setSection('import')}><FileSpreadsheet size={15} /> ورود فایل Excel</button></div>}
          </div>
        </section>}

        {section === 'import' && <section className="dossier-panel import-panel">
          <header><div><span>EXCEL DATA INTAKE</span><h3>ورود BOM و لیست نقشه‌ها</h3><p>تمام ستون‌های فایل حفظ می‌شوند و ستون شماره نقشه برای ساخت لیست قطعات تشخیص داده می‌شود.</p></div>{profile.sourceFileName && <em>{profile.sourceFileName}</em>}</header>
          <div className="import-workspace">
            <label className={`excel-dropzone ${reading ? 'reading' : ''}`}><input type="file" accept=".xlsx,.xls" onChange={(event) => void importExcel(event.target.files?.[0])} /><span><FilePlus2 size={32} /></span><b>{reading ? 'در حال تحلیل فایل…' : profile.sourceFileName ? 'جایگزینی فایل Excel' : 'انتخاب فایل Excel'}</b><p>فرمت مجاز XLSX یا XLS · ردیف اول باید نام ستون‌ها باشد</p></label>
            <aside className="tekla-map-card"><span>الگوی شناسایی‌شده از گزارش Tekla</span><div>{['Assembly', 'Part / Drawing No.', 'No. / Qty', 'Profile', 'Grade', 'Length (mm)', 'Weight (kg)'].map((item) => <b key={item}><i />{item}</b>)}</div><small>نام ستون‌ها می‌تواند فارسی یا انگلیسی باشد؛ داده خام بدون حذف نگهداری می‌شود.</small></aside>
          </div>
          {profile.sourceFileName && <div className="import-result-bar"><CircleCheck size={18} /><div><b>{profile.importedRows.length.toLocaleString('fa-IR')} ردیف و {profile.importedHeaders.length.toLocaleString('fa-IR')} ستون آماده است</b><small>{detectedDrawingHeader ? `ستون شماره نقشه: ${detectedDrawingHeader}` : 'ستون شماره نقشه تشخیص داده نشد؛ نام ستون را بررسی کنید.'}</small></div><button type="button" onClick={() => setSection('parts')}>مشاهده ساختار محصول <ChevronLeft size={14} /></button></div>}
          {profile.importedRows.length > 0 && <section className="dossier-data-preview"><header><b>پیش‌نمایش اطلاعات</b><span>نمایش ۵ ردیف اول از {profile.importedRows.length.toLocaleString('fa-IR')}</span></header><div><table><thead><tr>{profile.importedHeaders.slice(0, 8).map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{profile.importedRows.slice(0, 5).map((row, index) => <tr key={index}>{profile.importedHeaders.slice(0, 8).map((header) => <td key={header}>{row[header] || '—'}</td>)}</tr>)}</tbody></table></div></section>}
        </section>}
      </main>

      <footer className="dossier-footer"><div><ShieldCheck size={17} /><span><b>ذخیره یکپارچه شناسنامه</b><small>سربرگ، ساختار محصول و داده Excel با سوابق پروژه نگهداری می‌شوند.</small></span></div><div><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" onClick={() => onSave({ ...profile, componentDrawings: profile.componentDrawings.filter((item) => item.drawingNumber.trim()), importedRowCount: profile.importedRows.length })}><Save size={15} /> ذخیره شناسنامه فنی</button></div></footer>
    </section>
  </div>;
}

function IssueWorkItemModal({ project, onClose, onIssue }: { project: Project; onClose: () => void; onIssue: (value: { projectId: string; serialNumber: string }) => Promise<{ barcode: string; serialNumber: string } | null> }) {
  const [serialNumber, setSerialNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ barcode: string; serialNumber: string; png: string; svg: string } | null>(null);
  const generate = async () => {
    setBusy(true);
    try {
      const item = await onIssue({ projectId: project.id, serialNumber: serialNumber.trim() });
      if (!item) return;
      const png = await QRCode.toDataURL(item.barcode, { errorCorrectionLevel: 'H', width: 640, margin: 3, color: { dark: '#07191d', light: '#ffffff' } });
      const svg = await QRCode.toString(item.barcode, { type: 'svg', errorCorrectionLevel: 'H', margin: 3, color: { dark: '#000000', light: '#ffffff' } });
      setIssued({ ...item, png, svg });
    } finally { setBusy(false); }
  };
  const download = (kind: 'png' | 'svg') => {
    if (!issued) return;
    const href = kind === 'png' ? issued.png : URL.createObjectURL(new Blob([issued.svg], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${project.code}-${issued.serialNumber}-QR.${kind}`; anchor.click();
    if (kind === 'svg') window.setTimeout(() => URL.revokeObjectURL(href), 500);
  };
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal qr-issue-modal"><header><div><span>{project.code}</span><h2>تولید بارکد مجموعه</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header>{!issued ? <><div className="barcode-scope-note"><QrCode size={22} /><span><b>یک QR یکتا برای کل مجموعه</b><small>کد توسط سامانه تولید و در تمام مراحل مسیر استفاده می‌شود.</small></span></div><label>شماره سریال مجموعه<input autoFocus value={serialNumber} onChange={(event) => setSerialNumber(event.target.value.toUpperCase())} placeholder="شماره سریال واقعی" /></label><div className="plate-output-note"><Factory size={19} /><span><b>خروجی مناسب حک روی پلیت فلزی</b><small>پس از ثبت، فایل برداری SVG و تصویر PNG با کیفیت بالا دریافت می‌کنید.</small></span></div><footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={busy || serialNumber.trim().length < 2} onClick={() => void generate()}><QrCode size={16} /> {busy ? 'در حال تولید…' : 'تولید و ثبت QR'}</button></footer></> : <div className="issued-qr"><div className="qr-plate-preview"><img src={issued.png} alt={`QR ${issued.barcode}`} /><span>{project.code}</span><b>{issued.serialNumber}</b></div><div className="issued-qr-info"><span><CircleCheck size={18} /> بارکد با موفقیت در سامانه ثبت شد</span><h3>{issued.barcode}</h3><p>نسخه SVG برای دستگاه حک و نسخه PNG برای چاپ لیبل آماده است.</p><div><button type="button" onClick={() => download('svg')}><Download size={16} /> دریافت SVG حک</button><button type="button" onClick={() => download('png')}><Download size={16} /> دریافت PNG</button></div><button className="issue-done" type="button" onClick={onClose}>بستن و بازگشت به پروژه</button></div></div>}</section></div>;
}

function NewProjectModal({ onClose, onCreate }: { onClose: () => void; onCreate: (value: ProjectInput) => void }) {
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [drawings, setDrawings] = useState(''); const [itemType, setItemType] = useState<'single' | 'assembly'>('assembly');
  return <div className="modal-layer"><button className="modal-scrim" type="button" onClick={onClose} /><section className="forge-modal new-project-modal"><header><div><span>دفتر پروژه‌ها</span><h2>تعریف پروژه</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><label>نوع قطعه</label><div className="kind-selector compact project-kind-selector"><button type="button" className={itemType === 'assembly' ? 'active' : ''} onClick={() => setItemType('assembly')}><Boxes size={19} /><span><b>Assembly Part</b><small>پروژه مونتاژی و دارای پروفایل</small></span></button><button type="button" className={itemType === 'single' ? 'active' : ''} onClick={() => setItemType('single')}><PackageOpen size={19} /><span><b>Single Part</b><small>قطعه تکی</small></span></button></div><div className="modal-grid"><label>نام پروژه<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>کد پروژه<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label></div>{itemType === 'single' ? <label>شماره نقشه‌ها <em>هر شماره در یک خط</em><textarea value={drawings} onChange={(event) => setDrawings(event.target.value)} rows={4} /></label> : <div className="assembly-create-note"><FileSpreadsheet size={20} /><span><b>شماره نقشه در پروفایل ثبت می‌شود</b><small>بعد از ایجاد پروژه، شماره نقشه اصلی، جزئیات قطعات و فایل Excel را در پروفایل پروژه وارد کنید.</small></span></div>}{itemType === 'assembly' && <div className="default-route-note"><Route size={19} /><span><b>مسیر پیش‌فرض آماده می‌شود</b><small>مونتاژ، جوش، سندبلاست، رنگ میانی، رنگ نهایی و بسته‌بندی؛ تمام مراحل بعداً قابل ویرایش و جابه‌جایی‌اند.</small></span></div>}<footer><button type="button" onClick={onClose}>انصراف</button><button className="primary" type="button" disabled={name.trim().length < 2 || code.trim().length < 2} onClick={() => onCreate({ name, code, itemType, drawings: itemType === 'single' ? drawings.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) : [] })}>ثبت پروژه</button></footer></section></div>;
}
