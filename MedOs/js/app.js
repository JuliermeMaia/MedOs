const supabaseUrl = 'https://rmprqqoprnkimwcyitpe.supabase.co';
const supabaseKey = 'sb_publishable_FRonBTSKbr7LuaoRiW6-gA_34ExpGtc';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
let state = {
  user: null,
  missions: [],
  sessions: [],
  subjects: [],
  topics: [],
  achievements: [],
  userAchievements: []
};

let timerState = { duration: 25 * 60, remaining: 25 * 60, running: false, interval: null, missionId: null };
let xpByDay = {};

// ════════════════════════════════════════
// SUPABASE SYNC
// ════════════════════════════════════════
async function loadStateFromSupabase() {
  if (!state.user) return;
  const uid = state.user.id;

  // Fetch profile
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
  if (profile) state.user = { ...state.user, ...profile };

  // Fetch all related data
  const [mRes, sRes, subRes, tRes, uaRes] = await Promise.all([
    supabaseClient.from('missions').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    supabaseClient.from('sessions').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    supabaseClient.from('subjects').select('*').eq('user_id', uid),
    supabaseClient.from('topics').select('*, subjects!inner(user_id)').eq('subjects.user_id', uid),
    supabaseClient.from('user_achievements').select('*').eq('user_id', uid)
  ]);

  if (mRes.data) state.missions = mRes.data;
  if (sRes.data) state.sessions = sRes.data;
  if (subRes.data) state.subjects = subRes.data;
  if (tRes.data) state.topics = tRes.data;
  if (uaRes.data) state.userAchievements = uaRes.data;

  // Process XP by Day
  xpByDay = {};
  state.sessions.forEach(s => {
    const d = new Date(s.created_at).toDateString();
    xpByDay[d] = (xpByDay[d] || 0) + (s.xp_earned || 0);
  });
}

// ════════════════════════════════════════
// XP & LEVEL SYSTEM
// ════════════════════════════════════════
const LEVELS = [
  { level: 1, min: 0, max: 100 }, { level: 2, min: 100, max: 300 }, { level: 3, min: 300, max: 600 },
  { level: 4, min: 600, max: 1000 }, { level: 5, min: 1000, max: 1500 }, { level: 6, min: 1500, max: 2200 },
  { level: 7, min: 2200, max: 3000 }, { level: 8, min: 3000, max: 4000 }, { level: 9, min: 4000, max: 5500 },
  { level: 10, min: 5500, max: Infinity }
];
const LEVEL_TITLES = ['', 'Aprendiz', 'Estudante', 'Explorador', 'Sábio', 'Mestre', 'Lendário', 'Épico', 'Mítico', 'Imortal', 'Deus do Estudo'];

function getLevel(xp) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].min) return LEVELS[i];
  }
  return LEVELS[0];
}

function getLevelProgress(xp) {
  const lv = getLevel(xp);
  if (lv.max === Infinity) return 100;
  return Math.min(100, Math.round(((xp - lv.min) / (lv.max - lv.min)) * 100));
}

function getXpBonus(difficulty) {
  return { easy: 10, medium: 20, hard: 30 }[difficulty] || 10;
}

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) { showNotif('❌', 'Erro', 'Digite email e senha'); return; }

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
  if (error) { showNotif('❌', 'Erro', error.message); return; }

  state.user = data.user;
  await bootApp();
}

async function handleRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  if (!name || !email || !pass) { showNotif('❌', 'Erro', 'Preencha todos os campos'); return; }

  const { data, error } = await supabaseClient.auth.signUp({
    email, password: pass, options: { data: { name } }
  });
  if (error) { showNotif('❌', 'Erro', error.message); return; }

  showNotif('✉️', 'Sucesso!', 'Verifique seu email (se configurado) ou faça login');
  switchAuthTab('login');
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  state.user = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

async function checkSession() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    state.user = data.session.user;
    await bootApp();
  }
}

