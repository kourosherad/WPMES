import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, Barcode, Bell, Boxes, BriefcaseBusiness,
  Check, CheckCircle2, ChevronDown, CircleGauge, ClipboardCheck, Clock3,
  Factory, FileStack, Gauge, GripVertical, HardHat, History, LayoutDashboard,
  LogOut, Menu, MoreHorizontal, PackageCheck, PanelRightClose, PenLine, Plus,
  QrCode, ScanLine, Search, Settings2, ShieldCheck, Sparkles, UserRoundCheck,
  UsersRound, Wrench, X, Zap,
} from 'lucide-react';

type Page = 'dashboard' | 'scanner' | 'engineering' | 'projects' | 'quality';
type RoleId = 'operator' | 'qc' | 'production' | 'packaging' | 'engineering';
type ScanSource = 'SCANNER' | 'MANUAL';

type ScanResult = {
  ok: boolean;
  title: string;
  message: string;
  action: string;
  code: string;
  source: ScanSource;
};

const roles: Array<{ id: RoleId; title: string; scope: string; accent: string }> = [
  { id: 'operator', title: 'اپراتور جوش', scope: 'ایستگاه جوش ۰۲', accent: 'OP' },
  { id: 'qc', title: 'بازرس کنترل کیفیت', scope: 'تمام ایستگاه‌های پروژه', accent: 'QC' },
  { id: 'production', title: 'کنترل تولید', scope: 'سالن تولید شماره ۱', accent: 'PC' },
  { id: 'packaging', title: 'مسئول پکیجینگ', scope: 'بسته‌بندی و خروج', accent: 'PK' },
  { id: 'engineering', title: 'کارشناس مهندسی', scope: 'تعریف مسیر و نقشه', accent: 'EN' },
];

const navItems: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'نمای عملیات', icon: LayoutDashboard },
  { id: 'scanner', label: 'بارکدخوان من', icon: ScanLine },
  { id: 'engineering', label: 'مهندسی فرایند', icon: Wrench },
  { id: 'projects', label: 'پروژه‌ها', icon: BriefcaseBusiness },
  { id: 'quality', label: 'کنترل کیفیت', icon: ShieldCheck },
];

