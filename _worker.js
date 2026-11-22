
// CAT大戦争 Cloudflare Pages Advanced Mode Worker
// index.html と同じ階層に _worker.js として配置する。
// 必要な設定：D1バインディング DB、Secret ADMIN_PASSWORD

const DEFAULT_CONFIG = {
  economy: {
    startingCatChuru: 1330,
    startingXp: 1250,
    gachaSingleCost: 150,
    gachaTenCost: 1500,
    energyMax: 1000
  },
  gachaRates: {
    normal: 45,
    rare: 35,
    superRare: 15,
    uberRare: 5
  },
  characters: [
    {
      id: "cat-basic", name: "ネコ", side: "ally",
      hp: 1200, attack: 110, kb: 3, range: 110,
      speed: 42, cost: 50, cooldown: 2.5,
      rarity: "normal", attributes: ["ねこ"], abilities: [],
      image: "assets/images/cat.svg",
      description: "バランス型の基本キャラクター", inGacha: true
    },
    {
      id: "cat-guard", name: "ガードネコ", side: "ally",
      hp: 3600, attack: 70, kb: 1, range: 85,
      speed: 24, cost: 100, cooldown: 5,
      rarity: "rare", attributes: ["ねこ"], abilities: [],
      image: "assets/images/cat.svg",
      description: "体力が高い壁役", inGacha: true
    },
    {
      id: "cat-wave", name: "波動ネコ", side: "ally",
      hp: 1700, attack: 250, kb: 2, range: 155,
      speed: 30, cost: 250, cooldown: 8,
      rarity: "superRare", attributes: ["ねこ", "風"],
      abilities: ["wave"], image: "assets/images/cat.svg",
      description: "波動で後方にも攻撃", inGacha: true
    },
    {
      id: "enemy-pico", name: "ピコ", side: "enemy",
      hp: 950, attack: 90, kb: 2, range: 100,
      speed: 30, cost: 0, cooldown: 3,
      rarity: "normal", attributes: ["ピコ"], abilities: [],
      image: "assets/images/enemy.png",
      description: "練習ステージの敵", inGacha: false
    },
    {
      id: "enemy-brute", name: "つよいピコ", side: "enemy",
      hp: 5000, attack: 330, kb: 1, range: 130,
      speed: 18, cost: 0, cooldown: 4,
      rarity: "rare", attributes: ["ピコ", "強敵"],
      abilities: ["knockback"], image: "assets/images/enemy.png",
      description: "押し返す攻撃を持つ強敵", inGacha: false
    }
  ],
  stages: [
    {
      id: "stage-1",
      name: "はじまりの草原",
      chapter: "第1章 はじまり",
      multiplier: 1,
      rewardXp: 180,
      rewardChuru: 90,
      music: "",
      enemyWaves: [
        {
          characterId: "enemy-pico", at: 5, interval: 11,
          count: 5, hpMultiplier: 1, attackMultiplier: 1
        },
        {
          characterId: "enemy-brute", at: 35, interval: 30,
          count: 1, hpMultiplier: 1, attackMultiplier: 1
        }
      ]
    }
  ]
};

const SESSION_COOKIE = "cat_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const nowSeconds = () => Math.floor(Date.now() / 1000);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i >= 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeEqual(a, b) {
  const x = String(a ?? "");
  const y = String(b ?? "");
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);

  for (let i = 0; i < n; i++) {
    const xc = x.charCodeAt(i % (x.length || 1)) || 0;
    const yc = y.charCodeAt(i % (y.length || 1)) || 0;
    diff |= xc ^ yc;
  }
  return diff === 0;
}

async function passwordHash(password, saltHex) {
  const encoder = new TextEncoder();
  const salt = saltHex
    ? Uint8Array.from(
        saltHex.match(/.{2}/g).map(x => parseInt(x, 16))
      )
    : crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return {
    salt: [...salt]
      .map(b => b.toString(16).padStart(2, "0"))
      .join(""),
    hash: [...new Uint8Array(bits)]
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
  };
}

function getDb(env) {
  if (!env.DB) {
    throw new Error(
      "D1のバインディング名 DB が未設定です。"
    );
  }
  return env.DB;
}

const CAT_ITEM_CATALOG = [
  { id: "catmax", name: "CATMAX" },
  { id: "speed_up", name: "スピードアップ" }
];
function validateProfile(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const ids = (value, limit = 500) => [...new Set((Array.isArray(value) ? value : []).filter(x => typeof x === "string" && x.length > 0 && x.length <= 120))].slice(0, limit);
  const owned = ids(p.owned);
  const team = ids(p.team, 10).filter(x => owned.includes(x));
  const levelsIn = p.levels && typeof p.levels === "object" && !Array.isArray(p.levels) ? p.levels : {};
  const levels = {};
  for (const [id, value] of Object.entries(levelsIn).slice(0, 500)) levels[id] = Math.max(1, Math.min(100, Math.floor(Number(value) || 1)));
  const formsIn = p.forms && typeof p.forms === "object" && !Array.isArray(p.forms) ? p.forms : {};
  const forms = {};
  for (const [id, value] of Object.entries(formsIn).slice(0, 100)) forms[id] = Math.max(1, Math.min(3, Math.floor(Number(value) || 1)));
  const itemsIn = p.items && typeof p.items === "object" && !Array.isArray(p.items) ? p.items : {};
  const items = {};
  for (const item of CAT_ITEM_CATALOG) items[item.id] = Math.max(0, Math.min(1000000000, Math.floor(Number(itemsIn[item.id]) || 0)));
  const unlockedChapters = [...new Set(["1", ...ids(p.unlockedChapters, 4).filter(id => ["1", "2", "3", "4"].includes(id))])].slice(0, 4);
  const adminUnlockedChapters = (Array.isArray(p.adminUnlockedChapters)
    ? ids(p.adminUnlockedChapters, 4)
    : unlockedChapters.filter(id => id !== "1"))
    .filter(id => unlockedChapters.includes(id)).slice(0, 3);
  return {
    catChuru: Math.max(0, Math.min(1000000000, Math.floor(Number(p.catChuru) || 0))),
    xp: Math.max(0, Math.min(1000000000, Math.floor(Number(p.xp) || 0))),
    rainbowStars: Math.max(0, Math.min(1000000000, Math.floor(Number(p.rainbowStars) || 0))),
    items,
    owned, team, levels, forms, enemyBook: ids(p.enemyBook, 200),
    completedMissions: ids(p.completedMissions, 1000),
    ownedCards: ids(p.ownedCards, 1000),
    ownedExternalRewards: ids(p.ownedExternalRewards, 1000),
    unlockedStages: ids(p.unlockedStages, 500),
    unlockedChapters,
    adminUnlockedChapters,
    clearedStages: ids(p.clearedStages, 500),
    appliedGrantIds: ids(p.appliedGrantIds, 100),
    usedItemRequests: ids(p.usedItemRequests, 100)
  };
}
function starterProfile(config) {
  return {
    catChuru: Number(config.economy?.startingCatChuru ?? 1330),
    xp: Number(config.economy?.startingXp ?? 1250),
    rainbowStars: 0,
    items: { catmax: 0, speed_up: 0 },
    appliedGrantIds: [],
    usedItemRequests: [],
    clearedStages: [],
    adminUnlockedChapters: [],
    owned: ["cat-basic", "cat-guard"],
    team: ["cat-basic", "cat-guard"],
    levels: {
      "cat-basic": 1,
      "cat-guard": 1
    },
    forms: {},
    enemyBook: [],
    completedMissions: [],
    ownedCards: [],
    ownedExternalRewards: [],
    unlockedStages: [],
    unlockedChapters: ["1"]
  };
}

let legacyGameDataPromise = null;
async function loadLegacyGameData(env, request) {
  if (!env.ASSETS) return null;
  if (!legacyGameDataPromise) legacyGameDataPromise = (async () => {
    const req = new Request(new URL("/legacy-roster.json", request.url), { method:"GET" });
    const res = await env.ASSETS.fetch(req);
    if (!res.ok) throw new Error("元データを読み込めません: "+res.status);
    const data = await res.json();
    if (!Array.isArray(data.characters) || data.characters.filter(x=>x.side==="ally").length!==40 ||
        data.characters.filter(x=>x.side==="enemy").length!==69 || !Array.isArray(data.stages) || data.stages.length!==109)
      throw new Error("元データ（味方40・敵69・ステージ109）がそろっていません。");
    return data;
  })();
  try { return await legacyGameDataPromise; }
  catch(e) { legacyGameDataPromise=null; console.error("Legacy data load failed:",e); return null; }
}
async function loadLegacyCharacters(env, request) {
  const data=await loadLegacyGameData(env,request);
  return Array.isArray(data?.characters)?data.characters:null;
}

function mergeCharacterRoster(legacyCharacters, savedCharacters) {
  if (!Array.isArray(legacyCharacters) || !legacyCharacters.length) {
    return Array.isArray(savedCharacters)
      ? savedCharacters
      : DEFAULT_CONFIG.characters;
  }

  const merged = new Map(legacyCharacters.map(character => [character.id, character]));
  const builtIn = new Map(DEFAULT_CONFIG.characters.map(character => [character.id, character]));
  const genericImages = new Set(["assets/images/cat.svg", "assets/images/enemy.png"]);

  for (const saved of (Array.isArray(savedCharacters) ? savedCharacters : [])) {
    if (!saved || typeof saved.id !== "string") continue;
    const original = merged.get(saved.id);
    if (!original) {
      merged.set(saved.id, saved);
      continue;
    }

    const stub = builtIn.get(saved.id);
    const unchangedPlaceholder = stub &&
      saved.name === stub.name &&
      Number(saved.hp) === Number(stub.hp) &&
      Number(saved.attack) === Number(stub.attack) &&
      (!saved.image || saved.image === stub.image);
    if (unchangedPlaceholder) continue;

    const image = typeof saved.image === "string" &&
      saved.image.startsWith("data:image/") ? saved.image :
      (saved.image && !genericImages.has(saved.image) ? saved.image : original.image);

    merged.set(saved.id, {
      ...original, ...saved, image,
      encyclopediaImage: original.encyclopediaImage,
      walkFrames: original.walkFrames,
      attackFrames: original.attackFrames,
      forms: Array.isArray(saved.forms) && saved.forms.length
        ? saved.forms.map((form, index) => ({
            ...(original.forms?.[index] || {}), ...form,
            image: form.image?.startsWith("data:image/") ? form.image : original.forms?.[index]?.image,
            walkFrames: original.forms?.[index]?.walkFrames,
            attackFrames: original.forms?.[index]?.attackFrames
          }))
        : original.forms
    });
  }
  return [...merged.values()];
}