async function bootApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  initDefaultAchievements();
  await loadStateFromSupabase();
  await checkStreak();
  renderAll();
}

// ════════════════════════════════════════
// STREAK & XP UPDATES
// ════════════════════════════════════════
async function checkStreak() {
  if (!state.user || !state.user.last_study_date) return;
  const today = new Date().toDateString();
  const last = state.user.last_study_date;
  const diff = (new Date(today) - new Date(last)) / (1000 * 60 * 60 * 24);

  if (diff > 1 && state.user.streak > 0) {
    state.user.streak = 0;
    await supabaseClient.from('profiles').update({ streak: 0 }).eq('id', state.user.id);
  }
}

async function markStudiedTodayAndAddXp(xpEarned) {
  const today = new Date().toDateString();
  const last = state.user.last_study_date;
  let newStreak = state.user.streak || 0;

  if (last !== today) {
    const diff = last ? (new Date(today) - new Date(last)) / (1000 * 60 * 60 * 24) : 999;
    newStreak = (diff <= 1.5) ? newStreak + 1 : 1;
    state.user.streak = newStreak;
    state.user.last_study_date = today;
  }

  state.user.xp_total += xpEarned;
  state.user.level = getLevel(state.user.xp_total).level;

  xpByDay[today] = (xpByDay[today] || 0) + xpEarned;

  await supabaseClient.from('profiles').update({
    xp_total: state.user.xp_total,
    level: state.user.level,
    streak: state.user.streak,
    last_study_date: state.user.last_study_date
  }).eq('id', state.user.id);
}