const roleActions: Record<RoleId, { action: string; next: string; verb: string }> = {
  operator: { action: 'تأیید پایان عملیات جوش', next: 'در انتظار کنترل کیفیت', verb: 'ثبت پایان عملیات' },
  qc: { action: 'بازکردن فرم کنترل کیفیت جوش', next: 'در انتظار نتیجه QC', verb: 'شروع بازرسی' },
  production: { action: 'تأیید کنترل تولید مرحله جوش', next: 'آماده ورود به سندبلاست', verb: 'تأیید کنترل تولید' },
  packaging: { action: 'افزودن مجموعه به بسته فعال', next: 'ثبت در پکیج PKG-018', verb: 'افزودن به بسته' },
  engineering: { action: 'مشاهده شناسنامه فنی مجموعه', next: 'بدون تغییر وضعیت', verb: 'مشاهده شناسنامه' },
};

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [roleId, setRoleId] = useState<RoleId>('operator');
  const [roleOpen, setRoleOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualReason, setManualReason] = useState('مخدوش بودن لیبل');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const role = roles.find((item) => item.id === roleId)!;

  useEffect(() => {
    if (page === 'dashboard' || page === 'scanner') {
      const timer = window.setTimeout(() => scanInputRef.current?.focus(), 120);
      return () => window.clearTimeout(timer);
    }
  }, [page, roleId, scanResult]);

  const executeScan = (code: string, source: ScanSource) => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length < 6) {
      setScanResult({
        ok: false,
        title: 'کد قابل شناسایی نیست',
        message: 'کد واردشده کوتاه یا ناقص است. لیبل را دوباره اسکن کنید.',
        action: 'عملیات ثبت نشد',
        code: normalized || '—',
        source,
      });
      return;
    }
    const action = roleActions[roleId];
    setScanResult({
      ok: true,
      title: 'مجموعه شناسایی شد',
      message: `مجموعه ${normalized} متعلق به پروژه دکل انتقال جنوب است. مرحله جاری: جوشکاری نهایی.`,
      action: `${action.action} ← ${action.next}`,
      code: normalized,
      source,
    });
    setScanCode('');
    setManualCode('');
    setManualOpen(false);
  };

  const onScannerSubmit = (event: FormEvent) => {
    event.preventDefault();
    executeScan(scanCode, 'SCANNER');
  };

  const view = useMemo(() => {
    if (page === 'scanner') {
      return <ScannerPage role={role} roleId={roleId} scanCode={scanCode} setScanCode={setScanCode} inputRef={scanInputRef} onSubmit={onScannerSubmit} onManual={() => setManualOpen(true)} result={scanResult} clearResult={() => setScanResult(null)} />;
    }
    if (page === 'engineering') return <EngineeringPage />;
    if (page === 'projects') return <ProjectsPage />;
    if (page === 'quality') return <QualityPage />;
    return <Dashboard role={role} roleId={roleId} scanCode={scanCode} setScanCode={setScanCode} inputRef={scanInputRef} onSubmit={onScannerSubmit} onManual={() => setManualOpen(true)} result={scanResult} clearResult={() => setScanResult(null)} goScanner={() => setPage('scanner')} />;
  }, [page, role, roleId, scanCode, scanResult]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-emblem"><Factory size={22} strokeWidth={1.8} /></div>
          <div><strong>خط‌نگار</strong><span>سامانه فرمان تولید</span></div>
        </div>

        <div className="plant-context">
          <span className="context-label">سایت فعال</span>
          <button type="button"><span className="plant-mark">01</span><span><b>کارخانه مرکزی</b><small>سالن تولید شماره یک</small></span><ChevronDown size={15} /></button>
        </div>

        <nav className="main-nav" aria-label="منوی اصلی">
          <span className="nav-caption">فرماندهی عملیات</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSidebarOpen(false); }}><Icon size={18} /><span>{item.label}</span>{item.id === 'quality' && <em>۱۲</em>}</button>;
          })}
        </nav>

        <div className="sidebar-rule" />
        <nav className="main-nav secondary-nav">
          <span className="nav-caption">سامانه</span>
          <button type="button"><UsersRound size={18} /><span>کاربران و نقش‌ها</span></button>
          <button type="button"><History size={18} /><span>تاریخچه رویدادها</span></button>
          <button type="button"><Settings2 size={18} /><span>تنظیمات</span></button>
        </nav>

        <div className="system-status">
          <div className="status-signal"><span /><b>ارتباط پایدار</b></div>
          <small>سرور داخلی کارخانه</small>
          <div className="status-meta"><span>تاخیر</span><b>۱۸ ms</b></div>
        </div>
      </aside>

      {sidebarOpen && <button type="button" className="sidebar-scrim" aria-label="بستن منو" onClick={() => setSidebarOpen(false)} />}

      <div className="workspace">
        <header className="topbar-app">
          <div className="topbar-start">
            <button type="button" className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button>
            <div className="breadcrumb"><span>کارخانه مرکزی</span><ArrowLeft size={13} /><b>{navItems.find((item) => item.id === page)?.label}</b></div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="command-search"><Search size={16} /><span>جستجوی پروژه، نقشه یا بارکد</span><kbd>Ctrl K</kbd></button>
            <button type="button" className="round-action" aria-label="اعلان‌ها"><Bell size={18} /><i /></button>
            <div className="role-switcher">
              <button type="button" className="role-trigger" onClick={() => setRoleOpen((value) => !value)}><span className="user-avatar">{role.accent}</span><span className="user-copy"><b>{role.title}</b><small>{role.scope}</small></span><ChevronDown size={15} /></button>
              {roleOpen && <div className="role-menu"><div className="role-menu-head"><b>نقش فعال</b><span>نسخه نمایشی فاز اول</span></div>{roles.map((item) => <button key={item.id} type="button" className={roleId === item.id ? 'selected' : ''} onClick={() => { setRoleId(item.id); setRoleOpen(false); setScanResult(null); }}><span className="role-code">{item.accent}</span><span><b>{item.title}</b><small>{item.scope}</small></span>{roleId === item.id && <Check size={15} />}</button>)}</div>}
            </div>
          </div>
        </header>

        <main className="content-area">{view}</main>
      </div>

      {manualOpen && <ManualEntryModal code={manualCode} setCode={setManualCode} reason={manualReason} setReason={setManualReason} onClose={() => setManualOpen(false)} onSubmit={() => executeScan(manualCode, 'MANUAL')} />}
    </div>
  );
}

