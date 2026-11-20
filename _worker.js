
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
  if(!p||typeof p!=="object"||Array.isArray(p))return null;
  const owned=[...new Set((Array.isArray(p.owned)?p.owned:[]).filter(x=>typeof x==="string"))].slice(0,500);
  const team=[...new Set((Array.isArray(p.team)?p.team:[]).filter(x=>typeof x==="string"&&owned.includes(x)))].slice(0,10);
  const levelsIn=p.levels&&typeof p.levels==="object"&&!Array.isArray(p.levels)?p.levels:{};
  const levels={};for(const [id,value] of Object.entries(levelsIn).slice(0,500))levels[id]=Math.max(1,Math.min(100,Math.floor(Number(value)||1)));
  const formsIn=p.forms&&typeof p.forms==="object"&&!Array.isArray(p.forms)?p.forms:{};
  const forms={};for(const [id,value] of Object.entries(formsIn).slice(0,100))forms[id]=Math.max(1,Math.min(3,Math.floor(Number(value)||1)));
  const enemyBook=[...new Set((Array.isArray(p.enemyBook)?p.enemyBook:[]).filter(x=>typeof x==="string"))].slice(0,200);
  return {catChuru:Math.max(0,Math.min(1000000000,Math.floor(Number(p.catChuru)||0))),
    xp:Math.max(0,Math.min(1000000000,Math.floor(Number(p.xp)||0))),owned,team,levels,forms,enemyBook};
}function starterProfile(config) {
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
    enemyBook: []
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
      forms: Array.isArray(saved.forms) && saved.forms.length
        ? saved.forms.map((form, index) => ({
            ...(original.forms?.[index] || {}), ...form,
            image: form.image?.startsWith("data:image/") ? form.image : original.forms?.[index]?.image
          }))
        : original.forms
    });
  }
  return [...merged.values()];
}

async function loadConfig(env, request) {
  const legacyData=await loadLegacyGameData(env,request);
  const legacyCharacters=Array.isArray(legacyData?.characters)?legacyData.characters:null;
  const baseConfig={...structuredClone(DEFAULT_CONFIG),
    characters:legacyCharacters||DEFAULT_CONFIG.characters,
    stages:Array.isArray(legacyData?.stages)&&legacyData.stages.length?legacyData.stages:DEFAULT_CONFIG.stages};
  const row=await getDb(env).prepare("SELECT value_json FROM game_config WHERE config_key = 'main'").first();
  if(!row?.value_json)return baseConfig;
  try {
    const saved=JSON.parse(row.value_json);
    return {...baseConfig,...saved,
      economy:{...DEFAULT_CONFIG.economy,...(saved.economy||{})},
      gachaRates:{...DEFAULT_CONFIG.gachaRates,...(saved.gachaRates||{})},
      characters:mergeCharacterRoster(legacyCharacters,saved.characters),
      stages:mergeLegacyStages(baseConfig.stages,saved.stages)};
  } catch { return baseConfig; }
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

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

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
      return json({
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
      });
    } catch (e) {
      return json({ ok: false, error: e.message }, 500);
    }
  }

  // 別サイトからのデータ変更を拒否
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
    !checkSameOrigin(request)
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
      if(Array.isArray(character.forms))character.forms=character.forms.map(form=>{
        const copy={...form};if(typeof copy.image==="string"&&copy.image.startsWith("data:image/"))delete copy.image;return copy;
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
        xp: Number(p.xp || 0)
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        console.error("CAT大戦争 API error:", error);
        return json({
          error: error?.message || "サーバー内部でエラーが発生しました。"
        }, 500);
      }
    }

    // API以外はGitHubの静的ファイルを返し、ゲーム本体に拡張ゲーム処理を読み込む。
    const assetResponse=await env.ASSETS.fetch(request);
    if(request.method==="GET"&&(url.pathname==="/"||url.pathname==="/index.html")&&assetResponse.ok) {
      const html=await assetResponse.text();
      const tag='<script src="/gameplay.js?v=combat-20261120-v2"></script>';
      const output=html.includes("</body>")?html.replace("</body>",tag+"</body>"):html+tag;
      const headers=new Headers(assetResponse.headers);
      headers.delete("content-length");headers.delete("content-encoding");headers.delete("etag");
      return new Response(output,{status:assetResponse.status,headers});
    }
    return assetResponse;
  }
};