// ════════════════════════════════════════
// MISSIONS
// ════════════════════════════════════════
function openMissionModal() {
  document.getElementById('m-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('m-title').value = '';
  const sel = document.getElementById('m-subject');
  sel.innerHTML = '<option value="">— Nenhuma —</option>' + state.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  openModal('mission-modal');
}

async function saveMission() {
  const title = document.getElementById('m-title').value.trim();
  if (!title) { showNotif('❌', 'Erro', 'Digite o título'); return; }
  const diff = document.getElementById('m-diff').value;
  const duration = parseInt(document.getElementById('m-duration').value) || 30;
  const xp = duration + getXpBonus(diff);
  const subjId = document.getElementById('m-subject').value || null;

  const missionData = {
    user_id: state.user.id, title, type: document.getElementById('m-type').value,
    difficulty: diff, duration, xp, date: document.getElementById('m-date').value,
    subject_id: subjId, completed: false
  };

  const { data, error } = await supabaseClient.from('missions').insert(missionData).select().single();
  if (!error && data) {
    state.missions.unshift(data);
    closeModal('mission-modal');
    renderAll();
    showNotif('🎯', 'Missão criada!', `${title} · ${xp} XP`);
  }
}

async function completeMission(id) {
  const m = state.missions.find(x => x.id === id);
  if (!m || m.completed) return;

  m.completed = true;
  const oldLevel = getLevel(state.user.xp_total);

  await Promise.all([
    supabaseClient.from('missions').update({ completed: true }).eq('id', id),
    supabaseClient.from('sessions').insert({ user_id: state.user.id, mission_id: id, duration: m.duration, xp_earned: m.xp }),
    markStudiedTodayAndAddXp(m.xp)
  ]);

  // Add session locally
  state.sessions.unshift({ mission_id: id, duration: m.duration, xp_earned: m.xp, created_at: new Date().toISOString() });

  await checkAchievements();
  renderAll();
  showXpReward(m.xp, m.title);

  const newLevel = getLevel(state.user.xp_total);
  if (newLevel.level > oldLevel.level) setTimeout(() => showLevelUp(newLevel.level), 2000);
}

async function deleteMission(id) {
  state.missions = state.missions.filter(x => x.id !== id);
  await supabaseClient.from('missions').delete().eq('id', id);
  renderAll();
}

function filterMissions(filter, btn) {
  document.querySelectorAll('#page-missions .timer-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMissionsList(filter);
}

// ════════════════════════════════════════
// SUBJECTS & TOPICS
// ════════════════════════════════════════
function openSubjectModal() { openModal('subject-modal'); }

async function saveSubject() {
  const name = document.getElementById('s-name').value.trim();
  if (!name) return;
  const { data, error } = await supabaseClient.from('subjects').insert({ user_id: state.user.id, name }).select().single();
  if (data) {
    state.subjects.push(data);
    document.getElementById('s-name').value = '';
    closeModal('subject-modal');
    renderAll();
    showNotif('📚', 'Matéria adicionada!', name);
  }
}

async function addTopic() {
  const subjectId = document.getElementById('topic-subject-select').value;
  const name = document.getElementById('topic-name').value.trim();
  const mastery = parseInt(document.getElementById('topic-mastery').value) || 0;
  if (!subjectId || !name) return;

  const mLevel = Math.min(5, Math.max(0, mastery));
  const { data } = await supabaseClient.from('topics').insert({ subject_id: parseInt(subjectId), name, mastery_level: mLevel }).select().single();
  if (data) {
    state.topics.push(data);
    document.getElementById('topic-name').value = '';
    renderSubjects();
    showNotif('📝', 'Tópico adicionado!', name);
  }
}

async function deleteSubject(id) {
  state.subjects = state.subjects.filter(s => s.id !== id);
  state.topics = state.topics.filter(t => t.subject_id !== id);
  await supabaseClient.from('subjects').delete().eq('id', id);
  renderSubjects();
}

// ════════════════════════════════════════
// ACHIEVEMENTS
// ════════════════════════════════════════
const ACHIEVEMENT_DEFS = [
  { id: 1, name: 'Primeiro Estudo', description: 'Complete sua primeira missão', icon: '🌟', condition: s => s.missions.filter(m => m.completed).length >= 1 },
  { id: 2, name: '3 Dias Seguidos', description: '3 dias de streak', icon: '🔥', condition: s => s.user.streak >= 3 },
  { id: 3, name: '100 XP', description: 'Alcance 100 XP', icon: '⚡', condition: s => s.user.xp_total >= 100 },
  { id: 4, name: 'Maratonista', description: 'Complete 5 missões', icon: '🏃', condition: s => s.missions.filter(m => m.completed).length >= 5 },
  { id: 5, name: 'Nível 3', description: 'Chegue ao nível 3', icon: '🏆', condition: s => s.user.level >= 3 },
  { id: 6, name: '500 XP', description: 'Alcance 500 XP', icon: '💎', condition: s => s.user.xp_total >= 500 },
  { id: 7, name: '7 dias de streak', description: '7 dias consecutivos', icon: '🌈', condition: s => s.user.streak >= 7 },
  { id: 8, name: 'Enciclopédia', description: '3 matérias cadastradas', icon: '📚', condition: s => s.subjects.length >= 3 },
];

function initDefaultAchievements() {
  state.achievements = ACHIEVEMENT_DEFS.map(a => ({ id: a.id, name: a.name, description: a.description, icon: a.icon }));
}

async function checkAchievements() {
  for (const def of ACHIEVEMENT_DEFS) {
    const unlocked = state.userAchievements.some(ua => ua.achievement_id === def.id);
    if (!unlocked && def.condition(state)) {
      const { data } = await supabaseClient.from('user_achievements').insert({ user_id: state.user.id, achievement_id: def.id }).select().single();
      if (data) {
        state.userAchievements.push(data);
        setTimeout(() => showNotif(def.icon, 'Conquista desbloqueada!', def.name), 1500);
      }
    }
  }
}

// ════════════════════════════════════════
// TIMER
// ════════════════════════════════════════
function setTimerDuration(mins, btn) {
  document.querySelectorAll('.timer-opt').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  timerState.duration = mins * 60;
  timerState.remaining = mins * 60;
  timerState.running = false;
  clearInterval(timerState.interval);
  document.getElementById('timer-play-btn').textContent = '▶';
  updateTimerDisplay();
}

function toggleTimer() {
  if (timerState.running) {
    clearInterval(timerState.interval);
    timerState.running = false;
    document.getElementById('timer-play-btn').textContent = '▶';
    document.getElementById('timer-status-label').textContent = 'Pausado';
  } else {
    timerState.running = true;
    document.getElementById('timer-play-btn').textContent = '⏸';
    document.getElementById('timer-status-label').textContent = 'Focando...';
    timerState.interval = setInterval(() => {
      timerState.remaining--;
      updateTimerDisplay();
      if (timerState.remaining <= 0) {
        clearInterval(timerState.interval);
        timerState.running = false;
        onTimerComplete();
      }
    }, 1000);
  }
}

function resetTimer() {
  clearInterval(timerState.interval);
  timerState.running = false;
  timerState.remaining = timerState.duration;
  document.getElementById('timer-play-btn').textContent = '▶';
  document.getElementById('timer-status-label').textContent = 'Pronto para começar';
  updateTimerDisplay();
}

function skipTimer() {
  clearInterval(timerState.interval);
  timerState.running = false;
  timerState.remaining = 0;
  onTimerComplete();
}

function updateTimerDisplay() {
  const m = Math.floor(timerState.remaining / 60);
  const s = timerState.remaining % 60;
  document.getElementById('timer-display').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const circ = 553;
  const progress = timerState.remaining / timerState.duration;
  document.getElementById('timer-circle').style.strokeDashoffset = circ * (1 - progress);
}

async function onTimerComplete() {
  document.getElementById('timer-play-btn').textContent = '▶';
  document.getElementById('timer-status-label').textContent = 'Sessão concluída! 🎉';
  const elapsed = Math.floor((timerState.duration - timerState.remaining) / 60) || Math.floor(timerState.duration / 60);
  const xpEarned = elapsed;
  const mId = document.getElementById('timer-mission-select').value || null;

  const oldLevel = getLevel(state.user.xp_total);

  await Promise.all([
    supabaseClient.from('sessions').insert({ user_id: state.user.id, mission_id: mId, duration: elapsed, xp_earned: xpEarned }),
    markStudiedTodayAndAddXp(xpEarned)
  ]);

  state.sessions.unshift({ mission_id: mId, duration: elapsed, xp_earned: xpEarned, created_at: new Date().toISOString() });
  await checkAchievements();
  renderAll();
  showXpReward(xpEarned, 'Sessão Pomodoro');

  const newLevel = getLevel(state.user.xp_total);
  if (newLevel.level > oldLevel.level) setTimeout(() => showLevelUp(newLevel.level), 2000);
  if (Notification.permission === 'granted') new Notification('StudyQuest 🎮', { body: `Sessão concluída! +${xpEarned} XP ganho!` });

  timerState.remaining = timerState.duration;
  updateTimerDisplay();
}

// ════════════════════════════════════════
// RENDER FUNCTIONS
// ════════════════════════════════════════
function renderAll() {
  updateSidebar(); renderDashboard(); renderMissionsList(); renderTimerSelects();
  renderProfile(); renderSubjects(); renderAchievements(); renderSessions();
}

function updateSidebar() {
  if (!state.user) return;
  const lv = getLevel(state.user.xp_total);
  const pct = getLevelProgress(state.user.xp_total);
  document.getElementById('sidebar-avatar').textContent = state.user.name.slice(0, 2).toUpperCase();
  document.getElementById('sidebar-name').textContent = state.user.name;
  document.getElementById('sidebar-level').textContent = `Nível ${lv.level} · ${LEVEL_TITLES[lv.level] || ''}`;
  document.getElementById('sidebar-xp-val').textContent = `${state.user.xp_total} XP`;
  document.getElementById('sidebar-xp-next').textContent = `próximo: ${lv.max === Infinity ? '∞' : lv.max}`;
  document.getElementById('sidebar-xp-bar').style.width = pct + '%';
}

function renderDashboard() {
  if (!state.user) return;
  const u = state.user;
  const lv = getLevel(u.xp_total);
  const pct = getLevelProgress(u.xp_total);
  const completed = state.missions.filter(m => m.completed);
  const totalMins = state.sessions.reduce((a, s) => a + s.duration, 0);

  const h = new Date().getHours();
  const gr = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  document.getElementById('greeting').innerHTML = `${gr}, <span>${(u.name || 'Herói').split(' ')[0]}</span> 👋`;

  document.getElementById('dash-streak').textContent = u.streak || 0;
  document.getElementById('dash-xp').textContent = u.xp_total;
  document.getElementById('dash-level').textContent = lv.level;
  document.getElementById('dash-missions').textContent = completed.length;
  document.getElementById('dash-hours').textContent = Math.round(totalMins / 60 * 10) / 10;

  document.getElementById('dash-level-label').textContent = `Nível ${lv.level} · ${LEVEL_TITLES[lv.level] || ''}`;
  document.getElementById('dash-xp-label').textContent = `${u.xp_total} / ${lv.max === Infinity ? '∞' : lv.max} XP`;
  document.getElementById('dash-xp-pct').textContent = pct + '%';
  document.getElementById('dash-xp-bar').style.width = pct + '%';

  const today = new Date().toISOString().slice(0, 10);
  const todayM = state.missions.filter(m => m.date === today);
  const el = document.getElementById('today-missions-list');
  el.innerHTML = !todayM.length
    ? `<div class="empty-state"><div class="icon">🌟</div><h3>Nenhuma missão hoje</h3></div>`
    : todayM.map(m => missionHTML(m)).join('');

  renderChart('dash-chart');
}

function missionHTML(m) {
  const diffClass = { easy: 'badge-diff-easy', medium: 'badge-diff-medium', hard: 'badge-diff-hard' }[m.difficulty] || 'badge-diff-easy';
  const diffLabel = { easy: 'Fácil', medium: 'Médio', hard: 'Difícil' }[m.difficulty] || '';
  const icon = { Teoria: '📖', Questões: '✏️', Revisão: '🔄', Prática: '⚗️' }[m.type] || '📝';
  return `
    <div class="mission-item ${m.completed ? 'completed' : ''}" id="mission-${m.id}">
      <div class="mission-icon" style="background:var(--${m.completed ? 'green' : 'accent'}-bg)">${icon}</div>
      <div class="mission-info">
        <div class="mission-title">${m.title}</div>
        <div class="mission-meta">
          <span class="badge badge-type">${m.type}</span>
          <span class="badge ${diffClass}">${diffLabel}</span>
          <span class="badge badge-xp">+${m.xp} XP</span>
          <span class="badge" style="background:var(--bg4);color:var(--text2)">⏱ ${m.duration}min</span>
        </div>
      </div>
      <div class="mission-actions">
        ${!m.completed ? `<button class="btn-complete" onclick="completeMission(${m.id})">✔ Concluir</button>` : `<div class="check-circle done">✔</div>`}
        <button class="btn-icon" onclick="deleteMission(${m.id})" title="Excluir">🗑</button>
      </div>
    </div>`;
}

function renderMissionsList(filter = 'all') {
  let missions = [...state.missions];
  if (filter === 'pending') missions = missions.filter(m => !m.completed);
  if (filter === 'completed') missions = missions.filter(m => m.completed);
  const el = document.getElementById('all-missions-list');
  el.innerHTML = !missions.length
    ? `<div class="empty-state"><div class="icon">🎮</div><h3>Nenhuma missão aqui</h3></div>`
    : missions.map(m => missionHTML(m)).join('');
}

function renderTimerSelects() {
  const pending = state.missions.filter(m => !m.completed);
  document.getElementById('timer-mission-select').innerHTML = '<option value="">— Sessão livre —</option>' + pending.map(m => `<option value="${m.id}">${m.title}</option>`).join('');
}

function renderProfile() {
  if (!state.user) return;
  const u = state.user;
  const lv = getLevel(u.xp_total);
  const pct = getLevelProgress(u.xp_total);
  const totalMins = state.sessions.reduce((a, s) => a + s.duration, 0);

  document.getElementById('profile-avatar').textContent = u.name.slice(0, 2).toUpperCase();
  document.getElementById('profile-name').textContent = u.name;
  document.getElementById('profile-level-text').textContent = `⚔️ Nível ${lv.level} · ${LEVEL_TITLES[lv.level] || ''}`;
  document.getElementById('profile-streak').textContent = u.streak || 0;
  document.getElementById('profile-xp-label').textContent = `${u.xp_total} / ${lv.max === Infinity ? '∞' : lv.max} XP`;
  document.getElementById('profile-xp-pct').textContent = pct + '%';
  document.getElementById('profile-xp-bar').style.width = pct + '%';
  document.getElementById('prof-missions').textContent = state.missions.filter(m => m.completed).length;
  document.getElementById('prof-hours').textContent = Math.round(totalMins / 60 * 10) / 10 + 'h';

  const now = new Date();
  let weekXp = 0, monthXp = 0;
  Object.entries(xpByDay).forEach(([dateStr, xp]) => {
    const d = new Date(dateStr);
    if ((now - d) / (1000 * 60 * 60 * 24) <= 7) weekXp += xp;
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) monthXp += xp;
  });
  document.getElementById('prof-week-xp').textContent = weekXp;
  document.getElementById('prof-month-xp').textContent = monthXp;

  renderChart('profile-chart');
}

function renderChart(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    days.push({ key: d.toDateString(), label: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d.getDay()] });
  }
  const values = days.map(d => xpByDay[d.key] || 0);
  const max = Math.max(...values, 1);
  el.innerHTML = days.map((d, i) => {
    const h = Math.max(4, Math.round((values[i] / max) * 72));
    return `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${h}px;${i === 6 ? '' : 'opacity:0.5'}"></div><div class="chart-bar-label">${d.label}</div></div>`;
  }).join('');
}

