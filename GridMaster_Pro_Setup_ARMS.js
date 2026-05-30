/*
 * ⚡ SPARK_LABS — GRIDMASTER PRO ARMS · SETUP v1.0-beta
 * =============================================================
 *  Turning everyday Shelly devices into truly smart virtual appliances.
 * =============================================================
 *  TARGET   : Shelly Pro EM / Pro 3EM single-phase
 *  PARTNER  : GridMaster_Pro_ARMS_v1_0_beta.js (brain)
 *  REPO     : github.com/SPARK_LABS/Shelly_GridMaster
 *
 *  QUICK START
 *  -----------
 *  1. Edit VC_MODE / KVS_MODE below (defaults = 'install', 'install')
 *  2. Edit PREFILL_HISTORY with your 12 months of kWh totals (or zeros)
 *  3. Edit CFG_* tariff constants — defaults are Malta ARMS 2025
 *  4. Flash, run, watch console for ✅ COMPLETE
 *  5. Disable this installer, flash and start the brain
 *
 *  MODES
 *  -----
 *  install = wipe + provision from scratch
 *  update  = SetConfig only (refresh icons/titles/max_len, no data touch)
 *  delete  = remove managed VCs / all GM_* KVS keys
 *  skip    = no-op for that subsystem
 *
 *  COMMON COMBOS
 *  -------------
 *  Fresh device         VC=install  KVS=install
 *  Rebuild UI only      VC=install  KVS=skip
 *  Tariff rate change   VC=skip     KVS=update
 *  Icon refresh         VC=update   KVS=skip
 *  Factory reset        VC=delete   KVS=delete
 * =============================================================
 */

// =============================================================
//  SECTION 1 — DEPLOYMENT MODES (per-run)
//   Pre-flight checklist:
//     [ ] Modes set correctly for this run
//     [ ] Section 2 tariff matches your utility (Malta ARMS default)
//     [ ] Section 3 UX preferences look right
//     [ ] Section 4 contact + VC names branded for your install
//     [ ] Section 6 PREFILL_HISTORY edited (or left as zeros)
// =============================================================
let VC_MODE  = 'install'; // 'install' | 'update' | 'delete' | 'skip'
let KVS_MODE = 'install'; // 'install' | 'update' | 'delete' | 'skip'

// =============================================================
//  SECTION 2 — TARIFF (written to GM_Tariff KVS)
//   Brain reads this for ALL billing math.
//   Changing values here + KVS_MODE='update' refreshes the brain on next boot.
// =============================================================
let CFG_RESIDENTS  = 5;                            // household size
let CFG_SVC_CHARGE = 0.1781;                       // service charge €/day
let CFG_BANDS      = [2000, 6000, 10000, 20000];   // 5-tier annual kWh thresholds
let CFG_RATES      = [0.1047, 0.1298, 0.1607, 0.3420, 0.6076]; // €/kWh per band
let CFG_ECO        = [1000, 1750];                 // per-resident annual [base, upper]
let CFG_ECO_RATES  = [0.25, 0.15];                 // [base discount %, upper discount %]

// =============================================================
//  SECTION 3 — UX PREFERENCES (written to GM_UX KVS)
// =============================================================
let CFG_POW_MAX    = 6;        // Live Power slider max (kW) — match your CT rating
let CFG_IDLE_TO    = 120;      // seconds before view auto-reverts to default
let CFG_CALC_IDLE  = 30;       // seconds before CALC field reverts to hint
let CFG_DEF_VIEW   = 'Today';  // home/default view

// =============================================================
//  SECTION 4 — BRANDING + VC TEXT (written to GM_Brand KVS)
//   CFG_CONTACT is also stamped as default_value on text VCs so it shows
//   when the brain isn't running. Brain may also append it on runtime errors.
// =============================================================
let CFG_CONTACT    = 'Contact Recowatt 7994567';