const TERRA_STAGE_ID = "stage-terra-card";
function defaultTerraStage() {
  // 初期状態でも第3章から遊べるよう、既存の敵1体を仮設定しておく。
  // 運営が敵編成を保存した場合は、その編成で上書きされる。
  return { id: TERRA_STAGE_ID, name: "TERRA CARD", series: "第3章", chapter: "第3章",
    description: "運営が敵キャラクター・倍率・出現数を設定するステージ", configured: true, multiplier: 1, rewardXp: 0, rewardChuru: 0, music: "",
    enemyWaves: [{ characterId: "enemy-pico", trigger: "time", castleHpPercent: 50, at: 4, interval: 18, count: 1, spawnChance: 100, hpMultiplier: 1, attackMultiplier: 1, boss: false, shockwave: false }] };
}
function resolveCharacterDisplayName(character) {
  if (!character || typeof character !== "object") return "";
  const sideName = character.side === "ally" ? character.gachaName :
    character.side === "enemy" ? character.encyclopediaName : "";
  const candidates = [
    sideName,
    character.gachaName,
    character.encyclopediaName,
    character.displayName,
    character.originalName,
    character.nickname,
    ...(Array.isArray(character.aliases) ? character.aliases : [])
  ].map(value => String(value || "").trim()).filter(Boolean);
  const current = String(character.name || "").trim();
  const looksLikeInternalCode = value =>
    /^(?:味方|敵)\s*[a-z0-9_-]+$/i.test(value) ||
    /^(?:ally|enemy)[-_]?[a-z0-9_-]+$/i.test(value);
  if (looksLikeInternalCode(current)) {
    const meaningful = candidates.find(value => !looksLikeInternalCode(value));
    if (meaningful) return meaningful;
  }
  return current || candidates[0] || "";
}

const CHARACTER_STAT_LIMITS = {
  hp: [1, 1000000000000], attack: [0, 1000000000000],
  speed: [0.01, 100000], cooldown: [0.01, 3600],
  range: [0, 1000000], kb: [0, 100000],
  cost: [0, 1000000000], reproduction: [0, 100000],
  reward: [0, 1000000000]
};
function applyCharacterStatOverrides(characters, overrides) {
  if (!Array.isArray(characters) || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) return characters || [];
  return characters.map(character => {
    const patch = overrides[character.id];
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return character;
    const next = { ...character };
    for (const [field, limits] of Object.entries(CHARACTER_STAT_LIMITS)) {
      if (field === "cost" && character.side !== "ally") continue;
      if (field === "reward" && character.side !== "enemy") continue;
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      const value = Number(patch[field]);
      if (Number.isFinite(value) && value >= limits[0] && value <= limits[1]) next[field] = value;
    }
    return next;
  });
}

async function loadConfig(env, request) {
  const legacyData=await loadLegacyGameData(env,request);
  const legacyCharacters=Array.isArray(legacyData?.characters)?legacyData.characters:null;
  const baseConfig={...structuredClone(DEFAULT_CONFIG),
    characters:legacyCharacters||DEFAULT_CONFIG.characters,
    stages:[...(Array.isArray(legacyData?.stages)&&legacyData.stages.length?legacyData.stages:DEFAULT_CONFIG.stages),defaultTerraStage()]};
  const db=getDb(env);
  const row=await db.prepare("SELECT value_json FROM game_config WHERE config_key = 'main'").first();
  let config=baseConfig;
  if(row?.value_json) {
    try {
      const saved=JSON.parse(row.value_json);
      config={...baseConfig,...saved,
        economy:{...DEFAULT_CONFIG.economy,...(saved.economy||{})},
        gachaRates:{...DEFAULT_CONFIG.gachaRates,...(saved.gachaRates||{})},
        characters:mergeCharacterRoster(legacyCharacters,saved.characters),
        stages:mergeLegacyStages(baseConfig.stages,saved.stages)};
    } catch { config=baseConfig; }
  }

  // 運営が登録した正式名は元のScratchデータより優先する。
  const namesRow=await db.prepare("SELECT value_json FROM game_config WHERE config_key = 'character_names'").first();
  if(namesRow?.value_json) {
    try {
      const names=JSON.parse(namesRow.value_json);
      if(names&&typeof names==="object"&&!Array.isArray(names)) {
        config.characters=(config.characters||[]).map(character=>{
          const name=typeof names[character.id]==="string"?names[character.id].trim():"";
          return name?{...character,name}:character;
        });
      }
    } catch(error) { console.error("Character name overrides could not be read:",error); }
  }
  // 生産価格の基準値はScratchのガチャ／出陣ボタンに記録された価格。
  // 旧版の仮計算価格がmain設定に残っていても、正式な価格を先に戻す。
  if (legacyCharacters) {
    const sourceCosts = new Map(legacyCharacters.filter(x => x.side === "ally").map(x => [x.id, Number(x.cost || 0)]));
    config.characters = (config.characters || []).map(character =>
      character.side === "ally" && sourceCosts.has(character.id)
        ? { ...character, cost: sourceCosts.get(character.id) }
        : character
    );
  }
  // 運営が保存したキャラクター能力値を元データに重ねる。
  const statsRow=await db.prepare("SELECT value_json FROM game_config WHERE config_key = 'character_stats'").first();
  if(statsRow?.value_json) {
    try {
      const savedStats=JSON.parse(statsRow.value_json);
      config.characters=applyCharacterStatOverrides(config.characters,savedStats);
    } catch(error) { console.error("Character stats overrides could not be read:",error); }
  }
  // Scratch内部コード（味方n・敵pなど）を画面名として出さず、
  // 元データに正式名がある場合はそちらを優先する。
  config.characters = (config.characters || []).map(character => {
    const displayName = resolveCharacterDisplayName(character);
    return displayName && displayName !== character.name
      ? { ...character, name: displayName }
      : character;
  });
  return config;
}
function mergeLegacyStages(legacyStages,savedStages) {
  const map=new Map((Array.isArray(legacyStages)?legacyStages:[]).map(x=>[x.id,x]));
  for(const saved of (Array.isArray(savedStages)?savedStages:[])) {
    if(!saved||typeof saved.id!=="string"||saved.id==="stage-1")continue;
    const original=map.get(saved.id);
    const merged=original?{...original,...saved,
      titleImage:saved.titleImage?.startsWith("data:image/")?saved.titleImage:original.titleImage,
      enemyWaves:Array.isArray(saved.enemyWaves)&&saved.enemyWaves.length?saved.enemyWaves:original.enemyWaves}:saved;
    if(saved.id===TERRA_STAGE_ID) {
      if(!Array.isArray(merged.enemyWaves)||!merged.enemyWaves.length) merged.enemyWaves=defaultTerraStage().enemyWaves;
      // 古いDBに未設定プレースホルダーがあっても、TERRA CARDを一覧から消さない。
      merged.configured=true;
      merged.series="第3章";merged.chapter="第3章";merged.name="TERRA CARD";
    }
    map.set(saved.id,merged);
  }
  if(!map.has(TERRA_STAGE_ID))map.set(TERRA_STAGE_ID,defaultTerraStage());
  return [...map.values()];
}

