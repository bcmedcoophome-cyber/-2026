'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Screen = 'home' | 'check' | 'result' | 'chronic' | 'report' | 'education' | 'info' | 'account' | 'login' | 'signup' | 'records' | 'practice' | 'admin';
type AnswerMap = Record<string, boolean>;
type Profile = { name: string; birthDate: string; address: string; phone: string; email: string };
type AdminTab = 'dashboard' | 'members' | 'cognitive' | 'chronic' | 'practice';
type AdminFilter = 'all' | 'immediate' | 'focus' | 'watch' | 'stale';
type AdminProfile = { id: string; name: string; birth_date: string | null; phone: string; email: string; created_at: string };
type AdminCognitive = { id: number; user_id: string; score: number; risk: string; created_at: string };
type AdminChronic = { id: number; user_id: string; systolic: number; diastolic: number; blood_sugar: number; sugar_timing: string; created_at: string };
type AdminPractice = { id: number; user_id: string; practice_date: string; completed_count: number };
type AdminDashboardRow = AdminProfile & { cognitive_score: number | null; cognitive_risk: string | null; cognitive_at: string | null; systolic: number | null; diastolic: number | null; blood_sugar: number | null; sugar_timing: string | null; chronic_at: string | null };
type PriorityMember = AdminDashboardRow & { priority: Exclude<AdminFilter, 'all'>; reason: string; measuredAt: string | null };
type CognitiveRecord = { id: number; score: number; risk: string; createdAt: string };
type PostcodeData = { address: string; roadAddress: string; jibunAddress: string; zonecode: string };

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: { oncomplete: (data: PostcodeData) => void }) => { embed: (element: HTMLElement, options?: { autoClose?: boolean }) => void };
    };
  }
}
type RssItem = {
  title: string;
  link: string;
  description: string;
  publishedAt: string;
  category: 'education' | 'event' | 'meeting' | 'news';
};
type ChronicRecord = {
  id: number;
  age: number;
  systolic: number;
  diastolic: number;
  bloodSugar: number;
  sugarTiming: 'fasting' | 'after_meal' | 'random';
  createdAt: string;
};

const questions = [
  { id: 'm1', group: '기억력', weight: 2, text: '최근 대화나 약속 내용을 며칠 안에 잊어버린 적이 있다' },
  { id: 'm2', group: '기억력', weight: 2, text: '같은 질문이나 이야기를 반복해서 한 적이 있다' },
  { id: 'm3', group: '기억력', weight: 1, text: '물건을 어디에 두었는지 기억나지 않아 자주 찾아다닌다' },
  { id: 'a1', group: '주의집중력', weight: 1, text: 'TV를 보거나 대화하는 중에 집중을 유지하기 어렵다' },
  { id: 'a2', group: '주의집중력', weight: 2, text: '하던 일을 끝까지 마무리하지 못하고 중간에 멈추는 경우가 많다' },
  { id: 'l1', group: '언어 이해 및 표현', weight: 2, text: '대화 중 적절한 단어가 잘 떠오르지 않아 답답할 때가 있다' },
  { id: 'l2', group: '언어 이해 및 표현', weight: 1, text: '상대방의 말이나 지시사항을 이해하는 데 어려움을 느낀다' },
  { id: 'j1', group: '의사결정 및 문제해결', weight: 1, text: '일상적인 선택을 할 때 평소보다 혼란스럽다' },
  { id: 'j2', group: '의사결정 및 문제해결', weight: 2, text: '문제를 해결하거나 결정을 내리는 데 시간이 오래 걸린다' },
  { id: 'd1', group: '정서 및 사회생활', weight: 2, text: '불안, 짜증, 감정 기복이 예전보다 심해졌다' },
  { id: 'd2', group: '정서 및 사회생활', weight: 1, text: '사람들과의 교류나 좋아하던 활동에 대한 흥미가 줄었다' },
  { id: 'i1', group: '일상생활 수행', weight: 2, text: '약 복용, 공과금 납부 등 반복적인 일을 스스로 챙기기 어려워졌다' },
  { id: 'i2', group: '일상생활 수행', weight: 1, text: '대중교통으로 목적지까지 가는 데 어려움을 느낀다' },
  { id: 'r1', group: '생활습관 위험요인', weight: 1, text: '평소 잘 안 들려서 되묻는 일이 많다' },
  { id: 'r2', group: '생활습관 위험요인', weight: 1, text: '고혈압, 당뇨, 고지혈증을 진단받았지만 관리가 잘 안 되고 있다' },
  { id: 'r3', group: '생활습관 위험요인', weight: 1, text: '하루 30분 이상 걷거나 몸을 움직이는 날이 거의 없다' },
];

const groups = [...new Set(questions.map((question) => question.group))];
const practiceItems = [
  { id: 'walk', group: '3권', label: '걷기' },
  { id: 'meal', group: '3권', label: '건강한 식사' },
  { id: 'reading', group: '3권', label: '읽고 쓰기' },
  { id: 'drink', group: '3금', label: '과음하지 않기' },
  { id: 'smoke', group: '3금', label: '금연하기' },
  { id: 'head', group: '3금', label: '머리 보호하기' },
  { id: 'vitals', group: '3행', label: '건강수치 확인' },
  { id: 'social', group: '3행', label: '사람과 소통하기' },
  { id: 'screening', group: '3행', label: '조기검진 챙기기' },
];

function riskFor(score: number) {
  if (score >= 15) return { key: 'danger', label: '전문가 상담 권장', copy: '여러 항목에서 변화 신호가 확인되었습니다. 가까운 의료기관이나 치매안심센터에서 정확한 평가를 받아보세요.' };
  if (score >= 7) return { key: 'warn', label: '관찰이 필요한 단계', copy: '몇 가지 주의가 필요한 응답이 있습니다. 생활 변화를 살피고 정기 검진을 고려해보세요.' };
  return { key: 'ok', label: '현재 뚜렷한 위험 신호 없음', copy: '현재는 뚜렷한 위험 신호가 적습니다. 생활습관을 관리하며 3~6개월 뒤 다시 확인해보세요.' };
}

function priorityFor(member: AdminDashboardRow): PriorityMember {
  const dates = [member.cognitive_at, member.chronic_at].filter(Boolean) as string[];
  const measuredAt = dates.sort().at(-1) || null;
  const stale = !measuredAt || Date.now() - new Date(measuredAt).getTime() > 90 * 24 * 60 * 60 * 1000;
  if (member.systolic !== null && member.diastolic !== null && (member.systolic > 180 || member.diastolic > 120)) return { ...member, priority: 'immediate', reason: `혈압 ${member.systolic}/${member.diastolic} — 편안한 상태에서 재측정하고 연락 확인`, measuredAt };
  if (member.blood_sugar !== null && member.blood_sugar < 54) return { ...member, priority: 'immediate', reason: `혈당 ${member.blood_sugar}mg/dL — 신속한 연락 확인`, measuredAt };
  if (member.systolic !== null && member.diastolic !== null && (member.systolic >= 140 || member.diastolic >= 90)) return { ...member, priority: 'focus', reason: `높은 혈압 범위 ${member.systolic}/${member.diastolic}`, measuredAt };
  if (member.blood_sugar !== null && (member.blood_sugar < 70 || member.blood_sugar > 240)) return { ...member, priority: 'focus', reason: `혈당 ${member.blood_sugar}mg/dL`, measuredAt };
  if (member.cognitive_score !== null && member.cognitive_score >= 15) return { ...member, priority: 'focus', reason: `인지 자가점검 ${member.cognitive_score}점 · 전문가 상담 권장 범위`, measuredAt };
  if (stale) return { ...member, priority: 'stale', reason: measuredAt ? '최근 90일 내 건강 기록 없음' : '건강 기록 없음', measuredAt };
  if (member.cognitive_score !== null && member.cognitive_score >= 7) return { ...member, priority: 'watch', reason: `인지 자가점검 ${member.cognitive_score}점 · 변화 관찰`, measuredAt };
  return { ...member, priority: 'watch', reason: '최근 입력값 경과관찰', measuredAt };
}