// VC display names — install-time only, edit and re-run with VC_MODE='install' or 'update'
let VC_NAME_VIEW    = 'View';
let VC_NAME_POWER   = 'Live Power';
let VC_NAME_ENERGY  = 'ECO-TRACKER';
let VC_NAME_TARIFF  = 'Tariff';
let VC_NAME_TAR_PCT = 'Tariff Consumed';
let VC_NAME_ECO_ST  = 'Eco Status';
let VC_NAME_ECO_PCT = 'Eco Quota Used';
let VC_NAME_FIN     = 'Financial Status';
let VC_NAME_CALC    = 'Bill Calculator';
let VC_NAME_GROUP   = 'Energy Management';

// =============================================================
//  SECTION 5 — ICON MAP (Icons8 URLs — substitute any valid image URL)
// =============================================================
let ICONS = {
    view:    'https://img.icons8.com/?size=100&id=nZF8SFgVUZZJ&format=png&color=40C057',
    power:   'https://img.icons8.com/?size=100&id=41273&format=png&color=40C057',
    leaf:    'https://img.icons8.com/?size=100&id=63SQPfl3bwBR&format=png&color=000000',
    tariff:  'https://img.icons8.com/?size=100&id=FDDeSAesHDeK&format=png&color=40C057',
    percent: 'https://img.icons8.com/?size=100&id=123469&format=png&color=40C057',
    eco:     'https://img.icons8.com/?size=100&id=RxtQ8L6w2sOa&format=png&color=40C057',
    finance: 'https://img.icons8.com/?size=100&id=ysewnrIWx43K&format=png&color=40C057',
    calc:    'https://img.icons8.com/?size=100&id=kZhox7jHlVRS&format=png&color=40C057'
};

// VC ID range — wipe only touches this window
let VC_ID_MIN = 200;
let VC_ID_MAX = 207;

// =============================================================
//  SECTION 6 — HISTORY PRE-FILL (written to GM_0..GM_11 KVS)
//   12-month rolling history. Leave 0 for unknown months or current month.
//   Used by KVS_MODE='install' only. Ignored by 'update'.
//
//   EXAMPLE (Malta household, 5 residents, 2024 data):
//     776.85, 711.62, 730.97, 579.19, 0, 668.62,
//     730.68, 657.00, 613.51, 615.74, 660.35, 518.16
// =============================================================
let PREFILL_HISTORY = [
    776.85, // 0  Jan
    711.62, // 1  Feb
    730.97, // 2  Mar
    579.19, // 3  Apr
    0,      // 4  May  — current active month, leave 0
    668.62, // 5  Jun
    730.68, // 6  Jul
    657.00, // 7  Aug
    613.51, // 8  Sep
    615.74, // 9  Oct
    660.35, // 10 Nov
    518.16  // 11 Dec
];

// Real month day counts — used when seeding KVS history
let MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];

// =============================================================
// 3. TASK QUEUE
// =============================================================
let TASKS = [];
let T_IDX = 0;