async function createSession(env, userId, role, username) {
  const token = [
    ...crypto.getRandomValues(new Uint8Array(32))
  ].map(b => b.toString(16).padStart(2, "0")).join("");

  const expiresAt = nowSeconds() + SESSION_SECONDS;

  await getDb(env).prepare(
    `INSERT INTO sessions
     (token_hash, user_id, role, username, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    await sha256(token),
    userId,
    role,
    username,
    expiresAt,
    nowSeconds()
  ).run();

  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

async function getSession(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  return await getDb(env).prepare(
    `SELECT user_id, role, username, expires_at
     FROM sessions
     WHERE token_hash = ? AND expires_at > ?`
  ).bind(await sha256(token), nowSeconds()).first();
}

async function requireSession(request, env) {
  const session = await getSession(request, env);
  return session
    ? { session }
    : { error: json({ error: "ログインしてください。" }, 401) };
}

async function requireAdmin(request, env) {
  const result = await requireSession(request, env);
  if (result.error) return result;

  if (result.session.role !== "admin") {
    return {
      error: json({ error: "運営権限が必要です。" }, 403)
    };
  }
  return result;
}

function checkSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

// 独立した別ゲーム用のカード報酬。CAT大戦争の編成・戦闘・ガチャとは無関係。
const EXTERNAL_REWARD_CATALOG = [{
  id: "external-reward-cat-kanzen",
  name: "CAT完全体",
  image: "/assets/cards/cat-kanzen.webp",
  description: "別ゲーム用カード報酬。CAT大戦争の戦闘では使用しません。",
  originalEffect: "scratch属性のカードを2枚ずつ加え、コストを0にして効果を10倍にする。相手に10ダメージ、50%で自分に5ダメージ"
}];
const FIXED_TERRA_MISSION = {
  id: "fixed-win-terra-card", title: "TERRA CARDに勝利",
  description: "運営設定ステージ「TERRA CARD」をクリアする", type: "stage_win",
  stageId: TERRA_STAGE_ID, stageName: "TERRA CARD", fixed: true,
  rewards: { xp: 0, catChuru: 0, characterIds: [], externalRewardIds: ["external-reward-cat-kanzen"], stageIds: [] }
};
function boundedInt(value, max = 1000000000) { return Math.max(0, Math.min(max, Math.floor(Number(value) || 0))); }
function safeStringIds(value, limit = 500) { return [...new Set((Array.isArray(value) ? value : []).filter(x => typeof x === "string" && x.length > 0 && x.length <= 120))].slice(0, limit); }
function normalizeMission(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const id = String(input.id || "").trim(), title = String(input.title || "").trim().slice(0, 80);
  const stageName = String(input.stageName || "").trim().slice(0, 120);
  const stageId = typeof input.stageId === "string" ? input.stageId.slice(0, 120) : "";
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(id) || id === FIXED_TERRA_MISSION.id || !title) return null;
  if (input.type !== "stage_win" || (!stageId && !stageName)) return null;
  const exists = (config.stages || []).some(stage => (stageId && stage.id === stageId) || (stageName && String(stage.name || "").trim().toLowerCase() === stageName.toLowerCase()));
  if (!exists) return null;
  const rewards = input.rewards && typeof input.rewards === "object" ? input.rewards : {};
  const characters = new Set((config.characters || []).filter(c => c.side === "ally").map(c => c.id));
  const stages = new Set((config.stages || []).map(stage => stage.id));
  const externalRewards = new Set(EXTERNAL_REWARD_CATALOG.map(reward => reward.id));
  return { id, title, description: String(input.description || "").slice(0, 240), type: "stage_win", stageId, stageName, fixed: false,
    rewards: { xp: boundedInt(rewards.xp), catChuru: boundedInt(rewards.catChuru),
      characterIds: safeStringIds(rewards.characterIds, 100).filter(x => characters.has(x)),
      externalRewardIds: safeStringIds(rewards.externalRewardIds, 100).filter(x => externalRewards.has(x)),
      stageIds: safeStringIds(rewards.stageIds, 300).filter(x => stages.has(x)) } };
}
async function loadMissions(env, request) {
  const config = await loadConfig(env, request);
  const row = await getDb(env).prepare("SELECT value_json FROM game_config WHERE config_key = 'missions'").first();
  let custom = [];
  try { const data = row?.value_json ? JSON.parse(row.value_json) : []; if (Array.isArray(data)) custom = data.map(item => normalizeMission(item, config)).filter(Boolean); } catch {}
  return [FIXED_TERRA_MISSION, ...custom.filter(item => item.id !== FIXED_TERRA_MISSION.id)];
}
async function readProfileForUser(db, userId, config) {
  const row = await db.prepare("SELECT profile_json FROM profiles WHERE user_id = ?").bind(userId).first();
  let original = null; try { original = row?.profile_json ? JSON.parse(row.profile_json) : null; } catch {}
  return { row, profile: validateProfile(original) || starterProfile(config) };
}
async function saveProfileForUser(db, userId, profile, previousJson) {
  const encoded = JSON.stringify(validateProfile(profile));
  if (previousJson == null) {
    await db.prepare("INSERT INTO profiles (user_id, profile_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json, updated_at=excluded.updated_at").bind(userId, encoded, nowSeconds()).run();
    return;
  }
  const result = await db.prepare("UPDATE profiles SET profile_json = ?, updated_at = ? WHERE user_id = ? AND profile_json = ?").bind(encoded, nowSeconds(), userId, previousJson).run();
  if (!result.meta?.changes) throw new Error("プロフィールが同時に更新されました。もう一度お試しください。");
}

// Server-to-server reward bridge. Secrets are configured as Cloudflare Worker secrets;
 // never place them in the browser or in GitHub.
function createTerraClaimToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
}

async function ensureTerraRewardDelivery(db, session, mission, rewardId) {
  const reward = EXTERNAL_REWARD_CATALOG.find(item => item.id === rewardId);
  if (!reward || session?.role !== "player") return;
  const seed = [session.user_id, mission.id, reward.id].join("|");
  const eventId = "cat-" + await sha256(seed);
  const payload = {
    eventId,
    sourceGame: "CAT大戦争",
    username: String(session.username || "").trim(),
    missionId: mission.id,
    missionTitle: mission.title,
    reward: {
      id: reward.id,
      name: reward.name,
      image: reward.image,
      description: reward.description,
      originalEffect: reward.originalEffect
    },
    completedAt: nowSeconds()
  };
  const now = nowSeconds();
  await db.prepare(`
    INSERT OR IGNORE INTO terra_reward_deliveries
    (event_id, user_id, username, mission_id, reward_id, payload_json, status, last_error, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', '', 0, ?, ?)
  `).bind(eventId, session.user_id, payload.username, mission.id, reward.id, JSON.stringify(payload), now, now).run();

  // TERRA CARD receives the reward while the same player is signed in there.
  // A random, one-use claim token avoids needing to edit its Cloudflare Worker.
  const existing = await db.prepare(
    "SELECT event_id FROM terra_reward_claims WHERE event_id = ?"
  ).bind(eventId).first();
  if (!existing) {
    const token = createTerraClaimToken();
    await db.prepare(`
      INSERT OR IGNORE INTO terra_reward_claims
      (event_id, claim_token, user_id, username, reward_id, payload_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(eventId, token, session.user_id, payload.username, reward.id, JSON.stringify(payload), now).run();
  }
}

// Delivery is completed by a one-use claim URL. No cross-Worker secret is needed.

async function getTerraRewardDeliveryStatus(db, userId, request) {
  const rows = await db.prepare(`
    SELECT d.mission_id, d.reward_id, d.status, d.last_error, d.created_at, d.delivered_at,
           c.claim_token, c.status AS claim_status
    FROM terra_reward_deliveries d
    LEFT JOIN terra_reward_claims c ON c.event_id = d.event_id
    WHERE d.user_id = ?
    ORDER BY d.created_at DESC
    LIMIT 100
  `).bind(userId).all();
  const origin = new URL(request.url).origin;
  return (rows.results || []).map(row => {
    const delivered = row.status === "delivered" || row.claim_status === "claimed";
    const claimable = !delivered && row.claim_status === "pending" && !!row.claim_token;
    return {
      missionId: row.mission_id,
      rewardId: row.reward_id,
      status: delivered ? "delivered" : (claimable ? "claimable" : row.status),
      message: delivered ? "TERRACARDへ受取済み" : (claimable ? "TERRACARDで受け取れます" : "TERRACARDへ送信待ち"),
      claimUrl: claimable ? origin + "/api/terra-reward/claim?token=" + encodeURIComponent(row.claim_token) : "",
      lastError: row.status === "pending" ? row.last_error : "",
      deliveredAt: row.delivered_at || null
    };
  });
}

let schemaInitialization = null;
async function ensureSchema(env) {
  const db = getDb(env);
  if (schemaInitialization) return schemaInitialization;
  schemaInitialization = (async () => {
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, username TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS game_config (config_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS terra_reward_deliveries (
        event_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        reward_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        delivered_at INTEGER
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS terra_reward_claims (
        event_id TEXT PRIMARY KEY,
        claim_token TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        reward_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        claimed_at INTEGER
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_terra_reward_pending ON terra_reward_deliveries(user_id, status)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_terra_claim_user ON terra_reward_claims(user_id, status)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`)
    ]);
  })();
  try { await schemaInitialization; }
  catch (error) { schemaInitialization = null; throw error; }
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  // One-use external reward claim. The player must sign in to TERRA CARD
  // separately; its frontend checks that the username matches before saving.
  if (method === "GET" && path === "/api/terra-reward/claim") {
    const token = String(url.searchParams.get("token") || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "受取コードが正しくありません。" }, 400);
    const row = await getDb(env).prepare(
      "SELECT payload_json, status FROM terra_reward_claims WHERE claim_token = ?"
    ).bind(token).first();
    if (!row) return json({ error: "受取コードが見つかりません。" }, 404);
    let payload;
    try { payload = JSON.parse(row.payload_json); }
    catch { return json({ error: "報酬データを読み取れません。" }, 500); }
    if (row.status === "claimed") return json({ ok: true, payload, alreadyClaimed: true });
    if (row.status !== "pending") return json({ error: "この報酬は現在受け取れません。" }, 409);
    return json({ ok: true, payload, alreadyClaimed: false });
  }

  // TERRACARD login calls this endpoint to collect completed CAT rewards
  // for the same verified username. The TERRA token is checked server-to-server.
  if (method === "POST" && path === "/api/terra-reward/pending") {
    const body = await request.json().catch(() => ({}));
    const terraToken = String(body.terraToken || "").trim();
    if (terraToken.length < 20) return json({ error: "TERRACARDログイン情報がありません。" }, 400);
    let terraSession;
    try {
      const verifyResponse = await fetch("https://terracard-api.cosmos-apr-3.workers.dev/me", {
        method: "GET", redirect: "error", cache: "no-store",
        headers: { "Authorization": "Bearer " + terraToken }
      });
      terraSession = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !terraSession.player || typeof terraSession.player !== "object") {
        return json({ error: "TERRACARDのプレイヤーとしてログインしてください。" }, 401);
      }
    } catch {
      return json({ error: "TERRACARDのログイン状態を確認できませんでした。" }, 502);
    }
    const username = String(terraSession.username || terraSession.player.username || terraSession.player.userName || "").trim();
    if (!username) return json({ error: "TERRACARDのユーザー名を確認できませんでした。" }, 401);
    const db = getDb(env);
    const catUser = await db.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
    if (!catUser) return json({
      ok: true, username, deliveries: [],
      missions: [{
        id: FIXED_TERRA_MISSION.id,
        title: FIXED_TERRA_MISSION.title,
        description: FIXED_TERRA_MISSION.description,
        stageName: FIXED_TERRA_MISSION.stageName,
        done: false,
        linked: false,
        rewardName: EXTERNAL_REWARD_CATALOG[0].name,
        rewardStatus: "account_not_found"
      }]
    });
    const config = await loadConfig(env, request);
    const data = await readProfileForUser(db, catUser.id, config);
    const missions = await loadMissions(env, request);
    for (const mission of missions) {
      if (!data.profile.completedMissions.includes(mission.id)) continue;
      for (const rewardId of safeStringIds(mission.rewards?.externalRewardIds, 100)) {
        await ensureTerraRewardDelivery(db, { role: "player", user_id: catUser.id, username: catUser.username }, mission, rewardId);
      }
    }
    const deliveries = await getTerraRewardDeliveryStatus(db, catUser.id, request);
    const fixedMissionDone = data.profile.completedMissions.includes(FIXED_TERRA_MISSION.id);
    const fixedRewardDelivery = deliveries.find(item =>
      item.rewardId === "external-reward-cat-kanzen"
    );
    return json({
      ok: true,
      username,
      missions: [{
        id: FIXED_TERRA_MISSION.id,
        title: FIXED_TERRA_MISSION.title,
        description: FIXED_TERRA_MISSION.description,
        stageName: FIXED_TERRA_MISSION.stageName,
        done: fixedMissionDone,
        linked: true,
        rewardName: EXTERNAL_REWARD_CATALOG[0].name,
        rewardStatus: fixedRewardDelivery?.status || (fixedMissionDone ? "pending" : "locked")
      }],
      deliveries: deliveries.filter(item => item.status === "claimable" && item.claimUrl)
    });
  }

  if (method === "POST" && path === "/api/terra-reward/ack") {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "");
    const username = String(body.username || "").trim();
    const terraToken = String(body.terraToken || "").trim();
    if (!/^[a-f0-9]{64}$/.test(token) || !username || terraToken.length < 20) return json({ error: "受取情報またはTERRACARDログイン情報が正しくありません。" }, 400);
    // Require an authenticated TERRA CARD player session too; an operator token or
    // a guessed username must not be enough to consume a one-time reward.
    let terraSession;
    try {
      const verifyResponse = await fetch("https://terracard-api.cosmos-apr-3.workers.dev/me", {
        method: "GET", redirect: "error", cache: "no-store",
        headers: { "Authorization": "Bearer " + terraToken }
      });
      terraSession = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok || !terraSession.player || typeof terraSession.player !== "object") {
        return json({ error: "TERRACARDのプレイヤーとしてログインしてください。" }, 401);
      }
    } catch {
      return json({ error: "TERRACARDのログイン状態を確認できませんでした。" }, 502);
    }
    const verifiedUsername = String(terraSession.username || terraSession.player.username || terraSession.player.userName || "").trim();
    const db = getDb(env);
    const row = await db.prepare(
      "SELECT event_id, username, status FROM terra_reward_claims WHERE claim_token = ?"
    ).bind(token).first();
    if (!row) return json({ error: "受取コードが見つかりません。" }, 404);
    if (username.toLowerCase() !== String(row.username || "").trim().toLowerCase() ||
        (verifiedUsername && verifiedUsername.toLowerCase() !== String(row.username || "").trim().toLowerCase())) {
      return json({ error: "CAT大戦争とTERRACARDのアカウント名が一致しません。" }, 403);
    }
    if (row.status === "claimed") return json({ ok: true, alreadyClaimed: true });
    const now = nowSeconds();
    await db.batch([
      db.prepare("UPDATE terra_reward_claims SET status='claimed', claimed_at=? WHERE event_id=? AND status='pending'").bind(now, row.event_id),
      db.prepare("UPDATE terra_reward_deliveries SET status='delivered', last_error='', delivered_at=?, updated_at=? WHERE event_id=?").bind(now, now, row.event_id)
    ]);
    return json({ ok: true, alreadyClaimed: false });
  }

  // 接続確認
  if (method === "GET" && path === "/api/health") {
    try {
      await getDb(env).prepare("SELECT 1 AS ok").first();
      const legacyData = await loadLegacyGameData(env, request);
      const chars = Array.isArray(legacyData?.characters) ? legacyData.characters : [];
      const allies = chars.filter(character => character.side === "ally");
      const enemies = chars.filter(character => character.side === "enemy");
      const stages = Array.isArray(legacyData?.stages) ? legacyData.stages : [];
      const evolutionForms = allies.reduce((total, character) =>
        total + Math.max(0, (character.forms || []).length - 1), 0);
      const health = {
        ok: true,
        service: "CAT大戦争 API",
        database: "connected",
        legacyCharacters: {
          total: chars.length,
          allies: allies.length,
          enemies: enemies.length,
          enemyBook: enemies.filter(character => Boolean(character.encyclopediaImage)).length,
          evolutionForms,
          stages: stages.length,
          loaded: allies.length === 40 && enemies.length === 69 && stages.length === 109
        }
      };
      // Lightweight name-only diagnostic endpoint. Character names are public game data;
      // never include image frames or large base64 assets in this response.
      if (url.searchParams.get("includeNames") === "1") {
        health.characters = chars.map(character => ({
          id: character.id || "",
          name: character.name || "",
          side: character.side || "",
          legacyCode: character.legacyCode || "",
          displayName: character.displayName || "",
          originalName: character.originalName || "",
          nickname: character.nickname || "",
          aliases: Array.isArray(character.aliases) ? character.aliases.slice(0, 10) : []
        }));
      }
      if (url.searchParams.get("includeEffectiveNames") === "1") {
        const effective = await loadConfig(env, request);
        health.effectiveCharacters = (effective.characters || []).map(character => ({
          id: character.id || "",
          name: character.name || "",
          side: character.side || "",
          legacyCode: character.legacyCode || ""
        }));
      }
      return json(health);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  // The one-use reward acknowledgement is allowed from the TERRA CARD frontend.
  const isTerraClaimAck = ["/api/terra-reward/ack", "/api/terra-reward/pending"].includes(path) && method === "POST" && isAllowedTerraClaimOrigin(request);

  // 別サイトからのデータ変更を拒否
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !checkSameOrigin(request) &&
    !isTerraClaimAck
  ) {
    return json({ error: "不正な送信元です。" }, 403);
  }

  // プレイヤー／運営ログイン
  if (method === "POST" && path === "/api/auth/login") {
    const body = await request.json().catch(() => ({}));
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password =
      typeof body.password === "string" ? body.password : "";
    const mode = body.mode === "admin" ? "admin" : "player";

    if (!username || !password) {
      return json({
        error: "ユーザー名とパスワードを入力してください。"
      }, 400);
    }

    if (mode === "admin") {
      const adminName = env.ADMIN_USERNAME || "zikankun";

      if (!env.ADMIN_PASSWORD) {
        return json({
          error: "Cloudflare Secret ADMIN_PASSWORD が未設定です。"
        }, 503);
      }

      if (
        !safeEqual(username, adminName) ||
        !safeEqual(password, env.ADMIN_PASSWORD)
      ) {
        return json({
          error: "ユーザー名またはパスワードが違います。"
        }, 401);
      }

      const cookie = await createSession(
        env, "admin", "admin", adminName
      );

      return json({
        ok: true, role: "admin", username: adminName
      }, 200, { "Set-Cookie": cookie });
    }

    const user = await getDb(env).prepare(
      `SELECT id, username, password_hash, password_salt
       FROM users
       WHERE username = ? COLLATE NOCASE`
    ).bind(username).first();

    if (!user) {
      return json({
        error: "ユーザー名またはパスワードが違います。"
      }, 401);
    }

    const derived = await passwordHash(password, user.password_salt);

    if (!safeEqual(derived.hash, user.password_hash)) {
      return json({
        error: "ユーザー名またはパスワードが違います。"
      }, 401);
    }

    const cookie = await createSession(
      env, user.id, "player", user.username
    );

    return json({
      ok: true, role: "player", username: user.username
    }, 200, { "Set-Cookie": cookie });
  }

  // プレイヤー新規登録
  if (method === "POST" && path === "/api/auth/register") {
    const body = await request.json().catch(() => ({}));
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password =
      typeof body.password === "string" ? body.password : "";

    if (body.mode && body.mode !== "player") {
      return json({
        error: "運営アカウントは登録できません。"
      }, 403);
    }

    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) {
      return json({
        error: "ユーザー名は3〜24文字の英数字・日本語・_・-で入力してください。"
      }, 400);
    }

    if (password.length < 8 || password.length > 128) {
      return json({
        error: "パスワードは8文字以上にしてください。"
      }, 400);
    }

    const adminName = env.ADMIN_USERNAME || "zikankun";
    if (username.toLowerCase() === adminName.toLowerCase()) {
      return json({
        error: "そのユーザー名は登録できません。"
      }, 409);
    }

    const db = getDb(env);
    const exists = await db.prepare(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE"
    ).bind(username).first();

    if (exists) {
      return json({
        error: "そのユーザー名はすでに使われています。"
      }, 409);
    }

    const id = crypto.randomUUID();
    const hashed = await passwordHash(password);
    const config = await loadConfig(env, request);
    const profile = starterProfile(config);
    const now = nowSeconds();

    await db.batch([
      db.prepare(
        `INSERT INTO users
         (id, username, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, username, hashed.hash, hashed.salt, now),

      db.prepare(
        `INSERT INTO profiles
         (user_id, profile_json, updated_at)
         VALUES (?, ?, ?)`
      ).bind(id, JSON.stringify(profile), now)
    ]);

    const cookie = await createSession(
      env, id, "player", username
    );

    return json({
      ok: true, role: "player", username
    }, 201, { "Set-Cookie": cookie });
  }

  // ログアウト
  if (method === "POST" && path === "/api/auth/logout") {
    const token = readCookie(request, SESSION_COOKIE);

    if (token) {
      await getDb(env).prepare(
        "DELETE FROM sessions WHERE token_hash = ?"
      ).bind(await sha256(token)).run();
    }

    return json({ ok: true }, 200, {
      "Set-Cookie":
        `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    });
  }

  // 自分のプロフィール取得
  if (path === "/api/me" && method === "GET") {
    const auth = await requireSession(request, env);
    if (auth.error) return auth.error;

    const s = auth.session;

    if (s.role === "admin") {
      return json({
        role: "admin",
        username: s.username,
        profile: null
      });
    }

    const row = await getDb(env).prepare(
      "SELECT profile_json FROM profiles WHERE user_id = ?"
    ).bind(s.user_id).first();

    const config = await loadConfig(env, request);
    let profile;

    try {
      profile = row?.profile_json
        ? JSON.parse(row.profile_json)
        : starterProfile(config);
    } catch {
      profile = starterProfile(config);
    }
    profile = validateProfile(profile) || starterProfile(config);

    return json({
      role: "player",
      username: s.username,
      profile,
      profileExists: Boolean(row?.profile_json),
      updatedAt: Number(row?.updated_at || 0),
      // Only the small ID-to-Scratch-code mapping is sent to the game bridge;
      // never send the image/frame payload in the profile response.
      legacyCharacterCodes: (config.characters || [])
        .filter(character => character.side === "ally" && character.legacyCode)
        .map(character => ({ id: character.id, legacyCode: String(character.legacyCode) }))
    });
  }

  // 自分のプロフィール保存
  if (path === "/api/me" && method === "POST") {
    const auth = await requireSession(request, env);
    if (auth.error) return auth.error;

    if (auth.session.role !== "player") {
      return json({
        error: "プレイヤーアカウントでログインしてください。"
      }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const profile = validateProfile(body.profile);

    if (!profile) {
      return json({
        error: "プロフィールの形式が正しくありません。"
      }, 400);
    }

    const profileUpdatedAt = nowSeconds();
    const db = getDb(env);
    const encoded = JSON.stringify(profile);
    if (Object.prototype.hasOwnProperty.call(body, "expectedProfile")) {
      const current = await db.prepare(
        "SELECT profile_json FROM profiles WHERE user_id = ?"
      ).bind(auth.session.user_id).first();
      const expectedExists = body.expectedProfileExists !== false;
      const expectedCanonical = JSON.stringify(validateProfile(body.expectedProfile));
      let currentCanonical = "";
      try {
        currentCanonical = current?.profile_json
          ? JSON.stringify(validateProfile(JSON.parse(current.profile_json)))
          : "";
      } catch {}
      if (expectedExists) {
        if (!currentCanonical || currentCanonical !== expectedCanonical) {
          return json({ error: "プロフィールが更新されました。最新データを読み直してください。", code: "PROFILE_CONFLICT" }, 409);
        }
        const updated = await db.prepare(
          "UPDATE profiles SET profile_json = ?, updated_at = ? WHERE user_id = ? AND profile_json = ?"
        ).bind(encoded, profileUpdatedAt, auth.session.user_id, current.profile_json).run();
        if (!updated.meta?.changes) {
          return json({ error: "プロフィールが同時に更新されました。最新データを読み直してください。", code: "PROFILE_CONFLICT" }, 409);
        }
      } else {
        const inserted = await db.prepare(
          "INSERT OR IGNORE INTO profiles (user_id, profile_json, updated_at) VALUES (?, ?, ?)"
        ).bind(auth.session.user_id, encoded, profileUpdatedAt).run();
        if (!inserted.meta?.changes) {
          return json({ error: "プロフィールが同時に作成されました。最新データを読み直してください。", code: "PROFILE_CONFLICT" }, 409);
        }
      }
    } else {
      await db.prepare(
        `INSERT INTO profiles
         (user_id, profile_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at`
      ).bind(auth.session.user_id, encoded, profileUpdatedAt).run();
    }

    return json({ ok: true, profile, updatedAt: profileUpdatedAt, profileExists: true });
  }

  // ゲーム設定取得
  if (path === "/api/config" && method === "GET") {
    return json({ config: await loadConfig(env, request) });
  }

  // 運営によるステージ・キャラ・ガチャ設定の保存
  if (path === "/api/config" && method === "PUT") {
    const auth = await requireAdmin(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const c = body.config;

    if (
      !c ||
      !Array.isArray(c.characters) ||
      !Array.isArray(c.stages) ||
      !c.economy ||
      !c.gachaRates
    ) {
      return json({
        error: "設定データの形式が正しくありません。"
      }, 400);
    }

    if (c.characters.length > 1000 || c.stages.length > 500) {
      return json({
        error: "登録数が上限を超えています。"
      }, 400);
    }

    const rates = Object.values(c.gachaRates).map(Number);

    if (
      !rates.length ||
      rates.some(v => !Number.isFinite(v) || v < 0 || v > 100) ||
      Math.abs(rates.reduce((a, b) => a + b, 0) - 100) > 0.02
    ) {
      return json({
        error: "ガチャ確率の合計は100%にしてください。"
      }, 400);
    }

    const configToSave=structuredClone(c);
    for(const character of (configToSave.characters||[])) {
      if(typeof character.image==="string"&&character.image.startsWith("data:image/"))delete character.image;
      delete character.encyclopediaImage;
      delete character.walkFrames;
      delete character.attackFrames;
      if(Array.isArray(character.forms))character.forms=character.forms.map(form=>{
        const copy={...form};
        if(typeof copy.image==="string"&&copy.image.startsWith("data:image/"))delete copy.image;
        delete copy.walkFrames;
        delete copy.attackFrames;
        return copy;
      });
    }
    for(const stage of (configToSave.stages||[]))if(typeof stage.titleImage==="string"&&stage.titleImage.startsWith("data:image/"))delete stage.titleImage;
    const encoded=JSON.stringify(configToSave);
    if(encoded.length>900000)return json({error:"設定データが大きすぎます。"},413);

    await getDb(env).prepare(
      `INSERT INTO game_config
       (config_key, value_json, updated_at)
       VALUES ('main', ?, ?)
       ON CONFLICT(config_key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`
    ).bind(encoded, nowSeconds()).run();

    return json({ ok: true });
  }

  // Mission list and the logged-in player's claimed rewards.
  if (path === "/api/missions" && method === "GET") {
    const missions = await loadMissions(env, request);
    const session = await getSession(request, env);
    let progress = { completedMissions: [], ownedExternalRewards: [] };
    if (session?.role === "player") {
      const config = await loadConfig(env, request);
      const db = getDb(env);
      const data = await readProfileForUser(db, session.user_id, config);

      // Backfill bridge deliveries for missions completed before the reward bridge
      // was enabled. The deterministic event ID makes this safe to run on every
      // mission-list request without creating duplicate rewards.
      for (const mission of missions) {
        if (!data.profile.completedMissions.includes(mission.id)) continue;
        for (const rewardId of safeStringIds(mission.rewards?.externalRewardIds, 100)) {
          await ensureTerraRewardDelivery(db, session, mission, rewardId);
        }
      }

      progress = {
        completedMissions: data.profile.completedMissions,
        ownedExternalRewards: data.profile.ownedExternalRewards,
        unlockedStages: data.profile.unlockedStages,
        unlockedStageCodes: data.profile.unlockedStages.map(id => config.stages.find(stage => stage.id === id)?.legacyCode).filter(Boolean),
        terraDeliveries: await getTerraRewardDeliveryStatus(db, session.user_id, request)
      };
    }
    return json({ missions, externalRewards: EXTERNAL_REWARD_CATALOG, progress });
  }
  // Small operator catalog: names and IDs, never heavy character image data.
  if (path === "/api/admin/catalog" && method === "GET") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const config = await loadConfig(env, request);
    return json({
      characters: (config.characters || []).filter(c => c.side === "ally").map(c => ({ id: c.id, name: resolveCharacterDisplayName(c), legacyCode: c.legacyCode || "" })),
      enemies: (config.characters || []).filter(c => c.side === "enemy").map(c => ({ id: c.id, name: resolveCharacterDisplayName(c), legacyCode: c.legacyCode || "" })),
      items: CAT_ITEM_CATALOG.map(item => ({ id: item.id, name: item.name })),
      allCharacters: (config.characters || []).map(c => ({
        id: c.id, name: resolveCharacterDisplayName(c), side: c.side,
        legacyCode: c.legacyCode || "", displayName: c.displayName || "",
        originalName: c.originalName || "", nickname: c.nickname || "",
        aliases: Array.isArray(c.aliases) ? c.aliases.slice(0, 10) : [],
        hp: Number(c.hp || 0), attack: Number(c.attack || 0),
        speed: Number(c.speed || 0), cooldown: Number(c.cooldown || 0),
        range: Number(c.range || 0), kb: Number(c.kb || 0),
        cost: c.side === "ally" ? Number(c.cost || 0) : null,
        reproduction: c.side === "ally" ? Number(c.reproduction || 0) : null,
        reward: c.side === "enemy" ? Number(c.reward || 0) : null
      })),
      externalRewards: EXTERNAL_REWARD_CATALOG.map(item => ({ id: item.id, name: item.name })),
      stages: (config.stages || []).map(stage => ({ id: stage.id, name: stage.name, legacyCode: stage.legacyCode || "", series: stage.series || stage.chapter || "" })),
      chapters: [
        { id: "1", name: "第一章" },
        { id: "2", name: "第二章" },
        { id: "3", name: "第三章" },
        { id: "4", name: "第四章" }
      ]
    });
  }

  // 運営用キャラクター能力値・味方の生産価格の編集。
  if (path === "/api/admin/character-stats" && method === "PUT") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    const updates = Array.isArray(body.updates) ? body.updates : (body.update ? [body.update] : []);
    if (!updates.length || updates.length > 109) return json({ error: "更新するキャラクターを1〜109体選んでください。" }, 400);
    const config = await loadConfig(env, request);
    const byId = new Map((config.characters || []).map(character => [character.id, character]));
    const db = getDb(env);
    const row = await db.prepare("SELECT value_json FROM game_config WHERE config_key = 'character_stats'").first();
    let saved = {};
    try {
      const value = row?.value_json ? JSON.parse(row.value_json) : {};
      if (value && typeof value === "object" && !Array.isArray(value)) saved = { ...value };
    } catch {}
    const updatedIds = [];
    for (const item of updates) {
      if (!item || typeof item.id !== "string" || !byId.has(item.id)) return json({ error: "対象キャラクターが見つかりません。" }, 400);
      const character = byId.get(item.id);
      const patch = { ...(saved[item.id] || {}) };
      let changed = false;
      for (const [field, limits] of Object.entries(CHARACTER_STAT_LIMITS)) {
        if (!Object.prototype.hasOwnProperty.call(item, field) || item[field] === "" || item[field] === null) continue;
        if (field === "cost" && character.side !== "ally") continue;
        if (field === "reward" && character.side !== "enemy") continue;
        const value = Number(item[field]);
        if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
          return json({ error: field + " の値が範囲外です。" }, 400);
        }
        patch[field] = value;
        changed = true;
      }
      if (changed) saved[item.id] = patch;
      updatedIds.push(item.id);
    }
    const encoded = JSON.stringify(saved);
    if (encoded.length > 250000) return json({ error: "能力値の保存データが大きすぎます。" }, 413);
    await db.prepare("INSERT INTO game_config (config_key, value_json, updated_at) VALUES ('character_stats', ?, ?) ON CONFLICT(config_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at")
      .bind(encoded, nowSeconds()).run();
    const refreshed = await loadConfig(env, request);
    return json({
      ok: true,
      updated: (refreshed.characters || []).filter(character => updatedIds.includes(character.id)).map(character => ({
        id: character.id, name: resolveCharacterDisplayName(character), side: character.side,
        hp: Number(character.hp || 0), attack: Number(character.attack || 0),
        speed: Number(character.speed || 0), cooldown: Number(character.cooldown || 0),
        range: Number(character.range || 0), kb: Number(character.kb || 0),
        cost: character.side === "ally" ? Number(character.cost || 0) : null,
        reproduction: character.side === "ally" ? Number(character.reproduction || 0) : null
      }))
    });
  }

  // 運営がScratch内部コードの代わりに正式表示名を登録する。
  if (path === "/api/admin/character-names" && method === "PUT") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.names) || body.names.length < 1 || body.names.length > 200) {
      return json({ error: "名前の更新データが正しくありません。" }, 400);
    }
    const config = await loadConfig(env, request);
    const validIds = new Set((config.characters || []).map(c => c.id));
    const db = getDb(env);
    const row = await db.prepare("SELECT value_json FROM game_config WHERE config_key = 'character_names'").first();
    let names = {};
    try {
      const saved = row?.value_json ? JSON.parse(row.value_json) : {};
      if (saved && typeof saved === "object" && !Array.isArray(saved)) names = { ...saved };
    } catch {}
    const updated = [];
    for (const item of body.names) {
      if (!item || typeof item.id !== "string" || !validIds.has(item.id) || typeof item.name !== "string") {
        return json({ error: "登録対象のキャラクターが見つかりません。" }, 400);
      }
      const name = item.name.trim();
      if (name.length > 80) return json({ error: "キャラクター名は80文字以内にしてください。" }, 400);
      if (name) names[item.id] = name;
      else delete names[item.id];
      updated.push(item.id);
    }
    const encoded = JSON.stringify(names);
    await db.prepare(
      "INSERT INTO game_config (config_key, value_json, updated_at) VALUES ('character_names', ?, ?) ON CONFLICT(config_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at"
    ).bind(encoded, nowSeconds()).run();
    const result = (config.characters || []).filter(c => updated.includes(c.id)).map(c => ({
      id: c.id, name: names[c.id] || c.name, side: c.side, legacyCode: c.legacyCode || ""
    }));
    return json({ ok: true, updated: result });
  }

  // TERRA CARD is part of Chapter 3. Operators control global strength and each enemy wave.
  if (path === "/api/admin/terra-stage" && method === "GET") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const config = await loadConfig(env, request);
    const stage = (config.stages || []).find(item => item.id === TERRA_STAGE_ID) || defaultTerraStage();
    return json({ stage, selectedEnemyIds: (stage.enemyWaves || []).map(w => w.characterId).filter(Boolean) });
  }
  if (path === "/api/admin/terra-stage" && method === "PUT") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    const config = await loadConfig(env, request);
    const multiplier = Number(body.multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 0.01 || multiplier > 1000) return json({ error: "ステージ共通倍率は0.01〜1000の範囲で指定してください。" }, 400);
    const available = new Set((config.characters || []).filter(c => c.side === "enemy").map(c => c.id));
    const previous = (config.stages || []).find(item => item.id === TERRA_STAGE_ID) || defaultTerraStage();
    let enemyWaves = [];
    if (Array.isArray(body.enemyWaves)) {
      if (body.enemyWaves.length > 100) return json({ error: "敵キャラクターは100種類以内で設定してください。" }, 400);
      const seen = new Set();
      for (const [index, input] of body.enemyWaves.entries()) {
        if (!input || typeof input.characterId !== "string" || !available.has(input.characterId) || seen.has(input.characterId)) {
          return json({ error: "敵キャラクターの選択内容が正しくありません。" }, 400);
        }
        seen.add(input.characterId);
        const count = input.count === "" ? NaN : Number(input.count ?? 1);
        const hpMultiplier = input.hpMultiplier === "" ? NaN : Number(input.hpMultiplier ?? 1);
        const attackMultiplier = input.attackMultiplier === "" ? NaN : Number(input.attackMultiplier ?? 1);
        const spawnChance = input.spawnChance === "" ? NaN : Number(input.spawnChance ?? 100);
        const trigger = String(input.trigger || "time");
        if (!["time", "enemy_base", "player_base"].includes(trigger)) return json({ error: "敵の出現条件が正しくありません。" }, 400);
        const at = trigger === "time"
          ? (input.at === "" ? NaN : Number(input.at ?? (4 + index * 12)))
          : 0;
        const interval = input.interval === "" ? NaN : Number(input.interval ?? 18);
        const castleHpPercent = trigger === "time"
          ? 50
          : (input.castleHpPercent === "" ? NaN : Number(input.castleHpPercent ?? 50));
        if (!Number.isInteger(count) || count < 1 || count > 10000) return json({ error: "敵の出現数は1〜10000体の整数で指定してください。" }, 400);
        if (!Number.isInteger(at) || at < 0 || at > 31536000) return json({ error: "時間経過型の出現開始時間は0〜31536000秒の整数で指定してください。" }, 400);
        if (!Number.isInteger(interval) || interval < 1 || interval > 86400) return json({ error: "再出現間隔は1〜86400秒の整数で指定してください。" }, 400);
        if (!Number.isFinite(hpMultiplier) || hpMultiplier < 0.01 || hpMultiplier > 10000 ||
            !Number.isFinite(attackMultiplier) || attackMultiplier < 0.01 || attackMultiplier > 10000) {
          return json({ error: "敵ごとの体力・攻撃倍率は0.01〜10000の範囲で指定してください。" }, 400);
        }
        if (!Number.isFinite(spawnChance) || spawnChance < 0.1 || spawnChance > 100) return json({ error: "出現確率は0.1〜100%の範囲で指定してください。" }, 400);
        if (!Number.isFinite(castleHpPercent) || castleHpPercent < 0 || castleHpPercent > 100) return json({ error: "城HP条件は0〜100%の範囲で指定してください。" }, 400);
        enemyWaves.push({
          characterId: input.characterId,
          trigger,
          castleHpPercent,
          at,
          interval,
          count, spawnChance, hpMultiplier, attackMultiplier,
          boss: input.boss === true,
          shockwave: input.boss === true && input.shockwave === true
        });
      }
    } else {
      const enemyIds = safeStringIds(body.enemyIds, 100).filter(id => available.has(id));
      enemyWaves = enemyIds.map((characterId, index) => ({
        characterId, at: 4 + index * 12, interval: 18, count: 1, hpMultiplier: 1, attackMultiplier: 1
      }));
    }
    if (!enemyWaves.length) return json({ error: "敵キャラクターを1体以上選んでください。" }, 400);
    const enemyIds = enemyWaves.map(w => w.characterId);
    const stage = { ...previous, id: TERRA_STAGE_ID, name: "TERRA CARD", series: "第3章", chapter: "第3章",
      description: "運営が設定した敵・出現時間・城HP条件・出現確率・倍率・ボス演出で戦うステージ", configured: true, multiplier,
      enemyWaves };
    const next = { ...config, stages: [...(config.stages || []).filter(item => item.id !== TERRA_STAGE_ID), stage] };
    const configToSave = structuredClone(next);
    for (const character of (configToSave.characters || [])) {
      if (typeof character.image === "string" && character.image.startsWith("data:image/")) delete character.image;
      delete character.encyclopediaImage; delete character.walkFrames; delete character.attackFrames;
      if (Array.isArray(character.forms)) character.forms = character.forms.map(form => { const copy = { ...form }; if (typeof copy.image === "string" && copy.image.startsWith("data:image/")) delete copy.image; delete copy.walkFrames; delete copy.attackFrames; return copy; });
    }
    for (const item of (configToSave.stages || [])) if (typeof item.titleImage === "string" && item.titleImage.startsWith("data:image/")) delete item.titleImage;
    const encoded = JSON.stringify(configToSave);
    if (encoded.length > 900000) return json({ error: "設定データが大きすぎます。" }, 413);
    await getDb(env).prepare("INSERT INTO game_config (config_key, value_json, updated_at) VALUES ('main', ?, ?) ON CONFLICT(config_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").bind(encoded, nowSeconds()).run();
    return json({ ok: true, stage, selectedEnemyIds: enemyIds, selectedEnemyWaves: enemyWaves });
  }

  // Admin mission editor; the fixed TERRA CARD mission is always retained.
  if (path === "/api/admin/missions" && method === "GET") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    return json({ missions: await loadMissions(env, request), externalRewards: EXTERNAL_REWARD_CATALOG });
  }
  if (path === "/api/admin/missions" && method === "PUT") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    if (!Array.isArray(body.missions) || body.missions.length > 200) return json({ error: "ミッションは200件以内で送信してください。" }, 400);
    const config = await loadConfig(env, request);
    const custom = body.missions.filter(item => item && item.id !== FIXED_TERRA_MISSION.id && item.fixed !== true).map(item => normalizeMission(item, config));
    if (custom.some(item => !item)) return json({ error: "ミッション内容または対象ステージ・報酬が正しくありません。" }, 400);
    await getDb(env).prepare("INSERT INTO game_config (config_key, value_json, updated_at) VALUES ('missions', ?, ?) ON CONFLICT(config_key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at").bind(JSON.stringify(custom), nowSeconds()).run();
    return json({ ok: true, missions: [FIXED_TERRA_MISSION, ...custom] });
  }
  // Called only when the game reports a victory. Rewards are granted once per mission.
  if (path === "/api/missions/complete" && method === "POST") {
    const auth = await requireSession(request, env); if (auth.error) return auth.error;
    if (auth.session.role !== "player") return json({ error: "プレイヤーでログインしてください。" }, 403);
    const body = await request.json().catch(() => ({}));
    const config = await loadConfig(env, request);
    let stage = (config.stages || []).find(item => item.id === body.stageId || (body.legacyCode && String(item.legacyCode || "") === String(body.legacyCode)));
    const norm = value => String(value || "").normalize("NFKC").trim().toLowerCase();
    const reportedStageName = String(body.stageName || (String(body.legacyCode || "").normalize("NFKC").trim().toLowerCase() === norm(FIXED_TERRA_MISSION.stageName) ? body.legacyCode : "")).trim();
    if (!stage && norm(reportedStageName) === norm(FIXED_TERRA_MISSION.stageName)) {
      stage = { id: "external-stage-terra-card", name: FIXED_TERRA_MISSION.stageName, legacyCode: FIXED_TERRA_MISSION.stageName };
    }
    if (!stage) return json({ error: "対象ステージが見つかりません。" }, 404);
    const missions = await loadMissions(env, request);
    const stageAliases = [stage.name, stage.legacyCode, stage.id].filter(Boolean).map(norm);
    const eligible = missions.filter(m => {
      if (m.type !== "stage_win") return false;
      if (m.stageId && m.stageId === stage.id) return true;
      return Boolean(m.stageName && stageAliases.includes(norm(m.stageName)));
    });
    if (!eligible.length) return json({ ok: true, completed: [], message: "このステージに対応するミッションはありません。" });
    const db = getDb(env);
    let data = null, completed = [], rainbowStarsGranted = 0, saved = false;
    for (let attempt = 0; attempt < 4 && !saved; attempt++) {
      data = await readProfileForUser(db, auth.session.user_id, config);
      completed = [];
      rainbowStarsGranted = 0;
      let changed = false;
      if (stage.id !== TERRA_STAGE_ID && stage.id !== "external-stage-terra-card" && !data.profile.clearedStages.includes(stage.id)) {
        data.profile.clearedStages.push(stage.id);
        data.profile.rainbowStars = boundedInt(data.profile.rainbowStars + 1);
        rainbowStarsGranted = 1;
        changed = true;
      }
      for (const mission of eligible) {
        if (data.profile.completedMissions.includes(mission.id)) continue;
        const reward = mission.rewards || {};
        data.profile.xp = boundedInt(data.profile.xp + boundedInt(reward.xp));
        data.profile.catChuru = boundedInt(data.profile.catChuru + boundedInt(reward.catChuru));
        for (const id of safeStringIds(reward.characterIds, 100)) {
          if (!(config.characters || []).some(c => c.id === id && c.side === "ally")) continue;
          if (!data.profile.owned.includes(id)) data.profile.owned.push(id);
          data.profile.levels[id] = Math.max(1, Number(data.profile.levels[id] || 1));
        }
        for (const id of safeStringIds(reward.externalRewardIds, 100)) if (EXTERNAL_REWARD_CATALOG.some(item => item.id === id) && !data.profile.ownedExternalRewards.includes(id)) data.profile.ownedExternalRewards.push(id);
        for (const id of safeStringIds(reward.stageIds, 300)) if ((config.stages || []).some(x => x.id === id) && !data.profile.unlockedStages.includes(id)) data.profile.unlockedStages.push(id);
        data.profile.completedMissions.push(mission.id);
        completed.push(mission);
        changed = true;
      }
      if (!changed) {
        saved = true;
        break;
      }
      try {
        await saveProfileForUser(db, auth.session.user_id, data.profile, data.row?.profile_json ?? null);
        saved = true;
      } catch (error) {
        if (!String(error?.message || error).includes("同時に更新") || attempt === 3) throw error;
      }
    }
    if (!saved || !data) return json({ error: "報酬の保存に失敗しました。再確認してください。" }, 409);

    // A previously completed mission may predate the bridge. Queue its external
    // rewards too, then deliver pending entries idempotently to TERRACARD.
    for (const mission of eligible) {
      if (!data.profile.completedMissions.includes(mission.id)) continue;
      for (const rewardId of safeStringIds(mission.rewards?.externalRewardIds, 100)) {
        await ensureTerraRewardDelivery(db, auth.session, mission, rewardId);
      }
    }
    const terraDeliveries = await getTerraRewardDeliveryStatus(db, auth.session.user_id, request);
    return json({
      ok: true,
      completed,
      profile: data.profile,
      rainbowStarsGranted,
      externalRewards: EXTERNAL_REWARD_CATALOG,
      terraDeliveries
    });
  }
  // Admin grants currencies, characters, items and stage unlock flags.
  if (path === "/api/admin/grants" && method === "POST") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    if (typeof body.playerId !== "string" || !body.playerId) return json({ error: "配布先プレイヤーが指定されていません。" }, 400);
    const config = await loadConfig(env, request), db = getDb(env);
    const user = await db.prepare("SELECT id, username FROM users WHERE id = ?").bind(body.playerId).first();
    if (!user) return json({ error: "プレイヤーが見つかりません。", code: "PLAYER_NOT_FOUND" }, 404);

    const xp = boundedInt(body.xp), catChuru = boundedInt(body.catChuru), rainbowStars = boundedInt(body.rainbowStars);
    const requestedItems = body.items && typeof body.items === "object" && !Array.isArray(body.items) ? body.items : {};
    const itemCounts = Object.fromEntries(CAT_ITEM_CATALOG.map(item => [item.id, boundedInt(requestedItems[item.id])]));
    const hasItemGrants = Object.values(itemCounts).some(value => value > 0);
    const requestId = typeof body.requestId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(body.requestId) ? body.requestId : "";
    const characterIds = safeStringIds(body.characterIds, 100).filter(id => (config.characters || []).some(c => c.id === id && c.side === "ally"));
    const externalRewardIds = safeStringIds(body.externalRewardIds, 100).filter(id => EXTERNAL_REWARD_CATALOG.some(item => item.id === id));
    const stageIds = safeStringIds(body.stageIds, 300).filter(id => (config.stages || []).some(stage => stage.id === id));
    const chapterIds = safeStringIds(body.chapterIds, 4).filter(id => ["1", "2", "3", "4"].includes(id));
    if (!xp && !catChuru && !rainbowStars && !hasItemGrants && !characterIds.length && !externalRewardIds.length && !stageIds.length && !chapterIds.length) {
      return json({ error: "配布する経験値・CATチュール・虹星・アイテム・キャラクター・報酬・ステージ・章を1つ以上選んでください。", code: "EMPTY_GRANT" }, 400);
    }

    let savedProfile = null, alreadyApplied = false;
    // 同じ配布要求IDは一度だけ反映し、接続切れ後の再試行による二重配布を防止する。
    for (let attempt = 0; attempt < 4 && !savedProfile; attempt++) {
      const data = await readProfileForUser(db, body.playerId, config);
      const next = structuredClone(data.profile);
      if (requestId && next.appliedGrantIds.includes(requestId)) {
        savedProfile = next;
        alreadyApplied = true;
        break;
      }
      next.xp = boundedInt(next.xp + xp);
      next.catChuru = boundedInt(next.catChuru + catChuru);
      next.rainbowStars = boundedInt(next.rainbowStars + rainbowStars);
      for (const item of CAT_ITEM_CATALOG) next.items[item.id] = boundedInt((next.items[item.id] || 0) + itemCounts[item.id]);
      for (const id of characterIds) {
        if (!next.owned.includes(id)) next.owned.push(id);
        next.levels[id] = Math.max(1, Number(next.levels[id] || 1));
      }
      for (const id of externalRewardIds) if (!next.ownedExternalRewards.includes(id)) next.ownedExternalRewards.push(id);
      for (const id of stageIds) if (!next.unlockedStages.includes(id)) next.unlockedStages.push(id);
      for (const id of chapterIds) {
        if (!next.unlockedChapters.includes(id)) next.unlockedChapters.push(id);
        if (!next.adminUnlockedChapters.includes(id)) next.adminUnlockedChapters.push(id);
      }
      if (requestId) next.appliedGrantIds = [...next.appliedGrantIds, requestId].slice(-100);
      try {
        await saveProfileForUser(db, body.playerId, next, data.row?.profile_json ?? null);
        savedProfile = validateProfile(next);
      } catch (error) {
        if (!String(error?.message || error).includes("同時に更新") || attempt === 3) {
          console.error("Admin grant save failed:", error);
          return json({ error: "配布データを保存できませんでした。もう一度お試しください。", code: "GRANT_SAVE_FAILED" }, 409);
        }
      }
    }
    if (!savedProfile) return json({ error: "配布データを保存できませんでした。もう一度お試しください。", code: "GRANT_SAVE_FAILED" }, 409);

    // 運営が外部ゲーム用カードを直接配布した場合も、TERRACARD側の
    // ログイン自動受取で回収できるよう、通常ミッション報酬と同じ受取記録を作る。
    for (const rewardId of externalRewardIds) {
      await ensureTerraRewardDelivery(
        db,
        { role: "player", user_id: user.id, username: user.username },
        { id: "admin-grant-" + rewardId, title: "運営からの報酬配布" },
        rewardId
      );
    }
    const terraDeliveries = externalRewardIds.length
      ? await getTerraRewardDeliveryStatus(db, user.id, request)
      : [];
    return json({
      ok: true, playerId: body.playerId,
      added: { xp, catChuru, rainbowStars, items: itemCounts, characterIds, externalRewardIds, stageIds, chapterIds },
      alreadyApplied,
      profile: savedProfile,
      terraDeliveries
    });
  }

  // バトルアイテムは要求IDを記録し、接続切れ後の再試行でも二重消費しない。
  if (path === "/api/items/use" && method === "POST") {
    const auth = await requireSession(request, env);
    if (auth.error) return auth.error;
    if (auth.session.role !== "player") return json({ error: "プレイヤーでログインしてください。" }, 403);
    const body = await request.json().catch(() => ({}));
    const itemId = String(body.itemId || "");
    const requestId = String(body.requestId || "");
    if (itemId !== "speed_up" || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
      return json({ error: "使用するアイテムまたは要求IDが正しくありません。" }, 400);
    }
    const config = await loadConfig(env, request), db = getDb(env);
    for (let attempt = 0; attempt < 4; attempt++) {
      const data = await readProfileForUser(db, auth.session.user_id, config);
      if (data.profile.usedItemRequests.includes(requestId)) {
        return json({ ok: true, alreadyUsed: true, profile: data.profile });
      }
      if (Number(data.profile.items.speed_up || 0) < 1) {
        return json({ error: "スピードアップを持っていません。" }, 400);
      }
      data.profile.items.speed_up -= 1;
      data.profile.usedItemRequests = [...data.profile.usedItemRequests, requestId].slice(-100);
      try {
        await saveProfileForUser(db, auth.session.user_id, data.profile, data.row?.profile_json ?? null);
        return json({ ok: true, alreadyUsed: false, profile: validateProfile(data.profile) });
      } catch (error) {
        if (!String(error?.message || error).includes("同時に更新") || attempt === 3) {
          return json({ error: "アイテムを使用できませんでした。再確認してください。" }, 409);
        }
      }
    }
    return json({ error: "アイテムの使用が競合しました。再確認してください。" }, 409);
  }

  // ガチャ
  if (path === "/api/gacha" && method === "POST") {
    const auth = await requireSession(request, env);
    if (auth.error) return auth.error;

    if (auth.session.role !== "player") {
      return json({
        error: "プレイヤーモードでログインしてください。"
      }, 403);
    }

    const body = await request.json().catch(() => ({}));
    const count = Number(body.count ?? 1);

    if (![1, 10].includes(count)) {
      return json({
        error: "ガチャ回数が正しくありません。"
      }, 400);
    }

    const config = await loadConfig(env, request);
    const cost = Number(
      count === 10
        ? config.economy.gachaTenCost
        : config.economy.gachaSingleCost
    );

    const db = getDb(env);
    const row = await db.prepare(
      "SELECT profile_json FROM profiles WHERE user_id = ?"
    ).bind(auth.session.user_id).first();

    let original;
    try {
      original = row?.profile_json
        ? JSON.parse(row.profile_json) : null;
    } catch {
      original = null;
    }

    const profile = validateProfile(original) || {
      catChuru: 0, xp: 0, owned: [], team: [], levels: {}
    };

    if (profile.catChuru < cost) {
      return json({
        error: "CATチュールが足りません。"
      }, 400);
    }

    const pool = (config.characters || []).filter(
      c => c.side === "ally" && c.inGacha !== false
    );

    if (!pool.length) {
      return json({
        error: "ガチャに登録されているキャラクターがいません。"
      }, 400);
    }

    const rates = config.gachaRates || DEFAULT_CONFIG.gachaRates;
    const available = Object.entries(rates)
      .map(([rarity, weight]) => ({
        rarity,
        weight: Math.max(0, Number(weight) || 0),
        chars: pool.filter(c => c.rarity === rarity)
      }))
      .filter(x => x.weight > 0 && x.chars.length);

    const totalWeight = available.reduce(
      (sum, x) => sum + x.weight, 0
    );

    if (!totalWeight) {
      return json({
        error: "ガチャ確率とキャラクターのレア度設定を確認してください。"
      }, 400);
    }

    const draws = [];

    for (let i = 0; i < count; i++) {
      let roll = Math.random() * totalWeight;
      let picked = available[available.length - 1];

      for (const item of available) {
        roll -= item.weight;
        if (roll <= 0) {
          picked = item;
          break;
        }
      }

      const character =
        picked.chars[Math.floor(Math.random() * picked.chars.length)];

      draws.push(character);

      if (!profile.owned.includes(character.id)) {
        profile.owned.push(character.id);
      }

      profile.levels[character.id] = Math.max(
        1, Number(profile.levels[character.id] || 1)
      );
    }

    profile.catChuru -= cost;

    const updated = await db.prepare(
      `UPDATE profiles
       SET profile_json = ?, updated_at = ?
       WHERE user_id = ? AND profile_json = ?`
    ).bind(
      JSON.stringify(profile),
      nowSeconds(),
      auth.session.user_id,
      row?.profile_json || ""
    ).run();

    if (!updated.meta?.changes) {
      return json({
        error: "プロフィールが同時に更新されました。もう一度ガチャを押してください。"
      }, 409);
    }

    return json({ profile, draws });
  }

  // 運営：全プレイヤー一覧
  if (path === "/api/admin/players" && method === "GET") {
    const auth = await requireAdmin(request, env);
    if (auth.error) return auth.error;

    const rows = await getDb(env).prepare(
      `SELECT u.id, u.username, p.profile_json
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       ORDER BY u.created_at DESC LIMIT 500`
    ).all();

    const players = (rows.results || []).map(row => {
      let p = {};
      try {
        p = JSON.parse(row.profile_json || "{}");
      } catch {}

      return {
        id: row.id,
        username: row.username,
        catChuru: Number(p.catChuru || 0),
        xp: Number(p.xp || 0),
        rainbowStars: Number(p.rainbowStars || 0),
        items: p.items && typeof p.items === "object" ? p.items : {},
        ownedCount: Array.isArray(p.owned) ? p.owned.length : 0,
        externalRewardCount: Array.isArray(p.ownedExternalRewards) ? p.ownedExternalRewards.length : 0,
        unlockedStageCount: Array.isArray(p.unlockedStages) ? p.unlockedStages.length : 0,
        unlockedChapterCount: Array.isArray(p.unlockedChapters) ? p.unlockedChapters.length : 0
      };
    });

    return json({ players });
  }

  // 運営：プレイヤーのCATチュール・経験値変更
  if (path === "/api/admin/players" && method === "PUT") {
    const auth = await requireAdmin(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));

    if (typeof body.id !== "string") {
      return json({ error: "ユーザーIDがありません。" }, 400);
    }

    const db = getDb(env);
    const row = await db.prepare(
      "SELECT profile_json FROM profiles WHERE user_id = ?"
    ).bind(body.id).first();

    if (!row) {
      return json({
        error: "プレイヤーデータがありません。"
      }, 404);
    }

    let p;
    try {
      p = JSON.parse(row.profile_json);
    } catch {
      p = {};
    }

    p.catChuru = Math.max(
      0,
      Math.min(1000000000, Math.floor(Number(body.catChuru) || 0))
    );

    p.xp = Math.max(
      0,
      Math.min(1000000000, Math.floor(Number(body.xp) || 0))
    );

    const profile = validateProfile(p);

    await db.prepare(
      `UPDATE profiles
       SET profile_json = ?, updated_at = ?
       WHERE user_id = ?`
    ).bind(
      JSON.stringify(profile),
      nowSeconds(),
      body.id
    ).run();

    return json({ ok: true });
  }

  return json({ error: "APIが見つかりません。" }, 404);
}

function isAllowedTerraClaimOrigin(request) {
  const raw = request.headers.get("Origin");
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (
      u.hostname === "cosmosapr3-code.github.io" ||
      u.hostname.endsWith(".pages.dev") ||
      u.hostname.endsWith(".workers.dev")
    );
  } catch {
    return false;
  }
}

function addTerraClaimCors(request, response) {
  if (!isAllowedTerraClaimOrigin(request)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", request.headers.get("Origin"));
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  headers.append("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (["/api/terra-reward/ack", "/api/terra-reward/pending"].includes(url.pathname) && request.method === "OPTIONS" && isAllowedTerraClaimOrigin(request)) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": request.headers.get("Origin"),
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        await ensureSchema(env);
        const response = await handleApi(request, env);
        return (url.pathname === "/api/terra-reward/claim" || url.pathname === "/api/terra-reward/ack" || url.pathname === "/api/terra-reward/pending")
          ? addTerraClaimCors(request, response)
          : response;
      } catch (error) {
        console.error("CAT大戦争 API error:", error);
        const response = json({
          error: error?.message || "サーバー内部でエラーが発生しました。"
        }, 500);
        return (url.pathname === "/api/terra-reward/claim" || url.pathname === "/api/terra-reward/ack" || url.pathname === "/api/terra-reward/pending")
          ? addTerraClaimCors(request, response)
          : response;
      }
    }

    // Scratchゲーム本体はログイン後にiframeで読み込む。トップページindex.htmlは差し替えない。
if (request.method === "GET" && decodeURIComponent(url.pathname) === "/CAT大戦争_完全版_1ファイル軽量版.html") {
  const gameResponse = await env.ASSETS.fetch(request);
  if (!gameResponse.ok) return gameResponse;
  let html = await gameResponse.text();
  const controlStyle = "#loading,#launch,.control-button,.green-flag-button,.pause-button,.stop-all-button,.fullscreen-button,.standalone-fullscreen-button{display:none!important;visibility:hidden!important;pointer-events:none!important}";
  if (!html.includes("cat-hide-scratch-controls")) html = html.replace("</head>", '<style id="cat-hide-scratch-controls">' + controlStyle + "</style></head>");
  const readyMarker = "loadingScreen.hidden = true;";
  if (!html.includes(readyMarker)) return new Response("元ゲームの読み込み完了位置を確認できませんでした。", { status: 500 });
  html = html.replace(readyMarker, readyMarker + " window.CAT_SCRATCH_READY = true;");

  // Synchronize operator grants from D1 into the original Scratch game's own
  // variables/lists after the logged-in profile is available. Scratch stores
  // ownership by legacy character code in both "getto" and "kosu".
  const profileBridge = String.raw`<script id="cat-server-profile-bridge">
  (() => {
    if (window.__CAT_PROFILE_BRIDGE_INSTALLED) return;
    window.__CAT_PROFILE_BRIDGE_INSTALLED = true;
    let syncing = false;
    const findStage = () => window.scaffolding?.vm?.runtime?.targets?.find(target => target && target.isStage) || null;
    const findNamed = (stage, name) => Object.values(stage?.variables || {}).find(item => item && item.name === name) || null;
    const mergeList = (stage, name, values) => {
      const item = findNamed(stage, name);
      if (!item || !Array.isArray(item.value)) return false;
      const merged = [...item.value];
      const seen = new Set(merged.map(String));
      for (const value of values) {
        const key = String(value);
        if (key && !seen.has(key)) { merged.push(key); seen.add(key); }
      }
      item.value.splice(0, item.value.length, ...merged);
      return true;
    };
    async function sync() {
      if (syncing || window.CAT_PROFILE_SYNCED) return;
      syncing = true;
      try {
        const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error('profile HTTP ' + response.status);
        const data = await response.json();
        if (data.role !== 'player' || !data.profile) return;
        let stage = null;
        for (let attempt = 0; attempt < 80; attempt++) {
          stage = findStage();
          if (stage && findNamed(stage, '経験値') && findNamed(stage, 'catチュール') &&
              findNamed(stage, 'getto') && findNamed(stage, 'kosu')) break;
          await new Promise(resolve => setTimeout(resolve, 150));
        }
        if (!stage) throw new Error('Scratch stage not ready');
        const profile = data.profile;
        const currentXp = Number(findNamed(stage, '経験値')?.value || 0);
        const currentChuru = Number(findNamed(stage, 'catチュール')?.value || 0);
        const serverXp = Math.max(0, Math.floor(Number(profile.xp) || 0));
        const serverChuru = Math.max(0, Math.floor(Number(profile.catChuru) || 0));
        // Never reduce an already higher locally saved balance.
        findNamed(stage, '経験値').value = Math.max(currentXp, serverXp);
        findNamed(stage, 'catチュール').value = Math.max(currentChuru, serverChuru);
        const codeById = new Map((data.legacyCharacterCodes || []).map(item => [item.id, String(item.legacyCode)]));
        const ownedCodes = (Array.isArray(profile.owned) ? profile.owned : [])
          .map(id => codeById.get(id)).filter(Boolean);
        mergeList(stage, 'getto', ownedCodes);
        mergeList(stage, 'kosu', ownedCodes);
        window.CAT_PROFILE_SYNCED = true;
        window.CAT_PROFILE_SYNC_RESULT = {
          xp: Math.max(currentXp, serverXp),
          catChuru: Math.max(currentChuru, serverChuru),
          addedCharacters: ownedCodes.length
        };
        console.info('[CAT] D1 profile synchronized', window.CAT_PROFILE_SYNC_RESULT);
      } catch (error) {
        console.warn('[CAT] D1 profile sync failed:', error);
      } finally {
        syncing = false;
      }
    }
    window.addEventListener('CAT_AUTH_READY', event => {
      if (event?.detail?.role === 'player') sync();
    });
    if (window.CAT_AUTH?.role === 'player') sync();
  })();
  </script>`;
  if (!html.includes('cat-server-profile-bridge')) {
    html = html.replace('</body>', profileBridge + '</body>');
  }
  const headers = new Headers(gameResponse.headers);
  headers.delete("content-length"); headers.delete("content-encoding"); headers.delete("etag");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: gameResponse.status, headers });
}
return await env.ASSETS.fetch(request);
  }
};
