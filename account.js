(function () {
  "use strict";
  const CFG = window.FOODLAB_SUPABASE_CONFIG || {};
  const READY = window.FoodLabAccountReady = {};
  let resolveReady;
  READY.promise = new Promise(resolve => { resolveReady = resolve; });
  let client = null, user = null, busy = false, syncing = false, syncTimer = 0;
  const $ = id => document.getElementById(id);
  const keys = {
    diary: "foodlab-nutrition-diary-v1",
    favorites: "foodlab-favorites-v1",
    notes: "foodlab-free-notes-v1",
    settings: "foodlab-diary-settings-v1"
  };
  const scoped = key => user && Object.values(keys).includes(key) ? "foodlab-user:" + user.id + ":" + key : key;
  window.FoodLabStore = {
    getItem(key) { return localStorage.getItem(scoped(key)); },
    setItem(key, value) {
      localStorage.setItem(scoped(key), value);
      if (user && Object.values(keys).includes(key)) {
        window.dispatchEvent(new CustomEvent("foodlab:local-data-changed", { detail: { key } }));
      }
    },
    removeItem(key) { localStorage.removeItem(scoped(key)); }
  };
  const lang = () => document.documentElement.lang === "de" ? "de" : "ru";
  const tr = (ru, de) => lang() === "de" ? de : ru;
  const status = (message, kind = "") => {
    const el = $("accountStatus");
    if (el) { el.textContent = message; el.dataset.kind = kind; }
  };
  const setBusy = value => {
    busy = value;
    document.querySelectorAll("[data-auth-submit]").forEach(b => {
      b.disabled = value;
      b.textContent = value ? tr("Подождите…", "Bitte warten…") : b.dataset.label;
    });
  };
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function ensureUI() {
    const btn = $("accountBtn");
    if (!btn) return;
    btn.addEventListener("click", () => user ? showAccount() : showAuth("login"));
    const dialog = $("accountDialog");
    $("accountClose")?.addEventListener("click", closeDialog);
    dialog?.addEventListener("click", e => { if (e.target === dialog) closeDialog(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && dialog?.open) closeDialog(); });
    document.addEventListener("foodlab:account-language", renderButton);
    renderButton();
  }
  function renderButton() {
    const btn = $("accountBtn");
    if (!btn) return;
    btn.textContent = user ? tr("Аккаунт", "Konto") : tr("Войти", "Anmelden");
    btn.setAttribute("aria-label", user ? tr("Открыть аккаунт", "Konto öffnen") : tr("Войти или создать аккаунт", "Anmelden oder Konto erstellen"));
    btn.title = user ? user.email || "" : "";
  }
  function openDialog() { const d = $("accountDialog"); if (d && !d.open) d.showModal(); }
  function closeDialog() { const d = $("accountDialog"); if (d?.open) d.close(); }
  function showAuth(mode = "login", message = "") {
    const box = $("accountContent");
    if (!box) return;
    if (!client) { box.innerHTML = '<div class="kicker">FOODLAB / ACCOUNT</div><h2 id="accountDialogTitle" class="account-title">' + tr("Аккаунты ещё не настроены","Konten sind noch nicht eingerichtet") + '</h2><p class="account-copy">' + tr("Добавь URL проекта Supabase и публичный publishable key в supabase-config.js, затем настрой Auth и SQL по инструкции в supabase/README.md.","Trage die Supabase-Projekt-URL und den öffentlichen Publishable Key in supabase-config.js ein und richte Auth und SQL gemäß supabase/README.md ein.") + '</p>'; openDialog(); return; }
    const title = mode === "register" ? tr("Создать аккаунт", "Konto erstellen") :
      mode === "reset" ? tr("Восстановить пароль", "Passwort zurücksetzen") :
      mode === "new-password" ? tr("Новый пароль", "Neues Passwort") :
      tr("Вход в FoodLab", "Bei FoodLab anmelden");
    let fields = "";
    if (mode !== "new-password") fields += '<label for="authEmail">Email</label><input id="authEmail" type="email" autocomplete="email" required maxlength="254">';
    if (mode === "login" || mode === "register") fields += '<label for="authPassword">'+tr("Пароль","Passwort")+'</label><div class="auth-password"><input id="authPassword" type="password" autocomplete="'+(mode==="register"?"new-password":"current-password")+'" minlength="8" required><button type="button" id="toggleAuthPassword" aria-label="'+tr("Показать пароль","Passwort anzeigen")+'">◉</button></div>';
    if (mode === "new-password") fields += '<label for="authNewPassword">'+tr("Новый пароль","Neues Passwort")+'</label><div class="auth-password"><input id="authNewPassword" type="password" autocomplete="new-password" minlength="8" required><button type="button" id="toggleAuthPassword" aria-label="'+tr("Показать пароль","Passwort anzeigen")+'">◉</button></div>';
    box.innerHTML = '<div class="kicker">FOODLAB / ACCOUNT</div><h2 id="accountDialogTitle" class="account-title">'+title+'</h2><p class="account-copy">'+tr("Личные записи будут храниться в твоём аккаунте. Каталог доступен и без регистрации.","Deine persönlichen Einträge werden in deinem Konto gespeichert. Der Katalog bleibt ohne Registrierung nutzbar.")+'</p><form id="authForm" class="auth-form">'+fields+'<p id="authMessage" class="auth-message" role="status" aria-live="polite">'+escapeHtml(message)+'</p><button class="btn" type="submit" data-auth-submit data-label="'+tr("Продолжить","Weiter")+'">'+tr("Продолжить","Weiter")+'</button></form><div class="auth-links">'+
      (mode==="login" ? '<button type="button" data-auth-mode="register">'+tr("Создать аккаунт","Konto erstellen")+'</button><button type="button" data-auth-mode="reset">'+tr("Забыли пароль?","Passwort vergessen?")+'</button>' :
      mode==="register" ? '<button type="button" data-auth-mode="login">'+tr("Уже есть аккаунт? Войти","Schon registriert? Anmelden")+'</button>' :
      mode==="reset" ? '<button type="button" data-auth-mode="login">'+tr("Назад ко входу","Zurück zur Anmeldung")+'</button>' : "")+
      '</div>';
    box.querySelectorAll("[data-auth-mode]").forEach(b => b.addEventListener("click", () => showAuth(b.dataset.authMode)));
    $("toggleAuthPassword")?.addEventListener("click", () => {
      const input = $("authPassword") || $("authNewPassword");
      input.type = input.type === "password" ? "text" : "password";
    });
    $("authForm").addEventListener("submit", submitAuth(mode));
    openDialog();
    (mode === "new-password" ? $("authNewPassword") : $("authEmail"))?.focus();
  }
  function showAccount() {
    $("accountContent").innerHTML = '<div class="kicker">FOODLAB / ACCOUNT</div><h2 class="account-title">'+tr("Личный кабинет","Mein Konto")+'</h2><p class="account-copy">'+escapeHtml(user?.email || "")+'</p><p class="account-message" id="accountStatus" role="status" aria-live="polite">'+tr("Аккаунт подключён","Konto verbunden")+'</p><div class="account-actions"><button class="btn ghost" id="accountImport">'+tr("Перенести гостевые данные","Gastdaten übertragen")+'</button><button class="btn ghost" id="accountExport">'+tr("Экспортировать мои данные","Meine Daten exportieren")+'</button><button class="btn" id="accountLogout">'+tr("Выйти","Abmelden")+'</button></div>';
    $("accountImport").addEventListener("click", showImport);
    $("accountExport").addEventListener("click", exportData);
    $("accountLogout").addEventListener("click", logout);
    openDialog();
  }
  function submitAuth(mode) {
    return async e => {
      e.preventDefault();
      if (busy || !client) return;
      const email = $("authEmail")?.value.trim();
      const password = $("authPassword")?.value;
      const message = $("authMessage");
      setBusy(true);
      try {
        let result;
        if (mode === "register") {
          result = await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
          if (!result.error) message.textContent = tr("Проверь почту и подтверди адрес, чтобы завершить регистрацию.","Bitte prüfe dein Postfach und bestätige deine E-Mail-Adresse.");
        } else if (mode === "login") {
          result = await client.auth.signInWithPassword({ email, password });
        } else if (mode === "reset") {
          result = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "?auth=recovery" });
          if (!result.error) message.textContent = tr("Если адрес зарегистрирован, на него придёт письмо для восстановления.","Falls die Adresse registriert ist, erhältst du eine E-Mail zum Zurücksetzen.");
        } else {
          const next = $("authNewPassword").value;
          if (next.length < 8) throw new Error(tr("Пароль должен содержать минимум 8 символов.","Das Passwort muss mindestens 8 Zeichen enthalten."));
          result = await client.auth.updateUser({ password: next });
          if (!result.error) { closeDialog(); status(tr("Пароль обновлён.","Passwort aktualisiert."), "success"); }
        }
        if (result?.error) throw result.error;
        if (mode === "login" && result?.data?.session) closeDialog();
      } catch (err) {
        message.textContent = friendlyError(err);
      } finally { setBusy(false); }
    };
  }
  function friendlyError(err) {
    const m = String(err?.message || "");
    if (/invalid login credentials/i.test(m)) return tr("Неверный email или пароль.","E-Mail-Adresse oder Passwort ist falsch.");
    if (/email not confirmed/i.test(m)) return tr("Сначала подтверди email по ссылке из письма.","Bitte bestätige zuerst deine E-Mail-Adresse.");
    if (/already registered/i.test(m)) return tr("Этот email уже зарегистрирован.","Diese E-Mail-Adresse ist bereits registriert.");
    if (/password should be at least/i.test(m)) return tr("Пароль должен содержать минимум 8 символов.","Das Passwort muss mindestens 8 Zeichen enthalten.");
    if (/fetch|network/i.test(m)) return tr("Нет соединения. Проверь интернет и попробуй снова.","Keine Verbindung. Prüfe das Internet und versuche es erneut.");
    return m || tr("Не удалось выполнить запрос. Попробуй ещё раз.","Anfrage fehlgeschlagen. Bitte erneut versuchen.");
  }
  function guestSnapshot() {
    const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
    let diary = [], favorites = [], notes = "", settings = {};
    try { const d = JSON.parse(read(keys.diary) || "null"); diary = Array.isArray(d) ? d : d?.entries || []; } catch {}
    try { favorites = JSON.parse(read(keys.favorites) || "null")?.items || []; } catch {}
    try { notes = read(keys.notes) || ""; } catch {}
    try { settings = JSON.parse(read(keys.settings) || "{}") || {}; } catch {}
    return { diary, favorites, notes, settings };
  }
  function safeCalorieGoal(value) {
    return Number.isFinite(value) && value > 0 && value <= 100000 ? value : null;
  }
  function showImport() {
    const g = guestSnapshot();
    const goal = safeCalorieGoal(g.settings.goal);
    const has = g.diary.length || g.favorites.length || g.notes.trim() || goal;
    $("accountContent").innerHTML = '<div class="kicker">FOODLAB / IMPORT</div><h2 class="account-title">'+tr("Гостевые данные","Gastdaten")+'</h2><p class="account-copy">'+tr("Найдено на этом устройстве:","Auf diesem Gerät gefunden:")+'</p><ul class="import-counts"><li>'+tr("Записей дневника: ","Tagebucheinträge: ")+g.diary.length+'</li><li>'+tr("Избранных продуктов: ","Favoriten: ")+g.favorites.length+'</li><li>'+tr("Блокнот: ","Notizbuch: ")+(g.notes.trim()?tr("есть текст","Text vorhanden"):tr("пусто","leer"))+'</li><li>'+tr("Цель калорий: ","Kalorienziel: ")+(goal ?? "—")+'</li></ul><p class="account-copy">'+tr("Импорт добавит только отсутствующие записи. Облачные данные не будут перезаписаны. Локальный оригинал останется на устройстве.","Der Import ergänzt nur fehlende Einträge. Cloud-Daten werden nicht überschrieben. Das lokale Original bleibt erhalten.")+'</p><div class="account-actions"><button class="btn" id="confirmImport" '+(has?"":"disabled")+'>'+tr("Подтвердить перенос","Import bestätigen")+'</button><button class="btn ghost" id="cancelImport">'+tr("Не сейчас","Nicht jetzt")+'</button></div><p id="importStatus" class="account-message" role="status" aria-live="polite"></p>';
    $("confirmImport").addEventListener("click", importGuest);
    $("cancelImport").addEventListener("click", showAccount);
  }
  async function importGuest() {
    const g=guestSnapshot(),id=user.id,msg=$("importStatus");$("confirmImport").disabled=true;
    try{
      const dr=g.diary.map(x=>{if(!x||typeof x.id!=="string"||!x.id.trim())throw new Error("Некорректная запись гостевого дневника.");return {user_id:id,entry_id:x.id,data:x}});
      if(dr.length){const {error}=await client.from("diary_entries").upsert(dr,{onConflict:"user_id,entry_id",ignoreDuplicates:true});if(error)throw error;}
      const fr=g.favorites.filter(x=>x?.source==="catalog"&&typeof x.id==="string"&&x.id.trim()).map(x=>({user_id:id,favorite_key:"catalog:"+x.id,source:"catalog",catalog_product_id:x.id}));
      if(fr.length){const {error}=await client.from("favorites").upsert(fr,{onConflict:"user_id,favorite_key",ignoreDuplicates:true});if(error)throw error;}
      const nr=await client.from("user_notes").select("user_id").eq("user_id",id).maybeSingle();if(nr.error)throw nr.error;if(!nr.data&&g.notes){const {error}=await client.from("user_notes").insert({user_id:id,content:g.notes});if(error)throw error;}
      const sr=await client.from("user_settings").select("user_id").eq("user_id",id).maybeSingle();if(sr.error)throw sr.error;if(!sr.data&&Object.prototype.hasOwnProperty.call(g.settings,"goal")){const {error}=await client.from("user_settings").insert({user_id:id,goal:safeCalorieGoal(g.settings.goal)});if(error)throw error;}
      await loadCloud();localStorage.setItem("foodlab-import-prompted:"+id,"1");showAccount();status(tr("Перенос завершён. Локальные данные сохранены.","Import abgeschlossen. Lokale Daten bleiben erhalten."),"success");
    }catch(err){msg.textContent=tr("Перенос выполнен не полностью. Его можно безопасно повторить. ","Der Import war unvollständig und kann sicher wiederholt werden. ")+friendlyError(err);$("confirmImport").disabled=false;}
  }
  function readLocalCollection(key,kind){
    const raw=localStorage.getItem(scoped(key));if(raw===null)return [];
    const parsed=JSON.parse(raw),rows=kind==="diary"?(Array.isArray(parsed)?parsed:parsed?.entries):parsed?.items;
    if(!Array.isArray(rows))throw new Error("Неизвестный формат локальных данных. Синхронизация остановлена.");
    if(kind==="diary"&&rows.some(x=>!x||typeof x!=="object"||typeof x.id!=="string"||!x.id.trim()))throw new Error("Повреждён дневник. Облачные данные не изменены.");
    if(kind==="favorites"&&rows.some(x=>x?.source!=="catalog"||typeof x.id!=="string"||!x.id.trim()))throw new Error("Повреждено избранное. Облачные данные не изменены.");
    return rows;
  }
  function mergeById(remoteRows,localRows,idOf){const map=new Map();(remoteRows||[]).forEach(x=>map.set(idOf(x),x));(localRows||[]).forEach(x=>{const id=idOf(x);if(!map.has(id))map.set(id,x)});return [...map.values()];}
  async function loadCloud(){
    const id=user.id,[d,f,n,s]=await Promise.all([
      client.from("diary_entries").select("entry_id,data").eq("user_id",id).is("deleted_at",null),
      client.from("favorites").select("favorite_key,catalog_product_id").eq("user_id",id).is("deleted_at",null),
      client.from("user_notes").select("content").eq("user_id",id).maybeSingle(),
      client.from("user_settings").select("goal").eq("user_id",id).maybeSingle()
    ]);
    for(const x of [d,f,n,s])if(x.error)throw x.error;
    const diary=mergeById((d.data||[]).map(x=>x.data),readLocalCollection(keys.diary,"diary"),x=>String(x.id));
    const favorites=mergeById((f.data||[]).map(x=>({source:"catalog",id:x.catalog_product_id})),readLocalCollection(keys.favorites,"favorites"),x=>x.id);
    localStorage.setItem(scoped(keys.diary),JSON.stringify({version:2,entries:diary}));
    localStorage.setItem(scoped(keys.favorites),JSON.stringify({version:1,items:favorites}));
    if(n.data)localStorage.setItem(scoped(keys.notes),n.data.content||"");else if(localStorage.getItem(scoped(keys.notes))===null)localStorage.setItem(scoped(keys.notes),"");
    if(s.data)localStorage.setItem(scoped(keys.settings),JSON.stringify({goal:safeCalorieGoal(s.data.goal)}));else if(localStorage.getItem(scoped(keys.settings))===null)localStorage.setItem(scoped(keys.settings),JSON.stringify({goal:null}));
    window.dispatchEvent(new Event("foodlab:account-data-loaded"));status(tr("Данные объединены без удаления записей.","Daten wurden ohne Löschen von Einträgen zusammengeführt."),"success");
  }
  async function syncDiary(){
    const id=user.id,localRows=readLocalCollection(keys.diary,"diary"),{data:remote,error}=await client.from("diary_entries").select("entry_id").eq("user_id",id).is("deleted_at",null);if(error)throw error;
    const known=new Set((remote||[]).map(x=>x.entry_id)),missing=localRows.filter(x=>!known.has(String(x.id))).map(x=>({user_id:id,entry_id:String(x.id),data:x}));
    if(missing.length){const {error:e}=await client.from("diary_entries").upsert(missing,{onConflict:"user_id,entry_id",ignoreDuplicates:true});if(e)throw e;}
  }
  async function syncFavorites(){
    const id=user.id,localRows=readLocalCollection(keys.favorites,"favorites"),{data:remote,error}=await client.from("favorites").select("favorite_key").eq("user_id",id).is("deleted_at",null);if(error)throw error;
    const known=new Set((remote||[]).map(x=>x.favorite_key)),missing=localRows.filter(x=>!known.has("catalog:"+x.id)).map(x=>({user_id:id,favorite_key:"catalog:"+x.id,source:"catalog",catalog_product_id:x.id}));
    if(missing.length){const {error:e}=await client.from("favorites").upsert(missing,{onConflict:"user_id,favorite_key",ignoreDuplicates:true});if(e)throw e;}
  }
  async function syncSingletons(){
    const id=user.id,[nr,sr]=await Promise.all([client.from("user_notes").select("user_id").eq("user_id",id).maybeSingle(),client.from("user_settings").select("user_id").eq("user_id",id).maybeSingle()]);
    if(nr.error)throw nr.error;if(sr.error)throw sr.error;
    if(!nr.data){const notes=localStorage.getItem(scoped(keys.notes));if(notes){const {error}=await client.from("user_notes").insert({user_id:id,content:notes});if(error)throw error;}}
    if(!sr.data){const raw=localStorage.getItem(scoped(keys.settings)),settings=raw?JSON.parse(raw):{};if(Object.prototype.hasOwnProperty.call(settings,"goal")){const {error}=await client.from("user_settings").insert({user_id:id,goal:safeCalorieGoal(settings.goal)});if(error)throw error;}}
  }
  async function syncNow() {
    if(!client||!user||syncing)return false;
    syncing=true;status(tr("Синхронизация…","Synchronisierung…"));
    try{await syncDiary();await syncFavorites();await syncSingletons();status(tr("Новые записи синхронизированы. Изменения существующих записей и удаления пока не синхронизируются.","Neue Einträge synchronisiert. Änderungen bestehender Einträge und Löschungen werden noch nicht synchronisiert."),"success");return true;}
    catch(err){status(tr("Нет подтверждения облачного сохранения: ","Cloud-Speicherung nicht bestätigt: ")+friendlyError(err),"error");return false;}
    finally{syncing=false;}
  }
  function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,700);}
  async function clearUserCache(oldId) {
    if(!oldId)return;
    Object.values(keys).forEach(k=>localStorage.removeItem("foodlab-user:"+oldId+":"+k));
  }
  async function onAuthChange(nextUser) {
    const oldId=user?.id;
    user=nextUser||null;
    renderButton();
    if(oldId && oldId!==user?.id) await clearUserCache(oldId);
    if(user){
      try{await loadCloud();const guest=guestSnapshot();const hasGuest=guest.diary.length||guest.favorites.length||guest.notes.trim()||guest.settings.goal;if(hasGuest&&localStorage.getItem("foodlab-import-prompted:"+user.id)!=="1"){localStorage.setItem("foodlab-import-prompted:"+user.id,"1");showImport();}else{closeDialog();}}catch(err){showAccount();status(tr("Не удалось загрузить облачные данные: ","Cloud-Daten konnten nicht geladen werden: ")+friendlyError(err),"error");}
    } else {
      window.dispatchEvent(new Event("foodlab:account-data-loaded"));
    }
  }
  async function logout() {
    if(!client||!user)return;
    clearTimeout(syncTimer);
    const synced = await syncNow();
    if (!synced) {
      status(tr("Выход отменён: сначала дождись успешной синхронизации, чтобы не потерять изменения.","Abmeldung abgebrochen: Bitte zuerst die Synchronisierung abwarten, damit keine Änderungen verloren gehen."),"error");
      return;
    }
    const {error}=await client.auth.signOut();
    if(error){status(friendlyError(error),"error");return;}
    closeDialog();
  }
  function exportData() {
    const data={exportedAt:new Date().toISOString(),diary:[],favorites:[],notes:"",settings:{}};
    try{const d=JSON.parse(localStorage.getItem(scoped(keys.diary))||"null");data.diary=Array.isArray(d)?d:d?.entries||[];}catch{}
    try{data.favorites=JSON.parse(localStorage.getItem(scoped(keys.favorites))||"null")?.items||[];}catch{}
    data.notes=localStorage.getItem(scoped(keys.notes))||"";
    try{data.settings=JSON.parse(localStorage.getItem(scoped(keys.settings))||"{}");}catch{}
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="foodlab-export.json";a.click();URL.revokeObjectURL(url);
  }
  window.addEventListener("foodlab:local-data-changed",scheduleSync);
  window.addEventListener("online",scheduleSync);
  window.addEventListener("foodlab:account-language",renderButton);
  ensureUI();
  if (!window.supabase?.createClient || !CFG.url || !CFG.publishableKey || CFG.url.includes("YOUR_PROJECT") || CFG.publishableKey.includes("YOUR_")) {
    status(tr("Аккаунты пока не настроены. Добавь Supabase URL и publishable key.","Konten sind noch nicht konfiguriert. Supabase-URL und Publishable Key eintragen."),"warning");
    resolveReady(null);
  } else {
    client=window.supabase.createClient(CFG.url,CFG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"pkce"}});
    client.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>onAuthChange(session?.user||null),0);});
    client.auth.getSession().then(({data,error})=>{
      if(error)status(friendlyError(error),"error");
      onAuthChange(data?.session?.user||null).finally(()=>resolveReady(client));
      if(new URLSearchParams(location.search).get("auth")==="recovery")showAuth("new-password");
    }).catch(err=>{status(friendlyError(err),"error");resolveReady(client);});
  }
})();
