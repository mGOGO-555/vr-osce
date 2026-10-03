// VR-OSCE PoC  STEP 8: ルールベース採点
// 採点ルールは症例JSON（scoring / judgement）に置く。ここは解釈するだけ。
//   coverage : 指定した項目を実施した数で 0/1/2 点（before 指定があれば、その操作より前の実施のみ有効）
//   choice   : 臨床判断の設問で選んだ選択肢の score（0/1/2）
//   rank     : 複数選択＋優先順位。最優先(weight 3)を1位 かつ 無関係(weight 0)なし=2点／最優先を含む=1点／それ以外0点
// 入力: entries = Logger.entries（時系列）, answers = { stepId: { option, correct } }

const idxOf = (entries, action) => entries.findIndex(e => e.action === action);
// 立位評価のため自動で立ち上がった場合（auto_stand_up）も「立ち上がり」の時点として扱う（before 判定用）
const STAND_ALIAS = { start_sit_to_stand: ['auto_stand_up'] };
const idxBefore = (entries, action) => {
  const c = [action, ...(STAND_ALIAS[action] || [])].map(a => idxOf(entries, a)).filter(i => i >= 0);
  return c.length ? Math.min(...c) : -1;
};
const limitOf = (entries, beforeAction) => {           // この位置より前の実施だけを有効にする
  if (!beforeAction) return Infinity;
  const i = idxBefore(entries, beforeAction);
  return i >= 0 ? i : Infinity;                          // その操作を行っていなければ制限なし
};
const fill = (tpl, items) => tpl.replace('{items}', items.join('・'));

function scoreCoverage(rule, entries) {
  const reqMissing = (rule.required || []).filter(r => idxOf(entries, r.id) < 0);
  const done = [], missed = [];
  for (const it of rule.items) {
    const limit = limitOf(entries, it.before || rule.before);
    const i = idxOf(entries, it.id);
    (i >= 0 && i < limit ? done : missed).push(it);
  }
  let score = 0;
  if (reqMissing.length === 0) score = done.length >= rule.two ? 2 : done.length >= rule.one ? 1 : 0;

  const good = [], miss = [];
  if (done.length) good.push(fill(rule.good, done.map(d => d.short)));
  if (reqMissing.length && rule.required_missed) miss.push(rule.required_missed);
  if (missed.length) miss.push(fill(rule.missed, missed.map(d => d.short)));
  return { score, good, miss, detail: { done: done.map(d => d.id), missed: missed.map(d => d.id), required_missing: reqMissing.map(r => r.id) } };
}

function scoreChoice(rule, caseData, answers) {
  const step = caseData.judgement.steps.find(s => s.id === rule.step);
  const ans = answers[rule.step];
  const opt = ans ? step.options.find(o => o.id === ans.option) : null;
  const score = opt ? opt.score : 0;
  const best = step.options.reduce((a, b) => (b.score > a.score ? b : a));
  const good = [], miss = [];
  if (score >= 2) good.push(rule.good);
  else miss.push(rule.correct_text.replace('{correct}', best.label) + (opt ? '' : '（未回答）'));
  return { score, good, miss, detail: { selected: opt ? opt.id : null, best: best.id } };
}

function scoreRank(rule, caseData, answers) {
  const step = caseData.judgement.steps.find(s => s.id === rule.step);
  const ans = answers[rule.step];
  const ranking = ans && ans.ranking ? ans.ranking : [];
  const w = id => step.options.find(o => o.id === id).weight;
  const best = step.options.reduce((a, b) => (b.weight > a.weight ? b : a));
  const irr = ranking.filter(id => w(id) === 0).map(id => step.options.find(o => o.id === id).label);
  const hasBest = ranking.includes(best.id);
  const first = ranking[0] === best.id;
  const score = first && !irr.length ? 2 : hasBest ? 1 : 0;
  const good = [], miss = [];
  if (score === 2) good.push(rule.good);
  else {
    if (hasBest && !first) miss.push(rule.partial);
    else if (!hasBest) miss.push(rule.correct_text.replace('{correct}', best.label) + (ranking.length ? '' : '（未回答）'));
    if (irr.length) miss.push(rule.irrelevant.replace('{items}', irr.join('・')));
  }
  return { score, good, miss, detail: { ranking, best: best.id } };
}

export function scoreStation(caseData, entries, answers) {
  const rules = caseData.scoring;
  const out = { domains: [], good: [], missed: [], safety: [], safety_errors: [] };

  // Safety error（車椅子ブレーキ未確認のまま立ち上がり評価 など）
  for (const er of rules.safety_errors || []) {
    const bi = idxBefore(entries, er.before);
    if (bi < 0) continue;                                 // 該当操作を行っていない
    const ri = idxOf(entries, er.requires);
    if (ri < 0 || ri > bi) { out.safety_errors.push(er.id); out.safety.push(er.message); }
  }

  for (const rule of rules.domains) {
    const r = rule.type === 'choice' ? scoreChoice(rule, caseData, answers) : rule.type === 'rank' ? scoreRank(rule, caseData, answers) : scoreCoverage(rule, entries);
    let score = r.score;
    if (rule.id === 'safety' && rules.safety_cap_when_error != null && out.safety_errors.length) {
      score = Math.min(score, rules.safety_cap_when_error);
    }
    out.domains.push({ id: rule.id, label: rule.label, score, max: 2, detail: r.detail });
    out.good.push(...r.good);
    out.missed.push(...r.miss);
  }
  return out;
}
