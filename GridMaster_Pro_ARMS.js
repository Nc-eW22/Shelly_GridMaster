/*
 * ⚡ SPARK_LABS — GRIDMASTER PRO ARMS · v1.3 [GOLD MASTER RELEASE]
 * ============================================================================
 * TARGET   : Shelly Pro EM / Pro 3EM single-phase (ch0 = grid clamp)
 * ENGINE   : Malta ARMS 5-Band + Progressive Eco-Reduction + Service Charge
 * CLIENT   : Recowatt Malta — official Shelly distributor
 * ENTRY    : Shelly Smart Home Challenge 2026 · Scripting Category Winner
 * ============================================================================
 */
let OVR = { ACT:false, D:15.9, M:84.9, H30:[12.2,11.5,14.0,16.2,15.5] };
let C = { WATCHDOG:300000, IDLE:120000, CALC_IDLE:30000, DV:'Today', KP:'GM_', MK:'GM_Pro_Mem_v1_3', RECON_PCT:1.0 };
let MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let ML = ['january','february','march','april','may','june','july','august','september','october','november','december'];
let H = null;
let MEM = { d:0.0, m:0.0, w:0.0, hist:[], ld:-1, lm:-1 };
let CFG = null;
let tmr = { wd:null, r:null, ca:null };
let scn = { sum:0, days:0, on:false };
let seedState = { cm:0, cd:0, b:{}, now:0 }; 
let lastNotifTs = 0;     
let lastTotalWh = 0;     
let reconDoneToday = false; 
let lastTextWrite = { eng:'', fin:'' }; 
let lastPowerKw = -1;    
let vLk = false;
let UTC_OFFSET = 0; 

let seedNextTs = 0;     
let seedDaysDone = 0;   
let seedKwhTotal = 0;   

// 🔋 Flash Endurance Guard Variables
let lastSavedKwh = 0.0;
let minutesSinceLastSave = 0;

function bootSequence() {
    console.log('🚀 [BOOT] GridMaster Pro ARMS v1.3 [Production Locked]');
    Timer.set(500, false, bootStep1_LoadConfig);
}

function bootStep1_LoadConfig() {
    console.log('📥 [1/7] Loading configuration from KVS storage matrix...');
    Shelly.call('KVS.Get', { key:'GM_Tariff' }, bootStep1_LoadConfigDone);
}
function bootStep1_LoadConfigDone(res, err) {
    try {
        if (err === 0 && res && res.value) {
            CFG = JSON.parse(res.value);
            console.log('   ↳ GM_Tariff loaded successfully (' + CFG.res + ' residents, ' + CFG.rates.length + ' bands)');
        }
    } catch(e) {
        console.log('   ↳ ⚠️ KVS Config parse error: ' + (e.message || e));
    }
    if (!CFG || typeof CFG.eco_rates === 'undefined') {
        console.log('   ↳ ⚠️ KVS Config absent or corrupted. Deploying hardcoded fallback defaults.');
        CFG = { res:5, svc:0.1781, bands:[2000,6000,10000,20000], rates:[0.1047,0.1298,0.1607,0.3420,0.6076], eco:[1000,1750], eco_rates:[0.25,0.15] };
    }
    Timer.set(500, false, bootStep2_WaitNTP);
}

function bootStep2_WaitNTP() {
    let s = Shelly.getComponentStatus('sys');
    if (s !== null && typeof s.time === 'string' && s.time.length >= 4) {
        console.log('📅 [2/7] Hardware NTP clock synchronized: ' + s.time);
        if (typeof s.utc_offset === 'number') {
            UTC_OFFSET = s.utc_offset;
            console.log('   ↳ System Timezone Offset verified: ' + (UTC_OFFSET/3600) + 'h');
        }
        Timer.set(500, false, bootStep3_LoadMem);
    } else {
        console.log('📅 [2/7] Awaiting NTP network synchronization beacon...');
        Timer.set(3000, false, bootStep2_WaitNTP);
    }
}