function addV(type, id, cfg) {
    TASKS.push({ method:'Virtual.Add', params:{ type:type, id:id, config:cfg } });
}
function sc(method, id, config) {
    TASKS.push({ method:method, params:{ id:id, config:config } });
}
function buildInstallTasks() {
    addV('enum',   206, { name:VC_NAME_VIEW, options:['Month','Last Month','Year to Date','Today','Week','7 Days','12 Months','Last 30 Days','Custom'], default_value:CFG_DEF_VIEW });
    addV('number', 200, { name:VC_NAME_POWER, min:0, max:CFG_POW_MAX, default_value:0 });
    addV('text',   200, { name:VC_NAME_ENERGY, default_value:CFG_CONTACT });
    addV('enum',   200, { name:VC_NAME_TARIFF, options:['Band 1','Band 2','Band 3','Band 4','Band 5'], default_value:'Band 1' });
    addV('number', 201, { name:VC_NAME_TAR_PCT, min:0, max:100, default_value:0 });
    addV('enum',   201, { name:VC_NAME_ECO_ST, options:['Eco Active','Eco Risk','Eco VOID'], default_value:'Eco Active' });
    addV('number', 202, { name:VC_NAME_ECO_PCT, min:0, max:100, default_value:0 });
    addV('text',   207, { name:VC_NAME_FIN, default_value:CFG_CONTACT });
    addV('text',   204, { name:VC_NAME_CALC, default_value:'Units_Days' });
    addV('group',  200, { name:VC_NAME_GROUP });
    buildSetConfigTasks();
}
function buildSetConfigTasks() {
    sc('Enum.SetConfig',   206, { meta:{ ui:{ icon:ICONS.view, view:'dropdown' }}});
    sc('Number.SetConfig', 200, { meta:{ ui:{ icon:ICONS.power, view:'progressbar', unit:'Kw', step:1 }}});
    sc('Text.SetConfig',   200, { max_len:150, meta:{ ui:{ icon:ICONS.leaf, view:'label' }}});
    sc('Enum.SetConfig',   200, { meta:{ ui:{ icon:ICONS.tariff, view:'label',
        titles:{ 'Band 1':'Band 1 @€0.10','Band 2':'Band 2 @€0.13','Band 3':'Band 3 @€0.16','Band 4':'Band 4 @€0.34','Band 5':'Band 5 @€0.60' }}}});
    sc('Number.SetConfig', 201, { meta:{ ui:{ icon:ICONS.percent, view:'progressbar', unit:'%', step:1 }}});
    sc('Enum.SetConfig',   201, { meta:{ ui:{ icon:ICONS.eco, view:'label',
        titles:{ 'Eco Active':'Active ✔','Eco Risk':'Risk ⚠','Eco VOID':'VOID ❌' }}}});
    sc('Number.SetConfig', 202, { meta:{ ui:{ icon:ICONS.percent, view:'progressbar', unit:'%', step:1 }}});
    sc('Text.SetConfig',   207, { max_len:150, meta:{ ui:{ icon:ICONS.finance, view:'label' }}});
    sc('Text.SetConfig',   204, { max_len:50,  meta:{ ui:{ icon:ICONS.calc, view:'field' }}});
    sc('Group.SetConfig',  200, { meta:{ ui:{ view:'cards', icon:null }}});
    TASKS.push({ method:'Group.Set', params:{ id:200,
        value:['enum:206','number:200','text:200','enum:200','number:201','enum:201','number:202','text:207','text:204'] }});
}

// =============================================================
// 4. VC OPERATIONS
// =============================================================
function vcDelete(onDone) {
    console.log('🔍 Scanning for VCs in range ' + VC_ID_MIN + '-' + VC_ID_MAX + '...');
    Shelly.call('Shelly.GetComponents', { dynamic_only:true }, function(r, err) {
        if (err) { console.log('⚠️ GetComponents err=' + err); onDone(); return; }
        let found = [];
        let raw = (r && r.components) ? r.components : [];
        for (let i = 0; i < raw.length; i++) {
            let k = raw[i].key;
            let colon = k.indexOf(':');
            if (colon < 1) continue;
            let type = k.slice(0, colon);
            let id = Number(k.slice(colon + 1));
            if (id !== id || id < VC_ID_MIN || id > VC_ID_MAX) continue;
            if (type === 'enum' || type === 'number' || type === 'text' || type === 'group') found.push(k);
        }
        console.log('🗑️ Deleting ' + found.length + ' VCs...');
        deleteVCList(found, 0, onDone);
    });
}
function deleteVCList(list, i, onDone) {
    if (i >= list.length) { console.log('✅ VC delete done.'); onDone(); return; }
    Shelly.call('Virtual.Delete', { key:list[i] }, function(res, err, msg) {
        if (err) console.log('⚠️ Del ' + list[i] + ' err=' + err + ' ' + (msg||''));
        Timer.set(300, false, function() { deleteVCList(list, i + 1, onDone); });
    });
}

function vcInstall(onDone) {
    console.log('🏗️ Installing VCs...');
    T_IDX = 0; TASKS = [];
    buildInstallTasks();
    runTasks(onDone);
}
function vcUpdate(onDone) {
    console.log('🔧 Updating VC SetConfig...');
    T_IDX = 0; TASKS = [];
    buildSetConfigTasks();
    runTasks(onDone);
}
function runTasks(onDone) {
    if (T_IDX >= TASKS.length) { console.log('✅ VC tasks done.'); onDone(); return; }
    let t = TASKS[T_IDX]; T_IDX++;
    console.log('   (' + T_IDX + '/' + TASKS.length + ') ' + t.method);
    Shelly.call(t.method, t.params, function(res, err, msg) {
        if (err) console.log('⚠️ ' + t.method + ' err=' + err + ' ' + (msg||''));
        Timer.set(400, false, function() { runTasks(onDone); });
    });
}

