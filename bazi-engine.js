/*! bazi-engine.js — 珍芯晴芳香學院 八字排盤核心（節氣精算版）
 *  放在 index.html 同一資料夾，並在原本 <script>…</script> 之後加入：
 *  <script src="bazi-engine.js"></script>
 *  本檔會覆蓋原本的 handleFormSubmit，其餘 CSS/花晶/日主資料庫完全沿用。
 */
(function () {
  'use strict';
  const TZ = 8;                 // 台灣時區 UTC+8
  const MONTH_W = 1.5;          // 月令當令加權（五行百分比用）
  const TG = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const DZ = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const EL = ['木','火','土','金','水'];
  const HIDDEN = { 子:'癸', 丑:'己癸辛', 寅:'甲丙戊', 卯:'乙', 辰:'戊乙癸', 巳:'丙庚戊',
                   午:'丁己', 未:'己丁乙', 申:'庚壬戊', 酉:'辛', 戌:'戊辛丁', 亥:'壬甲' };
  const rad = Math.PI / 180;
  const mod = (a, n) => ((a % n) + n) % n;

  /* ---------- 天文：太陽視黃經 → 節氣（免查表，任意年份） ---------- */
  const jdOf = ms => ms / 86400000 + 2440587.5;
  function sunLon(jd) {
    const T = (jd - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * rad;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
            + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    const om = (125.04 - 1934.136 * T) * rad;
    return mod(L0 + C - 0.00569 - 0.00478 * Math.sin(om), 360);
  }
  function solveLon(target, jd0) {          // 求太陽到達 target 度的時刻(JD)
    let jd = jd0;
    for (let i = 0; i < 10; i++) {
      const d = mod(target - sunLon(jd) + 540, 360) - 180;
      jd += d / 0.9856;
      if (Math.abs(d) < 1e-7) break;
    }
    return jd;
  }
  const gz60 = (s, b) => { for (let i = 0; i < 60; i++) if (i % 10 === s && i % 12 === b) return i; };

  /* ---------- 四柱 ---------- */
  function pillars(y, m, d, hh, mi) {
    const utcMs = Date.UTC(y, m - 1, d, hh, mi) - TZ * 3600000;
    const jd = jdOf(utcMs), lon = sunLon(jd);
    const mIdx = Math.floor(mod(lon - 315, 360) / 30);          // 0=寅月 … 11=丑月
    const mBr = (mIdx + 2) % 12;
    const ys = (m <= 2 && mIdx >= 10) ? y - 1 : y;              // 立春前(1~2月)屬上一年
    const yS = mod(ys - 4, 10), yB = mod(ys - 4, 12);
    const mS = ((yS % 5) * 2 + 2 + mIdx) % 10;                  // 五虎遁
    let dn = Math.round(Date.UTC(y, m - 1, d) / 864e5) - Math.round(Date.UTC(1900, 0, 31) / 864e5);
    if (hh >= 23) dn += 1;                                      // 晚子時(23:00起)日柱換日
    const dI = mod(40 + dn, 60), dS = dI % 10, dB = dI % 12;    // 1900-01-31 = 甲辰(40)
    const hB = Math.floor(((hh + 1) % 24) / 2);
    const hS = ((dS % 5) * 2 + hB) % 10;                        // 五鼠遁
    return { stems: [yS, mS, dS, hS], branches: [yB, mBr, dB, hB], mIdx, jd, lon, monthGz: gz60(mS, mBr) };
  }

  /* ---------- 十神 ---------- */
  const TEN = [['比肩','劫財'],['食神','傷官'],['偏財','正財'],['七殺','正官'],['偏印','正印']];
  const tenGod = (me, o) => TEN[mod(((o >> 1) - (me >> 1)), 5)][(me % 2 === o % 2) ? 0 : 1];
  const branchGod = (me, b) => tenGod(me, TG.indexOf(HIDDEN[DZ[b]][0]));

  /* ---------- 五行百分比 + 旺衰 ---------- */
  function fiveElements(st, br) {
    const c = [0, 0, 0, 0, 0];
    st.forEach(s => c[s >> 1] += 1);
    br.forEach((b, i) => {
      const h = HIDDEN[DZ[b]], w = h.length === 1 ? [1] : h.length === 2 ? [.7, .3] : [.6, .3, .1];
      [...h].forEach((g, j) => c[TG.indexOf(g) >> 1] += w[j] * (i === 1 ? MONTH_W : 1));
    });
    const t = c.reduce((a, b) => a + b, 0), p = {};
    EL.forEach((e, i) => p[e] = Math.round(c[i] / t * 100));
    return p;
  }
  function strength(p, dayStem) {
    const a = dayStem >> 1, own = p[EL[a]] + p[EL[mod(a + 4, 5)]];   // 同類 + 生我(印)
    return { own, label: own >= 55 ? '偏旺' : own <= 45 ? '偏弱' : '中和' };
  }

  /* ---------- 大運 ---------- */
  function dayun(P, gender, y, m) {
    const fwd = (P.stems[0] % 2 === 0) === (gender === 'male');       // 陽男陰女順行
    const start = 315 + 30 * P.mIdx;
    const tJd = solveLon(fwd ? mod(start + 30, 360) : mod(start, 360), P.jd);
    const months = Math.round(Math.abs(tJd - P.jd) * 4);              // 3天=1年, 1天=4個月
    const yrs = Math.floor(months / 12), mo = months % 12;
    const sy = y + yrs + ((m - 1 + mo) >= 12 ? 1 : 0);
    const list = [];
    for (let i = 1; i <= 8; i++) {
      const g = mod(P.monthGz + (fwd ? i : -i), 60), s = g % 10, b = g % 12;
      list.push({ year: sy + 10 * (i - 1), age: sy - y + 1 + 10 * (i - 1), s, b });
    }
    return { fwd, yrs, mo, list };
  }

  /* ---------- 流年（依十神動態產生） ---------- */
  const YEAR_TG = {
    比肩: ['🤝 同儕競合年','自我主張・夥伴同行','自我意識抬頭，合作與競爭並存；宜分工清楚、量力而為，避免合夥財務糾纏。','氣脈舒暢 + 極緻大師','fa-handshake','#E3F2FD','#1565C0'],
    劫財: ['⚖️ 破耗守財年','分財競爭・謹慎理財','易有意外開銷或為人擔保、借貸；宜守住現金流，避免衝動投資。','財富之鑰 + 氣脈舒暢','fa-hand-holding-dollar','#FFEBEE','#C62828'],
    食神: ['🌿 靈感享受年','才華舒展・輕鬆生財','表達與創作力提升，適合學習、輸出作品、經營口碑；留意飲食與作息。','3號花晶 + 心輪花晶','fa-seedling','#E8F5E9','#2E7D32'],
    傷官: ['🔥 突破表達年','創意爆發・言行謹慎','想法多、敢突破，適合創作與技術；但易口舌是非或與上位者衝突，說話留三分。','神聖之光 + 情緒修護花晶','fa-fire','#FFF3E0','#E65100'],
    偏財: ['💰 機會流動年','橫向財源・人脈擴張','外部機會與流動資金增加，適合拓展合作；重視風險控管，避免過度擴張。','財富之鑰 + 1號花晶','fa-coins','#FFF8E1','#F57F17'],
    正財: ['🏦 穩健進財年','踏實積累・關係穩固','收入與資產趨於穩定，適合建立制度、儲蓄與長期規劃。','財富之鑰 + 3號花晶','fa-sack-dollar','#FFF8E1','#F57F17'],
    七殺: ['⚡ 壓力挑戰年','壓力磨練・轉危為機','外在壓力與競爭增大，也是磨練魄力的年份；宜規律作息、量力承接，避免硬撐。','氣脈舒暢 + 神聖之光','fa-bolt','#F3E5F5','#6A1B9A'],
    正官: ['🎖️ 名位責任年','規範肯定・貴人賞識','職位、名聲與責任同步增加，適合考核晉升與守規矩經營；宜守信、避免違規。','極緻大師 + 財富之鑰','fa-award','#E8F5E9','#2E7D32'],
    偏印: ['🔮 內省學習年','直覺沉澱・轉向內求','思慮與靈感增強，適合進修、研究、療癒；避免多慮與自我孤立。','神聖之光 + 2號花晶','fa-eye','#F3E5F5','#6A1B9A'],
    正印: ['📚 貴人庇護年','滋養支持・學習成長','貴人與長輩助力明顯，適合進修考證、休養充電，步調宜穩。','心輪花晶 + 2號花晶','fa-book-open','#E3F2FD','#1565C0']
  };

  const API = { pillars, tenGod, fiveElements, strength, dayun, TG, DZ };
  if (typeof module !== 'undefined') module.exports = API;
  if (typeof document === 'undefined') return;
  window.BaziEngine = API;

  /* ================= 以下為網頁 UI ================= */
  const $ = id => document.getElementById(id);
  const p2 = n => String(n).padStart(2, '0');

  function initUI() {
    // 1. 時辰選單：拆分早/晚子時，選單值改為時間字串
    const hs = $('birthHour');
    const opts = [['00:30', '早子時 (00:00-01:00)']];
    for (let i = 1; i < 12; i++) opts.push([p2(2 * i) + ':00', `${DZ[i]}時 (${p2(2 * i - 1)}:00-${p2(2 * i + 1)}:00)`]);
    opts.push(['23:30', '晚子時 (23:00-24:00)']);
    hs.innerHTML = opts.map(o => `<option value="${o[0]}"${o[0] === '02:00' ? ' selected' : ''}>${o[1]}</option>`).join('');
    // 2. 選填精確時間 + 說明
    hs.closest('.form-group').insertAdjacentHTML('afterend',
      '<div class="form-group"><label class="form-label">精確時間（選填）</label><input type="time" id="birthExact" class="form-control"></div>');
    hs.closest('.form-grid').insertAdjacentHTML('afterend',
      '<p style="font-size:.78rem;color:#888;margin:-4px 0 8px;line-height:1.6">節氣交接日請填精確時間以求準確；23:00 起日柱算隔日。' +
      '台灣 1946–1961、1974–1975、1979 年曾實施日光節約時間，若出生於該期間，請先減 1 小時再填入。</p>');
    // 3. 命盤格子預留十神/藏干欄
    document.querySelectorAll('.bazi-box').forEach(b =>
      b.insertAdjacentHTML('beforeend', '<div class="bz-extra" style="font-size:.75rem;color:#8C7355;margin-top:6px;line-height:1.5"></div>'));
    // 4. 大運卡片
    $('analysis-section').querySelector('.section-card')
      .insertAdjacentHTML('afterend', '<div class="section-card" id="dayunCard"></div>');
  }

  function render(e) {
    e.preventDefault();
    const name = $('userName').value || '貴賓', gender = $('userGender').value;
    const y = +$('birthYear').value, m = +$('birthMonth').value, d = +$('birthDay').value;
    const chk = new Date(Date.UTC(y, m - 1, d));
    if (chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d) { alert('此日期不存在，請重新選擇日期'); return; }
    const [hh, mi] = ($('birthExact').value || $('birthHour').value).split(':').map(Number);

    const P = pillars(y, m, d, hh, mi), me = P.stems[2];
    $('analysisUserHeader').innerText = `${name} 您的個人八字命盤資訊`;
    ['year', 'month', 'day', 'hour'].forEach((k, i) => $(k + 'PillarDisplay').innerText = TG[P.stems[i]] + DZ[P.branches[i]]);
    document.querySelectorAll('.bz-extra').forEach((el, i) => {
      const god = i === 2 ? '日主' : tenGod(me, P.stems[i]);
      el.innerHTML = `${god}<br><span style="color:#999">藏 ${HIDDEN[DZ[P.branches[i]]]}</span>`;
    });

    const pct = fiveElements(P.stems, P.branches);
    updateRadarChart(pct, TG[me]);
    const st = strength(pct, me);
    $('elementListContainer').insertAdjacentHTML('beforeend',
      `<div class="element-item" style="border:1px dashed #C59B27"><span>日主旺衰（同類＋印）</span><b>${st.label}（${st.own}%）</b></div>`);
    renderDayMasterAspects(TG[me]);

    // 大運
    const D = dayun(P, gender, y, m), cy = new Date().getFullYear();
    let cur = -1; D.list.forEach((x, i) => { if (cy >= x.year) cur = i; });
    $('dayunCard').innerHTML =
      `<div class="section-title"><i class="fa-solid fa-road" style="color:#C59B27;"></i> 大運（${D.fwd ? '順行' : '逆行'}・${D.yrs}歲${D.mo}個月起運）</div>` +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:10px;text-align:center">' +
      D.list.map((x, i) => `<div style="border:1px solid ${i === cur ? '#C59B27' : '#EFE9DF'};background:${i === cur ? '#FFF8E7' : '#fff'};border-radius:10px;padding:10px 4px">` +
        `<div style="font-size:.72rem;color:#888">${x.year}（${x.age}歲）</div>` +
        `<div style="font-size:1.15rem;font-weight:700">${TG[x.s]}${DZ[x.b]}</div>` +
        `<div style="font-size:.75rem;color:#8C7355">${tenGod(me, x.s)}${i === cur ? '・當前' : ''}</div></div>`).join('') + '</div>';

    // 流年（當年起 5 年）
    const grid = document.querySelector('.year-grid'), card = grid.closest('.section-card');
    card.querySelector('.section-title').innerHTML =
      `<i class="fa-regular fa-calendar-days" style="color:#C59B27;"></i> 近 5 年流年氣場走勢與花晶調和建議 (${cy}–${cy + 4})`;
    grid.innerHTML = [0, 1, 2, 3, 4].map(i => {
      const Y = cy + i, s = mod(Y - 4, 10), b = mod(Y - 4, 12), g = tenGod(me, s), T = YEAR_TG[g];
      const clash = ['年', '月', '日', '時'].filter((_, k) => mod(b - P.branches[k], 12) === 6).map(n => n + '支');
      return `<div class="year-card"><div class="year-header"><span class="year-title">${Y} ${TG[s]}${DZ[b]}年</span>` +
        `<span class="year-tag" style="background:${T[5]};color:${T[6]}">${T[0]}</span></div>` +
        `<div class="year-icon-box"><i class="fa-solid ${T[4]}"></i><div style="font-weight:600;font-size:.9rem">${T[1]}</div>` +
        `<div style="font-size:.72rem;color:#999;margin-top:4px">天干${g}・地支${branchGod(me, b)}</div></div>` +
        `<div class="year-desc">${T[2]}${clash.length ? `<br><span style="color:#C62828">⚠ 流年${DZ[b]}沖${clash.join('、')}，留意變動與健康。</span>` : ''}</div>` +
        `<div class="year-flower">🌸 花晶建議：【${T[3]}】</div></div>`;
    }).join('');

    $('input-section').style.display = 'none';
    $('analysis-section').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  window.handleFormSubmit = render;
  initUI();
})();