function assessChronic(record: ChronicRecord) {
  let bloodPressure = '일반적인 관리 범위';
  let bloodPressureNeedsAttention = false;
  if (record.systolic >= 180 || record.diastolic >= 120) {
    bloodPressure = '매우 높은 범위';
    bloodPressureNeedsAttention = true;
  } else if (record.systolic >= 140 || record.diastolic >= 90) {
    bloodPressure = '높은 범위';
    bloodPressureNeedsAttention = true;
  } else if (record.systolic >= 130 || record.diastolic >= 80) {
    bloodPressure = '주의 관찰 범위';
    bloodPressureNeedsAttention = true;
  } else if (record.systolic < 90 || record.diastolic < 60) {
    bloodPressure = '낮은 범위';
    bloodPressureNeedsAttention = true;
  }

  let glucose = record.sugarTiming === 'random' ? '측정 시점 참고 필요' : '일반적인 관리 범위';
  let glucoseNeedsAttention = false;
  if (record.bloodSugar < 70) {
    glucose = '낮은 범위';
    glucoseNeedsAttention = true;
  } else if (record.sugarTiming === 'fasting' && record.bloodSugar >= 126) {
    glucose = '높은 범위';
    glucoseNeedsAttention = true;
  } else if (record.sugarTiming === 'fasting' && record.bloodSugar >= 100) {
    glucose = '주의 관찰 범위';
    glucoseNeedsAttention = true;
  } else if (record.sugarTiming === 'after_meal' && record.bloodSugar >= 200) {
    glucose = '높은 범위';
    glucoseNeedsAttention = true;
  } else if (record.sugarTiming === 'after_meal' && record.bloodSugar >= 140) {
    glucose = '주의 관찰 범위';
    glucoseNeedsAttention = true;
  } else if (record.sugarTiming === 'random' && record.bloodSugar >= 200) {
    glucose = '높은 범위';
    glucoseNeedsAttention = true;
  }

  const needsAttention = bloodPressureNeedsAttention || glucoseNeedsAttention;
  return {
    key: needsAttention ? 'attention' : 'clear',
    title: needsAttention ? '주의가 필요한 수치가 있어요' : '현재 큰 문제 신호가 없어요',
    copy: needsAttention
      ? '한 번의 측정만으로 질환을 진단할 수는 없습니다. 편안한 상태에서 다시 측정하고 같은 범위가 반복되면 의료기관에 상담해주세요.'
      : '이번 입력값은 일반적인 관리 범위에 있습니다. 같은 조건에서 꾸준히 기록해 변화를 살펴보세요.',
    bloodPressure,
    glucose,
  };
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('left');
  const touchStart = useRef<{ x: number; y: number; interactive: boolean } | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [saveNote, setSaveNote] = useState('');
  const [age, setAge] = useState('');
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [bloodSugar, setBloodSugar] = useState('');
  const [sugarTiming, setSugarTiming] = useState<'fasting' | 'after_meal' | 'random'>('fasting');
  const [previewRecord, setPreviewRecord] = useState<ChronicRecord | null>(null);
  const [chronicNote, setChronicNote] = useState('');
  const [chronicLoading, setChronicLoading] = useState(false);
  const [rssItems, setRssItems] = useState<RssItem[]>([]);
  const [rssState, setRssState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authWorking, setAuthWorking] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupForm, setSignupForm] = useState<Profile>({ name: '', birthDate: '', address: '', phone: '', email: '' });
  const [addressDetail, setAddressDetail] = useState('');
  const [postcode, setPostcode] = useState('');
  const [addressSearchReady, setAddressSearchReady] = useState(false);
  const [addressSearchError, setAddressSearchError] = useState('');
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [healthAgreed, setHealthAgreed] = useState(false);
  const [cognitiveHistory, setCognitiveHistory] = useState<CognitiveRecord[]>([]);
  const [chronicHistory, setChronicHistory] = useState<ChronicRecord[]>([]);
  const [practiceChecks, setPracticeChecks] = useState<Record<string, boolean>>({});
  const [practiceSaved, setPracticeSaved] = useState(false);
  const [practiceMessage, setPracticeMessage] = useState('');
  const [recordPeriod, setRecordPeriod] = useState<'day' | 'month' | 'year'>('day');
  const [recordYear, setRecordYear] = useState(new Date().getFullYear());
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>('dashboard');
  const [adminFilter, setAdminFilter] = useState<AdminFilter>('all');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboardRow[]>([]);
  const [adminProfiles, setAdminProfiles] = useState<AdminProfile[]>([]);
  const [adminCognitive, setAdminCognitive] = useState<AdminCognitive[]>([]);
  const [adminChronic, setAdminChronic] = useState<AdminChronic[]>([]);
  const [adminPractice, setAdminPractice] = useState<AdminPractice[]>([]);
  const [adminCounts, setAdminCounts] = useState({ members: 0, cognitive: 0, chronic: 0, practice: 0 });
  const answered = Object.keys(answers).length;
  const score = useMemo(() => questions.reduce((total, q) => total + (answers[q.id] ? q.weight : 0), 0), [answers]);
  const risk = riskFor(score);
  const chronicAssessment = previewRecord ? assessChronic(previewRecord) : null;
  const priorityMembers = useMemo(() => adminDashboard.map(priorityFor).sort((a, b) => ({ immediate: 0, focus: 1, watch: 2, stale: 3 }[a.priority] - { immediate: 0, focus: 1, watch: 2, stale: 3 }[b.priority])), [adminDashboard]);
  const visiblePriorityMembers = adminFilter === 'all' ? priorityMembers : priorityMembers.filter((member) => member.priority === adminFilter);
  const priorityCounts = { immediate: priorityMembers.filter((member) => member.priority === 'immediate').length, focus: priorityMembers.filter((member) => member.priority === 'focus').length, watch: priorityMembers.filter((member) => member.priority === 'watch').length, stale: priorityMembers.filter((member) => member.priority === 'stale').length };

  async function loadMemberData(id: string) {
    const [profileResult, cognitiveResult, chronicResult, practiceResult] = await Promise.all([
      supabase.from('profiles').select('name,birth_date,address,phone,email').eq('id', id).maybeSingle(),
      supabase.from('cognitive_records').select('id,score,risk,created_at').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('chronic_records').select('id,age,systolic,diastolic,blood_sugar,sugar_timing,created_at').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('practice_records').select('checks,completed_count').eq('user_id', id).eq('practice_date', new Date().toISOString().slice(0, 10)).maybeSingle(),
    ]);

    if (profileResult.data) {
      setProfile({
        name: profileResult.data.name,
        birthDate: profileResult.data.birth_date,
        address: profileResult.data.address,
        phone: profileResult.data.phone,
        email: profileResult.data.email,
      });
    }
    setCognitiveHistory((cognitiveResult.data || []).map((item) => ({ id: item.id, score: item.score, risk: item.risk, createdAt: item.created_at })));
    setChronicHistory((chronicResult.data || []).map((item) => ({ id: item.id, age: item.age, systolic: item.systolic, diastolic: item.diastolic, bloodSugar: item.blood_sugar, sugarTiming: item.sugar_timing, createdAt: item.created_at })));
    if (practiceResult.data) {
      setPracticeChecks(practiceResult.data.checks || {});
      setPracticeSaved(true);
    } else {
      setPracticeChecks({});
      setPracticeSaved(false);
    }
  }

  function clearMemberData() {
    setUserId(null);
    setProfile(null);
    setCognitiveHistory([]);
    setChronicHistory([]);
    setPracticeChecks({});
    setPracticeSaved(false);
    setIsAdmin(false);
    setAdminDashboard([]);
    setAdminProfiles([]);
    setAdminCognitive([]);
    setAdminChronic([]);
    setAdminPractice([]);
    setAdminCounts({ members: 0, cognitive: 0, chronic: 0, practice: 0 });
    setAdminMessage('');
  }

  async function checkAdmin() {
    const { data, error } = await supabase.rpc('is_app_admin');
    const allowed = !error && data === true;
    setIsAdmin(allowed);
    return allowed;
  }

  async function resetPassword() {
    if (!loginEmail) { setAuthMessage('이메일을 먼저 입력해주세요.'); return; }
    setAuthWorking(true);
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, { redirectTo: window.location.origin });
    setAuthMessage(error ? '비밀번호 재설정 요청에 실패했습니다.' : '비밀번호 재설정 안내를 이메일로 보냈습니다.');
    setAuthWorking(false);
  }

  async function openAdmin() {
    if (!(await checkAdmin())) return;
    setScreen('admin');
    setAdminLoading(true);
    setAdminMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const [dashboard, profiles, cognitive, chronic, practice] = await Promise.all([
      supabase.rpc('admin_health_dashboard'),
      supabase.from('profiles').select('id,name,birth_date,phone,email,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(500),
      supabase.from('cognitive_records').select('id,user_id,score,risk,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(500),
      supabase.from('chronic_records').select('id,user_id,systolic,diastolic,blood_sugar,sugar_timing,created_at', { count: 'exact' }).order('created_at', { ascending: false }).limit(500),
      supabase.from('practice_records').select('id,user_id,practice_date,completed_count', { count: 'exact' }).order('practice_date', { ascending: false }).limit(500),
    ]);
    if (dashboard.error || profiles.error || cognitive.error || chronic.error || practice.error) setAdminMessage('관리자 자료를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.');
    else {
      setAdminDashboard((dashboard.data || []) as AdminDashboardRow[]);
      setAdminProfiles((profiles.data || []) as AdminProfile[]);
      setAdminCognitive((cognitive.data || []) as AdminCognitive[]);
      setAdminChronic((chronic.data || []) as AdminChronic[]);
      setAdminPractice((practice.data || []) as AdminPractice[]);
      setAdminCounts({ members: profiles.count || 0, cognitive: cognitive.count || 0, chronic: chronic.count || 0, practice: practice.count || 0 });
    }
    setAdminLoading(false);
  }

  function adminMember(id: string) { return adminProfiles.find((member) => member.id === id); }

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const id = data.session?.user.id || null;
      setUserId(id);
      if (id) { await loadMemberData(id); await checkAdmin(); }
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const id = session?.user.id || null;
      setUserId(id);
      if (id) setTimeout(() => { loadMemberData(id); checkAdmin(); }, 0);
      else clearMemberData();
      setAuthLoading(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (window.daum?.Postcode) {
      setAddressSearchReady(true);
      return;
    }
    const existing = document.getElementById('daum-postcode-script') as HTMLScriptElement | null;
    const markReady = () => setAddressSearchReady(Boolean(window.daum?.Postcode));
    if (existing) {
      existing.addEventListener('load', markReady);
      return () => existing.removeEventListener('load', markReady);
    }
    const script = document.createElement('script');
    script.id = 'daum-postcode-script';
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    script.async = true;
    script.onload = markReady;
    script.onerror = () => setAddressSearchError('주소검색을 불러오지 못했습니다. 잠시 후 다시 눌러주세요.');
    document.head.appendChild(script);
    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, []);

  useEffect(() => {
    if (!addressSearchOpen || !addressSearchReady || !window.daum?.Postcode) return;
    const container = document.getElementById('postcode-layer');
    if (!container) return;
    container.replaceChildren();
    new window.daum.Postcode({
      oncomplete: (data) => {
        const selectedAddress = data.roadAddress || data.jibunAddress || data.address;
        setSignupForm((current) => ({ ...current, address: selectedAddress }));
        setPostcode(data.zonecode);
        setAddressDetail('');
        setAddressSearchOpen(false);
      },
    }).embed(container, { autoClose: false });
  }, [addressSearchOpen, addressSearchReady]);

  function goHome() {
    setScreen('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openEducation() {
    setScreen('education');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openDementiaInfo() {
    setScreen('info');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (rssState !== 'idle') return;
    setRssState('loading');
    try {
      const response = await fetch('/api/rss');
      if (!response.ok) throw new Error('rss failed');
      const data = await response.json() as { items?: RssItem[]; configured?: boolean };
      const items = data.items || [];
      setRssItems(items);
      setRssState(items.length ? 'ready' : 'empty');
    } catch {
      setRssState('error');
    }
  }

  function beginCheck() {
    setScreen('check');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openChronic() {
    setScreen('chronic');
    setChronicNote(profile ? '확인한 결과는 내 기록에 저장됩니다.' : '비회원 입력값은 저장되지 않습니다.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openMedicalReport() {
    if (!previewRecord) return;
    setScreen('report');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveChronicRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChronicLoading(true);
    const record = { id: Date.now(), age: Number(age), systolic: Number(systolic), diastolic: Number(diastolic), bloodSugar: Number(bloodSugar), sugarTiming, createdAt: new Date().toISOString() };
    setPreviewRecord(record);
    if (profile && userId) {
      const { data, error } = await supabase.from('chronic_records').insert({ user_id: userId, age: record.age, systolic: record.systolic, diastolic: record.diastolic, blood_sugar: record.bloodSugar, sugar_timing: record.sugarTiming }).select('id,created_at').single();
      if (error) setChronicNote('저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
      else {
        setChronicHistory((current) => [{ ...record, id: data.id, createdAt: data.created_at }, ...current]);
        setChronicNote('내 기록에 저장했습니다.');
      }
    } else setChronicNote('결과를 확인했습니다. 비회원 입력값은 저장되지 않습니다.');
    setChronicLoading(false);
  }

  async function submitCheck() {
    if (answered !== questions.length) return;
    setScreen('result');
    if (profile && userId) {
      const { data, error } = await supabase.from('cognitive_records').insert({ user_id: userId, score, risk: risk.label, answers }).select('id,created_at').single();
      if (error) setSaveNote('저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
      else {
        setCognitiveHistory((current) => [{ id: data.id, score, risk: risk.label, createdAt: data.created_at }, ...current]);
        setSaveNote('내 기록에 저장했습니다.');
      }
    } else setSaveNote('비회원 결과는 저장되지 않습니다.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openAccount() {
    setScreen('account');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openPractice() {
    setPracticeMessage('');
    setScreen(profile ? 'practice' : 'account');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!privacyAgreed || !healthAgreed) return;
    setAuthWorking(true);
    setAuthMessage('');
    const address = [signupForm.address, addressDetail].filter(Boolean).join(' ');
    const { data, error } = await supabase.auth.signUp({
      email: signupForm.email,
      password: signupPassword,
      options: {
        emailRedirectTo: window.location.origin,
        data: { name: signupForm.name, birth_date: signupForm.birthDate, address, phone: signupForm.phone },
      },
    });
    if (error) setAuthMessage(error.message.includes('already') ? '이미 가입된 이메일입니다. 로그인해주세요.' : '가입하지 못했습니다. 입력 내용을 확인해주세요.');
    else if (!data.session) {
      setAuthMessage('인증 메일을 보냈습니다. 메일의 확인 버튼을 누른 뒤 로그인해주세요.');
      setScreen('login');
      setLoginEmail(signupForm.email);
    } else {
      setUserId(data.user?.id || null);
      if (data.user?.id) await loadMemberData(data.user.id);
      setScreen('account');
    }
    setAuthWorking(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthWorking(true);
    setAuthMessage('');
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error || !data.user) setAuthMessage('로그인 정보를 확인해주세요. 문제가 계속되면 관리자에게 문의해주세요.');
    else {
      setUserId(data.user.id);
      await loadMemberData(data.user.id);
      setScreen('account');
    }
    setAuthWorking(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    clearMemberData();
    goHome();
  }

  function openAddressSearch() {
    setAddressSearchError('');
    if (!addressSearchReady || !window.daum?.Postcode) {
      setAddressSearchError('주소검색을 준비 중입니다. 잠시 후 다시 눌러주세요.');
      return;
    }
    setAddressSearchOpen(true);
  }

  async function withdrawAccount() {
    setAuthWorking(true);
    const { error } = await supabase.rpc('delete_current_user');
    if (error) {
      setAuthMessage('탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해주세요.');
      setWithdrawConfirm(false);
      setAuthWorking(false);
      return;
    }
    await supabase.auth.signOut();
    clearMemberData();
    setSignupForm({ name: '', birthDate: '', address: '', phone: '', email: '' });
    setAddressDetail('');
    setPostcode('');
    setPrivacyAgreed(false);
    setHealthAgreed(false);
    setCognitiveHistory([]);
    setChronicHistory([]);
    setPracticeChecks({});
    setPracticeSaved(false);
    setWithdrawConfirm(false);
    setAuthWorking(false);
    goHome();
  }

  async function savePractice() {
    if (!userId) return;
    const { error } = await supabase.from('practice_records').upsert({ user_id: userId, practice_date: new Date().toISOString().slice(0, 10), checks: practiceChecks, completed_count: practiceCount }, { onConflict: 'user_id,practice_date' });
    if (error) {
      setPracticeSaved(false);
      setPracticeMessage('저장하지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    setPracticeSaved(true);
    setPracticeMessage(`오늘의 3·3·3 실천 ${practiceCount}/9를 저장했습니다.`);
    setRecordPeriod('day');
    setScreen('records');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const practiceCount = practiceItems.filter((item) => practiceChecks[item.id]).length;

  const swipeScreens: Screen[] = ['home', 'check', 'chronic', 'education'];
  const swipeIndex = screen === 'result' ? 1 : screen === 'report' ? 2 : screen === 'info' ? 3 : swipeScreens.indexOf(screen);
  const swipeEnabled = swipeIndex >= 0 && !addressSearchOpen && !withdrawConfirm;

  function openSwipeScreen(index: number) {
    if (index < 0 || index >= swipeScreens.length || index === swipeIndex) return;
    setSlideDirection(index > swipeIndex ? 'left' : 'right');
    const next = swipeScreens[index];
    if (next === 'home') goHome();
    else if (next === 'check') beginCheck();
    else if (next === 'chronic') openChronic();
    else openEducation();
  }

  function startSwipe(event: React.TouchEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    touchStart.current = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      interactive: Boolean(target.closest('input, textarea, select, button, a, [role="dialog"]')),
    };
  }

  function finishSwipe(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || start.interactive || !swipeEnabled) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    openSwipeScreen(swipeIndex + (dx < 0 ? 1 : -1));
  }

  const yearCognitive = cognitiveHistory
    .filter((item) => new Date(item.createdAt).getFullYear() === recordYear)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const yearChronic = chronicHistory
    .filter((item) => new Date(item.createdAt).getFullYear() === recordYear)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const monthlyVitals = Array.from({ length: 12 }, (_, month) => {
    const records = yearChronic.filter((item) => new Date(item.createdAt).getMonth() === month);
    const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    return { month, systolic: average(records.map((item) => item.systolic)), diastolic: average(records.map((item) => item.diastolic)), glucose: average(records.map((item) => item.bloodSugar)) };
  });
  const chartPoints = (values: Array<number | null>, min: number, max: number) => values
    .map((value, index) => value === null ? null : `${18 + index * 28},${92 - ((value - min) / (max - min)) * 70}`)
    .filter(Boolean).join(' ');
  const healthStory = [
    ...yearCognitive.map((item) => ({ date: item.createdAt, title: '인지건강 검사', detail: `${item.score}점 · ${item.risk}`, attention: item.score >= 7 })),
    ...yearChronic.map((item) => ({ date: item.createdAt, title: '혈압·혈당 기록', detail: `${item.systolic}/${item.diastolic} · 혈당 ${item.bloodSugar} mg/dL`, attention: item.systolic >= 140 || item.diastolic >= 90 || item.bloodSugar >= 200 })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);

  return (
    <main className="page-bg">
      <div className="app-shell">
        <header className="app-header">
          <button className="brand" type="button" onClick={goHome} aria-label="나의 건강관리 홈">
            <span className="brand-mark" aria-hidden="true">✚</span><span>나의 건강관리</span>
          </button>
          <button className="header-chip" type="button" onClick={openAccount}>{profile ? `${profile.name}님` : '로그인·가입'}</button>
        </header>

        <div
          className={`content screen-slide slide-${slideDirection}`}
          key={screen}
          onTouchStart={startSwipe}
          onTouchEnd={finishSwipe}
        >
          {screen === 'home' && (
            <>
              <section className="hero">
                <span className="hero-kicker">나의 건강을 쉽게 확인하세요</span>
                <h1>인지건강과 혈압·혈당을<br /><em>한곳에서 관리해요</em></h1>
                <p>원하는 메뉴를 눌러 바로 시작할 수 있습니다.</p>
                <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
              </section>

              {profile ? (
                <button className="member-summary" type="button" onClick={openAccount}>
                  <span><strong>{profile.name}님, 안녕하세요</strong><small>내 기록과 오늘의 실천을 확인하세요.</small></span><b>내 관리 ›</b>
                </button>
              ) : (
                <section className="guest-storage-note" aria-label="비회원 개인정보 안내">
                  <strong>기록을 모아보려면 로그인하세요.</strong>
                  <p>로그인한 회원의 기록만 안전하게 저장됩니다.</p>
                  <div className="guest-auth-actions"><button type="button" onClick={() => setScreen('login')}>로그인</button><button type="button" className="light" onClick={() => setScreen('signup')}>회원가입</button></div>
                </section>
              )}

              <div className="section-heading">
                <div><h2>무엇을 확인할까요?</h2></div><span>메뉴를 눌러주세요</span>
              </div>
              <section className="menu-list" aria-label="건강관리 메뉴">
                <button className="menu-card cognitive" type="button" onClick={beginCheck}>
                  <span className="menu-icon">✓</span><span className="menu-copy"><strong>인지건강 체크</strong><small>16문항 자가체크</small></span><span className="menu-arrow">›</span>
                </button>
                <button className="menu-card chronic" type="button" onClick={openChronic}>
                  <span className="menu-icon">♥</span><span className="menu-copy"><strong>혈압·혈당 확인</strong><small>측정 수치 확인</small></span><span className="menu-arrow">›</span>
                </button>
                <button className="menu-card education" type="button" onClick={openEducation}>
                  <span className="menu-icon">i</span><span className="menu-copy"><strong>치매교육</strong><small>예방수칙과 최신 소식</small></span><span className="menu-arrow">›</span>
                </button>
                <button className="menu-card practice" type="button" onClick={openPractice}>
                  <span className="menu-icon">3</span><span className="menu-copy"><strong>오늘의 작은 실천</strong><small>치매예방 3·3·3 확인</small></span><span className="menu-arrow">›</span>
                </button>
              </section>
              <p className="medical-note">이 서비스는 의학적 진단을 대신하지 않습니다. 걱정되는 변화가 있다면 치매안심센터나 의료기관에 상담해주세요.</p>
            </>
          )}

          {screen === 'check' && (
            <section className="check-view">
              <button className="text-back" type="button" onClick={goHome}>← 홈으로</button>
              <span className="eyebrow">COGNITIVE CARE</span><h1>인지건강 자가체크</h1><p className="lead">최근 6개월의 변화를 떠올리며 모든 문항에 답해주세요.</p>
              <div className="progress-card"><div><span>응답 진행률</span><strong>{answered} / {questions.length}</strong></div><div className="progress-track"><span style={{ width: `${answered / questions.length * 100}%` }} /></div></div>
              {groups.map((group, groupIndex) => (
                <section className="question-group" key={group}>
                  <h2><span>{String(groupIndex + 1).padStart(2, '0')}</span>{group}</h2>
                  {questions.filter((q) => q.group === group).map((q, index) => (
                    <article className="question-card" key={q.id}>
                      <p><span>{index + 1}</span>{q.text}</p>
                      <div className="answer-grid">
                        <button className={answers[q.id] === false ? 'selected' : ''} type="button" onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: false }))}>아니다</button>
                        <button className={answers[q.id] === true ? 'selected' : ''} type="button" onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: true }))}>그렇다</button>
                      </div>
                    </article>
                  ))}
                </section>
              ))}
              <button className="primary-btn submit-btn" type="button" disabled={answered !== questions.length} onClick={submitCheck}>{answered === questions.length ? '결과 확인하기' : `${questions.length - answered}문항 더 답해주세요`}</button>
            </section>
          )}

          {screen === 'result' && (
            <section className="result-view">
              <span className={`risk-badge ${risk.key}`}>{risk.label}</span><p className="result-kicker">나의 인지건강 체크 결과</p><div className="score"><strong>{score}</strong><span>점</span></div>
              <p className="save-note" aria-live="polite">{saveNote}</p>
              <div className={`result-message ${risk.key}`}><strong>이번 결과 안내</strong><p>{risk.copy}</p></div>
              <section className="result-actions"><h2>다음 건강관리</h2><button type="button" onClick={openChronic}>만성질환 관리 <span>확인하기</span></button><button type="button" onClick={openEducation}>예방교육 <span>학습하기</span></button></section>
              <p className="medical-note">이 결과는 자가 스크리닝 참고용이며 의학적 진단이 아닙니다. 증상이 걱정되면 의료기관에서 정확한 평가를 받아보세요.</p>
              <button className="secondary-btn" type="button" onClick={() => { setAnswers({}); beginCheck(); }}>다시 체크하기</button><button className="text-back centered" type="button" onClick={goHome}>홈으로 돌아가기</button>
            </section>
          )}

          {screen === 'chronic' && (
            <section className="chronic-view">
              <button className="text-back" type="button" onClick={goHome}>← 홈으로</button>
              <span className="eyebrow">CHRONIC CARE</span>
              <h1>혈압·혈당 관리</h1>
              <p className="lead">나이와 측정 수치를 입력해 결과를 확인하세요.</p>

              <form className="health-form" onSubmit={saveChronicRecord}>
                <div className="form-section-title"><span>01</span><strong>기본 정보</strong></div>
                <label className="field full-field"><span>나이</span><div><input inputMode="numeric" type="number" min="1" max="120" value={age} onChange={(event) => setAge(event.target.value)} placeholder="예: 67" required /><em>세</em></div></label>
                <div className="form-section-title"><span>02</span><strong>혈압</strong></div>
                <div className="field-grid">
                  <label className="field"><span>수축기 혈압</span><div><input inputMode="numeric" type="number" min="60" max="260" value={systolic} onChange={(event) => setSystolic(event.target.value)} placeholder="120" required /><em>mmHg</em></div></label>
                  <label className="field"><span>이완기 혈압</span><div><input inputMode="numeric" type="number" min="40" max="160" value={diastolic} onChange={(event) => setDiastolic(event.target.value)} placeholder="80" required /><em>mmHg</em></div></label>
                </div>
                <div className="form-section-title"><span>03</span><strong>혈당</strong></div>
                <div className="field-grid sugar-grid">
                  <label className="field"><span>혈당 수치</span><div><input inputMode="numeric" type="number" min="30" max="600" value={bloodSugar} onChange={(event) => setBloodSugar(event.target.value)} placeholder="100" required /><em>mg/dL</em></div></label>
                  <label className="field"><span>측정 시점</span><select value={sugarTiming} onChange={(event) => setSugarTiming(event.target.value as typeof sugarTiming)}><option value="fasting">공복</option><option value="after_meal">식후 2시간</option><option value="random">기타</option></select></label>
                </div>
                <button className="primary-btn" type="submit" disabled={chronicLoading}>{chronicLoading ? '확인 중…' : '수치 확인하기'}</button>
                <p className="save-note" aria-live="polite">{chronicNote}</p>
              </form>

              {chronicAssessment && (
                <section className={`health-assessment ${chronicAssessment.key}`} aria-live="polite">
                  <span className="assessment-badge">건강 수치 확인</span>
                  <h2>{chronicAssessment.title}</h2>
                  <p>{chronicAssessment.copy}</p>
                  <div className="assessment-grid">
                    <div><span>혈압</span><strong>{chronicAssessment.bloodPressure}</strong></div>
                    <div><span>혈당</span><strong>{chronicAssessment.glucose}</strong></div>
                  </div>
                  <small>나이 {previewRecord?.age}세 · {profile ? '이 세션의 내 기록에 표시됩니다.' : '이 결과와 입력값은 저장되지 않습니다.'}</small>
                  <button className="report-open-btn" type="button" onClick={openMedicalReport}>담당 의사에게 보여줄 보고서 →</button>
                </section>
              )}

              <section className="record-section">
                <div className="record-heading"><div><span className="eyebrow">MY RECORDS</span><h2>내 기록</h2></div></div>
                {profile ? (
                  <div className="locked-record">
                    <strong>이번 기록을 내 기록에 추가했습니다.</strong>
                    <p>내 건강 기록에서 이번 결과를 확인할 수 있습니다.</p>
                    <button type="button" onClick={() => setScreen('records')}>내 건강 기록 보기</button>
                  </div>
                ) : (
                  <div className="locked-record">
                    <strong>로그인 전에는 기록을 저장하지 않습니다.</strong>
                    <p>회원가입 후 입력하면 내 건강 기록에서 확인할 수 있습니다.</p>
                  </div>
                )}
              </section>
              <p className="medical-note">이 안내는 자가관리 참고용이며 진단 결과가 아닙니다. 혈압·혈당은 측정 조건과 개인 치료 목표에 따라 달라질 수 있습니다. 매우 높거나 낮은 수치, 어지럼·흉통·호흡곤란 등 불편한 증상이 있으면 의료기관에 상담해주세요.</p>
            </section>
          )}

          {screen === 'report' && previewRecord && chronicAssessment && (
            <section className="report-view">
              <button className="text-back" type="button" onClick={() => setScreen('chronic')}>← 만성질환 관리로</button>
              <article className="report-sheet">
                <header className="report-header">
                  <div><span>MY HEALTH CARE</span><h1>건강 수치 진료 보고서</h1><p>담당 의사에게 보여드리는 혈압·혈당 자가측정 기록</p></div>
                  <div className="report-mark">✚</div>
                </header>

                <section className="report-meta">
                  <div><span>대상자 나이</span><strong>{previewRecord.age}세</strong></div>
                  <div><span>측정일</span><strong>{new Date(previewRecord.createdAt).toLocaleDateString('ko-KR')}</strong></div>
                  <div><span>보고서 생성일</span><strong>{new Date().toLocaleDateString('ko-KR')}</strong></div>
                </section>

                <section className={`report-summary ${chronicAssessment.key}`}>
                  <span>종합 확인</span><h2>{chronicAssessment.title}</h2><p>{chronicAssessment.copy}</p>
                </section>

                <section className="latest-vitals">
                  <div><span>입력 혈압</span><strong>{previewRecord.systolic}<em>/</em>{previewRecord.diastolic}</strong><small>mmHg · {chronicAssessment.bloodPressure}</small></div>
                  <div><span>{previewRecord.sugarTiming === 'fasting' ? '공복 혈당' : previewRecord.sugarTiming === 'after_meal' ? '식후 2시간 혈당' : '무작위 혈당'}</span><strong>{previewRecord.bloodSugar}</strong><small>mg/dL · {chronicAssessment.glucose}</small></div>
                </section>

                <section className="report-section">
                  <h2>현재 입력값</h2>
                  <table><thead><tr><th>측정일</th><th>나이</th><th>혈압(mmHg)</th><th>혈당(mg/dL)</th><th>시점</th></tr></thead><tbody>
                    <tr><td>{new Date(previewRecord.createdAt).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' })}</td><td>{previewRecord.age}세</td><td>{previewRecord.systolic}/{previewRecord.diastolic}</td><td>{previewRecord.bloodSugar}</td><td>{previewRecord.sugarTiming === 'fasting' ? '공복' : previewRecord.sugarTiming === 'after_meal' ? '식후 2시간' : '무작위'}</td></tr>
                  </tbody></table>
                  <p className="save-note">비회원 입력값으로 만든 일회성 화면이며 서버나 브라우저에 저장되지 않습니다.</p>
                </section>

                <section className="report-section criteria-section">
                  <h2>앱에 적용한 확인 기준</h2>
                  <div className="criteria-grid"><div><strong>혈압</strong><p>130/80 이상 주의 관찰<br />140/90 이상 높은 범위<br />90/60 미만 낮은 범위</p></div><div><strong>혈당</strong><p>공복 100~125 주의, 126 이상 높음<br />식후 2시간 140~199 주의, 200 이상 높음<br />70 미만 낮은 범위</p></div></div>
                </section>

                <footer className="report-footer">
                  <p><strong>보고서 이용 안내:</strong> 본 자료는 사용자가 가정에서 입력한 자가측정 기록으로 진단서가 아닙니다. 진료 시 담당 의사에게 보여드리고 측정 방법, 복용약, 기저질환과 개인별 치료 목표를 함께 확인해주세요.</p>
                  <p>기준 출처: 대한고혈압학회 2022 고혈압 진료지침 · 대한당뇨병학회 당뇨병 진단기준 · NIH 저혈압 안내 · CDC 저혈당 안내</p>
                </footer>
              </article>
              <button className="secondary-btn report-back-btn" type="button" onClick={() => setScreen('chronic')}>기록 화면으로 돌아가기</button>
            </section>
          )}

          {screen === 'education' && (
            <section className="education-view">
              <button className="text-back" type="button" onClick={goHome}>← 홈으로</button>
              <span className="eyebrow">PREVENTION EDUCATION</span>
              <h1>치매교육</h1>
              <div className="info-tabs" aria-label="치매교육 메뉴">
                <button className="active" type="button">예방수칙</button>
                <button type="button" onClick={openDementiaInfo}>치매정보·행사</button>
              </div>
              <h2 className="education-title">치매예방수칙 3·3·3</h2>
              <p className="lead">즐기고, 줄이고, 챙기는 생활수칙입니다.</p>

              <section className="education-intro"><span>첫 번째 교육</span><strong>매일 실천하는 치매예방 생활수칙</strong><p>오늘 할 수 있는 한 가지부터 시작하세요.</p></section>

              <div className="education-groups">
                <section className="education-group enjoy"><header><span>3권</span><div><strong>즐길 것</strong><small>몸과 뇌를 자주 사용해요</small></div></header><ol><li><b>걷기</b><p>일주일에 세 번 이상 걷고 가까운 거리는 생활 속에서 움직여보세요.</p></li><li><b>건강한 식사</b><p>생선과 채소를 골고루 먹고 기름지고 짠 음식은 줄여보세요.</p></li><li><b>읽고 쓰기</b><p>책이나 신문을 읽고 짧은 메모나 일기를 꾸준히 써보세요.</p></li></ol></section>
                <section className="education-group avoid"><header><span>3금</span><div><strong>참을 것</strong><small>뇌 건강을 해치는 위험을 줄여요</small></div></header><ol><li><b>과음 줄이기</b><p>한 번에 술 세 잔을 넘기지 말고 다른 사람에게도 권하지 마세요.</p></li><li><b>금연하기</b><p>담배는 시작하지 않고, 피우고 있다면 금연 도움을 받아 끊어보세요.</p></li><li><b>머리 보호하기</b><p>운동할 때 보호장구를 착용하고 머리를 다쳤다면 검사를 받아보세요.</p></li></ol></section>
                <section className="education-group care"><header><span>3행</span><div><strong>챙길 것</strong><small>검진과 관계를 꾸준히 이어가요</small></div></header><ol><li><b>건강수치 확인</b><p>혈압·혈당·콜레스테롤을 정기적으로 확인하고 관리하세요.</p></li><li><b>사람과 소통하기</b><p>가족과 친구를 자주 만나고 단체활동이나 여가생활에 참여하세요.</p></li><li><b>조기검진 받기</b><p>매년 가까운 보건소나 치매안심센터에서 조기검진을 받아보세요.</p></li></ol></section>
              </div>

              <button className="education-action" type="button" onClick={openPractice}><strong>오늘의 작은 실천</strong><p>3·3·3 실천 현황 확인하기 ›</p></button>
              <a className="source-link" href="https://www.nid.or.kr/notification/prevention.aspx" target="_blank" rel="noreferrer">원문 보기 · 중앙치매센터 치매예방수칙 3·3·3 ↗</a>
              <p className="medical-note">교육 내용은 일반적인 예방 정보입니다. 건강 상태나 치료 중인 질환에 따른 개인별 조언은 의료진과 상담해주세요.</p>
            </section>
          )}

          {screen === 'info' && (
            <section className="education-view info-view">
              <button className="text-back" type="button" onClick={goHome}>← 홈으로</button>
              <span className="eyebrow">DEMENTIA INFORMATION</span>
              <h1>치매정보</h1>
              <div className="info-tabs" aria-label="치매교육 메뉴">
                <button type="button" onClick={openEducation}>예방수칙</button>
                <button className="active" type="button">치매정보·행사</button>
              </div>
              <p className="lead">치매자료와 예방행사 소식을 확인하세요.</p>

              <section className="community-hero">
                <span>함께하는 건강관리</span>
                <h2>알아보고, 만나고,<br />함께 예방해요</h2>
                <p>자료와 행사 소식은 누구나 볼 수 있습니다.</p>
              </section>

              <div className="community-shortcuts" aria-label="치매정보와 행사 안내">
                <div><span>자료</span><strong>최신 치매정보</strong><small>RSS 자동 업데이트</small></div>
                <div><span>행사</span><strong>의료사협 행사</strong><small>강좌·캠페인 일정</small></div>
                <div><span>모임</span><strong>건강 소모임</strong><small>걷기·인지활동 모임</small></div>
              </div>

              <section className="organization-preview" aria-labelledby="organization-home-title">
                <header><span>가상 홈페이지 · 검토용 시안</span><h2 id="organization-home-title">내손에 치매안심</h2><p>인지건강 체크부터 예방 프로그램, 우리동네 안심지도까지 한곳에서 안내합니다.</p></header>
                <div>
                  <article><b>인지건강 체크·훈련</b><span>자가검진과 두뇌 활동으로 꾸준히 관리해요.</span></article>
                  <article><b>치매예방·만성질환 관리</b><span>고혈압과 당뇨 관리로 치매 위험도 함께 낮춰요.</span></article>
                  <article><b>안심지도·프로그램·커뮤니티</b><span>가까운 기관과 요일별 프로그램, 이웃 활동을 확인해요.</span></article>
                </div>
                <p className="organization-preview-note">홈페이지에 표시된 일정·주소·연락처는 현재 예시 자료입니다.</p>
                <a className="organization-home-link" href="https://claude.ai/code/artifact/48a636fa-6105-4804-ad69-0ef9d7e525f8" target="_blank" rel="noopener noreferrer">내손에 치매안심 바로가기 <b>→</b></a>
              </section>

              <section className="rss-section">
                <div className="rss-heading"><div><span className="eyebrow">LATEST NEWS</span><h2>최신 치매정보</h2></div><span className="rss-badge">RSS 자동 업데이트</span></div>
                {rssState === 'loading' && <div className="rss-status">최신 소식을 불러오고 있어요…</div>}
                {rssState === 'error' && <div className="rss-status">최신 소식을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</div>}
                {rssState === 'empty' && (
                  <div className="rss-status ready"><strong>RSS 연결 준비가 완료되었습니다.</strong><span>운영할 RSS 주소를 연결하면 최신 글이 이곳에 자동으로 표시됩니다.</span></div>
                )}
                {rssItems.length > 0 && <div className="rss-list">{rssItems.map((item, index) => (
                  <a className="rss-card" href={item.link} target="_blank" rel="noreferrer" key={`${item.link}-${index}`}>
                    <span className={`rss-category ${item.category}`}>{item.category === 'education' ? '교육' : item.category === 'event' ? '행사' : item.category === 'meeting' ? '모임' : '정보'}</span>
                    <strong>{item.title}</strong>
                    {item.description && <p>{item.description}</p>}
                    <small>{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('ko-KR') : '치매정보'} <b>자세히 보기 →</b></small>
                  </a>
                ))}</div>}
              </section>

              <section className="coming-events">
                <div className="rss-heading"><div><span className="eyebrow">PROGRAM</span><h2>의료사협 참여 프로그램</h2></div></div>
                <article><span className="program-icon">걷기</span><div><small>건강 소모임</small><strong>함께 걷는 치매예방 모임</strong><p>일정과 장소는 RSS 소식으로 안내됩니다.</p></div><button type="button" disabled>신청 준비 중</button></article>
                <article><span className="program-icon lecture">행사</span><div><small>예방 행사</small><strong>의료사협 치매예방 캠페인</strong><p>새 행사 일정이 등록되면 이곳에서 확인할 수 있습니다.</p></div><button type="button" disabled>신청 준비 중</button></article>
              </section>
            </section>
          )}

          {screen === 'account' && (
            <section className="account-view">
              <button className="text-back" type="button" onClick={goHome}>← 홈으로</button>
              {!profile ? (
                <>
                  <h1>로그인·회원가입</h1>
                  <p className="lead">가입 후 건강 기록을 날짜별로 모아볼 수 있습니다.</p>
                  {authLoading && <p className="auth-message">로그인 상태를 확인하고 있습니다…</p>}
                  <button className="primary-btn" type="button" onClick={() => { setAuthMessage(''); setScreen('login'); }}>로그인</button>
                  <button className="primary-btn" type="button" onClick={() => setScreen('signup')}>회원가입하기</button>
                </>
              ) : (
                <>
                  <div className="profile-card"><span>회원</span><h1>{profile.name}님</h1><p>{profile.email}</p><small>내 건강 기록을 확인하세요.</small></div>
                  <div className="account-actions">
                    <button type="button" onClick={() => setScreen('records')}><span>▤</span><strong>내 건강 기록</strong><small>인지·혈압·혈당 기록 보기</small><b>›</b></button>
                    <button type="button" onClick={() => setScreen('practice')}><span>✓</span><strong>오늘의 작은 실천</strong><small>3·3·3 실천 {practiceCount}/9</small><b>›</b></button>
                    {isAdmin && <button className="admin-entry" type="button" onClick={openAdmin}><span>관</span><strong>건강관리 관리자</strong><small>회원별 관리 우선순위 보기</small><b>›</b></button>}
                  </div>
                  <section className="profile-info"><h2>가입정보</h2><p><b>생년월일</b>{profile.birthDate}</p><p><b>연락처</b>{profile.phone}</p><p><b>주소</b>{profile.address}</p></section>
                  <button className="secondary-btn" type="button" onClick={logout}>로그아웃</button>
                  <button className="withdraw-btn" type="button" onClick={() => setWithdrawConfirm(true)}>회원탈퇴</button>
                </>
              )}
            </section>
          )}

          {screen === 'login' && (
            <section className="account-view signup-view">
              <button className="text-back" type="button" onClick={openAccount}>← 계정 메뉴로</button>
              <h1>로그인</h1>
              <p className="lead">가입한 이메일과 비밀번호를 입력해주세요.</p>
              <form className="signup-form" onSubmit={submitLogin}>
                <label><span>이메일</span><input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} autoComplete="email" required /></label>
                <label><span>비밀번호</span><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" minLength={8} required /></label>
                {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
                <button className="primary-btn" type="submit" disabled={authWorking}>{authWorking ? '로그인 중…' : '로그인'}</button>
                <button className="text-back" type="button" onClick={resetPassword} disabled={authWorking}>비밀번호 재설정</button>
                <button className="secondary-btn" type="button" onClick={() => { setAuthMessage(''); setScreen('signup'); }}>처음 이용하시나요? 회원가입</button>
              </form>
            </section>
          )}

          {screen === 'signup' && (
            <section className="account-view signup-view">
              <button className="text-back" type="button" onClick={openAccount}>← 로그인 화면으로</button>
              <h1>회원가입</h1>
              <p className="lead">회원정보와 동의 내용을 확인해주세요.</p>
              <form className="signup-form" onSubmit={submitSignup}>
                <label><span>이름</span><input value={signupForm.name} onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })} autoComplete="name" required /></label>
                <label><span>생년월일</span><input type="date" value={signupForm.birthDate} onChange={(e) => setSignupForm({ ...signupForm, birthDate: e.target.value })} required /></label>
                <label className="address-field"><span>주소</span><div className="address-lookup-row"><input value={signupForm.address} readOnly autoComplete="street-address" placeholder="주소 찾기를 눌러주세요" required /><button type="button" onClick={openAddressSearch}>주소 찾기</button></div>{postcode && <small>우편번호 {postcode}</small>}{addressSearchError && <small className="address-error" role="alert">{addressSearchError}</small>}</label>
                <label><span>상세주소</span><input value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} autoComplete="address-line2" placeholder="동·호수 등 나머지 주소" /></label>
                <label><span>연락처</span><input type="tel" value={signupForm.phone} onChange={(e) => setSignupForm({ ...signupForm, phone: e.target.value })} autoComplete="tel" placeholder="010-0000-0000" required /></label>
                <label><span>이메일</span><input type="email" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} autoComplete="email" required /></label>
                <label><span>비밀번호</span><input type="password" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} autoComplete="new-password" minLength={8} placeholder="8자 이상" required /></label>
                <div className="consent-box">
                  <label><input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} /><span><strong>[필수] 개인정보 수집·이용 동의</strong><small>회원관리 목적으로 이름, 생년월일, 주소, 연락처, 이메일을 이용합니다.</small></span></label>
                  <label><input type="checkbox" checked={healthAgreed} onChange={(e) => setHealthAgreed(e.target.checked)} /><span><strong>[필수] 건강정보 수집·이용 동의</strong><small>인지점수, 혈압, 혈당, 3·3·3 실천기록을 이용합니다.</small></span></label>
                </div>
                {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
                <button className="primary-btn" type="submit" disabled={!privacyAgreed || !healthAgreed || authWorking}>{authWorking ? '가입 처리 중…' : '동의하고 가입'}</button>
              </form>
            </section>
          )}

          {screen === 'records' && profile && (
            <section className="account-view records-view">
              <button className="text-back" type="button" onClick={openAccount}>← 내 관리로</button>
              <h1>내 건강 기록</h1>
              {practiceMessage && <p className="practice-save-notice" role="status">✓ {practiceMessage}</p>}
              <div className="period-tabs" aria-label="기록 기간"><button className={recordPeriod === 'day' ? 'active' : ''} onClick={() => setRecordPeriod('day')}>일별</button><button className={recordPeriod === 'month' ? 'active' : ''} onClick={() => setRecordPeriod('month')}>월별</button><button className={recordPeriod === 'year' ? 'active' : ''} onClick={() => setRecordPeriod('year')}>연별</button></div>
              {recordPeriod !== 'year' ? <>
                <p className="prototype-line">{recordPeriod === 'day' ? '오늘 기록' : '이번 달 기록'}</p>
                <section className="record-summary-grid"><div><span>인지검사</span><strong>{cognitiveHistory.length}</strong><small>회</small></div><div><span>혈압·혈당</span><strong>{chronicHistory.length}</strong><small>회</small></div><div><span>3·3·3 실천</span><strong>{practiceSaved ? practiceCount : 0}</strong><small>/ 9</small></div></section>
                <section className="session-record-list"><h2>인지건강</h2>{cognitiveHistory.length ? cognitiveHistory.map((item) => <article key={item.id}><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span><strong>{item.score}점</strong><small>{item.risk}</small></article>) : <p>아직 검사 기록이 없습니다.</p>}</section>
                <section className="session-record-list"><h2>혈압·혈당</h2>{chronicHistory.length ? chronicHistory.map((item) => <article key={item.id}><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span><strong>{item.systolic}/{item.diastolic}</strong><small>혈당 {item.bloodSugar} mg/dL</small></article>) : <p>아직 측정 기록이 없습니다.</p>}</section>
              </> : <>
                <div className="year-picker"><button type="button" onClick={() => setRecordYear((year) => year - 1)} aria-label="이전 연도">‹</button><strong>{recordYear}년 건강 리포트</strong><button type="button" onClick={() => setRecordYear((year) => year + 1)} aria-label="다음 연도">›</button></div>
                <section className="record-summary-grid annual-summary"><div><span>인지검사</span><strong>{yearCognitive.length}</strong><small>회</small></div><div><span>혈압·혈당</span><strong>{yearChronic.length}</strong><small>회</small></div><div><span>최근 인지점수</span><strong>{yearCognitive.at(-1)?.score ?? '—'}</strong><small>{yearCognitive.length ? '점' : ''}</small></div></section>
                <section className="annual-chart-card"><h2>인지건강 변화</h2><p>점수가 낮을수록 위험 신호가 적습니다.</p>{yearCognitive.length ? <svg viewBox="0 0 360 125" role="img" aria-label={`${recordYear}년 인지건강 점수 변화`}><line x1="18" y1="22" x2="326" y2="22"/><line x1="18" y1="57" x2="326" y2="57"/><line x1="18" y1="92" x2="326" y2="92"/><polyline className="cognitive-line" points={yearCognitive.map((item, index) => `${18 + (yearCognitive.length === 1 ? 154 : index * 308 / (yearCognitive.length - 1))},${92 - Math.min(item.score, 20) / 20 * 70}`).join(' ')} />{yearCognitive.map((item, index) => <circle key={item.id} cx={18 + (yearCognitive.length === 1 ? 154 : index * 308 / (yearCognitive.length - 1))} cy={92 - Math.min(item.score, 20) / 20 * 70} r="5"><title>{new Date(item.createdAt).toLocaleDateString('ko-KR')} · {item.score}점</title></circle>)}<text x="8" y="116">1월</text><text x="302" y="116">12월</text></svg> : <div className="chart-empty">이 연도의 인지검사 기록이 없습니다.</div>}</section>
                <section className="annual-chart-card"><h2>월평균 혈압</h2><p><span className="legend sys" />수축기 <span className="legend dia" />이완기</p>{yearChronic.length ? <svg viewBox="0 0 360 125" role="img" aria-label={`${recordYear}년 월평균 혈압 변화`}><line x1="18" y1="22" x2="326" y2="22"/><line x1="18" y1="57" x2="326" y2="57"/><line x1="18" y1="92" x2="326" y2="92"/><polyline className="systolic-line" points={chartPoints(monthlyVitals.map((item) => item.systolic), 40, 200)} /><polyline className="diastolic-line" points={chartPoints(monthlyVitals.map((item) => item.diastolic), 40, 200)} /><text x="8" y="116">1월</text><text x="302" y="116">12월</text></svg> : <div className="chart-empty">이 연도의 혈압 기록이 없습니다.</div>}</section>
                <section className="annual-chart-card"><h2>월평균 혈당</h2><p>입력한 혈당 기록의 월별 평균입니다.</p>{yearChronic.length ? <svg viewBox="0 0 360 125" role="img" aria-label={`${recordYear}년 월평균 혈당 변화`}><line x1="18" y1="22" x2="326" y2="22"/><line x1="18" y1="57" x2="326" y2="57"/><line x1="18" y1="92" x2="326" y2="92"/><polyline className="glucose-line" points={chartPoints(monthlyVitals.map((item) => item.glucose), 40, 300)} /><text x="8" y="116">1월</text><text x="302" y="116">12월</text></svg> : <div className="chart-empty">이 연도의 혈당 기록이 없습니다.</div>}</section>
                <section className="health-story"><h2>올해의 건강 이야기</h2><p>기록한 순서대로 중요한 변화를 모았습니다.</p>{healthStory.length ? <div className="story-timeline">{healthStory.map((item, index) => <article className={item.attention ? 'attention' : ''} key={`${item.date}-${index}`}><time>{new Date(item.date).toLocaleDateString('ko-KR')}</time><strong>{item.title}</strong><span>{item.detail}</span></article>)}</div> : <div className="chart-empty">기록이 쌓이면 올해의 건강 이야기가 표시됩니다.</div>}</section>
              </>}
            </section>
          )}

          {screen === 'practice' && profile && (
            <section className="account-view practice-view">
              <button className="text-back" type="button" onClick={openAccount}>← 내 관리로</button>
              <div className="practice-score"><span>오늘의 실천</span><strong>{practiceCount}<small>/9</small></strong><p>{practiceCount === 9 ? '오늘 3·3·3을 모두 실천했어요!' : '실천한 항목을 눌러주세요.'}</p></div>
              {['3권', '3금', '3행'].map((group) => <section className="practice-group" key={group}><h2>{group}</h2>{practiceItems.filter((item) => item.group === group).map((item) => <button type="button" className={practiceChecks[item.id] ? 'checked' : ''} key={item.id} onClick={() => { setPracticeChecks((current) => ({ ...current, [item.id]: !current[item.id] })); setPracticeSaved(false); setPracticeMessage(''); }}><span>{practiceChecks[item.id] ? '✓' : ''}</span>{item.label}</button>)}</section>)}
              <button className="primary-btn" type="button" onClick={savePractice}>오늘 실천 저장</button>
              {practiceMessage && <p className="practice-confirm" role="status">{practiceMessage}</p>}
            </section>
          )}

          {screen === 'admin' && isAdmin && (
            <section className="account-view admin-view">
              <button className="text-back" type="button" onClick={openAccount}>← 내 관리로</button>
              <div className="admin-heading"><span>운영자 전용</span><h1>건강관리 대시보드</h1><p>회원별 최신 기록을 묶어 연락 우선순위를 확인합니다.</p></div>
              <p className="admin-medical-note">자가입력 자료를 이용한 관리 우선순위 안내이며 의료 진단이나 응급 판정이 아닙니다.</p>
              <section className="admin-priority-summary">
                <button className="immediate" onClick={() => { setAdminTab('dashboard'); setAdminFilter('immediate'); }}><span>즉시 확인</span><strong>{priorityCounts.immediate}</strong><small>재측정·연락</small></button>
                <button className="focus" onClick={() => { setAdminTab('dashboard'); setAdminFilter('focus'); }}><span>집중관리</span><strong>{priorityCounts.focus}</strong><small>상담 확인</small></button>
                <button className="watch" onClick={() => { setAdminTab('dashboard'); setAdminFilter('watch'); }}><span>경과관찰</span><strong>{priorityCounts.watch}</strong><small>변화 살피기</small></button>
                <button onClick={() => { setAdminTab('dashboard'); setAdminFilter('all'); }}><span>전체 회원</span><strong>{adminCounts.members}</strong><small>명</small></button>
              </section>
              <div className="admin-tabs" aria-label="관리자 화면 구분">{([['dashboard','우선순위'],['members','회원'],['cognitive','인지'],['chronic','혈압·혈당'],['practice','실천']] as [AdminTab,string][]).map(([key,label]) => <button key={key} className={adminTab === key ? 'active' : ''} onClick={() => setAdminTab(key)}>{label}</button>)}</div>
              {adminTab === 'dashboard' && <div className="admin-dashboard">
                <div className="admin-filters" aria-label="관리 우선순위 필터">{([['all','전체'],['immediate','즉시 확인'],['focus','집중관리'],['watch','경과관찰'],['stale','최근 기록 없음']] as [AdminFilter,string][]).map(([key,label]) => <button key={key} className={adminFilter === key ? 'active' : ''} onClick={() => setAdminFilter(key)}>{label}{key === 'stale' ? ` ${priorityCounts.stale}` : ''}</button>)}</div>
                {!adminLoading && !adminMessage && <div className="priority-list">{visiblePriorityMembers.length ? visiblePriorityMembers.map((member) => <article className={`priority-card ${member.priority}`} key={member.id}><div className="priority-card-head"><span>{member.priority === 'immediate' ? '즉시 확인' : member.priority === 'focus' ? '집중관리' : member.priority === 'watch' ? '경과관찰' : '최근 기록 없음'}</span><time>{member.measuredAt ? `최근 측정 ${new Date(member.measuredAt).toLocaleDateString('ko-KR')}` : '측정 기록 없음'}</time></div><h2>{member.name || '이름 미입력'}</h2><p>{member.phone || member.email || '연락처 미입력'}</p><div className="member-health-sections"><section><h3>인지건강</h3><strong>{member.cognitive_score === null ? '기록 없음' : `${member.cognitive_score}점`}</strong><span>{member.cognitive_risk || '분류 정보 없음'}</span><time>{member.cognitive_at ? new Date(member.cognitive_at).toLocaleDateString('ko-KR') : '측정일 없음'}</time></section><section><h3>만성질환</h3><strong>{member.systolic === null ? '혈압 기록 없음' : `혈압 ${member.systolic}/${member.diastolic}`}</strong><span>{member.blood_sugar === null ? '혈당 기록 없음' : `혈당 ${member.blood_sugar} mg/dL · ${member.sugar_timing === 'fasting' ? '공복' : member.sugar_timing === 'after_meal' ? '식후 2시간' : '무작위'}`}</span><time>{member.chronic_at ? new Date(member.chronic_at).toLocaleDateString('ko-KR') : '측정일 없음'}</time></section></div><strong className="priority-reason">{member.reason}</strong></article>) : <p className="admin-empty">해당하는 회원이 없습니다.</p>}</div>}
              </div>}
              {adminLoading && <p className="admin-status">자료를 불러오고 있습니다…</p>}
              {adminMessage && <p className="admin-status error">{adminMessage}</p>}
              {!adminLoading && !adminMessage && adminTab !== 'dashboard' && <div className="admin-list">
                {adminTab === 'members' && (adminProfiles.length ? adminProfiles.map((member) => <article key={member.id}><time>{new Date(member.created_at).toLocaleDateString('ko-KR')}</time><strong>{member.name || '이름 미입력'}</strong><span>{member.email}</span><small>{member.phone || '연락처 미입력'} · {member.birth_date || '생년월일 미입력'}</small></article>) : <p>가입한 회원이 없습니다.</p>)}
                {adminTab === 'cognitive' && (adminCognitive.length ? adminCognitive.map((item) => <article key={item.id}><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time><strong>{adminMember(item.user_id)?.name || '회원'} · {item.score}점</strong><span>{adminMember(item.user_id)?.email || item.user_id}</span><small>{item.risk}</small></article>) : <p>인지검사 기록이 없습니다.</p>)}
                {adminTab === 'chronic' && (adminChronic.length ? adminChronic.map((item) => <article key={item.id}><time>{new Date(item.created_at).toLocaleString('ko-KR')}</time><strong>{adminMember(item.user_id)?.name || '회원'} · {item.systolic}/{item.diastolic}</strong><span>{adminMember(item.user_id)?.email || item.user_id}</span><small>혈당 {item.blood_sugar}mg/dL</small></article>) : <p>혈압·혈당 기록이 없습니다.</p>)}
                {adminTab === 'practice' && (adminPractice.length ? adminPractice.map((item) => <article key={item.id}><time>{new Date(item.practice_date).toLocaleDateString('ko-KR')}</time><strong>{adminMember(item.user_id)?.name || '회원'} · {item.completed_count}/9</strong><span>{adminMember(item.user_id)?.email || item.user_id}</span><small>오늘의 작은 실천</small></article>) : <p>실천 기록이 없습니다.</p>)}
              </div>}
              {adminTab !== 'dashboard' && <p className="admin-limit-note">전체 건수는 요약에 정확히 표시하며, 원자료 목록은 종류별 최근 500건까지 보여줍니다.</p>}
              <p className="admin-privacy">건강정보가 포함되어 있습니다. 운영 목적 외 이용하거나 공유하지 마세요.</p>
            </section>
          )}

          {addressSearchOpen && (
            <div className="postcode-backdrop" role="dialog" aria-modal="true" aria-label="주소 찾기">
              <div className="postcode-modal">
                <header><strong>주소 찾기</strong><button type="button" onClick={() => setAddressSearchOpen(false)} aria-label="주소 찾기 닫기">×</button></header>
                <div id="postcode-layer" />
              </div>
            </div>
          )}


          {withdrawConfirm && (
            <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="withdraw-title">
              <div className="confirm-modal">
                <h2 id="withdraw-title">회원탈퇴 하시겠어요?</h2>
                <p>회원정보와 건강 기록이 모두 삭제됩니다.</p>
                <div><button type="button" onClick={() => setWithdrawConfirm(false)}>취소</button><button className="danger" type="button" onClick={withdrawAccount}>탈퇴하기</button></div>
              </div>
            </div>
          )}
        </div>

        <nav className="bottom-nav" aria-label="주요 메뉴">
          <button className={screen === 'home' ? 'active' : ''} type="button" onClick={goHome}><span>⌂</span>홈</button>
          <button className={screen === 'check' || screen === 'result' ? 'active' : ''} type="button" onClick={beginCheck}><span>✓</span>인지건강</button>
          <button className={screen === 'chronic' || screen === 'report' ? 'active' : ''} type="button" onClick={openChronic}><span>♥</span>만성질환</button>
          <button className={screen === 'education' || screen === 'info' ? 'active' : ''} type="button" onClick={openEducation}><span>i</span>정보</button>
          <button className={['account', 'login', 'signup', 'records', 'practice', 'admin'].includes(screen) ? 'active' : ''} type="button" onClick={openAccount}><span>●</span>마이페이지</button>
        </nav>
      </div>
    </main>
  );
}
