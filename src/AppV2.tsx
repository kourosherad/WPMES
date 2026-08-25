import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import {
  Activity, AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Barcode, Bell,
  Boxes, Camera, Check, CheckCircle2, ChevronDown, CircleStop, ClipboardList,
  Factory, FileCog, Flashlight, Gauge, HardHat, History, Layers3, ListFilter,
  LockKeyhole, Menu, PackageCheck, PenLine, Plus, QrCode, RefreshCw, ScanLine,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, UserRound, Wrench, X, Zap,
} from 'lucide-react';

type Page = 'scan' | 'queue' | 'flow' | 'engineering' | 'projects';
type RoleId = 'operator' | 'qc' | 'production' | 'packaging' | 'engineering';
type ScanSource = 'CAMERA' | 'USB_SCANNER' | 'MANUAL';

const roles = [
  { id: 'operator' as const, code: 'OP.W02', title: 'اپراتور جوش', station: 'سالن ۰۱ · ایستگاه جوش ۰۲', action: 'ثبت پایان عملیات جوش' },
  { id: 'qc' as const, code: 'QC.ALL', title: 'کنترل کیفیت', station: 'سالن ۰۱ · کنترل کیفیت', action: 'ثبت تأیید کنترل کیفیت' },
  { id: 'production' as const, code: 'PC.H01', title: 'کنترل تولید', station: 'سالن ۰۱ · کنترل تولید', action: 'ثبت تأیید کنترل تولید' },
  { id: 'packaging' as const, code: 'PK.01', title: 'پکیجینگ', station: 'سالن ۰۱ · خط بسته‌بندی', action: 'ثبت مجموعه در پکیج' },
  { id: 'engineering' as const, code: 'EN.RTE', title: 'امور مهندسی', station: 'طراحی مسیر تولید', action: 'مشاهده شناسنامه فنی' },
];

const nav = [
  { id: 'scan' as const, title: 'اسکن', icon: ScanLine },
  { id: 'queue' as const, title: 'صف کار', icon: ClipboardList },
  { id: 'flow' as const, title: 'جریان', icon: Activity },
  { id: 'engineering' as const, title: 'مهندسی', icon: Wrench },
  { id: 'projects' as const, title: 'پروژه‌ها', icon: Layers3 },
];

const sampleItems = [
  { code: 'ASM-017-0842', project: 'دکل انتقال جنوب', drawing: 'DWG-108-R3', step: 'جوشکاری نهایی', waiting: '۰۸ دقیقه', priority: 'فوری' },
  { code: 'ASM-017-0839', project: 'دکل انتقال جنوب', drawing: 'DWG-108-R3', step: 'مونتاژ پایه', waiting: '۱۹ دقیقه', priority: 'عادی' },
  { code: 'ASM-012-0441', project: 'سازه پست شرق', drawing: 'ST-204-R1', step: 'کنترل ابعادی', waiting: '۳۴ دقیقه', priority: 'عادی' },
  { code: 'OUT-017-0788', project: 'دکل انتقال جنوب', drawing: 'DWG-110-R2', step: 'کنترل ورودی', waiting: '۵۲ دقیقه', priority: 'تأخیر' },
];

