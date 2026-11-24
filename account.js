(function () {
  "use strict";
  const CFG = window.FOODLAB_SUPABASE_CONFIG || {};
  const scriptURL = document.currentScript?.src || location.href;
  const READY = window.FoodLabAccountReady = {};
  let resolveReady;
  READY.promise = new Promise(resolve => { resolveReady = resolve; });
  let client = null, user = null, busy = false, syncTimer = 0, syncTask = null;
  let epoch = 0, again = false, lastStatus = "", lastKind = "", recovery = false;
  const $ = id => document.getElementById(id);
  const keys = { diary: "foodlab-nutrition-diary-v1", favorites: "foodlab-favorites-v1", notes: "foodlab-free-notes-v1", settings: "foodlab-diary-settings-v1" };
  const prefix = id => "foodlab-user:" + id + ":";
  const scoped = key => user && Object.values(keys).includes(key) ? prefix(user.id) + key : key;
  const lang = () => document.documentElement.lang === "de" ? "de" : "ru";
  const tr = (ru, de) => lang() === "de" ? de : ru;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function status(message, kind = "") {
    lastStatus = message; lastKind = kind;
    const el = $("accountStatus");
    if (el) { el.textContent = message; el.dataset.kind = kind; }
    const btn = $("accountBtn");
    if (btn) btn.title = message;
  }
  function changed() { window.dispatchEvent(new Event("foodlab:account-data-loaded")); }
  window.FoodLabStore = {
    getItem(key) { return localStorage.getItem(scoped(key)); },
    setItem(key, value) {
      localStorage.setItem(scoped(key), value);
      if (user && Object.values(keys).includes(key)) {
        status(tr("Сохранено на устройстве; ожидает отправки.", "Lokal gespeichert; Übertragung ausstehend."), "pending");
        window.dispatchEvent(new CustomEvent("foodlab:local-data-changed", { detail: { key } }));
      }
    },
    removeItem(key) {
      if (user && Object.values(keys).includes(key)) {
        const value = key === keys.diary ? JSON.stringify({version:2,entries:[]}) : key === keys.favorites ? JSON.stringify({version:1,items:[]}) : key === keys.settings ? JSON.stringify({goal:null}) : "";
        this.setItem(key, value);
      } else localStorage.removeItem(scoped(key));
    }
  };
  function renderButton() {
    const btn = $("accountBtn");
    if (btn) { btn.textContent = user ? tr("Аккаунт", "Konto") : tr("Войти", "Anmelden"); btn.setAttribute("aria-label", btn.textContent); }
  }
  function openDialog() { const d = $("accountDialog"); if (d && !d.open) d.showModal(); }
  function closeDialog() { $("accountDialog")?.close(); }
  function ensureUI() {
    $("accountBtn")?.addEventListener("click", () => user ? showAccount() : showAuth("login"));
    $("accountClose")?.addEventListener("click", closeDialog);
    $("accountDialog")?.addEventListener("click", e => { if (e.target === $("accountDialog")) closeDialog(); });
    window.addEventListener("foodlab:account-language", renderButton);
    renderButton();
  }
  function showAuth(mode = "login") {
    const box = $("accountContent"); if (!box) return;
    if (!client) { box.innerHTML = '<h2 id="accountDialogTitle">'+tr("Аккаунты недоступны", "Konten nicht verfügbar")+'</h2><p>'+tr("Проверь настройку Supabase и подключение к сети.", "Supabase-Konfiguration und Netzwerk prüfen.")+'</p>'; openDialog(); return; }
    const titles = { login: tr("Вход в FoodLab","Bei FoodLab anmelden"), register: tr("Создать аккаунт","Konto erstellen"), reset: tr("Восстановить пароль","Passwort zurücksetzen"), password: tr("Новый пароль","Neues Passwort") };
    let fields = mode === "password" ? "" : '<label for="authEmail">Email</label><input id="authEmail" type="email" autocomplete="email" required maxlength="254">';
    if (mode !== "reset") fields += '<label for="authPassword">'+tr("Пароль","Passwort")+'</label><div class="auth-password"><input id="authPassword" type="password" autocomplete="'+(mode === "login" ? "current-password" : "new-password")+'" minlength="8" required><button type="button" id="toggleAuthPassword" aria-label="'+tr("Показать пароль","Passwort anzeigen")+'">◉</button></div>';
    box.innerHTML = '<div class="kicker">FOODLAB / ACCOUNT</div><h2 class="account-title" id="accountDialogTitle">'+titles[mode]+'</h2><form class="auth-form" id="authForm">'+fields+'<p id="authMessage" role="status" aria-live="polite"></p><button class="btn" type="submit" data-auth-submit>'+tr("Продолжить","Weiter")+'</button></form><div class="auth-links">'+(mode === "password" ? "" : ["login","register","reset"].filter(x => x !== mode).map(x => '<button type="button" data-auth-mode="'+x+'">'+titles[x]+'</button>').join(""))+'</div>';
    box.querySelectorAll("[data-auth-mode]").forEach(b => b.onclick = () => { if (!busy) showAuth(b.dataset.authMode); });
    $("toggleAuthPassword")?.addEventListener("click", e => {
      const input = $("authPassword"), show = input.type === "password";
      input.type = show ? "text" : "password";
      e.currentTarget.setAttribute("aria-label", show ? tr("Скрыть пароль","Passwort verbergen") : tr("Показать пароль","Passwort anzeigen"));
    });
    $("authForm").onsubmit = async e => {
      e.preventDefault(); if (busy) return;
      busy = true; const button = e.currentTarget.querySelector("[data-auth-submit]"), message = $("authMessage"); button.disabled = true;
      try {
        const email = $("authEmail")?.value.trim(), password = $("authPassword")?.value;
        const redirect = location.origin + location.pathname;
        let result;
        if (mode === "register") result = await client.auth.signUp({email,password,options:{emailRedirectTo:redirect}});
        else if (mode === "reset") result = await client.auth.resetPasswordForEmail(email,{redirectTo:redirect+"?auth=recovery"});
        else if (mode === "password") result = await client.auth.updateUser({password});
        else result = await client.auth.signInWithPassword({email,password});
        if (result.error) throw result.error;
        if (mode === "register") message.textContent = tr("Проверь почту для подтверждения адреса.","Bitte bestätige deine E-Mail-Adresse im Postfach.");
        else if (mode === "reset") message.textContent = tr("Если адрес зарегистрирован, придёт письмо для восстановления.","Falls die Adresse registriert ist, erhältst du eine E-Mail.");
        else { if (mode === "password") { recovery = false; history.replaceState(null,"",location.pathname+location.hash); } closeDialog(); }
      } catch (error) { message.textContent = friendlyError(error); }
      finally { busy = false; button.disabled = false; }
    };
    openDialog(); ($("authEmail") || $("authPassword"))?.focus();
  }
  function friendlyError(error) {
    const text = String(error?.message || "");
    if (error?.code === "SYNC_CONFLICT") return tr("Конфликт версий. Данные не перезаписаны. Экспортируй копию; требуется выбор версии.","Versionskonflikt. Daten wurden nicht überschrieben. Kopie exportieren; Versionsauswahl erforderlich.");
    if (/invalid login credentials/i.test(text)) return tr("Неверный email или пароль.","E-Mail oder Passwort falsch.");
    if (/email not confirmed/i.test(text)) return tr("Подтверди адрес по ссылке из письма.","Bitte bestätige deine E-Mail-Adresse.");
    if (/fetch|network/i.test(text)) return tr("Нет соединения. Локальные данные сохранены.","Keine Verbindung. Lokale Daten bleiben erhalten.");
    return tr("Операция не завершена. Проверь подключение и настройки; локальные данные не удалены.","Vorgang nicht abgeschlossen. Verbindung und Einstellungen prüfen; lokale Daten wurden nicht gelöscht.");
  }
  function showAccount() {
    if (!user) return showAuth();
    $("accountContent").innerHTML = '<div class="kicker">FOODLAB / ACCOUNT</div><h2 id="accountDialogTitle" class="account-title">'+tr("Личный кабинет","Mein Konto")+'</h2><p>'+esc(user.email || "")+'</p><p id="accountStatus" role="status" aria-live="polite"></p><p class="account-copy">'+tr("Копия данных аккаунта остаётся в этом браузере после выхода. Не используй общий профиль браузера для личных записей.","Eine Kontokopie bleibt nach der Abmeldung in diesem Browser. Für persönliche Einträge kein gemeinsam genutztes Browserprofil verwenden.")+'</p><div class="account-actions"><button class="btn ghost" id="accountSync">'+tr("Синхронизировать","Synchronisieren")+'</button><button class="btn ghost" id="accountImport">'+tr("Перенести гостевые данные","Gastdaten übertragen")+'</button><button class="btn ghost" id="accountExport">'+tr("Экспортировать мои данные","Meine Daten exportieren")+'</button><button class="btn" id="accountLogout">'+tr("Выйти","Abmelden")+'</button></div>';
    $("accountSync").onclick = syncNow; $("accountImport").onclick = showImport; $("accountExport").onclick = exportData; $("accountLogout").onclick = logout;
    status(lastStatus || tr("Облачное сохранение ещё не подтверждено.","Cloud-Speicherung noch nicht bestätigt."), lastKind); openDialog();
  }
  function validGoal(value) { return value === null || typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100000; }
  function readValues(id) {
    const out = {};
    for (const [name,key] of Object.entries(keys)) {
      const raw = localStorage.getItem(prefix(id)+key); if (raw === null) continue;
      if (name === "notes") { out.notes = raw; continue; }
      const parsed = JSON.parse(raw);
      if (name === "settings") { if (!parsed || !validGoal(parsed.goal)) throw new Error("Invalid settings"); out.settings = {goal:parsed.goal}; continue; }
      const rows = name === "diary" ? (Array.isArray(parsed) ? parsed : parsed?.entries) : parsed?.items;
      if (!Array.isArray(rows)) throw new Error("Invalid collection");
      if (name === "favorites" && rows.some(x => x?.source !== "catalog")) throw new Error("Invalid favorite source");
      window.FoodLabSync.planCollection({base:[],local:rows,remote:[]}); out[name] = rows;
    }
    return out;
  }
  const baseKey = id => prefix(id)+"foodlab-sync-base-v1";
  function readBase(id) {
    const raw = localStorage.getItem(baseKey(id)); if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)) throw new Error("Invalid sync snapshot");
    window.FoodLabSync.canonical(parsed.values); return parsed.values;
  }
  function guard(id, token) { if (user?.id !== id || epoch !== token) throw new Error("Account changed"); }
  const definitions = {
    diary:{table:"diary_entries",pk:"entry_id",collection:true},
    favorites:{table:"favorites",pk:"favorite_key",collection:true},
    notes:{table:"user_notes",pk:"user_id"}, settings:{table:"user_settings",pk:"user_id"}
  };
  async function fetchCloud(id, token) {
    const cloud = {}, rows = {};
    for (const [name,def] of Object.entries(definitions)) {
      let all = [], start = 0;
      while (true) {
        guard(id,token);
        const result = await client.from(def.table).select("*").eq("user_id",id).order(def.pk).range(start,start+199);
        if (result.error) throw result.error;
        guard(id,token);
        if (!Array.isArray(result.data)) throw new Error("Incomplete cloud response");
        all.push(...result.data);
        if (result.data.length < 200) break;
        start += 200;
      }
      rows[name] = all;
      const active = all.filter(x => !x.deleted_at);
      if (name === "diary") { if (active.some(x=>!x.data || x.data.id!==x.entry_id)) throw new Error("Invalid remote diary"); cloud.diary = active.map(x=>x.data); }
      else if (name === "favorites") { if (active.some(x=>x.source!=="catalog" || x.favorite_key!=="catalog:"+x.catalog_product_id)) throw new Error("Invalid remote favorite"); cloud.favorites = active.map(x=>({source:"catalog",id:x.catalog_product_id})); }
      else if (active.length) {
        if (active.length !== 1) throw new Error("Invalid singleton");
        if (name === "notes") { if (typeof active[0].content !== "string") throw new Error("Invalid note"); cloud.notes = active[0].content; }
        else { if (!validGoal(active[0].goal)) throw new Error("Invalid goal"); cloud.settings = {goal:active[0].goal}; }
      }
    }
    return {values:cloud,rows};
  }
  function plans(base, local, remote) {
    const result = {}, conflicts = [];
    for (const [name,def] of Object.entries(definitions)) {
      const present = Object.prototype.hasOwnProperty.call(local,name);
      const value = present ? local[name] : base !== null ? base[name] : remote[name];
      if (def.collection) {
        result[name] = window.FoodLabSync.planCollection({base:base===null?null:base[name]||[],local:value||[],remote:remote[name]||[]});
        conflicts.push(...result[name].conflicts.map(x=>({dataset:name,...x})));
      } else {
        const p = window.FoodLabSync.planValue({known:base!==null,base:base?.[name],local:value,remote:remote[name]});
        result[name] = {merged:p.value,operations:p.action==="none"||p.action==="conflict"?[]:[{action:p.action,value:p.value}],conflicts:[]};
        if (p.action === "conflict") conflicts.push({dataset:name,base:base?.[name],local:value,remote:remote[name]});
      }
    }
    return {result,conflicts};
  }
  function conflict(id, items) {
    localStorage.setItem(prefix(id)+"foodlab-sync-conflicts-v1",JSON.stringify({version:1,createdAt:new Date().toISOString(),items}));
    const error = new Error("Sync conflict"); error.code = "SYNC_CONFLICT"; throw error;
  }
  async function applyPlans(id, token, plan, remote, base) {
    for (const [name,def] of Object.entries(definitions)) for (const op of plan[name].operations) {
      guard(id,token);
      const pk = name === "favorites" ? "catalog:"+op.id : def.collection ? op.id : id;
      const existing = remote.rows[name].find(x=>x[def.pk]===pk);
      let payload;
      if (name === "diary") payload = {data:op.value,deleted_at:null};
      else if (name === "favorites") payload = {source:"catalog",catalog_product_id:op.id,deleted_at:null};
      else if (name === "notes") payload = {content:op.value};
      else payload = {goal:op.value?.goal??null};
      if (op.action === "delete") {
        if (!def.collection) throw new Error("Singleton must be explicitly cleared");
        payload = {deleted_at:new Date().toISOString()};
      }
      let query;
      if (existing) {
        if (existing.deleted_at && base === null) conflict(id,[{dataset:name,id:op.id,reason:"unknown-baseline-tombstone"}]);
        if (typeof existing.updated_at !== "string") throw new Error("Missing remote revision");
        query = client.from(def.table).update(payload).eq("user_id",id).eq(def.pk,pk).eq("updated_at",existing.updated_at).select("*");
      } else {
        if (op.action !== "insert") conflict(id,[{dataset:name,id:op.id,reason:"missing-revision"}]);
        query = client.from(def.table).insert({...payload,user_id:id,[def.pk]:pk}).select("*");
      }
      const result = await query; guard(id,token);
      if (result.error) throw result.error;
      if (!Array.isArray(result.data) || result.data.length !== 1) conflict(id,[{dataset:name,id:op.id,reason:"revision-changed"}]);
    }
  }
  function writeValues(id, plan) {
    for (const [name,key] of Object.entries(keys)) {
      let value = plan[name].merged;
      if (name === "diary") value = JSON.stringify({version:2,entries:value});
      else if (name === "favorites") value = JSON.stringify({version:1,items:value});
      else if (name === "settings") value = JSON.stringify(value || {goal:null});
      else value = value ?? "";
      const keyName = prefix(id)+key;
      if (localStorage.getItem(keyName) !== value) localStorage.setItem(keyName,value);
    }
  }
  async function synchronize(id,token) {
    const base = readBase(id), remote = await fetchCloud(id,token);
    const sent = readValues(id), first = plans(base,sent,remote.values);
    if (first.conflicts.length) conflict(id,first.conflicts);
    await applyPlans(id,token,first.result,remote,base);
    const confirmed = await fetchCloud(id,token); guard(id,token);
    // Rebase in-flight edits against the intended merged state, not against stale local data.
    const intended = Object.fromEntries(Object.entries(first.result).filter(([,p])=>p.merged!==undefined).map(([name,p])=>[name,p.merged]));
    const current = readValues(id);
    const rebased = plans(sent,current,intended);
    if (rebased.conflicts.length) conflict(id,rebased.conflicts);
    const rebasedValues = Object.fromEntries(Object.entries(rebased.result).filter(([,p])=>p.merged!==undefined).map(([name,p])=>[name,p.merged]));
    const final = plans(intended,rebasedValues,confirmed.values);
    if (final.conflicts.length) conflict(id,final.conflicts);
    writeValues(id,final.result);
    localStorage.setItem(baseKey(id),JSON.stringify({version:1,values:confirmed.values}));
    localStorage.removeItem(prefix(id)+"foodlab-sync-conflicts-v1");
    guard(id,token); changed();
    const pending = Object.values(final.result).some(p=>p.operations.length);
    if (pending) again = true;
    status(pending ? tr("Новые изменения ожидают отправки.","Neue Änderungen warten auf Übertragung.") : tr("Сохранено в аккаунте.","Im Konto gespeichert."),pending?"pending":"success");
    return !pending;
  }
  async function syncNow() {
    if (!client || !user || !window.FoodLabSync) return false;
    if (syncTask) { again = true; return syncTask; }
    const id = user.id, token = epoch;
    status(tr("Синхронизация…","Synchronisierung…"),"pending");
    syncTask = synchronize(id,token).catch(error=>{
      if (user?.id===id && epoch===token) status(friendlyError(error),"error"); return false;
    }).finally(()=>{ syncTask=null; if(again && user?.id===id && epoch===token){again=false;scheduleSync();} });
    return syncTask;
  }
  function scheduleSync() { clearTimeout(syncTimer); if (syncTask) again=true; else syncTimer=setTimeout(syncNow,700); }
  async function clearUserCache() { /* Keep namespaced local edits until explicit data removal is implemented. */ }
  async function onAuthChange(nextUser) {
    if (user?.id === nextUser?.id) { user=nextUser||null; return; }
    clearTimeout(syncTimer); again=false; epoch++; user=nextUser||null;
    lastStatus=""; lastKind=""; renderButton(); changed();
    if (user) { const id=user.id, token=epoch; if(syncTask)await syncTask; if(user?.id!==id || epoch!==token)return; const ok=await syncNow(); if (ok && !recovery && user?.id===id && epoch===token) closeDialog(); }
  }
  async function logout() {
    if (!user || !client || busy) return;
    busy=true; clearTimeout(syncTimer);
    try {
      if (syncTask) await syncTask;
      if (!await syncNow()) { showAccount(); return; }
      const result=await client.auth.signOut(); if(result.error)throw result.error; closeDialog();
    } catch(error) { status(friendlyError(error),"error"); }
    finally { busy=false; }
  }
  function guestSnapshot() {
    const get = key => localStorage.getItem(key);
    const d=JSON.parse(get(keys.diary)||"null"), f=JSON.parse(get(keys.favorites)||"null"), s=JSON.parse(get(keys.settings)||"null");
    const diary=Array.isArray(d)?d:d?.entries||[], favorites=f?.items||[];
    window.FoodLabSync.planCollection({base:[],local:diary,remote:[]});
    window.FoodLabSync.planCollection({base:[],local:favorites,remote:[]});
    if(favorites.some(x=>x.source!=="catalog") || s && !validGoal(s.goal))throw new Error("Invalid guest data");
    return {diary,favorites,notes:get(keys.notes)||"",settings:s?{goal:s.goal}:undefined};
  }
  function showImport() {
    try {
      const g=guestSnapshot();
      $("accountContent").innerHTML='<h2 id="accountDialogTitle" class="account-title">'+tr("Гостевые данные","Gastdaten")+'</h2><p>'+tr("Дневник: ","Tagebuch: ")+g.diary.length+'; '+tr("избранное: ","Favoriten: ")+g.favorites.length+'</p><p>'+tr("Будут добавлены только отсутствующие записи. Локальный оригинал останется. Существующие заметки не заменяются.","Nur fehlende Einträge werden ergänzt. Das lokale Original bleibt. Vorhandene Notizen werden nicht ersetzt.")+'</p><button class="btn" id="confirmImport">'+tr("Подтвердить перенос","Import bestätigen")+'</button><button class="btn ghost" id="cancelImport">'+tr("Отмена","Abbrechen")+'</button><p id="importStatus" role="status"></p>';
      $("confirmImport").onclick=importGuest; $("cancelImport").onclick=showAccount;
    } catch(error) { status(friendlyError(error),"error"); }
  }
  async function importGuest() {
    if (!user || busy) return;
    busy=true; const id=user.id, token=epoch, button=$("confirmImport"); if(button)button.disabled=true;
    try {
      if(syncTask)await syncTask;
      guard(id,token); const g=guestSnapshot(), local=readValues(id), remote=await fetchCloud(id,token); guard(id,token);
      for(const name of ["diary","favorites"]){
        const rows=local[name]||remote.values[name]||[], known=new Set([...rows,...(remote.values[name]||[])].map(x=>x.id));
        const extra=g[name].filter(x=>!known.has(x.id));
        if(extra.length) window.FoodLabStore.setItem(keys[name],JSON.stringify(name==="diary"?{version:2,entries:[...rows,...extra]}:{version:1,items:[...rows,...extra]}));
      }
      if (!Object.prototype.hasOwnProperty.call(local,"notes") && !Object.prototype.hasOwnProperty.call(remote.values,"notes") && g.notes) window.FoodLabStore.setItem(keys.notes,g.notes);
      if (!Object.prototype.hasOwnProperty.call(local,"settings") && !Object.prototype.hasOwnProperty.call(remote.values,"settings") && g.settings) window.FoodLabStore.setItem(keys.settings,JSON.stringify(g.settings));
      changed(); const ok=await syncNow(); guard(id,token); showAccount();
      if(ok)status(tr("Перенос завершён. Гостевые оригиналы сохранены.","Import abgeschlossen. Gastoriginale bleiben erhalten."),"success");
    } catch(error) { if(user?.id===id && epoch===token) { showAccount();status(friendlyError(error),"error"); } }
    finally {busy=false;if(button)button.disabled=false;}
  }
  function exportData() {
    if(!user)return;
    try {
      const data={version:1,exportedAt:new Date().toISOString(),...readValues(user.id),syncBase:readBase(user.id),conflicts:JSON.parse(localStorage.getItem(prefix(user.id)+"foodlab-sync-conflicts-v1")||"null")};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download="foodlab-export.json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {status(friendlyError(error),"error");}
  }
  window.addEventListener("foodlab:local-data-changed",scheduleSync);
  window.addEventListener("online",scheduleSync);
  ensureUI();
  async function initialize() {
    try {
      if(!window.FoodLabSync)await import(new URL("sync-engine.js",scriptURL).href);
      if(!window.FoodLabSync || !window.supabase?.createClient || !CFG.url || !CFG.publishableKey)throw new Error("Missing configuration");
      client=window.supabase.createClient(CFG.url,CFG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}});
      recovery=new URLSearchParams(location.search).get("auth")==="recovery";
      const session=await client.auth.getSession(); if(session.error)throw session.error;
      await onAuthChange(session.data?.session?.user||null);
      client.auth.onAuthStateChange((event,s)=>{setTimeout(async()=>{
        try {if(event==="PASSWORD_RECOVERY")recovery=true;await onAuthChange(s?.user||null);if(recovery&&s?.user)showAuth("password");}
        catch(error){status(friendlyError(error),"error");}
      },0);});
      if(recovery&&user)showAuth("password");
    } catch(error) {status(friendlyError(error),"error");}
    finally {resolveReady(client);}
  }
  initialize();
})();