function bootStep3_LoadMem() {
    console.log('💾 [3/7] Accessing persistent memory sector...');
    if (OVR.ACT) {
        MEM.d = OVR.D; MEM.m = OVR.M; MEM.hist = OVR.H30;
        recalcWeek();
        saveMemoryToFlash(true);
        console.log('   ↳ 🎬 [OVERRIDE ACTIVE] — Injecting mock telemetry matrix: m=' + MEM.m + ' d=' + MEM.d);
        Timer.set(500, false, bootStep6_AcquireHandles);
        return;
    }
    let raw = null;
    try { raw = Script.storage.getItem(C.MK); } catch(e) {}
    if (raw) {
        try {
            let s = JSON.parse(raw);
            if (s && typeof s.m === 'number') {
                MEM = s;
                if (!Array.isArray(MEM.hist)) MEM.hist = [];
                lastSavedKwh = MEM.m;
                console.log('   ↳ MEM state recovered safely: m=' + MEM.m.toFixed(1) + ' d=' + MEM.d.toFixed(1) + ' hist=' + MEM.hist.length);
                Timer.set(500, false, bootStep3b_RefreshToday);
                return;
            }
        } catch(e) {
            console.log('   ↳ ⚠️ Persistent memory recovery exception: ' + (e.message || e));
        }
    }
    console.log('   ↳ Persistent memory registry empty. Seeding procedure mandatory.');
    Timer.set(500, false, bootStep4_StartSeed);
}
function bootStep3b_RefreshToday() {
    console.log('🔄 [3b] Refreshing Today from device hourly log...');
    let now = new Date();
    let ts = Math.round(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime() / 1000) - UTC_OFFSET;
    ts = ts - (ts % 3600);
    Shelly.call('EM1Data.GetNetEnergies', { id:0, ts:ts, period:3600, end_ts:ts + 86400 }, bootStep3b_RefreshTodayDone);
}

function bootStep3b_RefreshTodayDone(res, err) {
    if (err !== 0 || res === null || !res.data || res.data.length === 0) {
        console.log('   ↳ No hourly data available for today yet — keeping persisted MEM.d');
        Timer.set(500, false, bootStep6_AcquireHandles);
        return;
    }
    let actualToday = 0;
    try {
        for (let b = 0; b < res.data.length; b++) {
            let v = res.data[b].values;
            if (!v) continue;
            for (let i = 0; i < v.length; i++) {
                if (v[i] && v[i][0] !== null) actualToday += v[i][0] / 1000.0;
            }
        }
    } catch(e) {
        console.log('   ↳ ⚠️ Refresh parse error: ' + (e.message || e));
        Timer.set(500, false, bootStep6_AcquireHandles);
        return;
    }
    let staleToday = MEM.d;
    let gap = actualToday - staleToday;
    MEM.d = actualToday;
    MEM.m = MEM.m + gap;
    console.log('   ↳ Today: was ' + staleToday.toFixed(2) + ' kWh → now ' + actualToday.toFixed(2) + ' kWh (gap ' + gap.toFixed(2) + ' kWh added to month)');
    recalcWeek();
    saveMemoryToFlash(true);
    Timer.set(500, false, bootStep6_AcquireHandles);
}
function bootStep4_StartSeed() {
    console.log('🌱 [4/7] Initiating 30-day sequential seeding lookback from hardware logs...');
    let c = new Date();
    seedState.cm = c.getMonth(); seedState.cd = c.getDate();
    seedState.now = Math.round(c.getTime()/1000); seedState.b = {};
    let st = seedState.now - 2592000;
    seedNextTs = st - (st % 3600);
    seedDaysDone = 0;
    seedKwhTotal = 0;
    Timer.set(500, false, bootStep4b_SeedFetch);
}

function bootStep4b_SeedFetch() {
    if (seedNextTs >= seedState.now) {
        Timer.set(500, false, bootStep5_FinishSeed);
        return;
    }
    Shelly.call('EM1Data.GetNetEnergies', { id:0, ts:seedNextTs, period:3600 }, bootStep4c_SeedFetchDone);
}