function AppV2() {
  const [page, setPage] = useState<Page>('scan');
  const [roleId, setRoleId] = useState<RoleId>('operator');
  const [roleOpen, setRoleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const role = roles.find((item) => item.id === roleId)!;

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2800);
  };

  return <div className="rivet-app">
    <aside className={`rivet-rail ${menuOpen ? 'open' : ''}`}>
      <div className="rivet-brand"><span className="rivet-logo" aria-hidden="true" /><div><b>خط‌نگار</b><small>PRODUCTION CONTROL</small></div></div>
      <nav className="rail-nav" aria-label="ماژول‌های سامانه">{nav.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setMenuOpen(false); }}><Icon size={19} /><span>{item.title}</span>{item.id === 'queue' && <em>۴</em>}</button>; })}</nav>
      <div className="rail-bottom"><div className="rail-health"><i /><span>ONLINE</span></div><button type="button" aria-label="تنظیمات" onClick={() => notify('تنظیمات امنیتی این نقش بارگذاری شد')}><SlidersHorizontal size={18} /></button></div>
    </aside>
    {menuOpen && <button type="button" className="menu-scrim" aria-label="بستن منو" onClick={() => setMenuOpen(false)} />}

    <div className="rivet-workspace">
      <header className="rivet-topbar">
        <div className="topbar-identity"><button type="button" className="hamburger" onClick={() => setMenuOpen(true)}><Menu size={20} /></button><div className="section-index">0{nav.findIndex((item) => item.id === page) + 1}</div><div><span>کارخانه مرکزی / سالن ۰۱</span><b>{nav.find((item) => item.id === page)?.title}</b></div></div>
        <div className="topbar-tools"><div className="live-clock"><i /><span>شیفت صبح</span><b>۱۰:۴۲</b></div><button type="button" className="icon-key" onClick={() => notify('یک هشدار کنترل کیفیت در صف شماست')}><Bell size={17} /><em /></button><div className="role-control"><button type="button" className="role-button" onClick={() => setRoleOpen((value) => !value)}><span className="role-seal">{role.code.split('.')[0]}</span><span><small>نقش فعال</small><b>{role.title}</b></span><ChevronDown size={14} /></button>{roleOpen && <div className="role-popover"><span className="popover-title">انتخاب زمینه کاری</span>{roles.map((item) => <button type="button" key={item.id} className={item.id === roleId ? 'selected' : ''} onClick={() => { setRoleId(item.id); setRoleOpen(false); }}><span className="role-seal">{item.code.split('.')[0]}</span><span><b>{item.title}</b><small>{item.station}</small></span>{item.id === roleId && <Check size={15} />}</button>)}</div>}</div></div>
      </header>

      <main className="rivet-main">
        {page === 'scan' && <ScanPage role={role} onManual={() => setManualOpen(true)} notify={notify} />}
        {page === 'queue' && <QueuePage />}
        {page === 'flow' && <FlowPage />}
        {page === 'engineering' && <EngineeringPage notify={notify} />}
        {page === 'projects' && <ProjectsPage />}
      </main>
      <nav className="mobile-dock">{nav.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}><Icon size={19} /><span>{item.title}</span></button>; })}</nav>
    </div>

    {manualOpen && <ManualModal role={role} onClose={() => setManualOpen(false)} onDone={(code) => { setManualOpen(false); notify(`کد ${code} با ثبت دلیل پردازش شد`); }} />}
    {toast && <div className="rivet-toast"><CheckCircle2 size={18} /><span>{toast}</span></div>}
  </div>;
}

function ModuleHeader({ code, title, description, children }: { code: string; title: string; description?: string; children?: React.ReactNode }) {
  return <header className="module-header"><div><span className="module-code">{code}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</header>;
}

function ScanPage({ role, onManual, notify }: { role: (typeof roles)[number]; onManual: () => void; notify: (value: string) => void }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [usbCode, setUsbCode] = useState('');
  const [lastRead, setLastRead] = useState<string | null>(null);

  const process = (code: string, source: ScanSource) => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 6) return;
    setLastRead(clean);
    setCameraOpen(false);
    if (navigator.vibrate) navigator.vibrate(120);
    notify(`${role.action} برای ${clean} ثبت شد · ${source === 'CAMERA' ? 'دوربین' : 'اسکنر'}`);
  };

  const usbSubmit = (event: FormEvent) => { event.preventDefault(); process(usbCode, 'USB_SCANNER'); setUsbCode(''); };

  return <>
    <ModuleHeader code={`محل اسکن · ${role.station}`} title={role.action}>
      <div className="session-guard"><ShieldCheck size={18} /><div><small>وضعیت ایستگاه</small><b>آماده اسکن · {role.code}</b></div></div>
    </ModuleHeader>

    <section className="scan-stage">
      <div className="scan-stage-main">
        {!cameraOpen && !lastRead && <div className="camera-launch">
          <div className="launch-visual"><div className="qr-orbit"><QrCode size={58} strokeWidth={1.25} /><i className="orbit-a" /><i className="orbit-b" /></div><span className="laser-line" /></div>
          <span className="launch-overline">ایستگاه آماده دریافت کد است</span><h2>QR مجموعه را اسکن کنید</h2>
          <button type="button" className="launch-camera" onClick={() => setCameraOpen(true)}><Camera size={20} /><span>اسکن با دوربین</span><ArrowLeft size={18} /></button>
          <div className="source-divider"><span>بارکدخوان رومیزی</span></div>
          <form className="usb-reader" onSubmit={usbSubmit}><Barcode size={19} /><input value={usbCode} onChange={(event) => setUsbCode(event.target.value)} placeholder="کد را اسکن کنید" autoComplete="off" /><kbd>ENTER</kbd></form>
        </div>}
        {cameraOpen && <CameraReader role={role} onClose={() => setCameraOpen(false)} onRead={(code) => process(code, 'CAMERA')} />}
        {lastRead && <ScanSuccess code={lastRead} role={role} onAgain={() => setLastRead(null)} />}
      </div>

      <aside className="scan-context">
        <div className="context-title"><span>عملیات فعال</span><LockKeyhole size={17} /></div>
        <div className="role-spec"><span className="role-seal large">{role.code.split('.')[0]}</span><div><small>کاربر و نقش</small><b>{role.title}</b><em>{role.station}</em></div></div>
        <dl className="context-rules"><div><dt>عملیات حاصل از اسکن</dt><dd>{role.action}</dd></div><div><dt>اعتبار نشست</dt><dd className="good">تا ساعت ۱۴:۴۵</dd></div><div><dt>تفکیک وظایف</dt><dd className="good">فعال</dd></div><div><dt>ثبت رویداد</dt><dd>Realtime + Audit</dd></div></dl>
        <button type="button" className="manual-entry" onClick={onManual}><PenLine size={17} /><span><b>ورود دستی کد</b><small>فقط در صورت عدم امکان اسکن</small></span><ArrowLeft size={16} /></button>
      </aside>
    </section>

    <section className="shift-strip"><div><span className="strip-label">آمار امروز</span><b>شیفت جاری</b></div><StripMetric value="۴۸" label="اسکن موفق" /><StripMetric value="۰۳" label="ورود دستی" warn /><StripMetric value="۱۲" label="منتظر QC" /><StripMetric value="۱۸ms" label="تاخیر سامانه" /><div className="strip-live"><i /> آنلاین</div></section>
  </>;
}