// =============================================================
// 5. KVS OPERATIONS
// =============================================================
function kvsDelete(onDone) {
    console.log('🔍 Listing GM_* keys...');
    Shelly.call('KVS.List', { match:'GM_**' }, function(res, err, msg) {
        if (err || !res || !res.keys) {
            console.log('⚠️ KVS.List err=' + (msg||err));
            onDone(); return;
        }
        let keys = Object.keys(res.keys);
        console.log('🗑️ Deleting ' + keys.length + ' KVS keys...');
        deleteKVSList(keys, 0, onDone);
    });
}
function deleteKVSList(keys, i, onDone) {
    if (i >= keys.length) { console.log('✅ KVS delete done.'); onDone(); return; }
    Shelly.call('KVS.Delete', { key:keys[i] }, function(res, err, msg) {
        if (err) console.log('⚠️ KVS.Delete ' + keys[i] + ' err=' + err + ' ' + (msg||''));
        else console.log('   🗑️ Deleted: ' + keys[i]);
        Timer.set(150, false, function() { deleteKVSList(keys, i + 1, onDone); });
    });
}

// Sequential KVS writers — flattened to avoid mJS nested-callback limit
// (docs: >2-3 levels of nested anonymous fns crashes the engine)
let kvsInstallDone = null;
let kvsUpdateDone = null;

function kvsInstall(onDone) {
    console.log('💾 Installing KVS: GM_Tariff + GM_UX + GM_Brand + GM_VCManifest + 12-month history...');
    kvsInstallDone = onDone;
    writeTariff(kvsInstallStep2);
}
function kvsInstallStep2() { writeUX(kvsInstallStep3); }
function kvsInstallStep3() { writeBrand(kvsInstallStep4); }
function kvsInstallStep4() { writeVCManifest(kvsInstallStep5); }
function kvsInstallStep5() { seedHistory(0, kvsInstallDone); }

function kvsUpdate(onDone) {
    console.log('💾 Updating KVS: GM_Tariff + GM_UX + GM_Brand (history untouched)...');
    kvsUpdateDone = onDone;
    writeTariff(kvsUpdateStep2);
}
function kvsUpdateStep2() { writeUX(kvsUpdateStep3); }
function kvsUpdateStep3() { writeBrand(kvsUpdateStep4); }
function kvsUpdateStep4() { writeVCManifest(kvsUpdateDone); }

function writeTariff(onDone) {
    let payload = {
        res:CFG_RESIDENTS, svc:CFG_SVC_CHARGE,
        bands:CFG_BANDS, rates:CFG_RATES,
        eco:CFG_ECO, eco_rates:CFG_ECO_RATES
    };
    Shelly.call('KVS.Set', { key:'GM_Tariff', value:JSON.stringify(payload) }, function(res, err, msg) {
        if (err) console.log('⚠️ KVS.Set GM_Tariff err=' + err + ' ' + (msg||''));
        else console.log('✅ GM_Tariff written.');
        Timer.set(200, false, onDone);
    });
}
function writeUX(onDone) {
    let payload = {
        pow_max:CFG_POW_MAX, idle_to:CFG_IDLE_TO,
        calc_idle:CFG_CALC_IDLE, def_view:CFG_DEF_VIEW
    };
    Shelly.call('KVS.Set', { key:'GM_UX', value:JSON.stringify(payload) }, function(res, err, msg) {
        if (err) console.log('⚠️ KVS.Set GM_UX err=' + err + ' ' + (msg||''));
        else console.log('✅ GM_UX written.');
        Timer.set(200, false, onDone);
    });
}
function writeBrand(onDone) {
    let payload = { contact:CFG_CONTACT };
    Shelly.call('KVS.Set', { key:'GM_Brand', value:JSON.stringify(payload) }, function(res, err, msg) {
        if (err) console.log('⚠️ KVS.Set GM_Brand err=' + err + ' ' + (msg||''));
        else console.log('✅ GM_Brand written.');
        Timer.set(200, false, onDone);
    });
}
function writeVCManifest(onDone) {
    let manifest = {
        'enum:206':1, 'number:200':1, 'text:200':1,
        'enum:200':1, 'number:201':1, 'enum:201':1,
        'number:202':1, 'text:207':1, 'text:204':1, 'group:200':1
    };
    Shelly.call('KVS.Set', { key:'GM_VCManifest', value:JSON.stringify(manifest) }, function(res, err, msg) {
        if (err) console.log('⚠️ KVS.Set GM_VCManifest err=' + err + ' ' + (msg||''));
        else console.log('✅ GM_VCManifest written (10 components).');
        Timer.set(200, false, onDone);
    });
}
function seedHistory(idx, onDone) {
    if (idx > 11) { console.log('✅ History seeded.'); onDone(); return; }
    let val = PREFILL_HISTORY[idx];
    console.log('   ⏱️ GM_' + idx + ' → ' + val + ' kWh (' + MDAYS[idx] + 'd)');
    Shelly.call('KVS.Set', { key:'GM_' + idx, value:JSON.stringify({ total:val, days:MDAYS[idx] }) }, function(res, err, msg) {
        if (err) console.log('⚠️ KVS.Set GM_' + idx + ' err=' + err + ' ' + (msg||''));
        Timer.set(200, false, function() { seedHistory(idx + 1, onDone); });
    });
}