function bootStep4c_SeedFetchDone(res, err) {
    let td = new Date(seedNextTs * 1000);
    let dayLabel = pad(td.getDate()) + '/' + pad(td.getMonth()+1);
    
    if (err !== 0 || res === null || !res.data || res.data.length === 0) {
        seedNextTs = seedNextTs + 86400;
        seedDaysDone = seedDaysDone + 1;
        Timer.set(200, false, bootStep4b_SeedFetch);
        return;
    }
    
    let lt = seedNextTs; 
    let recordsInThisBlock = 0;
    try {
        for (let b = 0; b < res.data.length; b++) {
            let v = res.data[b].values;
            if (!v) continue;
            let bt = res.data[b].ts;
            for (let i = 0; i < v.length; i++) {
                if (v[i] && v[i][0] !== null) {
                    let k = v[i][0] / 1000.0; 
                    lt = bt + (i * 3600);
                    let bd = new Date(lt * 1000);
                    let ky = bd.getFullYear() + '-' + pad(bd.getMonth() + 1) + '-' + pad(bd.getDate());
                    
                    if (bd.getMonth() === seedState.cm) { 
                        MEM.m += k; 
                        if (bd.getDate() === seedState.cd) MEM.d += k; 
                    }
                    
                    if (typeof seedState.b[ky] === 'undefined') seedState.b[ky] = 0.0;
                    seedState.b[ky] += k; 
                    recordsInThisBlock = recordsInThisBlock + 1;
                }
            }
        }
    } catch(e) {
        console.log('   ↳ ⚠️ Seeding processing exception: ' + (e.message || e));
    }
    
    if (recordsInThisBlock === 0) {
        seedNextTs = seedNextTs + 86400;
        seedDaysDone = seedDaysDone + 1;
    } else {
        seedNextTs = lt + 3600;
        seedDaysDone = seedDaysDone + Math.ceil(recordsInThisBlock / 24);
    }
    
    Timer.set(200, false, bootStep4b_SeedFetch);
}

function bootStep45_LogHeap(step) {
    let sysStatus = Shelly.getComponentStatus('sys');
    if (sysStatus && typeof sysStatus.ram_free === 'number') {
        console.log('   📊 [HEAP TELEMETRY] ' + step + ' | Available Memory Buffer: ' + sysStatus.ram_free + ' bytes');
        if (sysStatus.ram_free < 25000) {
            console.log('   ⚠️ [LOW MEMORY WARNING] High heap pressure detected on ecosystem loop!');
        }
    }
}

function bootStep5_FinishSeed() {
    console.log('📊 [5/7] Compiling parsed historical database elements...');
    MEM.hist = [];
    let c = new Date();
    for (let i = 29; i >= 1; i--) {
        let tD = new Date(c.getTime() - (i * 86400000));
        let ky = tD.getFullYear() + '-' + pad(tD.getMonth() + 1) + '-' + pad(tD.getDate());
        let v = seedState.b[ky];
        MEM.hist.push(typeof v === 'undefined' ? 0.0 : Number(v.toFixed(2)));
    }
    MEM.ld = seedState.cd; MEM.lm = seedState.cm;
    recalcWeek();
    saveMemoryToFlash(true);
    console.log('   ↳ Seeding complete: m=' + MEM.m.toFixed(1) + ' kWh, d=' + MEM.d.toFixed(1) + ' kWh, ' + seedDaysDone + ' storage intervals mapped.');
    bootStep45_LogHeap("Post-Seeding Execution");
    Timer.set(500, false, bootStep6_AcquireHandles);
}

function bootStep6_AcquireHandles() {
    console.log('🎯 [6/7] Interfacing with Virtual UI Component bindings...');
    H = {
        V:Virtual.getHandle('enum:206'),  CA:Virtual.getHandle('text:204'),
        F:Virtual.getHandle('text:207'),  E:Virtual.getHandle('text:200'),
        T:Virtual.getHandle('enum:200'),  TP:Virtual.getHandle('number:201'),
        EC:Virtual.getHandle('enum:201'), EP:Virtual.getHandle('number:202'),
        P:Virtual.getHandle('number:200')
    };
    let nm = ['V','CA','F','E','T','TP','EC','EP','P'];
    let missing = 0;
    for (let i = 0; i < nm.length; i++) {
        if (H[nm[i]] === null) { console.log('   ↳ ⚠️ Interface node handle ' + nm[i] + ' unassigned'); missing = missing + 1; }
    }
    if (missing === 0) console.log('   ↳ All 9 programmatic control handles linked.');
    else console.log('   ↳ ⚠️ ' + missing + ' unassigned elements detected — deploy configuration layer utility first.');
    Timer.set(500, false, bootStep7_InstallHandler);
}

