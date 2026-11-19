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
    .unit-deploy-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:10px}
    .unit-deploy-card{position:relative;overflow:hidden;min-height:94px;border:2px solid #b9a47a;border-radius:12px;background:linear-gradient(#fffdf4,#eddfbd);color:#3e2e1b;padding:6px 4px 8px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;cursor:pointer;box-shadow:0 2px 0 #927b4c;transition:transform .08s,border-color .08s}
    .unit-deploy-card:active{transform:translateY(2px);box-shadow:none}
    .unit-deploy-card img{width:52px;height:50px;object-fit:contain;filter:drop-shadow(0 1px 1px #0004)}
    .unit-deploy-card b{font-size:11px;line-height:1.2;max-width:100%;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
    .unit-deploy-card small{font-size:11px;font-weight:900;color:#725018}
    .unit-deploy-card:disabled{filter:grayscale(.9);opacity:.48;cursor:not-allowed}
    .unit-deploy-card .cooldown-mask{position:absolute;inset:0;background:#24201b99;color:white;display:none;align-items:center;justify-content:center;font-size:20px;font-weight:900;text-shadow:0 2px 4px #000}
    .unit-deploy-card.cooling .cooldown-mask{display:flex}
    .unit-deploy-card .form-mark{position:absolute;right:4px;top:3px;background:#7451a2;color:white;border-radius:9px;padding:1px 4px;font-size:9px}
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
    if (wrap && !$id('battleEconomy')) {
      const economy = document.createElement('div');
      economy.id = 'battleEconomy'; economy.className = 'battle-economy';
      economy.innerHTML = '<div><div class="cash-head"><span>💰 お金</span><span id="cashLabel">0 / 5,000</span></div><div class="cash-track"><div id="cashFill" class="cash-fill"></div></div></div><button id="workerUpgradeBtn" class="worker-upgrade">働きネコ Lv.1<br><small>強化 1,000円</small></button>';
      const controls = $id('deployButtons');
      if (controls) wrap.insertBefore(economy, controls);
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
    return evolved ? { ...base, ...evolved, id: base.id, baseId: base.id, formLevel: level, forms: base.forms, cost: base.cost, reproduction: base.reproduction } : { ...base, name: form.name, image: form.image, formLevel: level, baseId: base.id };
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
    const known = new Set(profile?.enemyBook || LEGACY_DATA.initialEnemyBook || []);
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
        forms: original.forms
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
      effects:[],done:false,team,kills:0 };
    playerCooldowns = {};
    $('battleTitle').textContent = stage.name; $('battleResult').classList.add('hidden');
    const grid = $('deployButtons'); grid.classList.add('unit-deploy-grid');
    grid.innerHTML = team.map(base => {
      const c=currentForm(base);
      return `<button class="unit-deploy-card" data-deploy="${escapeAttr(base.id)}"><img src="${escapeAttr(c.image || window.CAT_MEDIA.cat)}" onerror="this.src=window.CAT_MEDIA.cat"><b>${escapeHtml(c.name)}</b><small>￥${money(base.cost)}</small><span class="cooldown-mask" data-cooldown="${escapeAttr(base.id)}"></span>${c.formLevel>1 ? `<span class="form-mark">第${c.formLevel}形態</span>` : ''}</button>`;
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
    if(up){const cost=Math.round(1000*Math.pow(1.65,battle.workerLevel-1));up.innerHTML=`働きネコ Lv.${battle.workerLevel}<br><small>${battle.workerLevel>=8?'MAX':`強化 ￥${money(cost)}`}</small>`;up.disabled=battle.workerLevel>=8||battle.cash<cost;}
    document.querySelectorAll('[data-deploy]').forEach(btn=>{
      const base=charById(btn.dataset.deploy);if(!base)return;
      const cd=Math.max(0,Number(playerCooldowns[base.id]||0)-battle.time);
      btn.disabled=battle.done||battle.cash<Number(base.cost||0)||cd>0;
      btn.classList.toggle('cooling',cd>0);
      const mask=btn.querySelector('.cooldown-mask');if(mask)mask.textContent=cd>0?`${cd.toFixed(1)}s`:'';
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
    return {char:c,side,x,y:274+Math.random()*12,hp:st.hp,maxHp:st.hp,attack:st.attack,attackTimer:.25,
      attackAnim:0,flash:0,stopped:0,weak:0,knockback:0,invuln:0,kbLeft:Math.max(1,Number(c.kb||1)),
      walkPhase:Math.random()*Math.PI*2,baseTimer:.25};
  };

  frame = function(now) {
    if(!battle||battle.done)return;
    const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0))*battleSpeed;lastFrame=now;battle.time+=dt;
    battle.cash=Math.min(battle.cashMax,battle.cash+battle.cashRate*dt);
    for(const st of battle.waveState){
      const w=st.wave;
      if(st.spawned<Number(w.count||1)&&battle.time>=st.next){
        const c=charById(w.characterId);
        if(c&&c.side==='enemy'){
          const e=makeUnit(c,'enemy',800+Math.random()*12),scale=Number(w.hpMultiplier||1)*Number(battle.stage.multiplier||1);
          e.hp*=scale;e.maxHp=e.hp;e.attack*=Number(w.attackMultiplier||1)*Number(battle.stage.multiplier||1);battle.units.push(e);
        }
        st.spawned++;st.next=battle.time+Math.max(1,Number(w.interval||10));
      }
    }
    const units=battle.units;
    for(const u of units){
      if(u.hp<=0)continue;
      u.flash=Math.max(0,u.flash-dt);u.stopped=Math.max(0,u.stopped-dt);u.weak=Math.max(0,u.weak-dt);
      u.knockback=Math.max(0,u.knockback-dt);u.invuln=Math.max(0,u.invuln-dt);u.attackAnim=Math.max(0,u.attackAnim-dt);
      u.attackTimer-=dt;u.baseTimer-=dt;u.walkPhase+=dt*7;
      if(u.stopped>0||u.knockback>0)continue;
      const range=Math.max(38,Number(u.char.range||100)*.9);
      const foes=units.filter(v=>v.hp>0&&v.side!==u.side&&(u.side==='ally'?v.x>=u.x-10:v.x<=u.x+10));
      const target=foes.filter(v=>Math.abs(v.x-u.x)<=range).sort((a,b)=>Math.abs(a.x-u.x)-Math.abs(b.x-u.x))[0];
      if(target&&u.attackTimer<=0){
        let damage=Math.max(1,u.attack*(u.weak>0?.55:1));const ab=Array.isArray(u.char.abilities)?u.char.abilities:[];
        if(ab.includes('lowHpBoost')&&u.hp<u.maxHp*.5)damage*=1.6;
        if(ab.includes('critical')&&Math.random()<.25)damage*=2.5;
        u.attackAnim=.28;u.attackTimer=Math.min(5,Math.max(.9,Number(u.char.cooldown||2)*.65));target.hp-=damage;target.flash=.22;
        battle.effects.push({kind:'hit',x:target.x,y:target.y-34,life:.24,max:.24,color:u.side==='ally'?'#f6c84a':'#e85a58',damage:Math.round(damage)});
        if(ab.includes('stop'))target.stopped=1.5;if(ab.includes('weaken'))target.weak=3;
        if(ab.includes('knockback')){target.knockback=.22;target.x+=target.side==='enemy'?25:-25;target.kbLeft=Math.max(0,target.kbLeft-1);}
        if(ab.includes('wave')||ab.includes('surge')){
          const radius=ab.includes('surge')?95:145;
          for(const other of units)if(other.hp>0&&other.side!==u.side&&other!==target&&Math.abs(other.x-target.x)<radius){other.hp-=damage*(ab.includes('surge')?.35:.4);other.flash=.15;}
          battle.effects.push({kind:'wave',x:target.x,y:target.y-28,life:.5,max:.5,color:ab.includes('surge')?'#d29aff':'#72dbec'});
        }
      } else if(!target){
        const baseX=u.side==='ally'?846:54,dist=Math.abs(baseX-u.x);
        if(dist>42){const rawSpeed=Number(u.char.speed||18);const runSpeed=u.side==='enemy'?Math.min(48,Math.max(14,rawSpeed*1.25)):Math.min(65,Math.max(16,rawSpeed*1.25));u.x+=(u.side==='ally'?1:-1)*runSpeed*dt;}
        else if(u.baseTimer<=0){
          const damage=Math.max(1,u.attack);if(u.side==='ally')battle.enemyBase-=damage;else battle.playerBase-=damage;
          u.baseTimer=Math.max(.6,Number(u.char.cooldown||2));u.attackAnim=.25;
          battle.effects.push({kind:'base',x:baseX,y:205,life:.3,max:.3,color:u.side==='ally'?'#f3bd41':'#dc5b55',damage:Math.round(damage)});
        }
      }
      if(u.side==='enemy'&&u.x<50)u.x=50;if(u.side==='ally'&&u.x>850)u.x=850;
    }
    for(const dead of units.filter(u=>u.hp<=0&&u.side==='enemy'&&!u.rewarded)){
      dead.rewarded=true;battle.kills++;battle.cash=Math.min(battle.cashMax,battle.cash+Number(dead.char.reward||30));markEnemySeen(dead.char.id);
    }
    battle.units=units.filter(u=>u.hp>0&&u.x>20&&u.x<880);
    for(const e of battle.effects)e.life-=dt;battle.effects=battle.effects.filter(e=>e.life>0);
    drawBattle();
    $('battleClock').textContent=new Date(battle.time*1000).toISOString().slice(14,19);
    $('playerBaseLabel').textContent=`${Math.max(0,Math.round(battle.playerBase/50))}%`;
    $('enemyBaseLabel').textContent=`${Math.max(0,Math.round(battle.enemyBase/50))}%`;
    updateBattleEconomy();
    if(battle.enemyBase<=0)finishBattle(true);else if(battle.playerBase<=0)finishBattle(false);else raf=requestAnimationFrame(frame);
  };

  drawBattle = function() {
    const cv=$('battleCanvas'),ctx=cv.getContext('2d'),w=cv.width,h=cv.height;
    const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#94c5cb');g.addColorStop(.55,'#c0d5a0');g.addColorStop(1,'#80a45d');
    ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.fillStyle='#7da653';ctx.fillRect(0,274,w,86);ctx.fillStyle='#cbb47a';ctx.fillRect(0,310,w,50);
    for(let i=0;i<30;i++){const x=(i*47+13)%w;ctx.fillStyle=i%2?'#6c984c':'#8eae58';ctx.beginPath();ctx.ellipse(x,278+(i%3)*8,18,6,0,0,Math.PI*2);ctx.fill();}
    drawBase(ctx,38,220,'#e5b85e');drawBase(ctx,862,220,'#888e96');
    drawHp(ctx,20,198,100,8,battle.playerBase/5000,'#70bd4e');drawHp(ctx,780,198,100,8,battle.enemyBase/5000,'#cb5748');
    for(const u of battle.units){
      ctx.save();const lunge=u.attackAnim>0?(u.side==='ally'?1:-1)*Math.sin((u.attackAnim/.28)*Math.PI)*9:0;
      const bob=Math.sin(u.walkPhase)*2.2,x=u.x+lunge,y=u.y+bob;
      if(u.flash>0)ctx.globalAlpha=.52;
      const src=u.char.image||(u.side==='ally'?window.CAT_MEDIA.cat:window.CAT_MEDIA.enemy);
      if(!imageCache[src]){imageCache[src]=new Image();imageCache[src].src=src;}
      const im=imageCache[src],ww=64,hh=64;
      if(im.complete&&im.naturalWidth){if(u.side==='enemy'){ctx.translate(x,y-35);ctx.scale(-1,1);ctx.drawImage(im,-ww/2,-hh/2,ww,hh);}else ctx.drawImage(im,x-ww/2,y-hh,ww,hh);}
      else{ctx.fillStyle=u.side==='ally'?'#e8a849':'#9a5966';ctx.beginPath();ctx.arc(x,y-30,19,0,Math.PI*2);ctx.fill();}
      ctx.globalAlpha=1;drawHp(ctx,x-27,y-68,54,5,u.hp/u.maxHp,u.side==='ally'?'#74bb4c':'#dc574c');
      if(u.attackAnim>0){ctx.strokeStyle=u.side==='ally'?'#fff0a2':'#ffaaaa';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x+(u.side==='ally'?22:-22),y-38,14+(0.28-u.attackAnim)*30,-1.1,1.1);ctx.stroke();}
      ctx.restore();
    }
    for(const e of battle.effects){const alpha=Math.max(0,e.life/(e.max||.5));ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=e.color||'#fff';ctx.fillStyle=e.color||'#fff';
      if(e.kind==='wave'||e.kind==='base'){ctx.lineWidth=e.kind==='wave'?7:5;ctx.beginPath();ctx.arc(e.x,e.y||250,18+(1-alpha)*80,0,Math.PI*2);ctx.stroke();}
      else if(e.kind==='hit'){ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(e.x-16,e.y-5);ctx.lineTo(e.x+16,e.y+5);ctx.moveTo(e.x+4,e.y-19);ctx.lineTo(e.x-4,e.y+19);ctx.stroke();ctx.font='bold 16px sans-serif';ctx.fillText('-'+e.damage,e.x+12,e.y-18);}
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

  async function ready() {
    ensureExtraPages();
    try { LEGACY_DATA = await waitLegacy; }
    catch (e) { console.error('CAT legacy data:',e); return; }
    const oldEnterApp=enterApp;
    enterApp=async function(){
      await oldEnterApp();
      if(!$id('app')||$id('app').classList.contains('hidden'))return;
      mergeLegacyIntoConfig();
      profile.forms=profile.forms||{};
      profile.enemyBook=Array.isArray(profile.enemyBook)?profile.enemyBook:[];
      if(role==='player'&&!profile.enemyBook.length){profile.enemyBook=[...(LEGACY_DATA.initialEnemyBook||[])];await persistProfile();}
      selectedStageId=config.stages[0]?.id||null;
      renderAll();if(role==='admin')renderAdmin();
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
