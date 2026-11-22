
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
  return {
    catChuru: Math.max(0, Math.min(1000000000, Math.floor(Number(p.catChuru) || 0))),
    xp: Math.max(0, Math.min(1000000000, Math.floor(Number(p.xp) || 0))),
    owned, team, levels, forms, enemyBook: ids(p.enemyBook, 200),
    completedMissions: ids(p.completedMissions, 1000),
    ownedCards: ids(p.ownedCards, 1000),
    ownedExternalRewards: ids(p.ownedExternalRewards, 1000),
    unlockedStages: ids(p.unlockedStages, 500)
  };
}
function starterProfile(config) {
  return {
    catChuru: Number(config.economy?.startingCatChuru ?? 1330),
    xp: Number(config.economy?.startingXp ?? 1250),
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
    unlockedStages: []
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
  return { id: TERRA_STAGE_ID, name: "TERRA CARD", series: "運営ステージ", chapter: "運営ステージ",
    description: "敵キャラクターと倍率を運営が設定するステージ", configured: false, multiplier: 1, rewardXp: 0, rewardChuru: 0, music: "", enemyWaves: [] };
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
  return config;
}
function mergeLegacyStages(legacyStages,savedStages) {
  const map=new Map((Array.isArray(legacyStages)?legacyStages:[]).map(x=>[x.id,x]));
  for(const saved of (Array.isArray(savedStages)?savedStages:[])) {
    if(!saved||typeof saved.id!=="string"||saved.id==="stage-1")continue;
    const original=map.get(saved.id);
    map.set(saved.id,original?{...original,...saved,
      titleImage:saved.titleImage?.startsWith("data:image/")?saved.titleImage:original.titleImage,
      enemyWaves:Array.isArray(saved.enemyWaves)?saved.enemyWaves:original.enemyWaves}:saved);
  }
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
      return json(health);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  // The one-use reward acknowledgement is allowed from the TERRA CARD frontend.
  const isTerraClaimAck = path === "/api/terra-reward/ack" && method === "POST" && isAllowedTerraClaimOrigin(request);

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

    return json({
      role: "player",
      username: s.username,
      profile
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

    await getDb(env).prepare(
      `INSERT INTO profiles
       (user_id, profile_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       updated_at = excluded.updated_at`
    ).bind(
      auth.session.user_id,
      JSON.stringify(profile),
      nowSeconds()
    ).run();

    return json({ ok: true, profile });
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
      characters: (config.characters || []).filter(c => c.side === "ally").map(c => ({ id: c.id, name: c.name })),
      enemies: (config.characters || []).filter(c => c.side === "enemy").map(c => ({ id: c.id, name: c.name })),
      allCharacters: (config.characters || []).map(c => ({ id: c.id, name: c.name, side: c.side, legacyCode: c.legacyCode || "" })),
      externalRewards: EXTERNAL_REWARD_CATALOG.map(item => ({ id: item.id, name: item.name })),
      stages: (config.stages || []).map(stage => ({ id: stage.id, name: stage.name, legacyCode: stage.legacyCode || "", series: stage.series || stage.chapter || "" }))
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

  // TERRA CARD is a new CAT stage. Operators set its enemy roster and stage multiplier.
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
    if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 100) return json({ error: "倍率は0.1〜100の範囲で指定してください。" }, 400);
    const available = new Set((config.characters || []).filter(c => c.side === "enemy").map(c => c.id));
    const enemyIds = safeStringIds(body.enemyIds, 10).filter(id => available.has(id));
    if (!enemyIds.length) return json({ error: "敵キャラクターを1体以上選んでください。" }, 400);
    const previous = (config.stages || []).find(item => item.id === TERRA_STAGE_ID) || defaultTerraStage();
    const stage = { ...previous, id: TERRA_STAGE_ID, name: "TERRA CARD", series: "運営ステージ", chapter: "運営ステージ",
      description: "運営が設定した敵キャラクターと倍率で戦うステージ", configured: true, multiplier,
      enemyWaves: enemyIds.map((characterId, index) => ({ characterId, at: 4 + index * 12, interval: 18, count: 1, hpMultiplier: 1, attackMultiplier: 1 })) };
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
    return json({ ok: true, stage, selectedEnemyIds: enemyIds });
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
    const db = getDb(env), data = await readProfileForUser(db, auth.session.user_id, config), completed = [];
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
      data.profile.completedMissions.push(mission.id); completed.push(mission);
    }
    await saveProfileForUser(db, auth.session.user_id, data.profile, data.row?.profile_json ?? null);

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
      externalRewards: EXTERNAL_REWARD_CATALOG,
      terraDeliveries
    });
  }
  // Admin grants currencies, characters, collectible cards and stage unlock flags.
  if (path === "/api/admin/grants" && method === "POST") {
    const auth = await requireAdmin(request, env); if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({}));
    if (typeof body.playerId !== "string" || !body.playerId) return json({ error: "配布先プレイヤーが指定されていません。" }, 400);
    const config = await loadConfig(env, request), db = getDb(env);
    const user = await db.prepare("SELECT id FROM users WHERE id = ?").bind(body.playerId).first();
    if (!user) return json({ error: "プレイヤーが見つかりません。", code: "PLAYER_NOT_FOUND" }, 404);

    const xp = boundedInt(body.xp), catChuru = boundedInt(body.catChuru);
    const characterIds = safeStringIds(body.characterIds, 100).filter(id => (config.characters || []).some(c => c.id === id && c.side === "ally"));
    const externalRewardIds = safeStringIds(body.externalRewardIds, 100).filter(id => EXTERNAL_REWARD_CATALOG.some(item => item.id === id));
    const stageIds = safeStringIds(body.stageIds, 300).filter(id => (config.stages || []).some(stage => stage.id === id));
    if (!xp && !catChuru && !characterIds.length && !externalRewardIds.length && !stageIds.length) {
      return json({ error: "配布する経験値・CATチュール・キャラクター・報酬・ステージを1つ以上選んでください。", code: "EMPTY_GRANT" }, 400);
    }

    let savedProfile = null;
    // 別の保存と重なった場合は最新プロフィールを読み直して配布を再適用する。
    for (let attempt = 0; attempt < 4 && !savedProfile; attempt++) {
      const data = await readProfileForUser(db, body.playerId, config);
      const next = structuredClone(data.profile);
      next.xp = boundedInt(next.xp + xp);
      next.catChuru = boundedInt(next.catChuru + catChuru);
      for (const id of characterIds) {
        if (!next.owned.includes(id)) next.owned.push(id);
        next.levels[id] = Math.max(1, Number(next.levels[id] || 1));
      }
      for (const id of externalRewardIds) if (!next.ownedExternalRewards.includes(id)) next.ownedExternalRewards.push(id);
      for (const id of stageIds) if (!next.unlockedStages.includes(id)) next.unlockedStages.push(id);
      try {
        await saveProfileForUser(db, body.playerId, next, data.row?.profile_json ?? null);
        savedProfile = next;
      } catch (error) {
        if (!String(error?.message || error).includes("同時に更新") || attempt === 3) {
          console.error("Admin grant save failed:", error);
          return json({ error: "配布データを保存できませんでした。もう一度お試しください。", code: "GRANT_SAVE_FAILED" }, 409);
        }
      }
    }
    if (!savedProfile) return json({ error: "配布データを保存できませんでした。もう一度お試しください。", code: "GRANT_SAVE_FAILED" }, 409);
    return json({
      ok: true, playerId: body.playerId,
      added: { xp, catChuru, characterIds, externalRewardIds, stageIds },
      profile: savedProfile
    });
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
        ownedCount: Array.isArray(p.owned) ? p.owned.length : 0,
        externalRewardCount: Array.isArray(p.ownedExternalRewards) ? p.ownedExternalRewards.length : 0,
        unlockedStageCount: Array.isArray(p.unlockedStages) ? p.unlockedStages.length : 0
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

    if (url.pathname === "/api/terra-reward/ack" && request.method === "OPTIONS" && isAllowedTerraClaimOrigin(request)) {
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
        return (url.pathname === "/api/terra-reward/claim" || url.pathname === "/api/terra-reward/ack")
          ? addTerraClaimCors(request, response)
          : response;
      } catch (error) {
        console.error("CAT大戦争 API error:", error);
        const response = json({
          error: error?.message || "サーバー内部でエラーが発生しました。"
        }, 500);
        return (url.pathname === "/api/terra-reward/claim" || url.pathname === "/api/terra-reward/ack")
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
  const headers = new Headers(gameResponse.headers);
  headers.delete("content-length"); headers.delete("content-encoding"); headers.delete("etag");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: gameResponse.status, headers });
}
return await env.ASSETS.fetch(request);
  }
};