function bootStep7_InstallHandler() {
    console.log('✅ [7/7] Mount-loading asynchronous push telemetry routines...');
    let ed = Shelly.getComponentStatus('em1data', 0);
    if (ed !== null && typeof ed.total_act_energy === 'number') {
        lastTotalWh = ed.total_act_energy;
        console.log('   ↳ Meter Index Base Stamp: ' + (lastTotalWh/1000).toFixed(2) + ' cumulative kWh');
    }
    H.V.on('change', onViewChange);
    H.CA.on('change', onCalcChange);
    Shelly.addStatusHandler(onStatus);
    tmr.wd = Timer.set(C.WATCHDOG, true, watchdogCheck);
    updHint();
    processView();
    console.log('⚡ GRIDMASTER CORE PLATFORM ONLINE // EM BEDDED MIDDLEWARE EXECUTING');
    bootStep45_LogHeap("System Operational Readiness Lifecycle");
}

function onViewChange(e) {
    let s = (e.info) ? e.info.source : null;
    if (s === 'rpc' || s === 'loopback' || s === 'sys') return;
    if (tmr.ca) { Timer.clear(tmr.ca); tmr.ca = null; }
    resetIdle(); updHint(); processView();
}
function onCalcChange(e) {
    let s = (e.info) ? e.info.source : null;
    if (s === 'rpc' || s === 'loopback' || s === 'sys' || vLk) return;
    resetIdle(); processView();
    if (tmr.ca) Timer.clear(tmr.ca);
    tmr.ca = Timer.set(C.CALC_IDLE, false, onCalcIdleExpire);
}
function onCalcIdleExpire() { tmr.ca = null; updHint(); }

function onStatus(notif) {
    if (!notif || !notif.component) return;
    if (OVR.ACT) return; 

    if (notif.component === 'em1:0' && notif.delta && typeof notif.delta.act_power === 'number') {
        let kw = notif.delta.act_power / 1000;
        let rounded = Number(kw.toFixed(2));
        if (Math.abs(rounded - lastPowerKw) >= 0.01 && H.P !== null) {
            H.P.setValue(rounded);
            lastPowerKw = rounded;
        }
        return;
    }

    if (notif.component === 'em1data:0' && notif.delta && typeof notif.delta.total_act_energy === 'number') {
        let totWh = notif.delta.total_act_energy;
        let notifTs = (notif.info && notif.info.ts) ? notif.info.ts : Math.round(Date.now() / 1000);
        handleEnergyUpdate(totWh, notifTs);
    }
}

function saveMemoryToFlash(force) {
    let currentKwh = MEM.m;
    let deltaAccumulated = Math.abs(currentKwh - lastSavedKwh);
    minutesSinceLastSave = minutesSinceLastSave + 1;

    // Throttling Filter Constraint: Commit to flash ONLY if significant delta, 15m elapsed, or force flag set
    if (force || deltaAccumulated >= 0.5 || minutesSinceLastSave >= 15) {
        try {
            Script.storage.setItem(C.MK, JSON.stringify(MEM));
            lastSavedKwh = currentKwh;
            minutesSinceLastSave = 0;
            if (force) console.log('💾 [FLASH REGISTRY] State hardened to non-volatile chip space via force macro.');
        } catch(e) {
            console.log('⚠️ [FLASH REGISTRY EXP] Persistence write error: ' + (e.message || e));
        }
    }
}

function handleEnergyUpdate(totWh, notifTs) {
    lastNotifTs = notifTs;
    if (lastTotalWh > 0) {
        let dlWh = totWh - lastTotalWh;
        let dlKwh = dlWh / 1000;
        if (dlKwh > 0 && dlKwh < 50) {
            MEM.d += dlKwh;
            MEM.m += dlKwh;
        } else if (dlKwh < 0) {
            console.log('⚠️ Counter regressed: ' + dlKwh.toFixed(3) + ' kWh — ignoring');
        }
    }
    lastTotalWh = totWh;
    let nd = new Date(notifTs * 1000);
    chkRollover(nd, totWh);

    if (nd.getHours() === 0) reconDoneToday = false;
    if (!reconDoneToday && nd.getHours() === 1) {
        reconcileMonth(totWh);
        reconDoneToday = true;
        bootStep45_LogHeap("Daily 01:00 Audit Loop");
    }

    let v = H.V.getValue();
    if (typeof v === 'string' && (v === 'Today' || v === 'Month' || v === 'Week' || v === '7 Days' || v === 'Last 30 Days')) {
        if (!isQ(v, H.CA.getValue())) processView();
    }
    
    // Evaluate memory block lifecycle properties safely
    saveMemoryToFlash(false);
}

