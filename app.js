(() => {
  // =========================
  //  DATA: Your rows (ordered 6)
  // =========================
  const ROWS = [
    ["ramp","closed-box","open-box","v","x","d-wings"],                  // Row 1
    ["adidas","d-wings","d-v","d-slant","ninja","ramp"],                 // Row 2
    ["d-slant","t-wings","ninja","d-v","adidas","ramp"],                 // Row 3
    ["d-slant","v","open-box","x","d-wings","closed-box"],               // Row 4
    ["ramp","v-trap","open-box","closed-box","x","d-wings"],             // Row 5
    ["v","v-trap","x","closed-box","d-wings","d-v"],                     // Row 6
  ];

  // All 12 unique symbols
  const ALL = Array.from(new Set(ROWS.flat())).sort();

  // Symbol display metadata
  const META = Object.fromEntries(ALL.map(sym => ([
    sym,
    {
      id: sym,
      img: `./assets/${sym}.png`,
      label: sym.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    }
  ])));

  // =========================
  // MEMORY (localStorage + JSON export/import)
  // =========================
  const MEM_KEY = "beast_floppy_memory_v1";

  function loadMemory(){
    try{
      const raw = localStorage.getItem(MEM_KEY);
      if (!raw) return { sequences: {}, totalSaved: 0 };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") throw new Error("bad mem");
      parsed.sequences ||= {};
      parsed.totalSaved ||= 0;
      return parsed;
    } catch {
      return { sequences: {}, totalSaved: 0 };
    }
  }

  function saveMemory(mem){
    localStorage.setItem(MEM_KEY, JSON.stringify(mem));
  }

  function seqKey(seq4){
    return seq4.join("|");
  }

  function bumpSequence(mem, seq4){
    const k = seqKey(seq4);
    mem.sequences[k] = (mem.sequences[k] || 0) + 1;
    mem.totalSaved = Object.values(mem.sequences).reduce((a,b)=>a+b,0);
    saveMemory(mem);
  }

  function downloadJson(filename, obj){
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function mergeMemory(target, incoming){
    if (!incoming || typeof incoming !== "object") return target;
    incoming.sequences ||= {};
    target.sequences ||= {};
    for (const [k,v] of Object.entries(incoming.sequences)){
      const add = Number(v);
      if (!Number.isFinite(add) || add <= 0) continue;
      target.sequences[k] = (target.sequences[k] || 0) + add;
    }
    target.totalSaved = Object.values(target.sequences).reduce((a,b)=>a+b,0);
    saveMemory(target);
    return target;
  }

  // =========================
  //  STATE
  // =========================
  const state = {
    selected: new Set(),
    tapHistory: [],
    locked: false,   // locks only when guaranteed + user taps Lock
  };

  // =========================
  //  DOM
  // =========================
  const gridEl = document.getElementById("grid");
  const pillsEl = document.getElementById("pills");
  const predBlockEl = document.getElementById("predBlock");
  const sublineEl = document.getElementById("subline");
  const summaryLineEl = document.getElementById("summaryLine");
  const resetBtn = document.getElementById("resetBtn");
  const undoBtn = document.getElementById("undoBtn");
  const lockBtn = document.getElementById("lockBtn");
  const lockBannerEl = document.getElementById("lockBanner");

  const saveGameBtn = document.getElementById("saveGameBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const clearMemBtn = document.getElementById("clearMemBtn");
  const importFile = document.getElementById("importFile");

  // =========================
  //  INFERENCE ENGINE
  //  Sliding 4-wide windows in each 6-symbol row:
  //    windows: [0..3], [1..4], [2..5]
  //  Each valid window is a hypothesis (candidate 4-sequence).
  //  Hypotheses are weighted by saved memory (Laplace smoothing).
  // =========================
  function infer(selectedSet){
    const selected = Array.from(selectedSet);

    if (selected.length > 4) {
      return {
        hypotheses: [],
        possibleSymbols: new Set(),
        positionStats: [new Map(), new Map(), new Map(), new Map()],
        bestSequence: null,
        confidence: 0,
        reason: "too_many_selected",
        totalWeight: 0
      };
    }

    const mem = loadMemory();
    const hypotheses = [];

    for (const row of ROWS){
      // prune: row must contain all selected
      let ok = true;
      for (const s of selected){
        if (!row.includes(s)) { ok = false; break; }
      }
      if (!ok) continue;

      // sliding windows
      for (let start = 0; start <= 2; start++){
        const win = row.slice(start, start + 4);

        let wOk = true;
        for (const s of selected){
          if (!win.includes(s)) { wOk = false; break; }
        }
        if (!wOk) continue;

        const k = seqKey(win);
        const seen = mem.sequences[k] || 0;

        // Laplace smoothing: new sequences still have weight 1
        const weight = (seen + 1);

        hypotheses.push({ seq: win, start, weight });
      }
    }

    const totalWeight = hypotheses.reduce((sum,h)=>sum+h.weight, 0);

    const possibleSymbols = new Set();
    for (const h of hypotheses) h.seq.forEach(s => possibleSymbols.add(s));

    // Weighted counts by position
    const positionStats = [new Map(), new Map(), new Map(), new Map()];
    for (const h of hypotheses){
      for (let i = 0; i < 4; i++){
        const sym = h.seq[i];
        positionStats[i].set(sym, (positionStats[i].get(sym) || 0) + h.weight);
      }
    }

    // Best gamble: highest weighted symbol per position
    let bestSequence = null;
    if (hypotheses.length > 0){
      bestSequence = [];
      for (let i = 0; i < 4; i++){
        const entries = Array.from(positionStats[i].entries());
        entries.sort((a,b) => b[1] - a[1]);
        bestSequence.push(entries[0][0]);
      }
    }

    // Confidence = probability of the single most-likely full hypothesis (by weight)
    let topHypProb = 0;
    if (totalWeight > 0){
      const topW = Math.max(...hypotheses.map(h => h.weight));
      topHypProb = topW / totalWeight;
    }

    return {
      hypotheses,
      possibleSymbols,
      positionStats,
      bestSequence,
      confidence: topHypProb,
      reason: null,
      totalWeight
    };
  }

  // =========================
  //  UI RENDER
  // =========================
  function fmtPct(p){
    const pct = Math.round(p * 100);
    return `${pct}%`;
  }

  function render(){
    const result = infer(state.selected);
    const selCount = state.selected.size;
    const N = result.hypotheses.length;

    // Enable Save only when truly guaranteed and not locked
    saveGameBtn.disabled = !(N === 1 && !state.locked);

    // Pills
    const mem = loadMemory();
    const pills = [];
    pills.push(`<span class="pill"><strong>${selCount}</strong> selected</span>`);
    pills.push(`<span class="pill"><strong>${mem.totalSaved || 0}</strong> saved games</span>`);

    if (selCount > 4){
      pills.push(`<span class="pill" style="border-color: rgba(255,93,125,.35); background: rgba(255,93,125,.10); color: rgba(255,255,255,.85);">
        <strong>Too many</strong> (max 4)
      </span>`);
    } else {
      pills.push(`<span class="pill"><strong>${N}</strong> possible sequence${N===1?"":"s"}</span>`);
      if (N === 0 && selCount > 0){
        pills.push(`<span class="pill" style="border-color: rgba(255,93,125,.35); background: rgba(255,93,125,.10); color: rgba(255,255,255,.85);">
          <strong>No match</strong> (undo/reset)
        </span>`);
      }
      if (N > 0){
        pills.push(`<span class="pill"><strong>Confidence</strong> ${fmtPct(result.confidence)}</span>`);
      }
      if (state.locked){
        pills.push(`<span class="pill" style="border-color: rgba(93,255,182,.35); background: rgba(93,255,182,.10); color: rgba(255,255,255,.88);">
          <strong>Locked</strong>
        </span>`);
      }
    }
    pillsEl.innerHTML = pills.join("");

    // Subline + lock rules
    lockBannerEl.style.display = state.locked ? "block" : "none";

    if (selCount === 0){
      sublineEl.textContent = "Select 1–4 symbols to begin…";
    } else if (selCount > 4){
      sublineEl.textContent = "You selected more than 4. The model assumes exactly 4 spawned.";
    } else if (N === 0){
      sublineEl.textContent = "No valid sequences remain. Undo/reset and re-tap.";
    } else if (N === 1){
      sublineEl.textContent = "Guaranteed sequence found. You can lock it or save it.";
    } else {
      sublineEl.textContent = "Not guaranteed yet — probabilities shown below (weighted by your history).";
    }

    // Lock button: only enable when guaranteed AND not already locked
    lockBtn.disabled = !(N === 1 && !state.locked);

    // Grid: always show all 12
    gridEl.innerHTML = "";
    for (const sym of ALL){
      const tile = document.createElement("div");
      tile.className = "tile";
      const isSelected = state.selected.has(sym);

      // impossible symbol: not in any remaining hypothesis
      const hasFilter = selCount > 0 && selCount <= 4;
      const impossible = hasFilter && N > 0 && !result.possibleSymbols.has(sym);

      if (isSelected) tile.classList.add("selected");
      if (!isSelected && impossible) tile.classList.add("impossible");

      tile.innerHTML = `
        <div class="iconWrap">
          <img class="icon" src="${META[sym].img}" alt="${META[sym].label}"
               onerror="this.style.opacity=.25; this.style.filter='grayscale(1)';" />
        </div>
        <div class="label">${META[sym].label}</div>
      `;

      tile.addEventListener("click", () => {
        if (state.locked) return;
        toggle(sym);
      });

      gridEl.appendChild(tile);
    }

    // Prediction panel
    predBlockEl.innerHTML = "";
    summaryLineEl.style.display = "none";

    // If locked and guaranteed, show single sequence
    if (state.locked && N === 1){
      renderGuaranteed(result.hypotheses[0].seq);
      return;
    }

    // Otherwise show probabilistic breakdown
    if (selCount === 0 || selCount > 4 || N === 0){
      return;
    }

    const total = result.totalWeight;

    for (let pos = 0; pos < 4; pos++){
      const counts = result.positionStats[pos];
      const entries = Array.from(counts.entries()).sort((a,b) => b[1]-a[1]);

      const top = entries.slice(0, 3);

      const choicesHtml = top.map(([sym, c]) => {
        const p = total > 0 ? (c / total) : 0;
        return `
          <span class="choice">
            <span class="miniIcon"><img src="${META[sym].img}" alt="" onerror="this.remove()"></span>
            ${META[sym].label} <span class="pct">${fmtPct(p)}</span>
          </span>
        `;
      }).join("");

      const uniqueCount = entries.length;
      const spreadNote = uniqueCount === 1 ? "locked" : `${uniqueCount} options`;

      const row = document.createElement("div");
      row.className = "posRow";
      row.innerHTML = `
        <div class="posTitle">
          <div>${pos+1}${suffix(pos+1)} position</div>
          <span>${spreadNote}</span>
        </div>
        <div class="choices">${choicesHtml || `<span class="hint">No data</span>`}</div>
      `;
      predBlockEl.appendChild(row);
    }

    if (result.bestSequence){
      const best = result.bestSequence.map(s => META[s].label).join(" → ");
      summaryLineEl.style.display = "block";
      summaryLineEl.innerHTML = `
        <strong>Best gamble right now:</strong> ${best}<br/>
        <strong>Remaining possibilities:</strong> ${N} sequence${N===1?"":"s"}<br/>
        <strong>Confidence:</strong> ${fmtPct(result.confidence)} (guaranteed only when 100%)
      `;
    }
  }

  function renderGuaranteed(seq){
    predBlockEl.innerHTML = "";

    const best = seq.map(s => META[s].label).join(" → ");
    const wrap = document.createElement("div");
    wrap.className = "posRow";
    wrap.innerHTML = `
      <div class="posTitle">
        <div>Guaranteed order (1st → 4th)</div>
        <span>100%</span>
      </div>
      <div class="choices">
        ${seq.map((sym) => `
          <span class="choice" style="border-color: rgba(93,255,182,.26); background: rgba(93,255,182,.08);">
            <span class="miniIcon"><img src="${META[sym].img}" alt="" onerror="this.remove()"></span>
            ${META[sym].label}
          </span>
        `).join("")}
      </div>
      <div class="bigLine" style="margin-top:10px;">
        <strong>Sequence:</strong> ${best}
      </div>
    `;
    predBlockEl.appendChild(wrap);
  }

  function suffix(n){
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    if (n % 10 === 1) return "st";
    if (n % 10 === 2) return "nd";
    if (n % 10 === 3) return "rd";
    return "th";
  }

  // =========================
  //  INTERACTIONS
  // =========================
  function toggle(sym){
    if (state.selected.has(sym)){
      state.selected.delete(sym);
      for (let i = state.tapHistory.length - 1; i >= 0; i--){
        if (state.tapHistory[i] === sym){
          state.tapHistory.splice(i, 1);
          break;
        }
      }
    } else {
      state.selected.add(sym);
      state.tapHistory.push(sym);
    }
    render();
  }

  function undo(){
    if (state.locked) return;
    const last = state.tapHistory.pop();
    if (!last) return;
    state.selected.delete(last);
    render();
  }

  function reset(){
    state.selected.clear();
    state.tapHistory = [];
    state.locked = false;
    render();
  }

  // Lock only when guaranteed
  lockBtn.addEventListener("click", () => {
    const result = infer(state.selected);
    if (result.hypotheses.length === 1){
      state.locked = true;
      render();
    }
  });

  // Save game only when guaranteed (stores the only remaining sequence)
  saveGameBtn.addEventListener("click", () => {
    const result = infer(state.selected);
    if (result.hypotheses.length !== 1) return;
    const mem = loadMemory();
    bumpSequence(mem, result.hypotheses[0].seq);
    // keep unlocked so you can still tap Reset; not forcing lock
    render();
  });

  exportBtn.addEventListener("click", () => {
    const mem = loadMemory();
    downloadJson("beast_floppy_memory.json", mem);
  });

  importBtn.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try{
      const text = await file.text();
      const incoming = JSON.parse(text);
      const mem = loadMemory();
      mergeMemory(mem, incoming);
      render();
    } catch {
      alert("Import failed: invalid JSON.");
    } finally {
      importFile.value = "";
    }
  });

  clearMemBtn.addEventListener("click", () => {
    if (!confirm("Clear all saved memory?")) return;
    localStorage.removeItem(MEM_KEY);
    render();
  });

  resetBtn.addEventListener("click", reset);
  undoBtn.addEventListener("click", undo);

  render();

  // PWA
  if ("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();