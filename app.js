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

  const ALL = Array.from(new Set(ROWS.flat())).sort();

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
    locked: false,
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
  //  UI helpers
  // =========================
  function fmtPct(p){
    return `${Math.round(p * 100)}%`;
  }

  function suffix(n){
    if (n % 100 >= 11 && n % 100 <= 13) return "th";
    if (n % 10 === 1) return "st";
    if (n % 10 === 2) return "nd";
    if (n % 10 === 3) return "rd";
    return "th";
  }

  // =========================
  //  Core combinatorics: all ordered 4-of-6 subsequences
  //  C(6,4)=15 per row
  // =========================
  function allSubseq4(row){
    const out = [];
    for (let i = 0; i < 6; i++){
      for (let j = i+1; j < 6; j++){
        for (let k = j+1; k < 6; k++){
          for (let l = k+1; l < 6; l++){
            out.push([row[i], row[j], row[k], row[l]]);
          }
        }
      }
    }
    return out;
  }

  // =========================
  //  INFERENCE ENGINE (weighted by memory)
  // =========================
  function infer(selectedSet){
    const selected = Array.from(selectedSet);

    if (selected.length > 4) {
      return {
        hypotheses: [],
        possibleSymbols: new Set(),
        positionStats: [new Map(), new Map(), new Map(), new Map()],
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

      const subs = allSubseq4(row);

      for (const seq of subs){
        // must contain all selected (membership only)
        let ok2 = true;
        for (const s of selected){
          if (!seq.includes(s)) { ok2 = false; break; }
        }
        if (!ok2) continue;

        const k = seqKey(seq);
        const seen = mem.sequences[k] || 0;

        // Laplace smoothing: unseen sequences still have weight
        const weight = (seen + 1);

        hypotheses.push({ seq, weight });
      }
    }

    const totalWeight = hypotheses.reduce((sum,h)=>sum+h.weight, 0);

    const possibleSymbols = new Set();
    for (const h of hypotheses) h.seq.forEach(s => possibleSymbols.add(s));

    const positionStats = [new Map(), new Map(), new Map(), new Map()];
    for (const h of hypotheses){
      for (let i = 0; i < 4; i++){
        const sym = h.seq[i];
        positionStats[i].set(sym, (positionStats[i].get(sym) || 0) + h.weight);
      }
    }

    // Confidence here = probability of the single most likely full sequence (top hypothesis)
    let topProb = 0;
    if (totalWeight > 0 && hypotheses.length){
      const topW = Math.max(...hypotheses.map(h => h.weight));
      topProb = topW / totalWeight;
    }

    return {
      hypotheses,
      possibleSymbols,
      positionStats,
      confidence: topProb,
      reason: null,
      totalWeight
    };
  }

  // =========================
  //  RENDER helpers: locked positions + ranked hypotheses
  // =========================
  function computeLocked(positionStats){
    const locked = [null,null,null,null];
    for (let i = 0; i < 4; i++){
      const m = positionStats[i];
      if (m.size === 1){
        locked[i] = Array.from(m.keys())[0];
      }
    }
    return locked;
  }

  function renderLockedStrip(locked){
    const strip = document.createElement("div");
    strip.className = "lockStrip";

    strip.innerHTML = [0,1,2,3].map(i => {
      const sym = locked[i];
      if (!sym){
        return `
          <div class="lockSlot">
            <div class="tiny">${i+1}${suffix(i+1)}</div>
            <div class="lockIcon">
              <div style="opacity:.25;color:rgba(255,255,255,.5);font-weight:900;">?</div>
            </div>
            <div class="tiny">open</div>
          </div>
        `;
      }
      return `
        <div class="lockSlot">
          <div class="tiny">${i+1}${suffix(i+1)}</div>
          <div class="lockIcon lockedGlow">
            <img src="${META[sym].img}" alt="" onerror="this.remove()">
          </div>
          <div class="tiny">locked</div>
        </div>
      `;
    }).join("");

    return strip;
  }

  function renderTopOrders(hypotheses, totalWeight, locked, topK=3){
    const ranked = hypotheses.slice().sort((a,b) => b.weight - a.weight);
    const picks = ranked.slice(0, topK);

    const list = document.createElement("div");
    list.className = "ordersList";

    for (const h of picks){
      const p = totalWeight > 0 ? (h.weight / totalWeight) : 0;

      const chain = h.seq.map((sym, idx) => {
        const isLocked = locked[idx] && locked[idx] === sym;
        const cls = isLocked ? "posIcon lockedGlow" : "posIcon";
        const icon = `<span class="${cls}"><img src="${META[sym].img}" alt="" onerror="this.remove()"></span>`;
        return idx === 0 ? icon : `<span class="sep">→</span>${icon}`;
      }).join("");

      const card = document.createElement("div");
      card.className = "orderCard";
      card.innerHTML = `
        <div class="orderChain">${chain}</div>
        <div class="orderOdds">${fmtPct(p)}</div>
      `;
      list.appendChild(card);
    }

    return { list, picks, ranked };
  }

  // =========================
  //  UI RENDER
  // =========================
  function render(){
    const result = infer(state.selected);
    const selCount = state.selected.size;
    const N = result.hypotheses.length;

    // Save only when guaranteed and not locked (still allowed if you only tapped 1–3,
    // but Save should only happen when there is exactly 1 full order left)
    saveGameBtn.disabled = !(N === 1 && !state.locked);

    // Pills
    const mem = loadMemory();
    const pills = [];
    pills.push(`<span class="pill"><strong>${selCount}</strong> selected</span>`);
    pills.push(`<span class="pill"><strong>${mem.totalSaved || 0}</strong> saved</span>`);

    if (selCount > 4){
      pills.push(`<span class="pill" style="border-color: rgba(255,93,125,.35); background: rgba(255,93,125,.10); color: rgba(255,255,255,.85);">
        <strong>Too many</strong> (max 4)
      </span>`);
    } else {
      pills.push(`<span class="pill"><strong>${N}</strong> left</span>`);
      if (N === 0 && selCount > 0){
        pills.push(`<span class="pill" style="border-color: rgba(255,93,125,.35); background: rgba(255,93,125,.10); color: rgba(255,255,255,.85);">
          <strong>No match</strong>
        </span>`);
      }
      if (N > 0){
        pills.push(`<span class="pill"><strong>Conf</strong> ${fmtPct(result.confidence)}</span>`);
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
      sublineEl.textContent = "Select 1–4 symbols…";
    } else if (selCount > 4){
      sublineEl.textContent = "You selected more than 4 (tool assumes 4 spawned).";
    } else if (N === 0){
      sublineEl.textContent = "No valid orders remain. Undo/reset and re-tap.";
    } else if (N === 1){
      sublineEl.textContent = "Only one full order fits (100%). Lock or Save.";
    } else {
      sublineEl.textContent = "Top candidates + locked positions update as you tap.";
    }

    lockBtn.disabled = !(N === 1 && !state.locked);

    // Grid: always show all 12
    gridEl.innerHTML = "";
    for (const sym of ALL){
      const tile = document.createElement("div");
      tile.className = "tile";

      const isSelected = state.selected.has(sym);

      // Fade logic: ONLY fade once you’ve started and we still have hypotheses.
      // This fade shows symbols that can’t appear in ANY remaining valid order.
      const canFade = (selCount > 0 && selCount <= 4 && N > 0);
      const impossible = (canFade && !result.possibleSymbols.has(sym));

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

    // Panel
    predBlockEl.innerHTML = "";
    summaryLineEl.style.display = "none";

    // Locked + guaranteed display
    if (state.locked && N === 1){
      renderGuaranteed(result.hypotheses[0].seq);
      return;
    }

    // Nothing to show yet
    if (selCount === 0 || selCount > 4 || N === 0){
      return;
    }

    // Show locked positions + top candidate orders
    const locked = computeLocked(result.positionStats);
    predBlockEl.appendChild(renderLockedStrip(locked));

    const { list, picks, ranked } = renderTopOrders(result.hypotheses, result.totalWeight, locked, 3);
    predBlockEl.appendChild(list);

    // Footer line
    summaryLineEl.style.display = "block";
    const bestP = picks.length && result.totalWeight > 0 ? (picks[0].weight / result.totalWeight) : 0;
    summaryLineEl.innerHTML = `
      <div class="bestRow">
        <strong>Shown:</strong> Top ${picks.length} of ${ranked.length} possible
        <div style="flex-basis:100%; height:0;"></div>
        <span style="color: rgba(255,255,255,.65); font-size:12px;">
          ${ranked.length} left • top pick ${fmtPct(bestP)}
        </span>
      </div>
    `;
  }

  function renderGuaranteed(seq){
    predBlockEl.innerHTML = "";

    // compute locked strip (everything locked)
    const locked = seq.slice();
    predBlockEl.appendChild(renderLockedStrip(locked));

    // show the guaranteed order as a single order card
    const list = document.createElement("div");
    list.className = "ordersList";

    const chain = seq.map((sym, idx) => {
      const icon = `<span class="posIcon lockedGlow"><img src="${META[sym].img}" alt="" onerror="this.remove()"></span>`;
      return idx === 0 ? icon : `<span class="sep">→</span>${icon}`;
    }).join("");

    const card = document.createElement("div");
    card.className = "orderCard";
    card.innerHTML = `
      <div class="orderChain">${chain}</div>
      <div class="orderOdds">100%</div>
    `;
    list.appendChild(card);

    predBlockEl.appendChild(list);

    summaryLineEl.style.display = "block";
    summaryLineEl.innerHTML = `
      <div class="bestRow">
        <strong>Guaranteed:</strong> Only one order remains.
        <div style="flex-basis:100%; height:0;"></div>
        <span style="color: rgba(255,255,255,.65); font-size:12px;">Lock on, save if you want.</span>
      </div>
    `;
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

  lockBtn.addEventListener("click", () => {
    const result = infer(state.selected);
    if (result.hypotheses.length === 1){
      state.locked = true;
      render();
    }
  });

  saveGameBtn.addEventListener("click", () => {
    const result = infer(state.selected);
    if (result.hypotheses.length !== 1) return;
    const mem = loadMemory();
    bumpSequence(mem, result.hypotheses[0].seq);
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

  if ("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