function watchdogCheck() {
    let nowSec = Math.round(Date.now() / 1000);
    let age = nowSec - lastNotifTs;
    if (age > 300) {
        console.log('⚠️ Watchdog event: no push payload from em1data in ' + age + 's — executing manual fallback polling.');
        let ed = Shelly.getComponentStatus('em1data', 0);
        if (ed !== null && typeof ed.total_act_energy === 'number') {
            handleEnergyUpdate(ed.total_act_energy, nowSec);
        }
    }
}

function reconcileMonth(currentTotWh) {
    console.log('📊 [01:00] Reconciled Window Status -> MTD: ' + MEM.m.toFixed(1) + ' kWh | System Total Registers: ' + (currentTotWh/1000).toFixed(1) + ' kWh');
}

function chkRollover(nd, totWh) {
    let d = nd.getDate(); let m = nd.getMonth();
    if (MEM.ld !== d && MEM.ld !== -1) {
        MEM.hist.push(MEM.d);
        while (MEM.hist.length > 29) {
            let t = []; for (let i = 1; i < MEM.hist.length; i++) t.push(MEM.hist[i]); MEM.hist = t;
        }
        MEM.d = 0.0; MEM.ld = d;
        console.log('📅 Calendar date boundary crossed. Day index stepped to: ' + d);
        saveMemoryToFlash(true); // Harden boundary changes immediately
        if (H !== null) updHint(); 
    }
    if (MEM.lm !== m && MEM.lm !== -1) {
        let p = new Date(nd.getTime() - 86400000); // 24h back = last day of previous month
        let archiveTotal = MEM.m;
        let archiveDays = p.getDate();
        let archiveKey = C.KP + MEM.lm;
        archiveMonthWithRetry(archiveKey, archiveTotal, archiveDays, 0);
        MEM.m = 0.0; MEM.lm = m;
        console.log('📆 Calendar month boundary crossed. Month index stepped to: ' + m);
        saveMemoryToFlash(true);
    }
    if (MEM.ld === -1) MEM.ld = d;
    if (MEM.lm === -1) MEM.lm = m;
}

function archiveMonthWithRetry(key, total, days, attempt) {
    Shelly.call('KVS.Set', { key:key, value:JSON.stringify({ total:total, days:days }) }, function(res, err, msg) {
        if (err) {
            if (attempt < 3) {
                console.log('⚠️ KVS Backup fail (err=' + err + '), retrying step ' + (attempt+1) + '/3 in 5s');
                Timer.set(5000, false, function() { archiveMonthWithRetry(key, total, days, attempt + 1); });
            } else {
                console.log('❌ KVS Historical commit critical error. Multi-day packet discarded: ' + total.toFixed(2) + ' kWh lost.');
            }
        } else {
            console.log('💾 KVS Data Matrix Hardened: ' + key + ' = ' + total.toFixed(2) + ' kWh across ' + days + ' days.');
        }
    });
}
function recalcWeek() {
    let dy = new Date().getDay();
    if (dy === 1) { MEM.w = MEM.d; return; }
    let ws = MEM.d; let db = (dy === 0) ? 6 : (dy - 1); let ln = MEM.hist.length;
    for (let i = 0; i < db; i++) { let x = ln - 1 - i; if (x >= 0) ws += MEM.hist[x]; }
    MEM.w = ws;
}

