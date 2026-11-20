/* CAT大戦争: original roster/forms/stages/encyclopedia + lane battle runtime */
(() => {
  const $id = id => document.getElementById(id);
  const waitLegacy = fetch('/legacy-roster.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(`legacy-roster ${r.status}`); return r.json(); })
    .then(data => {
      if (!Array.isArray(data.characters) || data.characters.length !== 109) throw new Error('復元データが不足しています');
      return data;
    });

  const style = document.createElement('style');
  style.textContent = `
    .battle-economy{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;margin:12px 0 9px;padding:12px;border-radius:14px;background:#fff6df;border:1px solid #e6cc91;color:#513a20}
    .cash-head{display:flex;justify-content:space-between;gap:8px;font-weight:900;font-size:15px}
    .cash-track{height:13px;border-radius:20px;background:#5e4a35;overflow:hidden;margin-top:7px;box-shadow:inset 0 1px 2px #0005}
    .cash-fill{height:100%;width:10%;background:linear-gradient(90deg,#f2b935,#ffe58a);transition:width .1s linear}
    .worker-upgrade{min-width:126px;border:2px solid #b57b21;background:linear-gradient(#fff3c8,#f4cf7d);border-radius:12px;padding:9px 12px;font-weight:900;color:#54360e;cursor:pointer}
    .worker-upgrade:disabled{opacity:.55;cursor:not-allowed}
    .unit-deploy-panel{margin:8px 0 14px;padding:10px;border:2px solid #9f8b67;border-radius:14px;background:linear-gradient(#e8dfca,#cfc1a3);box-shadow:inset 0 1px 0 #fff8}
    .unit-deploy-heading{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:0 0 8px;color:#493b27;font-weight:900;font-size:13px}
    .unit-deploy-hint{font-size:11px;font-weight:700;opacity:.75}
    .unit-deploy-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:0}
    .unit-deploy-card{position:relative;overflow:hidden;min-height:92px;border:2px solid #b9a47a;border-radius:9px;background:linear-gradient(#fffdf4,#eddfbd);color:#3e2e1b;padding:5px 4px 7px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;cursor:pointer;box-shadow:0 2px 0 #927b4c;transition:transform .08s,border-color .08s}
    .unit-deploy-card:active{transform:translateY(2px);box-shadow:none}
    .unit-deploy-card img{width:52px;height:50px;object-fit:contain;filter:drop-shadow(0 1px 1px #0004)}
    .unit-deploy-card b{font-size:11px;line-height:1.2;max-width:100%;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
    .unit-deploy-card small{font-size:11px;font-weight:900;color:#725018}
    .unit-deploy-card:disabled{filter:grayscale(.9);opacity:.48;cursor:not-allowed}
    .unit-deploy-card .cooldown-mask{position:absolute;inset:0;background:#24201b99;color:white;display:none;align-items:center;justify-content:center;font-size:20px;font-weight:900;text-shadow:0 2px 4px #000}
    .unit-deploy-card.cooling .cooldown-mask{display:flex}
    .unit-deploy-card .form-mark{position:absolute;right:4px;top:3px;background:#7451a2;color:white;border-radius:9px;padding:1px 4px;font-size:9px}
    .unit-deploy-card .cost-label{display:block;font-size:11px;font-weight:900;color:#6d4a18}
    .unit-deploy-card:disabled .cost-label{color:#875c51}
    .unit-deploy-card img{flex:1 1 auto;min-height:42px}
    .battle-economy{position:relative}
    @media(max-width:620px){.unit-deploy-panel{padding:7px}.unit-deploy-grid{gap:4px}.unit-deploy-card{min-height:78px;padding:3px 2px 5px}.unit-deploy-card img{width:40px;height:40px;min-height:38px}.unit-deploy-card b{font-size:10px}.unit-deploy-card small{font-size:10px}.unit-deploy-card .cooldown-mask{font-size:16px}}
    .legacy-stage-groups{display:grid;gap:10px}
    .legacy-stage-group{border:1px solid var(--line,#dfd6c5);border-radius:14px;padding:8px;background:#fffaf0}
    .legacy-stage-group summary{font-weight:900;cursor:pointer;padding:8px;color:#4d3b24}
    .legacy-stage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:9px;padding:6px}
    .legacy-stage-card{display:flex;flex-direction:column;text-align:left;gap:6px;padding:8px;border:2px solid #d9c9a8;border-radius:12px;background:#fff;cursor:pointer;color:#43351f;min-width:0}
    .legacy-stage-card.active{border-color:#df8c26;box-shadow:0 0 0 2px #f8dfa9}
    .legacy-stage-card img{width:100%;height:58px;object-fit:contain;background:#f7f1e5;border-radius:8px}
    .legacy-stage-card b{font-size:12px;overflow-wrap:anywhere}
    .legacy-enemy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
    .legacy-enemy-card{border:1px solid #dfd2b6;border-radius:13px;background:#fffaf0;padding:10px;display:grid;grid-template-columns:94px 1fr;gap:9px;align-items:center}
    .legacy-enemy-card img{width:94px;height:82px;object-fit:contain;background:#f4eddf;border-radius:8px}
    .legacy-enemy-card.locked img{filter:brightness(0) opacity(.35)}
    .legacy-form-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
    .legacy-form-btn{border:1px solid #c7b48d;border-radius:9px;background:#fff7e7;padding:6px 10px;font-size:12px;font-weight:800;cursor:pointer}
    .legacy-form-btn.active{background:#dff0c8;border-color:#719d42;color:#355d20}
    .legacy-stage-banner{width:100%;max-height:120px;object-fit:contain;background:#f7f1e5;border-radius:10px;margin:5px 0}
    @media(max-width:620px){.unit-deploy-grid{grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}.unit-deploy-card{min-height:82px;padding:4px 2px}.unit-deploy-card img{width:42px;height:42px}.battle-economy{grid-template-columns:1fr}.worker-upgrade{width:100%}.legacy-stage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  function ensureExtraPages() {
    const nav = document.querySelector('.navbtn')?.parentElement;
    const main = document.querySelector('.main');
    if (nav && !$id('enemyBookNav')) {
      const b = document.createElement('button');
      b.id = 'enemyBookNav'; b.className = 'navbtn'; b.dataset.page = 'enemybook'; b.textContent = '📕 敵図鑑';
      nav.appendChild(b); b.addEventListener('click', () => showPage('enemybook'));
    }
    if (main && !$id('page-enemybook')) {
      const page = document.createElement('section');
      page.id = 'page-enemybook'; page.className = 'page hidden';
      page.innerHTML = '<div class="panel"><div class="panel-title">📕 敵キャラクター図鑑</div><p class="muted">戦闘で出会った敵が登録されるよ。</p><div id="legacyEnemyBookStats" class="statline"></div><div id="legacyEnemyBookGrid" class="legacy-enemy-grid"></div></div>';
      main.appendChild(page);
    }
    const wrap = document.querySelector('.battle-wrap');
    const controls = $id('deployButtons');
    if (wrap && controls && !$id('unitDeployPanel')) {
      const panel = document.createElement('section');
      panel.id = 'unitDeployPanel'; panel.className = 'unit-deploy-panel';
      panel.innerHTML = '<div class="unit-deploy-heading"><span>出撃キャラクター</span><span class="unit-deploy-hint">お金と再生産時間を確認してタップ</span></div>';
      controls.classList.remove('battle-controls');
      controls.classList.add('unit-deploy-grid');
      controls.parentNode.insertBefore(panel, controls);
      panel.appendChild(controls);
    }
    if (wrap && !$id('battleEconomy')) {
      const economy = document.createElement('div');
      economy.id = 'battleEconomy'; economy.className = 'battle-economy';
      economy.innerHTML = '<div><div class="cash-head"><span>💰 お金</span><span id="cashLabel">500 / 5,000</span></div><div class="cash-track"><div id="cashFill" class="cash-fill"></div></div><small class="unit-deploy-hint">時間経過と敵撃破でお金が増える</small></div><button id="workerUpgradeBtn" class="worker-upgrade">働きネコ Lv.1<br><small>強化 ￥1,000</small></button>';
      const panel = $id('unitDeployPanel');
      if (panel && panel.parentNode === wrap) wrap.insertBefore(economy, panel);
      else if (controls && controls.parentNode === wrap) wrap.insertBefore(economy, controls);
      else wrap.appendChild(economy);
    }
    const energyLabel = document.querySelector('#energyLabel')?.closest('.battle-top');
    const energyBar = $id('energyBar')?.parentElement;
    if (energyLabel) energyLabel.style.display = 'none';
    if (energyBar) energyBar.style.display = 'none';
  }

  function getOwnedBaseUnits() {
    return (profile?.owned || []).map(charById).filter(c => c && c.side === 'ally' && !c.evolutionOf);
  }
  function currentForm(base) {
    if (!base || !Array.isArray(base.forms) || !base.forms.length) return base;
    const level = Math.max(1, Math.min(3, Number(profile?.forms?.[base.id] || 1)));
    const form = base.forms.find(f => Number(f.level) === level) || base.forms[0];
    if (level === 1) return base;
    const evolved = config.characters.find(c => c.id === form.id);
    return evolved ? { ...base, ...evolved, id: base.id, baseId: base.id, formLevel: level, forms: base.forms, cost: base.cost, reproduction: base.reproduction,
      walkFrames: form.walkFrames || evolved.walkFrames || base.walkFrames,
      attackFrames: form.attackFrames || evolved.attackFrames || base.attackFrames } :
      { ...base, name: form.name, image: form.image, walkFrames: form.walkFrames || base.walkFrames,
        attackFrames: form.attackFrames || base.attackFrames, formLevel: level, baseId: base.id };
  }

  function markEnemySeen(id) {
    if (!profile || !id || !LEGACY_DATA) return;
    profile.enemyBook = Array.isArray(profile.enemyBook) ? profile.enemyBook : [];
    if (profile.enemyBook.includes(id)) return;
    profile.enemyBook.push(id);
    if (profile.enemyBook.length > 200) profile.enemyBook = profile.enemyBook.slice(-200);
    window.clearTimeout(window.__enemyBookSaveTimer);
    window.__enemyBookSaveTimer = window.setTimeout(() => { if (role === 'player') persistProfile(); }, 1200);
  }

  function renderEnemyBook() {
    if (!LEGACY_DATA || !$id('legacyEnemyBookGrid')) return;
    const enemies = LEGACY_DATA.characters.filter(c => c.side === 'enemy');
    const known = new Set(profile?.enemyBook || []);
    $id('legacyEnemyBookStats').innerHTML = `<span class="stat">発見 ${known.size} / ${enemies.length}</span>`;
    $id('legacyEnemyBookGrid').innerHTML = enemies.map((enemy, index) => {
      const unlocked = known.has(enemy.id);
      const image = enemy.encyclopediaImage || enemy.image || '';
      return `<article class="legacy-enemy-card ${unlocked ? '' : 'locked'}"><img src="${escapeAttr(image)}" alt="${unlocked ? escapeHtml(enemy.name) : '未発見'}"><div><b>${unlocked ? escapeHtml(enemy.name) : `？？？ #${index + 1}`}</b><div class="enemy-description muted">${unlocked ? `HP ${money(enemy.hp)} · 攻撃 ${money(enemy.attack)}<br>KB ${money(enemy.kb)} · 射程 ${money(enemy.range)}` : 'まだ出会っていない敵'}</div></div></article>`;
    }).join('');
  }

  function mergeLegacyIntoConfig() {
    if (!LEGACY_DATA) return;
    const current = new Map((config.characters || []).map(c => [c.id, c]));
    const chars = LEGACY_DATA.characters.map(original => {
      const saved = current.get(original.id);
      if (!saved) return original;
      return { ...original, ...saved,
        image: saved.image?.startsWith('data:image/') ? saved.image : original.image,
        encyclopediaImage: original.encyclopediaImage,
        forms: original.forms,
        walkFrames: original.walkFrames,
        attackFrames: original.attackFrames,
        attackMode: original.attackMode
      };
    });
    for (const c of (config.characters || [])) if (!current.has(c.id)) chars.push(c);
    config.characters = chars;
    const stages = new Map(LEGACY_DATA.stages.map(s => [s.id, s]));
    for (const s of (config.stages || [])) {
      if (s.id === 'stage-1') continue;
      const original = stages.get(s.id);
      stages.set(s.id, original ? { ...original, ...s, titleImage: original.titleImage, enemyWaves: s.enemyWaves || original.enemyWaves } : s);
    }
    config.stages = [...stages.values()];
  }

  function renderLegacyUnits() {
    const list = getOwnedBaseUnits();
    $id('unitList').innerHTML = list.map(base => {
      const active = currentForm(base); const st = unitStats(active);
      const available = base.evolutionAvailable && base.forms?.length > 1;
      const formButtons = available ? `<div class="legacy-form-row">${base.forms.map(f => `<button class="legacy-form-btn ${Number(profile.forms?.[base.id] || 1) === f.level ? 'active' : ''}" data-form-base="${escapeAttr(base.id)}" data-form-level="${f.level}">${f.name}</button>`).join('')}</div>` : '';
      return `<div class="card"><div style="display:flex;gap:10px;align-items:center"><img src="${escapeAttr(active.image || window.CAT_MEDIA.cat)}" style="width:68px;height:68px;object-fit:contain"><div><h3>${escapeHtml(active.name)}</h3><span class="tag">${escapeHtml(base.rarity || 'normal')} · Lv.${st.level}</span><div class="muted">${escapeHtml((base.attributes || []).join(' / '))}</div></div></div><div class="statline"><span class="stat">HP ${money(st.hp)}</span><span class="stat">攻撃 ${money(st.attack)}</span><span class="stat">KB ${money(active.kb)}</span><span class="stat">射程 ${money(active.range)}</span></div><p>${escapeHtml(base.description || '')}</p>${formButtons}<p class="muted">能力: ${(active.abilities || []).map(a => ABILITY_LABEL[a] || a).join('、') || (base.legacyAbilityCode ? `旧能力コード ${escapeHtml(base.legacyAbilityCode)}` : 'なし')}</p><button class="btn tiny" data-train="${escapeAttr(base.id)}">経験値で強化（次: ${money(st.level * 100)}）</button></div>`;
    }).join('') || '<div class="empty">キャラクターがいません。</div>';
    document.querySelectorAll('[data-train]').forEach(b => b.onclick = () => train(b.dataset.train));
    document.querySelectorAll('[data-form-base]').forEach(b => b.onclick = async () => {
      profile.forms = profile.forms || {};
      profile.forms[b.dataset.formBase] = Number(b.dataset.formLevel);
      renderLegacyUnits(); renderFormation(); await persistProfile();
    });
  }

  function renderLegacyFormation() {
    const list = getOwnedBaseUnits();
    $id('formationList').innerHTML = list.map(base => {
      const active = currentForm(base); const st = unitStats(active);
      const selected = (profile.team || []).includes(base.id);
      return `<label class="card" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-team="${escapeAttr(base.id)}" ${selected ? 'checked' : ''}><img src="${escapeAttr(active.image || window.CAT_MEDIA.cat)}" style="width:58px;height:58px;object-fit:contain"><span><b>${escapeHtml(active.name)}</b><br><small class="muted">Lv.${st.level} · コスト ${money(base.cost)} · 攻撃 ${money(st.attack)}</small></span></label>`;
    }).join('') || '<div class="empty">仲間を増やしてね。</div>';
    document.querySelectorAll('[data-team]').forEach(input => input.onchange = () => {
      const id = input.dataset.team; profile.team = profile.team || [];
      if (input.checked) {
        if (profile.team.length >= 10) { input.checked = false; toast('編成は最大10体までだよ'); return; }
        if (!profile.team.includes(id)) profile.team.push(id);
      } else profile.team = profile.team.filter(x => x !== id);
    });
  }

  function renderLegacyStages() {
    const groups = new Map();
    for (const stage of (config.stages || [])) {
      const key = stage.series || stage.chapter || 'その他';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(stage);
    }
    const groupHtml = [...groups.entries()].map(([name, stages], index) => `<details class="legacy-stage-group" ${index === 0 ? 'open' : ''}><summary>${escapeHtml(name)}（${stages.length}ステージ）</summary><div class="legacy-stage-grid">${stages.map(s => `<button class="legacy-stage-card ${s.id === selectedStageId ? 'active' : ''}" data-stage="${escapeAttr(s.id)}">${s.titleImage ? `<img src="${escapeAttr(s.titleImage)}" alt="${escapeAttr(s.name)}">` : `<span class="stage-icon">⚔️</span>`}<b>${escapeHtml(s.name)}</b><small>倍率 ×${Number(s.multiplier || 1)} · 報酬 ${money(s.rewardXp || 0)} XP</small></button>`).join('')}</div></details>`).join('');
    $id('stageList').innerHTML = `<div class="legacy-stage-groups">${groupHtml}</div>`;
    $id('homeStages').innerHTML = (config.stages || []).slice(0, 3).map(s => `<button class="stage-choice" data-home-stage="${escapeAttr(s.id)}"><span class="stage-icon">⚔️</span><span><b>${escapeHtml(s.name)}</b><span class="muted">${escapeHtml(s.series || s.chapter || '')}</span></span></button>`).join('');
    document.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => { selectedStageId = b.dataset.stage; renderLegacyStages(); renderLegacyStageDetails(); });
    document.querySelectorAll('[data-home-stage]').forEach(b => b.onclick = () => { selectedStageId = b.dataset.homeStage; showPage('stages'); });
    renderLegacyStageDetails();
  }

  function renderLegacyStageDetails() {
    const stage = config.stages.find(s => s.id === selectedStageId) || config.stages[0];
    if (!stage) { $id('stageDetails').innerHTML = '<div class="empty">ステージがありません。</div>'; $id('startBattleBtn').disabled = true; return; }
    selectedStageId = stage.id;
    $id('stageDetails').innerHTML = `<h3>${escapeHtml(stage.name)}</h3>${stage.titleImage ? `<img class="legacy-stage-banner" src="${escapeAttr(stage.titleImage)}" alt="${escapeAttr(stage.name)}">` : ''}<div class="statline"><span class="stat">${escapeHtml(stage.series || stage.chapter || '')}</span><span class="stat">倍率 ×${Number(stage.multiplier || 1)}</span><span class="stat">経験値 ${money(stage.rewardXp || 0)}</span><span class="stat">CATチュール ${money(stage.rewardChuru || 0)}</span></div><p>敵の出現ルール：${(stage.enemyWaves || []).length}種類</p>${stage.legacyWaveData === false ? '<small class="muted">元のステージ名・ステージ画像を復元済み。敵の出現タイミングは新バトル用に再設定しています。</small>' : ''}`;
    $id('startBattleBtn').disabled = false;
  }

  let LEGACY_DATA = null;
  const originalShowPage = showPage;
  showPage = function(name) { originalShowPage(name); if (name === 'enemybook') renderEnemyBook(); };
  const originalRenderStages = renderStages;
  renderStages = function() { if (LEGACY_DATA) renderLegacyStages(); else originalRenderStages(); };
  const originalRenderUnits = renderUnits;
  renderUnits = function() { if (LEGACY_DATA) renderLegacyUnits(); else originalRenderUnits(); };
  const originalRenderFormation = renderFormation;
  renderFormation = function() { if (LEGACY_DATA) renderLegacyFormation(); else originalRenderFormation(); };

  const originalStartBattle = startBattle;
  startBattle = function(stageId) {
    if (!LEGACY_DATA) return originalStartBattle(stageId);
    const stage = config.stages.find(x => x.id === stageId); if (!stage) return;
    const team = (profile.team || []).map(charById).filter(c => c && c.side === 'ally' && !c.evolutionOf);
    if (!team.length) { toast('編成で出撃キャラクターを選んでね'); showPage('formation'); return; }
    if (raf) cancelAnimationFrame(raf);
    battle = { stage, time:0, playerBase:5000, enemyBase:5000, cash:500, cashMax:5000, cashRate:35, workerLevel:1,
      units:[], waveState:(stage.enemyWaves || []).map(w => ({wave:w,spawned:0,next:Number(w.at || 0)})),
      effects:[],done:false,team,kills:0, spawnSide:0, battleEndTimer:0 };
    playerCooldowns = {};
    $('battleTitle').textContent = stage.name; $('battleResult').classList.add('hidden');
    const grid = $('deployButtons'); grid.classList.add('unit-deploy-grid');
    const panel = $id('unitDeployPanel');
    if (panel) panel.querySelector('.unit-deploy-heading').innerHTML = '<span>出撃キャラクター</span><span class="unit-deploy-hint">最大10体 · お金が足りない時は灰色表示</span>';
    grid.innerHTML = team.map(base => {
      const c=currentForm(base);
      return `<button type="button" class="unit-deploy-card" data-deploy="${escapeAttr(base.id)}" title="${escapeAttr(c.name)}"><img src="${escapeAttr(c.image || window.CAT_MEDIA.cat)}" onerror="this.src=window.CAT_MEDIA.cat"><b>${escapeHtml(c.name)}</b><small class="cost-label">￥${money(base.cost)}</small><span class="cooldown-mask" data-cooldown="${escapeAttr(base.id)}"></span>${c.formLevel>1 ? `<span class="form-mark">第${c.formLevel}形態</span>` : ''}</button>`;
    }).join('');
    grid.querySelectorAll('[data-deploy]').forEach(b => b.onclick = () => deploy(b.dataset.deploy));
    $('battleMusic').value = stage.music || $('battleMusic').value; if (stage.music) playTrack(stage.music);
    const up=$('workerUpgradeBtn'); if(up) up.onclick=upgradeWorker;
    showPage('battle'); updateBattleEconomy(); lastFrame=performance.now(); raf=requestAnimationFrame(frame);
  };

  function upgradeWorker() {
    if (!battle || battle.done) return;
    const cost = Math.round(1000 * Math.pow(1.65, battle.workerLevel - 1));
    if (battle.workerLevel >= 8) { toast('働きネコは最大レベルだよ'); return; }
    if (battle.cash < cost) { toast('お金が足りないよ'); return; }
    battle.cash -= cost; battle.workerLevel++; battle.cashMax += 900; battle.cashRate += 11; updateBattleEconomy();
  }

  function updateBattleEconomy() {
    if (!battle) return;
    const label=$('cashLabel'), fill=$('cashFill'), up=$('workerUpgradeBtn');
    if(label) label.textContent=`${money(Math.floor(battle.cash))} / ${money(battle.cashMax)}`;
    if(fill) fill.style.width=`${Math.max(0,Math.min(100,battle.cash/battle.cashMax*100))}%`;
    if(up){const cost=Math.round(1000*Math.pow(1.65,battle.workerLevel-1));up.innerHTML=`働きネコ Lv.${battle.workerLevel}<br><small>${battle.workerLevel>=8?'最大レベル':`強化 ￥${money(cost)}`}</small>`;up.disabled=battle.workerLevel>=8||battle.cash<cost;}
    document.querySelectorAll('[data-deploy]').forEach(btn=>{
      const base=charById(btn.dataset.deploy);if(!base)return;
      const cd=Math.max(0,Number(playerCooldowns[base.id]||0)-battle.time);
      const affordable=battle.cash>=Number(base.cost||0);
      btn.disabled=battle.done||!affordable||cd>0;
      btn.classList.toggle('cooling',cd>0);
      btn.classList.toggle('unaffordable',!affordable);
      const mask=btn.querySelector('.cooldown-mask');
      if(mask)mask.textContent=cd>0?`${Math.ceil(cd)}`:'';
      const cost=btn.querySelector('.cost-label');
      if(cost)cost.textContent=cd>0?`再生産 ${Math.ceil(cd)}秒`:`￥${money(base.cost||0)}`;
    });
  }

  deploy = function(id) {
    if(!battle||battle.done)return;const base=charById(id);if(!base||base.side!=='ally')return;
    if(Number(playerCooldowns[id]||0)>battle.time)return;
    const cost=Number(base.cost||0);if(battle.cash<cost){toast('お金が足りないよ');return;}
    battle.cash-=cost;playerCooldowns[id]=battle.time+Math.max(3,Number(base.reproduction||10));
    battle.units.push(makeUnit(currentForm(base),'ally',100+Math.random()*10));updateBattleEconomy();
  };

  makeUnit = function(c,side,x) {
    const st=side==='ally'?unitStats(c):{hp:Number(c.hp||1),attack:Number(c.attack||0)};
    const maxHp=Math.max(1,Number(st.hp)||1);
    const kbTotal=Math.max(1,Math.floor(Number(c.kb)||1));
    return {char:c,side,x,y:276+Math.random()*22,hp:maxHp,maxHp,attack:Math.max(1,Number(st.attack)||1),
      attackTimer:.35,attackAnim:0,attackAnimDuration:.52,flash:0,stopped:0,weak:0,knockback:0,
      invuln:0,kbTotal,kbRemaining:kbTotal,nextKbHp:kbTotal>1?maxHp*(kbTotal-1)/kbTotal:0,
      walkPhase:Math.random()*Math.PI*2,baseTimer:.2,moving:true};
  };

  function applyHit(attacker,target,units,baseAttack=false) {
    if(!attacker||!target||target.hp<=0)return 0;
    let damage=Math.max(1,Number(attacker.attack)||1);
    const abilities=Array.isArray(attacker.char.abilities)?attacker.char.abilities:[];
    if(attacker.weak>0)damage*=.55;
    if(abilities.includes('lowHpBoost')&&attacker.hp<attacker.maxHp*.5)damage*=1.6;
    const critical=abilities.includes('critical')&&Math.random()<.25;
    if(critical)damage*=2.5;
    damage=Math.max(1,Math.round(damage));
    if(baseAttack){target.hp-=damage;return damage;}
    target.hp-=damage;target.flash=.18;target.invuln=.08;
    if(abilities.includes('stop'))target.stopped=Math.max(target.stopped,1.5);
    if(abilities.includes('weaken'))target.weak=Math.max(target.weak,3);
    if(abilities.includes('knockback'))target.knockback=Math.max(target.knockback,.25);
    if(target.kbRemaining>1&&target.hp<=target.nextKbHp){
      target.kbRemaining--;
      target.nextKbHp=target.kbRemaining>1?target.maxHp*(target.kbRemaining-1)/target.kbTotal:0;
      target.knockback=Math.max(target.knockback,.32);
      target.x+=(target.side==='enemy'?1:-1)*25;
      target.invuln=Math.max(target.invuln,.28);
      battle.effects.push({kind:'knockback',x:target.x,y:target.y-28,life:.3,max:.3,color:'#fff1bd'});
    }
    battle.effects.push({kind:'hit',x:target.x,y:target.y-38,life:.42,max:.42,color:critical?'#fff06a':(attacker.side==='ally'?'#f6c84a':'#e85a58'),damage,critical});
    return damage;
  }

  frame = function(now) {
    if(!battle||battle.done)return;
    const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0))*battleSpeed;
    lastFrame=now;battle.time+=dt;
    battle.cash=Math.min(battle.cashMax,battle.cash+battle.cashRate*dt);

    for(const st of battle.waveState){
      const w=st.wave;
      if(st.spawned<Number(w.count||1)&&battle.time>=st.next){
        const c=charById(w.characterId);
        if(c&&c.side==='enemy'){
          const lane=(st.spawned%3)*13;
          const e=makeUnit(c,'enemy',824+Math.random()*8);
          e.y=276+lane;
          const scale=Number(w.hpMultiplier||1)*Number(battle.stage.multiplier||1);
          e.hp*=scale;e.maxHp=e.hp;e.attack*=Number(w.attackMultiplier||1)*Number(battle.stage.multiplier||1);
          e.kbRemaining=e.kbTotal;e.nextKbHp=e.kbTotal>1?e.maxHp*(e.kbTotal-1)/e.kbTotal:0;
          battle.units.push(e);
        }
        st.spawned++;st.next=battle.time+Math.max(1,Number(w.interval||10));
      }
    }

    const units=battle.units;
    for(const u of units){
      if(u.hp<=0)continue;
      u.flash=Math.max(0,u.flash-dt);u.stopped=Math.max(0,u.stopped-dt);
      u.weak=Math.max(0,u.weak-dt);u.knockback=Math.max(0,u.knockback-dt);
      u.invuln=Math.max(0,u.invuln-dt);u.attackAnim=Math.max(0,u.attackAnim-dt);
      u.attackTimer-=dt;u.baseTimer-=dt;u.walkPhase+=dt*8;
      if(u.stopped>0||u.knockback>0)continue;

      const direction=u.side==='ally'?1:-1;
      const range=Math.max(32,Math.min(360,Number(u.char.range||100)));
      const foes=units.filter(v=>v.hp>0&&v.side!==u.side&&direction*(v.x-u.x)>=-4);
      const target=foes.filter(v=>Math.abs(v.x-u.x)<=range)
        .sort((a,b)=>Math.abs(a.x-u.x)-Math.abs(b.x-u.x))[0];

      if(target){
        // Units stop advancing as soon as an opponent enters attack range.
        u.moving=false;
        if(u.attackTimer<=0){
          const group=u.char.attackMode==='area'
            ?foes.filter(v=>Math.abs(v.x-u.x)<=range)
            :[target];
          u.attackAnim=u.attackAnimDuration;
          u.attackTimer=Math.max(.45,Number(u.char.cooldown||2.4));
          for(const victim of group)applyHit(u,victim,units,false);
          if(u.char.abilities?.includes('wave')||u.char.abilities?.includes('surge')){
            const radius=u.char.abilities.includes('surge')?115:180;
            for(const victim of foes){
              if(victim!==target&&victim.hp>0&&Math.abs(victim.x-target.x)<=radius)
                applyHit({...u,attack:u.attack*(u.char.abilities.includes('surge')?.35:.4)},victim,units,false);
            }
            battle.effects.push({kind:'wave',x:target.x,y:target.y-30,life:.55,max:.55,color:u.char.abilities.includes('surge')?'#d29aff':'#72dbec'});
          }
        }
      } else {
        u.moving=true;
        const baseX=u.side==='ally'?852:48;
        const distance=Math.abs(baseX-u.x);
        if(distance>38){
          const rawSpeed=Math.max(.1,Number(u.char.speed)||2);
          const runSpeed=Math.max(8,Math.min(80,8+rawSpeed*6.2));
          const obstruction=foes.some(v=>Math.abs(v.x-u.x)<24);
          if(!obstruction)u.x+=direction*runSpeed*dt;
        } else if(u.baseTimer<=0){
          u.attackAnim=u.attackAnimDuration;
          u.attackTimer=Math.max(.45,Number(u.char.cooldown||2.4));
          u.baseTimer=u.attackTimer;
          if(u.side==='ally'){
            battle.enemyBase-=u.attack;
            battle.effects.push({kind:'base',x:baseX,y:205,life:.38,max:.38,color:'#f3bd41',damage:Math.round(u.attack)});
          }else{
            battle.playerBase-=u.attack;
            battle.effects.push({kind:'base',x:baseX,y:205,life:.38,max:.38,color:'#dc5b55',damage:Math.round(u.attack)});
          }
        }
      }
      u.x=Math.max(35,Math.min(865,u.x));
    }

    for(const dead of units.filter(u=>u.hp<=0&&u.side==='enemy'&&!u.rewarded)){
      dead.rewarded=true;battle.kills++;
      battle.cash=Math.min(battle.cashMax,battle.cash+Number(dead.char.reward||30));
      markEnemySeen(dead.char.id);
    }
    battle.units=units.filter(u=>u.hp>0&&u.x>20&&u.x<880);
    for(const effect of battle.effects)effect.life-=dt;
    battle.effects=battle.effects.filter(effect=>effect.life>0);

    drawBattle();
    $('battleClock').textContent=new Date(battle.time*1000).toISOString().slice(14,19);
    $('playerBaseLabel').textContent=`${Math.max(0,Math.round(battle.playerBase/50))}%`;
    $('enemyBaseLabel').textContent=`${Math.max(0,Math.round(battle.enemyBase/50))}%`;
    updateBattleEconomy();
    if(battle.enemyBase<=0)finishBattle(true);
    else if(battle.playerBase<=0)finishBattle(false);
    else raf=requestAnimationFrame(frame);
  };

  const battleImageCache = imageCache || {};
  function getBattleImage(src) {
    if(!src)return null;
    if(!battleImageCache[src]){const image=new Image();image.src=src;battleImageCache[src]=image;}
    return battleImageCache[src];
  }

  drawBattle = function() {
    const cv=$('battleCanvas'),ctx=cv.getContext('2d'),w=cv.width,h=cv.height;
    const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#94c5cb');g.addColorStop(.55,'#c0d5a0');g.addColorStop(1,'#80a45d');
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#7da653';ctx.fillRect(0,274,w,86);ctx.fillStyle='#cbb47a';ctx.fillRect(0,310,w,50);
    for(let i=0;i<30;i++){const x=(i*47+13)%w;ctx.fillStyle=i%2?'#6c984c':'#8eae58';ctx.beginPath();ctx.ellipse(x,278+(i%3)*8,18,6,0,0,Math.PI*2);ctx.fill();}
    drawBase(ctx,38,220,'#e5b85e');drawBase(ctx,862,220,'#888e96');
    drawHp(ctx,20,198,100,8,battle.playerBase/5000,'#70bd4e');drawHp(ctx,780,198,100,8,battle.enemyBase/5000,'#cb5748');
    for(const u of battle.units){
      ctx.save();
      const attacking=u.attackAnim>0;
      const lunge=attacking?(u.side==='ally'?1:-1)*Math.sin((u.attackAnim/u.attackAnimDuration)*Math.PI)*10:0;
      const bob=u.moving?Math.sin(u.walkPhase)*3.2:Math.sin(u.walkPhase*.35)*.8;
      const x=u.x+lunge,y=u.y+bob;
      const frames=attacking?(u.char.attackFrames||[]):(u.char.walkFrames||[]);
      const frameIndex=frames.length
        ?(attacking?Math.min(frames.length-1,Math.floor((1-u.attackAnim/u.attackAnimDuration)*frames.length)):
          Math.floor(u.walkPhase/0.72)%frames.length)
        :-1;
      const src=(frameIndex>=0?frames[frameIndex]:null)||u.char.image||(u.side==='ally'?window.CAT_MEDIA.cat:window.CAT_MEDIA.enemy);
      const im=getBattleImage(src),ww=68,hh=68;
      ctx.globalAlpha=u.flash>0?.58:1;
      ctx.fillStyle='#26321c55';ctx.beginPath();ctx.ellipse(x,y-4,23,6,0,0,Math.PI*2);ctx.fill();
      if(im&&im.complete&&im.naturalWidth){
        ctx.translate(x,y-33);if(u.side==='enemy')ctx.scale(-1,1);
        ctx.drawImage(im,-ww/2,-hh/2,ww,hh);
      }else{
        ctx.fillStyle=u.side==='ally'?'#e8a849':'#9a5966';ctx.beginPath();ctx.arc(x,y-30,19,0,Math.PI*2);ctx.fill();
      }
      ctx.globalAlpha=1;
      drawHp(ctx,x-28,y-73,56,5,u.hp/u.maxHp,u.side==='ally'?'#74bb4c':'#dc574c');
      if(attacking){
        ctx.strokeStyle=u.side==='ally'?'#fff0a2':'#ffaaaa';ctx.lineWidth=4;ctx.beginPath();
        ctx.arc(x+(u.side==='ally'?25:-25),y-38,15+(1-u.attackAnim/u.attackAnimDuration)*30,-1.15,1.15);ctx.stroke();
      }
      if(u.stopped>0){ctx.fillStyle='#70d9ee';ctx.font='bold 12px sans-serif';ctx.fillText('停止',x-12,y-80);}
      if(u.weak>0){ctx.fillStyle='#b99be9';ctx.font='bold 12px sans-serif';ctx.fillText('弱体',x-12,y-80);}
      ctx.restore();
    }
    for(const e of battle.effects){
      const alpha=Math.max(0,e.life/(e.max||.5));ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=e.color||'#fff';ctx.fillStyle=e.color||'#fff';
      if(e.kind==='wave'||e.kind==='base'||e.kind==='knockback'){
        ctx.lineWidth=e.kind==='wave'?7:5;ctx.beginPath();ctx.arc(e.x,e.y||250,18+(1-alpha)*80,0,Math.PI*2);ctx.stroke();
      } else if(e.kind==='hit'){
        ctx.lineWidth=e.critical?5:3;ctx.beginPath();ctx.moveTo(e.x-16,e.y-5);ctx.lineTo(e.x+16,e.y+5);ctx.moveTo(e.x+4,e.y-19);ctx.lineTo(e.x-4,e.y+19);ctx.stroke();
        ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.fillText((e.critical?'CRITICAL ':'-')+e.damage,e.x,e.y-18);
      }
      ctx.restore();
    }
  };

  finishBattle = function(win) {
    if(!battle||battle.done)return;battle.done=true;cancelAnimationFrame(raf);
    const s=battle.stage,p=$('battleResult');p.classList.remove('hidden');
    p.innerHTML=win?`<h3>🎉 ステージクリア！</h3><p>経験値 +${money(s.rewardXp||0)} · CATチュール +${money(s.rewardChuru||0)}</p><button class="btn green" id="resultReturn">戻る</button>`:`<h3>もう少し！</h3><p>編成を見直して再挑戦しよう。</p><button class="btn" id="resultReturn">戻る</button>`;
    if(win&&role==='player'){profile.xp+=Number(s.rewardXp||0);profile.catChuru+=Number(s.rewardChuru||0);persistProfile();}
    refreshProfile();$('resultReturn').onclick=()=>{if($('bgm'))$('bgm').pause();showPage('stages');};
  };

  async function applyLegacyToOpenApp() {
    if(!LEGACY_DATA || !profile || !config || !role)return;
    mergeLegacyIntoConfig();
    profile.forms=profile.forms||{};
    profile.enemyBook=Array.isArray(profile.enemyBook)?profile.enemyBook:[];
    if(role==='player'&&!profile.enemyBook.length){
      profile.enemyBook=[...(LEGACY_DATA.initialEnemyBook||[])];
      await persistProfile();
    }
    if(!config.stages.some(stage=>stage.id===selectedStageId))
      selectedStageId=config.stages.find(stage=>stage.id!=='stage-1')?.id||config.stages[0]?.id||null;
    renderAll();
    if(role==='admin')renderAdmin();
  }

  async function ready() {
    ensureExtraPages();
    // Wrap enterApp immediately, before waiting for the roster, so login cannot race the data load.
    const oldEnterApp=enterApp;
    enterApp=async function(){
      await oldEnterApp();
      try { LEGACY_DATA=LEGACY_DATA||await waitLegacy; }
      catch(e){ console.error('CAT legacy data:',e); return; }
      if(!$id('app')||!$id('app').classList.contains('hidden'))await applyLegacyToOpenApp();
    };
    try {
      LEGACY_DATA=await waitLegacy;
      // If the user already logged in before the asset finished loading, apply it now.
      if(role&&profile&&config&&$id('app')&&!$id('app').classList.contains('hidden'))
        await applyLegacyToOpenApp();
    } catch(e) {
      console.error('CAT legacy data:',e);
      toast('元のキャラクター・ステージデータを読み込めませんでした');
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