function CameraReader({ role, onClose, onRead }: { role: (typeof roles)[number]; onClose: () => void; onRead: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [state, setState] = useState<'starting' | 'reading' | 'insecure' | 'denied' | 'unsupported'>('starting');
  const [torch, setTorch] = useState(false);
  const readLock = useRef(false);
  const onReadRef = useRef(onRead);

  useEffect(() => { onReadRef.current = onRead; }, [onRead]);

  useEffect(() => {
    let disposed = false;
    const start = async () => {
      if (!window.isSecureContext) { setState('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
      try {
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 900 });
        const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, videoRef.current || undefined, (result) => {
          if (result && !readLock.current && !disposed) {
            readLock.current = true;
            controlsRef.current?.stop();
            onReadRef.current(result.getText());
          }
        });
        if (disposed) controls.stop(); else { controlsRef.current = controls; setState('reading'); }
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        setState(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'unsupported');
      }
    };
    start();
    return () => { disposed = true; controlsRef.current?.stop(); controlsRef.current = null; };
  }, []);

  const close = () => { controlsRef.current?.stop(); onClose(); };
  const toggleTorch = async () => { if (!controlsRef.current?.switchTorch) return; const next = !torch; try { await controlsRef.current.switchTorch(next); setTorch(next); } catch { /* capability varies by device */ } };

  return <div className="camera-reader">
    <video ref={videoRef} muted playsInline className="camera-video" />
    <div className="camera-shade" /><div className="camera-target"><i /><i /><i /><i /><span /></div>
    <div className="camera-top"><button type="button" onClick={close}><X size={19} /></button><div><span>{role.station}</span><b>{role.action}</b></div><button type="button" onClick={toggleTorch} className={torch ? 'active' : ''}><Flashlight size={18} /></button></div>
    {state === 'starting' && <CameraMessage icon={<RefreshCw className="spin" size={24} />} title="در حال آماده‌سازی دوربین" text="لطفاً چند لحظه صبر کنید..." />}
    {state === 'insecure' && <CameraMessage icon={<LockKeyhole size={25} />} title="اتصال امن لازم است" text="برای فعال‌شدن دوربین گوشی، سامانه باید با HTTPS باز شود." />}
    {state === 'denied' && <CameraMessage icon={<CircleStop size={25} />} title="دسترسی دوربین داده نشد" text="از تنظیمات مرورگر، دسترسی Camera را برای این سامانه فعال کنید." />}
    {state === 'unsupported' && <CameraMessage icon={<AlertTriangle size={25} />} title="دوربین در دسترس نیست" text="مرورگر یا دستگاه فعلی امکان خواندن QR را فراهم نکرده است." />}
    {state === 'reading' && <div className="camera-hint"><i /><span>QR را داخل قاب ثابت نگه دارید</span></div>}
  </div>;
}