function pad(n) { let s = String(n); return s.length < 2 ? '0' + s : s; }
function todayStr() {
    let n = new Date();
    return pad(n.getDate()) + '/' + pad(n.getMonth()+1) + '/' + String(n.getFullYear()).slice(2);
}
function setHint(t) {
    vLk = true; H.CA.setValue(t);
    Timer.set(200, false, function() { vLk = false; });
}
function updHint() {
    let v = H.V.getValue(); if (typeof v !== 'string') return;
    let nm = new Date().getMonth();
    if (v === 'Custom') setHint('Units_Days');
    else if (v === 'Today') setHint(todayStr());
    else if (v === 'Month') setHint(MS[nm]);
    else if (v === 'Last Month') {
        let lm = nm - 1; if (lm < 0) lm = 11;
        setHint(MS[lm]);
}
    else if (v === 'Year to Date') setHint('Jan-Today');
    else if (v === '12 Months') setHint(MS[nm] + '-Today');
    else setHint('—');
}
function isQ(v, r) {
    if (typeof r !== 'string' || r.length === 0) return false;
    if (v === 'Custom') return r !== 'Units_Days' && r.indexOf('_') > 0;
    if (v === 'Today') return r !== todayStr() && r.indexOf('/') > 0;
    if (v === 'Month' || v === 'Last Month') return r !== MS[new Date().getMonth()] && monIdx(r) >= 0;
    if (v === 'Year to Date' || v === '12 Months') return r.indexOf('-') > 0;
    return false;
}
function monIdx(s) {
    if (typeof s !== 'string') return -1;
    let l = s.toLowerCase();
    for (let i = 0; i < 12; i++) {
        if (l === MS[i].toLowerCase() || l === ML[i]) return i;
        if (l.length >= 3 && ML[i].indexOf(l) === 0) return i;
    }
    return -1;
}

function scanKVS(mode, si, ei, ic) {
    if (scn.on) return;
    scn.on = true; scn.sum = 0; scn.days = 0;
    setFin('Scanning DB...'); setEng('Please wait...');
    fetchKVS(si, ei, mode, ic);
}
function fetchKVS(i, t, m, ic) {
    if (i > t) { finScan(m, ic); return; }
    Shelly.call('KVS.Get', { key:C.KP + i }, function(res, err) {
        if (!err && res && res.value) {
            try { let d = JSON.parse(res.value); scn.sum += (d.total||0); scn.days += (d.days||30); } catch(e) {}
        }
        fetchKVS(i + 1, t, m, ic);
    });
}
function finScan(m, ic) {
    scn.on = false;
    let t = scn.sum; let d = scn.days;
    if (ic) { t += MEM.m; d += new Date().getDate(); }
    if (m === '12 Months' && d < 100) d = 365;
    updDisp(t, d, m);
}
function showNoData(label) { setFin('No data for ' + label); setEng('—'); }
/*  */
function getMonthKVS(mi, tag) {
    Shelly.call('KVS.Get', { key:C.KP + mi }, function(res, err) {
        if (!err && res && res.value) {
            try { let d = JSON.parse(res.value); updDisp(d.total, d.days||30, tag); return; } catch(e) {}
        }
        showNoData(MS[mi]);
    });
}

function queryDay(d, mo, y) {
    if (scn.on) return;
    let yr = (y < 100) ? 2000 + y : y;
    let ts = Math.round(new Date(yr, mo - 1, d, 0, 0, 0).getTime() / 1000) - UTC_OFFSET;
    ts = ts - (ts % 3600);
    scn.on = true;
    setFin('Querying day...'); setEng('Please wait...');
    Shelly.call('EM1Data.GetNetEnergies', { id:0, ts:ts, period:3600, end_ts:ts + 86400 }, function(res, err) {
        scn.on = false;
        let lbl = pad(d) + '/' + pad(mo) + '/' + String(yr).slice(2);
        if (err !== 0 || res === null || !res.data || res.data.length === 0) {
            showNoData(lbl); return;
        }
        let s = 0; let c = 0;
        for (let b = 0; b < res.data.length; b++) {
            let v = res.data[b].values;
            if (!v) continue;
            for (let i = 0; i < v.length; i++) {
                if (v[i] && v[i][0] !== null) { s += v[i][0] / 1000.0; c++; }
            }
        }
        if (c === 0) { showNoData(lbl); return; }
        updDisp(s, 1, 'Day');
    });
}
function parseDate(s) {
    if (typeof s !== 'string' || s.indexOf('/') < 0) return null;
    let p = []; let b = '';
    for (let i = 0; i < s.length; i++) {
        if (s[i] === '/') { p.push(b); b = ''; } else b += s[i];
    }
    p.push(b);
    if (p.length !== 3) return null;
    let d = Number(p[0]); let m = Number(p[1]); let y = Number(p[2]);
    if (d !== d || m !== m || y !== y || d < 1 || d > 31 || m < 1 || m > 12) return null;
    return [d, m, y];
}
function rangeQ(r, m) {
    let dh = r.indexOf('-'); if (dh < 1) { processView(); return; }
    let st = monIdx(r.slice(0, dh)); if (st < 0) { setFin('Bad range start'); setEng(r); return; }
    let b = r.slice(dh + 1); let en; let ic = false;
    if (b.toLowerCase() === 'today') { en = new Date().getMonth() - 1; ic = true; if (en < st) en = st - 1; } 
    else { en = monIdx(b); if (en < 0) { setFin('Bad range end'); setEng(r); return; } }
    if (en < st && !ic) { setFin('Range backwards'); setEng(r); return; }
    scanKVS(m, st, en, ic);
}