type ScannerProps = {
  role: (typeof roles)[number]; roleId: RoleId; scanCode: string;
  setScanCode: (value: string) => void; inputRef: React.RefObject<HTMLInputElement | null>;
  onSubmit: (event: FormEvent) => void; onManual: () => void;
  result: ScanResult | null; clearResult: () => void;
};

function PageIntro({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-intro"><div><span className="eyebrow-app">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}

function Dashboard(props: ScannerProps & { goScanner: () => void }) {
  return <>
    <PageIntro eyebrow="دوشنبه، ۰۳ شهریور ۱۴۰۵ · شیفت صبح" title="نبض تولید امروز" description="تصویر زنده‌ای از وضعیت پروژه‌ها، ایستگاه‌ها و کنترل‌های در انتظار">
      <div className="shift-card"><span className="shift-pulse" /><div><small>شیفت فعال</small><b>صبح · ۰۷:۰۰ تا ۱۵:۰۰</b></div><span className="shift-team"><UsersRound size={14} /> ۳۸ نفر</span></div>
    </PageIntro>

    <section className="kpi-grid">
      <Metric icon={<Boxes size={19} />} label="مجموعه در جریان" value="۲۸۴" delta="+۱۸ امروز" tone="steel" />
      <Metric icon={<Activity size={19} />} label="پیشرفت کل پروژه‌ها" value="۶۷٫۴٪" delta="۲٫۸٪ رشد هفتگی" tone="teal" />
      <Metric icon={<ClipboardCheck size={19} />} label="در انتظار کنترل" value="۲۱" delta="۱۲ QC · ۹ تولید" tone="amber" />
      <Metric icon={<AlertTriangle size={19} />} label="نیازمند اقدام" value="۰۷" delta="۳ مورد با اولویت بالا" tone="red" />
    </section>

    <section className="primary-grid">
      <ScanConsole {...props} compact />
      <ProjectPulse />
    </section>

    <section className="route-board panel">
      <div className="panel-head"><div><span className="panel-kicker">FLOW / LIVE</span><h2>جریان فعال پروژه دکل انتقال جنوب</h2></div><div className="panel-actions"><span className="live-tag"><i /> به‌روزرسانی زنده</span><button type="button"><MoreHorizontal size={18} /></button></div></div>
      <div className="route-lane">
        <RouteStation code="A1" title="مونتاژ" count="۴۸" status="روان" tone="done" />
        <RouteStation code="W2" title="جوش" count="۳۹" status="تراکم متوسط" tone="active" />
        <RouteStation code="Q1" title="کنترل QC" count="۱۲" status="نیازمند اقدام" tone="warning" />
        <RouteStation code="B1" title="سندبلاست" count="۲۷" status="روان" tone="normal" />
        <RouteStation code="G1" title="گالوانیزه" count="۱۸" status="پیمانکار" tone="external" />
        <RouteStation code="P1" title="پکیجینگ" count="۰۸" status="آماده خروج" tone="normal" last />
      </div>
    </section>

    <section className="bottom-grid">
      <PendingQueue />
      <LiveTimeline />
    </section>
  </>;
}

function Metric({ icon, label, value, delta, tone }: { icon: ReactNode; label: string; value: string; delta: string; tone: string }) {
  return <article className={`metric-card ${tone}`}><div className="metric-top"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><button type="button"><MoreHorizontal size={16} /></button></div><div className="metric-value">{value}</div><div className="metric-foot"><span>{delta}</span><i className="micro-line" /></div></article>;
}

function ScanConsole({ role, roleId, scanCode, setScanCode, inputRef, onSubmit, onManual, result, clearResult, compact = false }: ScannerProps & { compact?: boolean }) {
  const action = roleActions[roleId];
  return <section className={`scan-console-app ${compact ? 'compact' : ''}`}>
    <div className="scan-grid-mark" aria-hidden="true" />
    <div className="scan-head"><div><span className="panel-kicker">SCAN CONSOLE / {role.accent}</span><h2>بارکدخوان من</h2></div><span className="scanner-ready"><i /> آماده دریافت</span></div>
    <div className="active-permission"><span className="permission-code">{role.accent}</span><div><small>عملیات مجاز در نقش فعلی</small><b>{action.action}</b></div><ShieldCheck size={20} /></div>
    {!result ? <form className="scan-form" onSubmit={onSubmit}>
      <label htmlFor={compact ? 'dashboard-scan' : 'page-scan'}>اسکن بارکد مجموعه</label>
      <div className="scanner-input-wrap"><span className="focus-corners" /><Barcode size={24} /><input id={compact ? 'dashboard-scan' : 'page-scan'} ref={inputRef} value={scanCode} onChange={(event) => setScanCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="بارکد را اسکن کنید..." /><kbd>ENTER</kbd></div>
      <div className="scan-help"><span><Zap size={14} /> ورودی اسکنر همیشه آماده است</span><button type="button" onClick={onManual}><PenLine size={14} /> ورود دستی کد</button></div>
    </form> : <div className={`scan-result ${result.ok ? 'success' : 'error'}`}><button type="button" className="result-close" onClick={clearResult}><X size={16} /></button><div className="result-icon">{result.ok ? <CheckCircle2 size={30} /> : <AlertTriangle size={30} />}</div><div className="result-copy"><span>{result.source === 'MANUAL' ? 'ثبت دستی · قابل ممیزی' : 'اسکن مستقیم'}</span><h3>{result.title}</h3><p>{result.message}</p><b>{result.action}</b></div><div className="result-code"><small>کد مجموعه</small><strong>{result.code}</strong></div></div>}
    <div className="scan-footer"><span>کاربر: <b>{role.title}</b></span><span>زمینه: <b>{role.scope}</b></span><span className="session-expiry"><Clock3 size={13} /> نشست معتبر تا ۱۴:۴۵</span></div>
  </section>;
}

function ProjectPulse() {
  return <section className="project-pulse panel"><div className="panel-head"><div><span className="panel-kicker">PROJECT / 1405-017</span><h2>دکل انتقال جنوب</h2></div><span className="project-priority">اولویت بالا</span></div><div className="project-identity"><div className="project-monogram">DS</div><div><span>کارفرما: توسعه انرژی پارس</span><b>۴۲۰ مجموعه · ۶ نوع نقشه</b></div></div><div className="project-progress-head"><div><span>پیشرفت واقعی</span><b>۶۷٫۴٪</b></div><div><span>برنامه مصوب</span><b>۷۱٫۰٪</b></div></div><div className="project-progress"><i className="actual" /><i className="planned" /></div><div className="project-gap"><AlertTriangle size={14} /><span>۳٫۶٪ عقب‌تر از برنامه</span><button type="button">مشاهده تحلیل</button></div><div className="project-stats"><div><small>موعد تحویل</small><b>۲۸ مهر ۱۴۰۵</b></div><div><small>مجموعه تکمیل‌شده</small><b>۲۸۳ / ۴۲۰</b></div><div><small>نقشه جاری</small><b>DWG-108-R3</b></div></div></section>;
}

function RouteStation({ code, title, count, status, tone, last = false }: { code: string; title: string; count: string; status: string; tone: string; last?: boolean }) {
  return <div className={`route-station ${tone}`}><div className="station-node"><span>{code}</span></div>{!last && <i className="route-connector" />}<div className="station-copy"><b>{title}</b><strong>{count}</strong><small>{status}</small></div></div>;
}

function PendingQueue() {
  const rows = [
    ['ASM-017-0842', 'جوشکاری نهایی', 'کنترل کیفیت', '۸ دقیقه', 'urgent'],
    ['ASM-017-0839', 'مونتاژ پایه', 'کنترل کیفیت', '۱۹ دقیقه', 'normal'],
    ['ASM-017-0827', 'کنترل ورودی', 'کنترل تولید', '۳۴ دقیقه', 'normal'],
    ['ASM-017-0818', 'سندبلاست', 'کنترل کیفیت', '۵۲ دقیقه', 'late'],
  ];
  return <section className="panel queue-panel"><div className="panel-head"><div><span className="panel-kicker">ACTION QUEUE</span><h2>صف اقدام‌های من</h2></div><button type="button" className="text-action">مشاهده همه <ArrowLeft size={14} /></button></div><div className="queue-table"><div className="queue-row queue-head"><span>کد مجموعه</span><span>مرحله</span><span>اقدام</span><span>زمان انتظار</span></div>{rows.map((row) => <div className="queue-row" key={row[0]}><b>{row[0]}</b><span>{row[1]}</span><span className="queue-action">{row[2]}</span><span className={`wait ${row[4]}`}>{row[3]}</span></div>)}</div></section>;
}

function LiveTimeline() {
  const events = [
    ['تأیید QC ثبت شد', 'ASM-017-0831 · سارا احمدی', 'همین حالا', 'ok'],
    ['عملیات جوش تکمیل شد', 'ASM-017-0842 · ایستگاه W2', '۸ دقیقه قبل', 'work'],
    ['مجموعه از پیمانکار بازگشت', 'ASM-017-0788 · گالوانیزه', '۲۲ دقیقه قبل', 'external'],
    ['عدم انطباق ثبت شد', 'ASM-017-0804 · جوش ناقص', '۴۱ دقیقه قبل', 'alert'],
  ];
  return <section className="panel timeline-panel"><div className="panel-head"><div><span className="panel-kicker">LIVE EVENTS</span><h2>رویدادهای زنده</h2></div><span className="live-tag"><i /> LIVE</span></div><div className="timeline-list">{events.map((event) => <div className="timeline-event" key={event[0]}><span className={`event-dot ${event[3]}`} /><div><b>{event[0]}</b><span>{event[1]}</span></div><small>{event[2]}</small></div>)}</div></section>;
}

function ScannerPage(props: ScannerProps) {
  return <>
    <PageIntro eyebrow="ROLE-BASED SCAN STATION" title="بارکدخوان نقش‌محور" description="کد مجموعه را اسکن کنید؛ سامانه بر اساس نقش، ایستگاه و وضعیت جاری، عملیات مجاز را تشخیص می‌دهد.">
      <div className="security-stamp"><ShieldCheck size={20} /><div><small>کنترل سمت سرور</small><b>RBAC + تفکیک وظایف</b></div></div>
    </PageIntro>
    <div className="scanner-page-grid"><ScanConsole {...props} /><section className="scan-guide panel"><div className="panel-head"><div><span className="panel-kicker">SCAN POLICY</span><h2>منطق این نشست</h2></div><CircleGauge size={21} /></div><div className="policy-line"><span>01</span><div><b>هویت کاربر</b><small>{props.role.title}</small></div><Check size={16} /></div><div className="policy-line"><span>02</span><div><b>نقش و حوزه فعال</b><small>{props.role.scope}</small></div><Check size={16} /></div><div className="policy-line"><span>03</span><div><b>وضعیت مجموعه</b><small>پس از اسکن از سرور خوانده می‌شود</small></div><Activity size={16} /></div><div className="policy-line"><span>04</span><div><b>نتیجه مجاز</b><small>{roleActions[props.roleId].verb}</small></div><ShieldCheck size={16} /></div><div className="policy-warning"><AlertTriangle size={17} /><p>ورود دستی همان کنترل‌های اسکن را طی می‌کند و همراه با دلیل، کاربر و زمان در Audit ثبت می‌شود.</p></div></section></div>
    <section className="panel sample-codes"><div><span className="panel-kicker">DEMO DATA</span><h2>کدهای نمونه برای بررسی رابط</h2></div><div className="code-chips"><button type="button" onClick={() => props.setScanCode('ASM-017-0842')}>ASM-017-0842</button><button type="button" onClick={() => props.setScanCode('ASM-017-0831')}>ASM-017-0831</button><button type="button" onClick={() => props.setScanCode('OUT-017-0788')}>OUT-017-0788</button></div></section>
  </>;
}

function EngineeringPage() {
  const [selected, setSelected] = useState(2);
  const steps = [
    ['مونتاژ اولیه', 'داخلی', 'A1'], ['جوشکاری', 'داخلی', 'W2'], ['کنترل ابعادی', 'داخلی', 'Q1'],
    ['گالوانیزه گرم', 'خارجی', 'EXT'], ['کنترل ورودی', 'داخلی', 'Q2'], ['پکیجینگ', 'داخلی', 'PK'],
  ];
  return <>
    <PageIntro eyebrow="ENGINEERING WORKBENCH" title="طراحی مسیر تولید" description="مسیر هر مجموعه را بدون وابستگی به تیم نرم‌افزار تعریف، کنترل و نسخه‌بندی کنید.">
      <div className="intro-actions"><button type="button" className="button-secondary">ذخیره پیش‌نویس</button><button type="button" className="button-primary"><Sparkles size={16} /> اعتبارسنجی و انتشار</button></div>
    </PageIntro>
    <section className="engineering-shell">
      <aside className="process-library panel"><div className="builder-head"><span>کتابخانه فرایند</span><button type="button"><Plus size={16} /></button></div><div className="library-search"><Search size={14} /><input placeholder="جستجوی فرایند..." /></div><span className="library-label">ساخت و آماده‌سازی</span>{['برش ورق','مونتاژ اولیه','جوشکاری','سنگ‌زنی'].map((item) => <button type="button" className="library-process" key={item}><GripVertical size={14} /><span>{item}</span><Plus size={13} /></button>)}<span className="library-label">پوشش و تکمیل</span>{['سندبلاست','گالوانیزه گرم','آستر','رنگ نهایی'].map((item) => <button type="button" className="library-process" key={item}><GripVertical size={14} /><span>{item}</span><Plus size={13} /></button>)}</aside>
      <section className="route-canvas panel"><div className="canvas-head"><div><span>مسیر مجموعه</span><b>مجموعه پایه مدل TP-420</b></div><div className="version-badge">پیش‌نویس · نسخه ۴</div></div><div className="canvas-grid">{steps.map((step, index) => <button type="button" key={step[0]} className={`canvas-step ${selected === index ? 'selected' : ''} ${step[1] === 'خارجی' ? 'external' : ''}`} onClick={() => setSelected(index)}><span className="step-index">{String(index + 1).padStart(2, '0')}</span><span className="step-grip"><GripVertical size={15} /></span><span className="step-code">{step[2]}</span><span className="step-name"><b>{step[0]}</b><small>{step[1]} · QC اجباری · کنترل تولید</small></span><span className="step-type">{step[1]}</span><MoreHorizontal size={17} /></button>)}</div><button type="button" className="add-step"><Plus size={16} /> افزودن زیر‌فرایند</button></section>
      <aside className="settings-panel panel"><div className="builder-head"><span>تنظیمات مرحله</span><button type="button"><PanelRightClose size={16} /></button></div><div className="selected-process"><span>03</span><div><small>زیر‌فرایند انتخاب‌شده</small><b>{steps[selected][0]}</b></div></div><Field label="نوع اجرا"><div className="segmented"><button type="button" className={steps[selected][1] === 'داخلی' ? 'active' : ''}>داخلی</button><button type="button" className={steps[selected][1] === 'خارجی' ? 'active' : ''}>خارجی</button></div></Field><Field label="ایستگاه مسئول"><button type="button" className="select-field">کنترل کیفیت Q1 <ChevronDown size={14} /></button></Field><Field label="کنترل‌های عبور"><label className="check-setting"><span className="fake-check checked"><Check size={12} /></span>تأیید کنترل کیفیت</label><label className="check-setting"><span className="fake-check checked"><Check size={12} /></span>تأیید کنترل تولید</label></Field><Field label="سیاست بارکد"><button type="button" className="select-field">بدون تغییر بارکد <ChevronDown size={14} /></button></Field><div className="validation-note"><CheckCircle2 size={17} /><div><b>پیکربندی معتبر</b><small>تمام الزامات عبور تعریف شده‌اند.</small></div></div></aside>
    </section>
  </>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="field-group"><label>{label}</label>{children}</div>; }

function ProjectsPage() {
  const projects = [
    ['PRJ-1405-017','دکل انتقال جنوب','توسعه انرژی پارس','۶۷٫۴٪','فعال','۲۸ مهر'],
    ['PRJ-1405-012','سازه پست شرق','نیروی گستران','۸۴٫۱٪','فعال','۱۲ شهریور'],
    ['PRJ-1405-009','فریم صنعتی K-90','پترو تجهیز','۴۳٫۸٪','تأخیر','۰۵ آبان'],
    ['PRJ-1404-031','سازه نگهدارنده B2','فولاد ساحل','۱۰۰٪','تکمیل','تحویل شد'],
  ];
  return <><PageIntro eyebrow="PROJECT PORTFOLIO" title="پروژه‌ها" description="کنترل وضعیت پروژه، نقشه‌ها، اقلام و نسخه مسیر تولید"><button type="button" className="button-primary"><Plus size={16} /> تعریف پروژه جدید</button></PageIntro><section className="panel projects-panel"><div className="table-tools"><div className="library-search wide"><Search size={15} /><input placeholder="جستجو در پروژه‌ها..." /></div><button type="button" className="filter-button"><Settings2 size={15} /> فیلتر پیشرفته</button></div><div className="projects-table"><div className="project-row project-row-head"><span>پروژه</span><span>کارفرما</span><span>پیشرفت</span><span>وضعیت</span><span>موعد</span><span /></div>{projects.map((project) => <div className="project-row" key={project[0]}><div><span className="project-table-mark"><FileStack size={17} /></span><span><b>{project[1]}</b><small>{project[0]}</small></span></div><span>{project[2]}</span><div className="progress-cell"><b>{project[3]}</b><i><span className={`progress-fill progress-${project[3].replace(/[^0-9]/g,'').slice(0,2)}`} /></i></div><span className={`project-status ${project[4]}`}>{project[4]}</span><span>{project[5]}</span><button type="button"><MoreHorizontal size={18} /></button></div>)}</div></section></>;
}

function QualityPage() {
  return <><PageIntro eyebrow="QUALITY CONTROL" title="مرکز کنترل کیفیت" description="بازرسی‌های منتظر، عدم انطباق‌ها و روند کیفیت پروژه‌ها"><button type="button" className="button-secondary"><ClipboardCheck size={16} /> فرم‌های بازرسی</button></PageIntro><section className="quality-grid"><article className="quality-hero panel"><div className="quality-score"><span>نرخ قبولی دفعه اول</span><strong>۹۴٫۸٪</strong><small>۱٫۷٪ بهتر از ماه قبل</small></div><div className="quality-rings"><div className="ring ring-a"><span>۱۲</span><small>منتظر</small></div><div className="ring ring-b"><span>۰۴</span><small>اصلاح</small></div><div className="ring ring-c"><span>۰۱</span><small>توقف</small></div></div></article><article className="panel quality-alerts"><div className="panel-head"><div><span className="panel-kicker">NON-CONFORMITY</span><h2>موارد نیازمند توجه</h2></div><AlertTriangle size={20} /></div>{['جوش ناقص در اتصال پایه','ضخامت پوشش خارج از تلرانس','مغایرت ابعادی فلنج'].map((item,index)=><div className="quality-alert" key={item}><span>{String(index+1).padStart(2,'0')}</span><div><b>{item}</b><small>پروژه دکل انتقال جنوب · {index*11+9} دقیقه قبل</small></div><ArrowLeft size={15}/></div>)}</article></section></>;
}

function ManualEntryModal({ code, setCode, reason, setReason, onClose, onSubmit }: { code: string; setCode: (value: string) => void; reason: string; setReason: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="manual-title"><button type="button" className="modal-scrim" aria-label="بستن" onClick={onClose} /><div className="manual-modal"><div className="modal-head"><div className="modal-icon"><PenLine size={20} /></div><div><span>ورودی جایگزین کنترل‌شده</span><h2 id="manual-title">ثبت دستی کد مجموعه</h2></div><button type="button" onClick={onClose}><X size={18} /></button></div><div className="audit-banner"><ShieldCheck size={18} /><p>این عملیات با نام کاربر، زمان، نقش فعال و دلیل ورود دستی در سابقه امنیتی ثبت می‌شود.</p></div><Field label="کد درج‌شده روی لیبل"><div className="manual-input"><Barcode size={19} /><input autoFocus value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="مثال: ASM-017-0842" /></div></Field><Field label="دلیل عدم استفاده از اسکنر"><select value={reason} onChange={(event) => setReason(event.target.value)}><option>مخدوش بودن لیبل</option><option>خرابی موقت بارکدخوان</option><option>خوانده نشدن بارکد</option><option>سایر موارد</option></select></Field><label className="manual-confirm"><input type="checkbox" defaultChecked /><span>صحت کد واردشده را با برچسب فیزیکی تطبیق داده‌ام.</span></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={onClose}>انصراف</button><button type="button" className="button-primary" onClick={onSubmit} disabled={code.trim().length < 6}><UserRoundCheck size={16} /> ثبت و ادامه</button></div></div></div>;
}

export default App;