function CameraMessage({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="camera-message">{icon}<b>{title}</b><span>{text}</span></div>; }

function ScanSuccess({ code, role, onAgain }: { code: string; role: (typeof roles)[number]; onAgain: () => void }) {
  return <div className="scan-success"><div className="success-signal"><Check size={37} /></div><span className="success-label">SCAN ACCEPTED / 200</span><h2>عملیات با موفقیت ثبت شد</h2><div className="success-code"><small>شناسه مجموعه</small><b>{code}</b></div><div className="success-grid"><div><small>پروژه</small><b>دکل انتقال جنوب</b></div><div><small>نقشه</small><b>DWG-108-R3</b></div><div><small>مرحله</small><b>جوشکاری نهایی</b></div><div><small>ثبت‌کننده</small><b>{role.title}</b></div></div><div className="success-action"><Zap size={17} /><span>{role.action}</span><b>ثبت شد</b></div><button type="button" className="scan-again" onClick={onAgain}><ScanLine size={18} /> اسکن مجموعه بعدی</button></div>;
}

function StripMetric({ value, label, warn = false }: { value: string; label: string; warn?: boolean }) { return <div className={`strip-metric ${warn ? 'warn' : ''}`}><b>{value}</b><span>{label}</span></div>; }

function QueuePage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'urgent'>('all');
  const [selected, setSelected] = useState<(typeof sampleItems)[number] | null>(null);
  const rows = sampleItems.filter((item) => (filter === 'all' || item.priority !== 'عادی') && `${item.code}${item.project}${item.step}`.includes(query));
  return <><ModuleHeader code="WORK QUEUE / LIVE" title="صف کار من" description="مجموعه‌هایی که بر اساس نقش فعال به اقدام شما نیاز دارند."><div className="queue-count"><span>در انتظار اقدام</span><b>{rows.length.toLocaleString('fa-IR')}</b></div></ModuleHeader><div className="queue-toolbar"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جستجوی کد، پروژه یا مرحله" /></label><div className="filter-tabs"><button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>همه</button><button type="button" className={filter === 'urgent' ? 'active' : ''} onClick={() => setFilter('urgent')}>اولویت‌دار</button></div></div><section className="work-list"><div className="work-list-head"><span>شناسه مجموعه</span><span>پروژه / نقشه</span><span>مرحله جاری</span><span>انتظار</span><span>اولویت</span><span /></div>{rows.map((item, index) => <button type="button" className="work-row" key={item.code} onClick={() => setSelected(item)}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><span className="mono">{item.code}</span><span><b>{item.project}</b><small>{item.drawing}</small></span><span>{item.step}</span><span>{item.waiting}</span><span className={`priority ${item.priority}`}>{item.priority}</span><ArrowLeft size={17} /></button>)}</section>{selected && <ItemDrawer item={selected} onClose={() => setSelected(null)} />}</>;
}

function ItemDrawer({ item, onClose }: { item: (typeof sampleItems)[number]; onClose: () => void }) { return <div className="item-drawer"><button type="button" className="drawer-scrim" onClick={onClose} /><aside><header><span>WORK ITEM</span><button type="button" onClick={onClose}><X size={18} /></button></header><div className="drawer-code"><QrCode size={25} /><b>{item.code}</b></div><dl><div><dt>پروژه</dt><dd>{item.project}</dd></div><div><dt>شماره نقشه</dt><dd>{item.drawing}</dd></div><div><dt>مرحله جاری</dt><dd>{item.step}</dd></div><div><dt>زمان انتظار</dt><dd>{item.waiting}</dd></div></dl><div className="drawer-timeline"><span className="done">مونتاژ اولیه <Check size={13} /></span><span className="active">جوشکاری نهایی <Zap size={13} /></span><span>کنترل کیفیت</span><span>کنترل تولید</span></div><button type="button" className="drawer-action"><ScanLine size={17} /> رفتن به اسکن این مجموعه</button></aside></div>; }