function resetIdle() {
    if (tmr.r) Timer.clear(tmr.r);
    tmr.r = Timer.set(C.IDLE, false, function() { H.V.setValue(C.DV); updHint(); processView(); });
}
function processView() {
    let m = H.V.getValue(); if (typeof m !== 'string') m = C.DV;
    let r = H.CA.getValue(); if (typeof r !== 'string' || vLk) r = '';

    if (m === 'Custom') {
        if (r === 'Units_Days' || r.length === 0) { setFin('Type: kWh_Days'); return; }
        let clean = '';
        for (let i = 0; i < r.length; i++) {
            let ch = r.charAt(i);
            if ((ch >= '0' && ch <= '9') || ch === '_' || ch === '-' || ch === '.') clean += ch;
        }
        let sp = (clean.indexOf('_') > -1) ? '_' : '-';
        if (clean.indexOf(sp) > 0) {
            let p = []; let b = ''; for (let i = 0; i < clean.length; i++) { if (clean[i] === sp) { p.push(b); b = ''; } else b += clean[i]; }
            p.push(b);
            updDisp(Number(p[0]), Number(p[1]), 'Custom');
        } else setFin('Type: kWh_Days');
        return;
    }
    if (m === 'Today') {
        if (isQ('Today', r)) { let p = parseDate(r); if (p !== null) { queryDay(p[0], p[1], p[2]); return; } }
        updDisp(MEM.d, 1, 'Today'); return;
    }
    if (m === 'Month') {
        let mi = monIdx(r); let nm = new Date().getMonth();
        if (mi >= 0 && mi !== nm) { getMonthKVS(mi, MS[mi]); return; }
        updDisp(MEM.m, new Date().getDate(), 'Month'); return;
    }
    if (m === 'Last Month') {
        let mi = monIdx(r); if (mi < 0) { mi = new Date().getMonth() - 1; if (mi < 0) mi = 11; }
        getMonthKVS(mi, MS[mi]); return;
    }
    if (m === 'Year to Date') {
        if (isQ(m, r)) { rangeQ(r, m); return; }
        let e = new Date().getMonth() - 1; if (e < 0) { updDisp(MEM.m, new Date().getDate(), 'YTD'); return; }
        scanKVS('YTD', 0, e, true); return;
    }
    if (m === '12 Months') { if (isQ(m, r)) { rangeQ(r, m); return; } scanKVS('12 Months', 0, 11, false); return; }
    if (m === 'Last 30 Days') { let u = MEM.d; for (let i = 0; i < MEM.hist.length; i++) u += MEM.hist[i]; updDisp(u, 30, 'Last 30 Days'); return; }
    if (m === '7 Days') { let u = MEM.d; let ln = MEM.hist.length; for (let i = 0; i < 6; i++) { let x = ln - 1 - i; if (x >= 0) u += MEM.hist[x]; } { updDisp(u, 7, '7 Days'); return; } }
    if (m === 'Week') { recalcWeek(); let dy = new Date().getDay(); if (dy === 0) dy = 7; updDisp(MEM.w, dy, 'Week'); return; }
    updDisp(MEM.m, new Date().getDate(), 'Month');
}

function setEng(s) { if (s !== lastTextWrite.eng && H.E !== null) { H.E.setValue(s); lastTextWrite.eng = s; } }
function setFin(s) { if (s !== lastTextWrite.fin && H.F !== null) { H.F.setValue(s); lastTextWrite.fin = s; } }