function verifyWipe(onDone) {
    Timer.set(1000, false, function() {
        Shelly.call('Shelly.GetComponents', { dynamic_only:true }, function(r) {
            let rem = [];
            let raw = (r && r.components) ? r.components : [];
            for (let i = 0; i < raw.length; i++) {
                let k = raw[i].key;
                let colon = k.indexOf(':');
                if (colon < 1) continue;
                let type = k.slice(0, colon);
                let id = Number(k.slice(colon + 1));
                if (id !== id || id < VC_ID_MIN || id > VC_ID_MAX) continue;
                if (type === 'enum' || type === 'number' || type === 'text' || type === 'group') rem.push(k);
            }
            if (rem.length > 0) {
                console.log('⚠️ ' + rem.length + ' VCs still present — retrying wipe...');
                deleteVCList(rem, 0, function() { verifyWipe(onDone); });
            } else {
                console.log('✅ Wipe verified clean. Starting install...');
                Timer.set(500, false, function() { vcInstall(onDone); });
            }
        });
    });
}
// =============================================================
// 6. SEQUENCER
// =============================================================
function runVC(onDone) {
    if (VC_MODE === 'delete') {
        vcDelete(onDone);
    } else if (VC_MODE === 'install') {
        vcDelete(function() { verifyWipe(onDone); });
    } else if (VC_MODE === 'update') {
        vcUpdate(onDone);
    } else {
        console.log('⏭️ VC: skip');
        onDone();
    }
}
function runKVS(onDone) {
    if (KVS_MODE === 'delete') {
        kvsDelete(onDone);
    } else if (KVS_MODE === 'install') {
        kvsInstall(onDone);
    } else if (KVS_MODE === 'update') {
        kvsUpdate(onDone);
    } else {
        console.log('⏭️ KVS: skip');
        onDone();
    }
}
function finish() {
    console.log('============================================');
    console.log('✅ GridMaster Pro ARMS Setup v1.0-beta COMPLETE');
    console.log('   VC:  ' + VC_MODE + ' | KVS: ' + KVS_MODE);
    console.log('   Next: enable GridMaster_Pro_ARMS_v1_0_beta.js (the brain)');
    console.log('============================================');
    Timer.set(1000, false, function() {
        Shelly.call('Script.Stop', { id:Shelly.getCurrentScriptId() });
    });
}

// =============================================================
// 7. IGNITION
// =============================================================
console.log('============================================');
console.log('⚡ GridMaster Pro ARMS Setup v1.0-beta');
console.log('   VC:  ' + VC_MODE + ' | KVS: ' + KVS_MODE);
console.log('============================================');
runVC(function() { Timer.set(300, false, function() { runKVS(finish); }); });