function FlowPage() {
  const stages = [
    ['مونتاژ','۴۸','COMPLETE'],['جوش','۳۹','ACTIVE'],['QC جوش','۱۲','QUEUE'],['سندبلاست','۲۷','NORMAL'],['گالوانیزه','۱۸','EXTERNAL'],['آستر','۰۹','NORMAL'],['پکیجینگ','۰۸','NORMAL'],
  ];
  return <><ModuleHeader code="PRODUCTION FLOW / PRJ-1405-017" title="جریان تولید" description="موقعیت زنده مجموعه‌ها در مسیر پروژه دکل انتقال جنوب."><button type="button" className="project-selector"><span>پروژه فعال</span><b>PRJ-1405-017</b><ChevronDown size={15} /></button></ModuleHeader><section className="flow-command"><div className="flow-stats"><span>پیشرفت واقعی</span><b>۶۷٫۴٪</b><em>۳٫۶٪ عقب‌تر از برنامه</em></div><div className="flow-track">{stages.map((stage, index) => <div className={`flow-node ${stage[2].toLowerCase()}`} key={stage[0]}><span className="node-number">{String(index + 1).padStart(2, '0')}</span>{index < stages.length - 1 && <i />}<b>{stage[0]}</b><strong>{stage[1]}</strong><small>مجموعه</small></div>)}</div></section><section className="flow-alerts"><article><AlertTriangle size={20} /><div><span>گلوگاه فعلی</span><b>کنترل کیفیت جوش</b><small>۱۲ مجموعه · متوسط انتظار ۳۱ دقیقه</small></div></article><article><Gauge size={20} /><div><span>بهره‌وری شیفت</span><b>۸۸٫۲٪</b><small>۲٫۱٪ بالاتر از میانگین هفتگی</small></div></article><article><PackageCheck size={20} /><div><span>آماده پکیجینگ</span><b>۰۸ مجموعه</b><small>برای بسته PKG-018</small></div></article></section></>;
}

function EngineeringPage({ notify }: { notify: (value: string) => void }) {
  const [steps, setSteps] = useState([
    { name: 'مونتاژ اولیه', mode: 'داخلی', code: 'A1' }, { name: 'جوشکاری', mode: 'داخلی', code: 'W2' }, { name: 'کنترل ابعادی', mode: 'داخلی', code: 'Q1' }, { name: 'گالوانیزه گرم', mode: 'خارجی', code: 'EXT' }, { name: 'کنترل ورودی', mode: 'داخلی', code: 'Q2' }, { name: 'پکیجینگ', mode: 'داخلی', code: 'PK' },
  ]);
  const [selected, setSelected] = useState(1);
  const move = (index: number, delta: number) => { const next = [...steps]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setSteps(next); setSelected(target); };
  const toggleMode = () => setSteps((current) => current.map((step, index) => index === selected ? { ...step, mode: step.mode === 'داخلی' ? 'خارجی' : 'داخلی' } : step));
  return <><ModuleHeader code="ROUTE ENGINEER / DRAFT V04" title="طراحی مسیر تولید" description="ترتیب و قواعد هر زیر‌فرایند را بدون وابستگی به تیم نرم‌افزار تنظیم کنید."><div className="engine-actions"><button type="button" onClick={() => notify('پیش‌نویس نسخه ۴ ذخیره شد')}>ذخیره پیش‌نویس</button><button type="button" className="publish" onClick={() => notify('مسیر اعتبارسنجی شد و برای تأیید مهندسی آماده است')}><Sparkles size={16} /> اعتبارسنجی مسیر</button></div></ModuleHeader><section className="engine-layout"><div className="engine-sequence"><header><div><span>ROUTE SEQUENCE</span><b>مجموعه پایه مدل TP-420</b></div><em>۶ زیر‌فرایند</em></header>{steps.map((step, index) => <div className={`engine-step ${selected === index ? 'selected' : ''} ${step.mode === 'خارجی' ? 'external' : ''}`} key={`${step.code}-${index}`} onClick={() => setSelected(index)}><span className="step-order">{String(index + 1).padStart(2, '0')}</span><span className="step-id">{step.code}</span><span><b>{step.name}</b><small>{step.mode} · QC اجباری · کنترل تولید</small></span><span className="step-mode">{step.mode}</span><div><button type="button" aria-label="انتقال به بالا" disabled={index === 0} onClick={(event) => { event.stopPropagation(); move(index, -1); }}><ArrowUp size={14} /></button><button type="button" aria-label="انتقال به پایین" disabled={index === steps.length - 1} onClick={(event) => { event.stopPropagation(); move(index, 1); }}><ArrowDown size={14} /></button></div></div>)}</div><aside className="engine-inspector"><span className="inspector-title">STEP CONFIGURATION</span><div className="inspector-selected"><span>{String(selected + 1).padStart(2, '0')}</span><div><small>مرحله انتخاب‌شده</small><b>{steps[selected].name}</b></div></div><label>نحوه اجرا</label><div className="mode-switch"><button type="button" className={steps[selected].mode === 'داخلی' ? 'active' : ''} onClick={toggleMode}>داخلی</button><button type="button" className={steps[selected].mode === 'خارجی' ? 'active' : ''} onClick={toggleMode}>خارجی</button></div><label>کنترل‌های عبور</label><div className="control-check"><Check size={13} /><span>تأیید اپراتور</span></div><div className="control-check"><Check size={13} /><span>تأیید کنترل کیفیت</span></div><div className="control-check"><Check size={13} /><span>تأیید کنترل تولید</span></div><label>سیاست بارکد</label><button type="button" className="inspector-select">بدون تغییر بارکد <ChevronDown size={14} /></button><div className="valid-config"><ShieldCheck size={17} /><span><b>پیکربندی معتبر</b><small>تمام قواعد عبور تعریف شده‌اند.</small></span></div></aside></section></>;
}