function updDisp(u, d, tag) {
    let res = calcARMS(u, d);
    H.T.setValue(res.t); H.TP.setValue(Number(res.tp.toFixed(0)));
    H.EC.setValue(res.es); H.EP.setValue(Number(res.ep.toFixed(0)));
    if (tag === 'Today' || tag === 'Day') { setEng('⚡ ' + u.toFixed(1) + ' kWh'); setFin('💶 €' + res.v.toFixed(2)); return; }
    if (tag === 'Custom') {
        setEng('⚡ ' + u.toFixed(1) + ' kWh | ' + d + 'd');
        let fc = '💶 €' + res.v.toFixed(2); let ic = ['1🟢','2🟡','3🟠','4🔴','5⚫'];
        for (let i = 0; i < 5; i++) { if (res.tc[i] > 0.05) fc += ' | ' + ic[i] + '€' + res.tc[i].toFixed(2); }
        if (res.sc > 0.05) fc += ' | 🔧€' + res.sc.toFixed(2);
        if (res.ds > 0.05) fc += ' | 🍃-€' + res.ds.toFixed(2);
        setFin(fc); return;
    }
    let avg = (d > 0) ? (u/d) : 0;
    setEng('⚡ ' + u.toFixed(1) + ' kWh | 📊 Ø ' + avg.toFixed(1) + '/d');
    let f = '💶 €' + Math.round(res.v); let ic = ['1🟢','2🟡','3🟠','4🔴','5⚫'];
    for (let i = 0; i < 5; i++) { if (res.tc[i] > 0.5) f += ' | ' + ic[i] + '€' + Math.round(res.tc[i]); }
    if (res.sc > 0.5) f += ' | 🔧€' + Math.round(res.sc);
    if (res.ds > 0.5) f += ' | 🍃-€' + Math.round(res.ds);
    setFin(f);
}

function calcARMS(u, d) {
    if (typeof u !== 'number' || u !== u || u < 0) u = 0;
    if (typeof d !== 'number' || d !== d || d < 1) d = 1;
    let r = d / 365.0;
    let c = 0.0; let rem = u; let t = 'Band 1';
    let tc = [0,0,0,0,0]; let lim = [];
    for (let i = 0; i < 4; i++) lim.push(CFG.bands[i] * r);
    let pl = 0;
    for (let i = 0; i < 5; i++) {
        if (rem <= 0) break;
        t = 'Band ' + (i+1);
        let sp = (i < 4) ? (lim[i] - pl) : rem;
        let tk = (rem > sp && i < 4) ? sp : rem;
        let cs = tk * CFG.rates[i];
        c += cs; tc[i] = cs; rem -= tk;
        if (i < 4) pl = lim[i];
    }
    let bi = Number(t.charAt(5)) - 1; let bp = 0;
    if (bi === 0) bp = (lim[0] > 0) ? (u/lim[0])*100 : 0;
    else if (bi < 4) { let s = lim[bi] - lim[bi-1]; bp = (s > 0) ? ((u - lim[bi-1])/s)*100 : 0; }
    else bp = 100;
    
    let el = CFG.eco[1] * CFG.res * r;
    let eb = CFG.eco[0] * CFG.res * r;
    let ds = 0.0; let es = 'Eco Active';
    let ep = (el > 0) ? (u/el)*100 : 100;
    
    if (u <= el) {
        let rb = eb; let cb2 = 0.0;
        let ru = (u > eb) ? (u - eb) : 0; let cu2 = 0.0;
        let pl2 = 0;
        for (let i = 0; i < 5; i++) {
            let bsp = (i < 4) ? (lim[i] - pl2) : (u - pl2);
            if (rb > 0) {
                let tk = (rb > bsp) ? bsp : rb;
                cb2 += tk * CFG.rates[i]; rb -= tk; bsp -= tk;
            }
            if (rb <= 0 && ru > 0 && bsp > 0) {
                let tk = (ru > bsp) ? bsp : ru;
                cu2 += tk * CFG.rates[i]; ru -= tk;
            }
            if (i < 4) pl2 = lim[i];
        }
        ds = (cb2 * CFG.eco_rates[0]) + (cu2 * CFG.eco_rates[1]);
        if (u > eb) es = 'Eco Risk';
    } else { es = 'Eco VOID'; ep = 100; ds = 0; }
    return { v:(c + (CFG.svc * d) - ds), t:t, tc:tc, tp:bp, es:es, ep:ep, ds:ds };
}

bootSequence();