function renderSubjects() {
  const el = document.getElementById('subjects-list');
  el.innerHTML = !state.subjects.length
    ? `<div class="empty-state"><div class="icon">📖</div><h3>Nenhuma matéria</h3></div>`
    : state.subjects.map(s => {
      const topics = state.topics.filter(t => t.subject_id === s.id);
      const avgMastery = topics.length ? Math.round(topics.reduce((a, t) => a + t.mastery_level, 0) / topics.length * 10) / 10 : 0;
      const r = ['#ff5a5a', '#f5a623', '#facc15', '#22d3a0', '#4da6ff', '#7c6dfa'][Math.floor(avgMastery)] || '#ff5a5a';
      return `<div class="subject-item"><div class="subject-name"><div style="font-weight:600">${s.name}</div><div style="font-size:0.75rem;color:var(--text2)">${topics.length} tópico(s)</div></div><div class="mastery-bar"><div class="mastery-fill" style="width:${(avgMastery / 5) * 100}%;background:${r}"></div></div><div class="mastery-label">${avgMastery}/5</div><button class="del-btn btn-icon" onclick="deleteSubject(${s.id})">🗑</button></div>`;
    }).join('');

  const opt = '<option value="">Selecione...</option>' + state.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('topic-subject-select').innerHTML = opt;
  if (document.getElementById('m-subject')) document.getElementById('m-subject').innerHTML = '<option value="">— Nenhuma —</option>' + state.subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function renderAchievements() {
  document.getElementById('achievements-grid').innerHTML = ACHIEVEMENT_DEFS.map(def => {
    const u = state.userAchievements.some(ua => ua.achievement_id === def.id);
    return `<div class="achievement-card ${u ? 'unlocked' : 'locked'}"><div class="achievement-icon">${def.icon}</div><div class="achievement-name">${def.name}</div><div class="achievement-desc">${def.description}</div></div>`;
  }).join('');
}

function renderSessions() {
  const el = document.getElementById('sessions-list');
  el.innerHTML = !state.sessions.length ? '<p class="text-muted text-sm">Nenhuma sessão ainda</p>' : state.sessions.slice(0, 8).map(s => {
    const label = new Date(s.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<div class="session-row"><span>${label}</span><span style="color:var(--text2)">${s.duration} min</span><span style="color:var(--accent2);font-weight:600">+${s.xp_earned} XP</span></div>`;
  }).join('');
}

// ════════════════════════════════════════
// NAVIGATION & MODALS
// ════════════════════════════════════════
function navigate(page, mobileBtn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item, .mobile-nav-btn').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => { if (n.getAttribute('onclick')?.includes(`'${page}'`)) n.classList.add('active'); });
  if (mobileBtn) mobileBtn.classList.add('active');
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  if (page === 'profile') renderProfile();
  if (page === 'missions') renderMissionsList();
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));

// ════════════════════════════════════════
// ANIMATIONS & NOTIFS
// ════════════════════════════════════════
function showXpReward(xp, title) {
  const o = document.createElement('div'); o.className = 'xp-reward-overlay';
  o.innerHTML = `<div class="xp-reward-popup"><div class="big">⚡</div><div class="title">+${xp} XP!</div><div class="sub">${title}</div></div>`;
  document.body.appendChild(o); spawnParticles(); setTimeout(() => o.remove(), 2500);
}
function showLevelUp(level) {
  document.getElementById('levelup-text').textContent = `Nível ${level} · ${LEVEL_TITLES[level] || ''}`;
  document.getElementById('levelup-overlay').classList.add('open');
}
function showNotif(icon, title, sub) {
  const c = document.getElementById('notif-container'); const n = document.createElement('div'); n.className = 'notif';
  n.innerHTML = `<div class="notif-icon">${icon}</div><div class="notif-text"><div class="notif-title">${title}</div><div class="notif-sub">${sub}</div></div>`;
  c.appendChild(n); setTimeout(() => { n.style.opacity = '0'; n.style.transform = 'translateX(20px)'; setTimeout(() => n.remove(), 300); }, 3000);
}
function spawnParticles() {
  const cvs = document.getElementById('particles'), ctx = cvs.getContext('2d');
  cvs.width = window.innerWidth; cvs.height = window.innerHeight;
  const p = [], c = ['#7c6dfa', '#f472b6', '#22d3a0', '#f5a623', '#4da6ff'];
  for (let i = 0; i < 60; i++) p.push({ x: Math.random() * cvs.width, y: Math.random() * cvs.height * 0.5, vx: (Math.random() - 0.5) * 6, vy: -(Math.random() * 6 + 2), s: Math.random() * 8 + 3, c: c[Math.floor(Math.random() * c.length)], a: 1 });
  let raf;
  function draw() {
    ctx.clearRect(0, 0, cvs.width, cvs.height); let alive = false;
    p.forEach(x => {
      x.x += x.vx; x.y += x.vy; x.vy += 0.15; x.a -= 0.015;
      if (x.a > 0) { alive = true; ctx.save(); ctx.globalAlpha = x.a; ctx.fillStyle = x.c; ctx.beginPath(); ctx.arc(x.x, x.y, x.s, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    });
    if (alive) raf = requestAnimationFrame(draw); else { ctx.clearRect(0, 0, cvs.width, cvs.height); cancelAnimationFrame(raf); }
  }
  draw();
}

if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
checkSession();