function ProjectsPage() {
  const [selected, setSelected] = useState('PRJ-1405-017');
  const projects = [
    ['PRJ-1405-017','دکل انتقال جنوب','۶۷٫۴٪','فعال'],['PRJ-1405-012','سازه پست شرق','۸۴٫۱٪','فعال'],['PRJ-1405-009','فریم صنعتی K-90','۴۳٫۸٪','تأخیر'],['PRJ-1404-031','سازه نگهدارنده B2','۱۰۰٪','تکمیل'],
  ];
  return <><ModuleHeader code="PROJECT REGISTER" title="پروژه‌ها" description="پروژه، نقشه‌ها و نسخه مسیر تولید را مدیریت کنید."><button type="button" className="new-project"><Plus size={16} /> پروژه جدید</button></ModuleHeader><section className="project-register"><div className="register-tools"><label><Search size={16} /><input placeholder="جستجوی پروژه..." /></label><button type="button"><ListFilter size={16} /> فیلتر</button></div>{projects.map((project, index) => <button type="button" className={`register-row ${selected === project[0] ? 'selected' : ''}`} key={project[0]} onClick={() => setSelected(project[0])}><span className="row-index">{String(index + 1).padStart(2, '0')}</span><span><small>{project[0]}</small><b>{project[1]}</b></span><span className="progress-number">{project[2]}</span><span className={`status-chip ${project[3]}`}>{project[3]}</span><span><small>آخرین فعالیت</small><b>{index * 11 + 8} دقیقه قبل</b></span><ArrowLeft size={17} /></button>)}</section></>;
}

function ManualModal({ role, onClose, onDone }: { role: (typeof roles)[number]; onClose: () => void; onDone: (code: string) => void }) {
  const [code, setCode] = useState(''); const [reason, setReason] = useState('لیبل مخدوش یا ناخوانا'); const [confirmed, setConfirmed] = useState(false);
  return <div className="manual-layer"><button type="button" className="manual-scrim" onClick={onClose} /><section className="manual-sheet"><header><div><span>FALLBACK INPUT / AUDITED</span><h2>ورود دستی کد</h2></div><button type="button" onClick={onClose}><X size={19} /></button></header><div className="manual-security"><ShieldCheck size={19} /><p>ثبت دستی همان اعتبارسنجی اسکن را طی می‌کند و همراه با دلیل، کاربر، نقش و زمان در Audit ذخیره می‌شود.</p></div><label>کد QR مجموعه</label><div className="manual-code"><QrCode size={20} /><input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ASM-017-0842" /></div><label>دلیل استفاده از ورود دستی</label><select value={reason} onChange={(event) => setReason(event.target.value)}><option>لیبل مخدوش یا ناخوانا</option><option>خرابی موقت دوربین</option><option>خرابی بارکدخوان ایستگاه</option><option>سایر موارد</option></select><div className="manual-context"><div><small>نقش فعال</small><b>{role.title}</b></div><div><small>عملیات</small><b>{role.action}</b></div></div><label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>کد را با نوشته روی لیبل فیزیکی تطبیق داده‌ام.</span></label><footer><button type="button" onClick={onClose}>انصراف</button><button type="button" className="submit-manual" disabled={code.trim().length < 6 || !confirmed} onClick={() => onDone(code.trim().toUpperCase())}>ثبت کد و ادامه <ArrowLeft size={16} /></button></footer></section></div>;
}

export default AppV2;
