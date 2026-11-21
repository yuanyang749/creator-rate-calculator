(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const currency = n =>
    new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 0
    }).format(Number.isFinite(n) ? n : 0);

  const number = n =>
    new Intl.NumberFormat('zh-CN', {
      maximumFractionDigits: 0
    }).format(Number.isFinite(n) ? n : 0);

  const num = (id, { integer = false, maxOverride = null } = {}) => {
    const el = $(id);
    if (!el) return 0;
    const raw = Number(el.value);
    if (!Number.isFinite(raw)) return 0;
    const min = el.min !== '' && Number.isFinite(Number(el.min)) ? Number(el.min) : 0;
    const attrMax = el.max !== '' && Number.isFinite(Number(el.max)) ? Number(el.max) : 1e9;
    const max = maxOverride !== null ? maxOverride : attrMax;
    const clamped = Math.min(max, Math.max(min, raw));
    return integer ? Math.floor(clamped) : clamped;
  };

  function roundPrice(value, step, ensurePositive = false) {
    if (!Number.isFinite(value) || value <= 0) return 0;
    const rounded = Math.round(value / step) * step;
    return ensurePositive ? Math.max(step, rounded) : Math.max(0, rounded);
  }

  function calcBreakEven(targetAmount, isCps, orderVal, commissionVal) {
    if (targetAmount <= 0) return 0;
    const perConversion = isCps ? (orderVal * commissionVal) / 100 : commissionVal;
    if (perConversion <= 0) return null;
    const q = targetAmount / perConversion;
    const eps = Math.max(1e-9, q * 1e-12);
    return Math.ceil(q - eps);
  }

  const formatPresets = {
    post: 1.5,
    article: 3,
    review: 3.5,
    thread: 3,
    bundle: 5
  };

  const formatTasks = {
    post: [false, false, false, false],
    article: [false, false, true, false],
    review: [true, true, true, false],
    thread: [false, false, true, false],
    bundle: [true, true, true, true]
  };

  const taskHours = {
    testing: 1.5,
    recording: 1,
    visuals: 1,
    editing: 2
  };

  const checkIds = Object.keys(taskHours);

  // 分段滑块映射：让中小博主常用区间拥有更充裕的拖动精度
  const trafficSliders = [
    {
      inputId: 'followers',
      rangeId: 'followersRange',
      scale: [
        { minPos: 0, maxPos: 300, minVal: 0, maxVal: 10000, step: 100 },
        { minPos: 300, maxPos: 650, minVal: 10000, maxVal: 50000, step: 500 },
        { minPos: 650, maxPos: 1000, minVal: 50000, maxVal: 200000, step: 2000 }
      ]
    },
    {
      inputId: 'impressions',
      rangeId: 'impressionsRange',
      scale: [
        { minPos: 0, maxPos: 300, minVal: 0, maxVal: 15000, step: 100 },
        { minPos: 300, maxPos: 650, minVal: 15000, maxVal: 80000, step: 500 },
        { minPos: 650, maxPos: 1000, minVal: 80000, maxVal: 300000, step: 2000 }
      ]
    }
  ];

  const defaults = {
    platform: 'X / Twitter',
    followers: 5500,
    impressions: 10000,
    engagement: 3.5,
    format: 'review',
    baseHours: 3.5,
    hourlyRate: 100,
    directCost: 0,
    revisions: 0,
    revisionFee: 100,
    cpm: 40,
    postFactor: 80,
    fitFactor: 100,
    paidUsage: false,
    exclusive: false,
    rush: false,
    pin: false,
    paidUsagePct: 30,
    exclusivePct: 20,
    rushPct: 15,
    pinFee: 150,
    premium: 18,
    discount: 20,
    payMode: 'fixed',
    commissionType: 'cpa',
    commissionValue: 100,
    orderValue: 1000,
    conversions: 3,
    fixedFee: 800
  };

  const defaultCommissionMemory = { cpa: 100, cps: 15 };
  let commissionMemory = { ...defaultCommissionMemory };
  let lastCommissionType = 'cpa';
  const integerFieldIds = new Set(['followers', 'impressions', 'revisions', 'conversions']);

  let lastExternal = '';
  let lastInternal = '';

  const getMode = () => {
    const checked = document.querySelector('input[name="payMode"]:checked');
    return checked ? checked.value : 'fixed';
  };

  const toast = message => {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 1800);
  };

  function getTodayIso() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function makeQuotationCode(seedText) {
    const year = new Date().getFullYear();
    let hash = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
      hash ^= seedText.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const serial = String((Math.abs(hash) % 9000) + 1000);
    return `Q-${year}-${serial}`;
  }

  function allocatePercents(values) {
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) return values.map(() => 0);

    const exact = values.map(v => (v / total) * 100);
    const floored = exact.map(v => Math.floor(v));
    let remainder = 100 - floored.reduce((a, b) => a + b, 0);

    const order = exact
      .map((v, i) => ({ i, frac: v - floored[i] }))
      .sort((a, b) => b.frac - a.frac);

    for (let k = 0; k < order.length && remainder > 0; k++) {
      floored[order[k].i] += 1;
      remainder -= 1;
    }
    return floored;
  }

  function rangeToValue(pos, segments) {
    const p = Math.max(0, Math.min(1000, Number(pos) || 0));
    const seg = segments.find(s => p <= s.maxPos) || segments[segments.length - 1];
    const ratio = seg.maxPos > seg.minPos ? (p - seg.minPos) / (seg.maxPos - seg.minPos) : 0;
    const raw = seg.minVal + ratio * (seg.maxVal - seg.minVal);
    const snapped = Math.round(raw / seg.step) * seg.step;
    return Math.min(seg.maxVal, Math.max(seg.minVal, snapped));
  }

  function valueToRange(val, segments) {
    const v = Math.max(0, Number(val) || 0);
    const maxCap = segments[segments.length - 1].maxVal;
    if (v >= maxCap) return 1000;
    const seg = segments.find(s => v <= s.maxVal) || segments[segments.length - 1];
    const ratio = seg.maxVal > seg.minVal ? (v - seg.minVal) / (seg.maxVal - seg.minVal) : 0;
    return Math.round(seg.minPos + ratio * (seg.maxPos - seg.minPos));
  }

  function updateRangeFill(id) {
    const input = $(id);
    if (!input) return;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const val = Number(input.value) || 0;
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
  }

  function syncPresetHighlight(followerCount, organic) {
    document.querySelectorAll('.preset-btn').forEach(btn => {
      const f = Number(btn.dataset.followers);
      const imp = Number(btn.dataset.impressions);
      const active = f === followerCount && imp === organic;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function syncHasFallback() {
    if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('selector(:has(*))')) {
      return;
    }
    document.querySelectorAll('.privacy-switch, .task-chip, .right-item, .mode-card').forEach(label => {
      const input = label.querySelector('input');
      if (input) {
        label.classList.toggle('is-checked', input.checked);
      }
    });
  }

  function render(activeRangeId = null) {
    const followerCount = num('followers', { integer: true });
    const organic = num('impressions', { integer: true });
    const postFactorRaw = num('postFactor');
    const fitFactorRaw = num('fitFactor');
    const postFactor = postFactorRaw / 100;
    const fitFactor = fitFactorRaw / 100;

    // 同步粉丝数与曝光量滑块位置、进度条及无障碍读数
    trafficSliders.forEach(({ inputId, rangeId, scale }) => {
      const rangeEl = $(rangeId);
      if (!rangeEl) return;
      const val = num(inputId, { integer: true });
      if (activeRangeId !== rangeId) {
        rangeEl.value = valueToRange(val, scale);
      }
      updateRangeFill(rangeId);
      rangeEl.setAttribute('aria-valuetext', number(val));
    });

    const sponsoredReach = organic * postFactor;
    const mediaCost = Math.round((sponsoredReach / 1000) * num('cpm') * fitFactor);

    const extraHours = checkIds.reduce((acc, id) => acc + ($(id).checked ? taskHours[id] : 0), 0);
    const hours = num('baseHours') + extraHours;
    const directCostRounded = Math.round(num('directCost'));
    const revisions = num('revisions', { integer: true });
    const revisionFee = num('revisionFee');
    const laborCost = Math.round(hours * num('hourlyRate') + revisions * revisionFee);
    const productionCost = laborCost + directCostRounded;

    // 直接成本实报实销，不参与商业授权比例加价
    const rightsBase = mediaCost + laborCost;
    const paidUsagePct = num('paidUsagePct');
    const exclusivePct = num('exclusivePct');
    const rushPct = num('rushPct');
    const pinFee = num('pinFee');

    const rightsRate =
      ($('paidUsage').checked ? paidUsagePct : 0) +
      ($('exclusive').checked ? exclusivePct : 0) +
      ($('rush').checked ? rushPct : 0);

    const rightsCost =
      Math.round((rightsBase * rightsRate) / 100) +
      ($('pin').checked ? Math.round(pinFee) : 0);
    const base = mediaCost + productionCost + rightsCost;

    const premiumPct = num('premium');
    const discountPct = num('discount');
    const priceStep = base >= 300 ? 50 : 10;
    const target = base > 0 ? roundPrice(base, priceStep, true) : 0;
    const openingRaw = base > 0 ? roundPrice(base * (1 + premiumPct / 100), priceStep, true) : 0;
    const floorRaw = base > 0 ? roundPrice(base * (1 - discountPct / 100), priceStep, true) : 0;
    const opening = Math.max(target, openingRaw);
    const floor = Math.min(target, floorRaw);

    // 更新滑块读数与黑线轨道进度
    $('postFactorText').textContent = `${Math.round(postFactorRaw)}%`;
    $('fitFactorText').textContent = `${Math.round(fitFactorRaw)}%`;
    updateRangeFill('postFactor');
    updateRangeFill('fitFactor');

    // 更新授权比例徽标 & 高级参数摘要
    $('paidUsageTag').textContent = `+${Math.round(paidUsagePct)}%`;
    $('exclusiveTag').textContent = `+${Math.round(exclusivePct)}%`;
    $('rushTag').textContent = `+${Math.round(rushPct)}%`;
    $('pinTag').textContent = `+${currency(pinFee)}`;

    const summaryParts = [
      `溢价 +${Math.round(premiumPct)}%`,
      `底价 -${Math.round(discountPct)}%`,
      `改稿 ${revisions} 轮`
    ];
    if (directCostRounded > 0) summaryParts.push(`直出 ${currency(directCostRounded)}`);
    $('advancedSummary').textContent = summaryParts.join(' · ');

    syncPresetHighlight(followerCount, organic);

    // 小票元信息与编号
    const fmt = $('format').selectedOptions[0].textContent;
    const platform = $('platform').value;
    const code = makeQuotationCode(`${platform}|${fmt}|${followerCount}|${organic}|${hours}|${opening}|${rightsRate}`);

    $('receiptProject').textContent = fmt;
    $('receiptPlatform').textContent = platform;
    $('receiptDate').textContent = getTodayIso();
    $('receiptCode').textContent = code;
    $('barcodeCode').textContent = code;

    // 主价格区与对外报价模式
    const isClientMode = $('hideFloor').checked;
    $('receiptCard').classList.toggle('is-client-mode', isClientMode);
    $('receiptStamp').textContent = isClientMode ? 'QUOTATION' : 'ESTIMATE';
    $('openingLabel').textContent = isClientMode ? '建议合作报价' : '建议对外开价';

    $('opening').textContent = currency(opening);
    $('mobileOpening').textContent = currency(opening);
    $('target').textContent = currency(target);
    $('floor').textContent = currency(floor);

    const clientRightsNames = [];
    if ($('paidUsage').checked) clientRightsNames.push('付费广告二次使用');
    if ($('exclusive').checked) clientRightsNames.push('竞品排他期');
    if ($('rush').checked) clientRightsNames.push('加急交付');
    if ($('pin').checked) clientRightsNames.push('置顶 / 延长保留');
    $('clientRightsValue').textContent = clientRightsNames.length
      ? clientRightsNames.join('、')
      : '仅基础自然发布';

    // 成本构成三段比例条
    const [prodP, mediaP, rightsP] = allocatePercents([productionCost, mediaCost, rightsCost]);
    $('prodPct').textContent = `${prodP}%`;
    $('mediaPct').textContent = `${mediaP}%`;
    $('rightsPct').textContent = `${rightsP}%`;

    const segs = [
      { el: $('barProd'), pct: prodP },
      { el: $('barMedia'), pct: mediaP },
      { el: $('barRights'), pct: rightsP }
    ];
    segs.forEach(({ el, pct }) => {
      el.style.width = `${pct}%`;
      el.textContent = pct >= 14 ? `${pct}%` : '';
    });
    $('mixBar').setAttribute(
      'aria-label',
      `报价构成比例：制作成本 ${prodP}%，流量估值 ${mediaP}%，授权费用 ${rightsP}%`
    );

    // 小票账单明细（整数三项相加严格等于模型基础估值）
    $('expectedReach').textContent = number(Math.round(sponsoredReach));
    $('totalHours').textContent = `${hours.toFixed(1)} h`;
    $('reachRatio').textContent = followerCount > 0 ? `${Math.round((organic / followerCount) * 100)}%` : '—';
    $('mediaCost').textContent = currency(mediaCost);
    $('productionCost').textContent = currency(productionCost);
    $('rightsCost').textContent = currency(rightsCost);
    $('baseEstimate').textContent = currency(base);

    const badge = $('directCostBadge');
    badge.hidden = directCostRounded <= 0;
    if (directCostRounded > 0) {
      badge.textContent = `（含直出 ${currency(directCostRounded)}）`;
    }

    // 结算模式
    const mode = getMode();
    const isPerformance = mode !== 'fixed';
    const pure = mode === 'performance';
    $('commissionInputs').hidden = !isPerformance;
    $('fixedFeeWrapper').hidden = pure;
    $('performanceAlert').hidden = !pure;

    const cps = $('commissionType').value === 'cps';
    syncCommissionConstraints(cps);
    $('orderValueWrapper').hidden = !cps;
    $('commissionUnit').textContent = cps ? '%' : '¥';
    $('commissionValueLabel').textContent = cps ? '成交佣金比例' : '每次有效行为佣金';

    const orderVal = num('orderValue');
    const commVal = num('commissionValue', { maxOverride: cps ? 100 : null });
    const commissionPerConversion = cps ? (orderVal * commVal) / 100 : commVal;
    const conversions = num('conversions', { integer: true });
    const projectedCommissionRounded = Math.round(commissionPerConversion * conversions);
    const fixedFeeRounded = pure ? 0 : Math.round(num('fixedFee'));
    const projectedIncome = fixedFeeRounded + projectedCommissionRounded;

    if (mode === 'fixed') {
      $('modeLabel').textContent = isClientMode ? '固定稿酬报价' : '建议固定稿酬';
      $('expectedIncome').textContent = currency(isClientMode ? opening : target);
      $('modeNote').textContent = '固定费用建议与交付内容、修改次数、付款时间和授权范围分开约定。';
    } else if (mode === 'hybrid') {
      $('modeLabel').textContent = '固定 + 预估佣金';
      $('expectedIncome').textContent = currency(projectedIncome);
      $('modeNote').textContent = `固定 ${currency(fixedFeeRounded)} + 预估佣金 ${currency(projectedCommissionRounded)}（按 ${number(conversions)} 次有效转化估算，效果部分非保底）。`;
    } else {
      const breakEven = calcBreakEven(target, cps, orderVal, commVal);
      $('modeLabel').textContent = '纯效果模式 · 非保底';
      $('expectedIncome').textContent = currency(projectedIncome);
      if (isClientMode) {
        $('modeNote').textContent =
          commissionPerConversion > 0
            ? `纯效果按实际有效转化结算（预估单次佣金 ${currency(commissionPerConversion)}）。需书面明确有效行为判定、归因窗口与结算周期。`
            : '请先填写每次有效行为佣金或 CPS 分成比例。';
      } else {
        $('modeNote').textContent =
          breakEven === null
            ? '请先填写每次有效行为佣金或 CPS 分成比例，才能计算盈亏平衡所需转化数。'
            : `达到模型目标成交价 ${currency(target)}，约需 ${number(breakEven)} 次有效转化；这不代表一定能实现该转化数。`;
      }
    }

    // 复制文案构建
    const description = `${fmt}（预计总工时 ${hours.toFixed(1)} 小时）`;
    const activeRights = [];
    if ($('paidUsage').checked) activeRights.push(`付费广告二次使用(+${Math.round(paidUsagePct)}%)`);
    if ($('exclusive').checked) activeRights.push(`竞品排他(+${Math.round(exclusivePct)}%)`);
    if ($('rush').checked) activeRights.push(`加急交付(+${Math.round(rushPct)}%)`);
    if ($('pin').checked) activeRights.push(`置顶/延长保留(+${currency(pinFee)})`);

    lastExternal = [
      `商单合作报价参考（单号 ${code}）`,
      `平台：${platform}`,
      `内容形式：${description}`,
      ...(activeRights.length ? [`包含附加项：${activeRights.join('、')}`] : []),
      `建议合作报价：${currency(opening)}`,
      '说明：报价包含约定内容的创作与一次自然发布；具体交付节点、修改轮数、授权范围及付款方式以双方书面确认为准。',
      '本报价不承诺固定曝光、注册或成交转化。'
    ].join('\n');

    lastInternal = [
      `Creator Rate Lab｜内部测算报告（${code}，请勿原样发给商务）`,
      `平台：${platform}｜内容：${description}`,
      `粉丝：${number(followerCount)}｜平均原创曝光：${number(organic)}｜互动率记录：${num('engagement')}%`,
      `预计商业帖曝光：${number(Math.round(sponsoredReach))}（曝光系数 ${Math.round(postFactorRaw)}%，受众匹配 ${Math.round(fitFactorRaw)}%）`,
      `成本拆解：流量估值 ${currency(mediaCost)}（${mediaP}%）+ 制作成本 ${currency(productionCost)}（${prodP}%${directCostRounded > 0 ? `，含直出 ${currency(directCostRounded)} 不计入授权加价` : ''}）+ 授权附加 ${currency(rightsCost)}（${rightsP}%）`,
      `模型基础估值：${currency(base)}`,
      `报价梯度：对外开价 ${currency(opening)} ｜ 目标成交价 ${currency(target)} ｜ 【内部底价】${currency(floor)}`,
      `结算模式：${mode === 'fixed' ? '固定稿酬' : mode === 'hybrid' ? '固定 + 佣金' : '纯效果佣金'}`,
      ...(isPerformance
        ? [
            `单次有效转化预估佣金：${currency(commissionPerConversion)}`,
            `预估有效转化：${number(conversions)} 次`,
            `模拟总收入（非保底）：${currency(projectedIncome)}`
          ]
        : []),
      '提示：此结果为自设参数估值模型，不构成行业统一报价或收益保证。'
    ].join('\n');

    syncHasFallback();
  }

  function syncCommissionConstraints(isCps) {
    const input = $('commissionValue');
    if (!input) return;
    input.max = isCps ? '100' : '1000000';
    input.step = isCps ? '1' : '5';
  }

  function handleCommissionTypeChange() {
    const nextType = $('commissionType').value;
    if (nextType !== lastCommissionType) {
      commissionMemory[lastCommissionType] = num('commissionValue', {
        maxOverride: lastCommissionType === 'cps' ? 100 : null
      });
      const restored = commissionMemory[nextType] ?? defaultCommissionMemory[nextType];
      syncCommissionConstraints(nextType === 'cps');
      $('commissionValue').value = String(restored);
      lastCommissionType = nextType;
    } else {
      syncCommissionConstraints(nextType === 'cps');
    }
    render();
  }

  function normalizeNumberInput(el) {
    if (!el || !el.id) return;
    if (el.value.trim() === '') {
      const fallbackMin = el.min !== '' && Number.isFinite(Number(el.min)) ? Number(el.min) : 0;
      el.value = String(fallbackMin);
      render();
      return;
    }
    const isCpsVal = el.id === 'commissionValue' && $('commissionType').value === 'cps';
    const normalized = num(el.id, {
      integer: integerFieldIds.has(el.id),
      maxOverride: isCpsVal ? 100 : null
    });
    if (String(normalized) !== el.value) {
      el.value = String(normalized);
      render();
    }
  }

  function applyFormatPreset() {
    const format = $('format').value;
    $('baseHours').value = formatPresets[format] ?? 3.5;
    const tasks = formatTasks[format] ?? formatTasks.review;
    checkIds.forEach((id, index) => {
      $(id).checked = tasks[index];
    });
    render();
  }

  function applyAccountPreset(followers, impressions) {
    $('followers').value = followers;
    $('impressions').value = impressions;
    render();
    toast(`已切换至 ${number(followers)} 粉 / ${number(impressions)} 曝光示例`);
  }

  function resetAll() {
    Object.entries(defaults).forEach(([key, value]) => {
      if (key === 'payMode') {
        const radio = document.querySelector(`input[name="payMode"][value="${value}"]`);
        if (radio) radio.checked = true;
        return;
      }
      const el = $(key);
      if (!el) return;
      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else {
        el.value = value;
      }
    });
    const tasks = formatTasks[defaults.format];
    checkIds.forEach((id, index) => {
      $(id).checked = tasks[index];
    });
    $('hideFloor').checked = false;
    $('advancedDrawer').open = false;
    commissionMemory = { ...defaultCommissionMemory };
    lastCommissionType = defaults.commissionType;
    syncCommissionConstraints(false);
    render();
    toast('已恢复默认参数');
  }

  async function copyText(content, label) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = content;
        textArea.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        if (!document.execCommand('copy')) throw new Error('copy failed');
        textArea.remove();
      }
      toast(label);
    } catch (_) {
      window.prompt('请手动复制下方文案：', content);
    }
  }

  // 事件绑定
  $('calculatorForm').addEventListener('submit', e => e.preventDefault());

  trafficSliders.forEach(({ inputId, rangeId, scale }) => {
    const rangeEl = $(rangeId);
    if (!rangeEl) return;
    rangeEl.addEventListener('input', () => {
      $(inputId).value = rangeToValue(rangeEl.value, scale);
      render(rangeId);
    });
  });

  document.querySelectorAll('input:not(#followersRange):not(#impressionsRange), select:not(#commissionType)').forEach(el => {
    el.addEventListener('input', () => render());
    el.addEventListener('change', () => render());
  });

  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('blur', () => normalizeNumberInput(el));
  });

  $('commissionType').addEventListener('change', handleCommissionTypeChange);
  $('format').addEventListener('change', applyFormatPreset);

  $('hideFloor').addEventListener('change', () => {
    render();
    toast(
      $('hideFloor').checked
        ? '已切换为对外报价模式，已隐藏目标成交价、内部底价与成本拆解'
        : '已切回内部测算模式'
    );
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyAccountPreset(Number(btn.dataset.followers), Number(btn.dataset.impressions));
    });
  });

  $('reset').addEventListener('click', resetAll);
  $('copyPublic').addEventListener('click', () => copyText(lastExternal, '已复制对外报价文案'));
  $('copyInternal').addEventListener('click', () => copyText(lastInternal, '已复制内部完整测算'));
  $('print').addEventListener('click', () => window.print());

  render();
})();
