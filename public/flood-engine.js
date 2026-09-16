/**
 * Flood Intelligence Engine - Browser Edition
 * Runs entirely in the browser, no Node.js server needed.
 * All data loaded via fetch() from static JSON files.
 */

let _sitesCache = null;
let _layersCache = null;
let _reportsCache = null;

const RISK_COLORS = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#ea580c',
  very_high: '#dc2626'
};

const RISK_LABELS = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  very_high: 'Rất cao'
};

// Detect base path for GitHub Pages (e.g. /hadong-flood-lab/) vs local (/)
function basePath() {
  const p = location.pathname;
  // If running from a subdirectory like /hadong-flood-lab/
  const match = p.match(/^(\/[^/]+\/)/);
  if (match && !p.endsWith('.html') && p !== '/') return match[1];
  if (p.includes('/hadong-flood-lab')) return '/hadong-flood-lab/';
  return '/';
}

export async function loadGisData() {
  if (_sitesCache && _layersCache) return { sites: _sitesCache, layers: _layersCache };
  const base = basePath();
  const [sitesRes, layersRes] = await Promise.all([
    fetch(base + 'data/sites.geojson'),
    fetch(base + 'data/gis-layers.geojson')
  ]);
  _sitesCache = await sitesRes.json();
  _layersCache = await layersRes.json();
  return { sites: _sitesCache, layers: _layersCache };
}

export async function loadReports() {
  // Community reports stored in localStorage (no server)
  const stored = localStorage.getItem('hadong-community-reports');
  if (stored) {
    try { _reportsCache = JSON.parse(stored); } catch { _reportsCache = []; }
  }
  if (_reportsCache) return _reportsCache;

  // First load: seed from static JSON
  try {
    const res = await fetch(basePath() + 'data/community-reports.json');
    _reportsCache = await res.json();
    localStorage.setItem('hadong-community-reports', JSON.stringify(_reportsCache));
  } catch {
    _reportsCache = [];
  }
  return _reportsCache;
}

export function saveReport(report) {
  const reports = _reportsCache || [];
  const newReport = {
    id: 'rep-' + Date.now().toString(36),
    reporter_name: report.reporter_name || 'Người dân Hà Đông',
    location_name: report.location_name || 'Khu vực Hà Đông',
    coordinates: report.coordinates || [105.78, 20.97],
    depth_level: report.depth_level || 'medium',
    depth_cm: Number(report.depth_cm) || 25,
    photo_url: report.photo_url || '',
    description: report.description || '',
    reported_at: new Date().toISOString(),
    status: 'verified',
    votes: 1
  };
  reports.unshift(newReport);
  _reportsCache = reports;
  localStorage.setItem('hadong-community-reports', JSON.stringify(reports));
  return newReport;
}

/**
 * Fetch weather directly from Open-Meteo (browser-side, no proxy needed)
 */
let _weatherCache = null;
let _weatherTime = 0;

export async function fetchWeatherDirect() {
  const now = Date.now();
  if (_weatherCache && now - _weatherTime < 900000) return _weatherCache;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=20.9708&longitude=105.7788&hourly=precipitation,precipitation_probability,temperature_2m&past_days=1&forecast_days=3&timezone=Asia%2FBangkok';
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Weather provider unavailable');
  const data = await res.json();
  _weatherTime = now;
  _weatherCache = { ...data, retrieved_at: new Date(now).toISOString(), source: 'Open-Meteo forecast (direct)' };
  return _weatherCache;
}

/**
 * AI Flood Forecast
 */
export async function getAiForecast(horizon = '+1h', currentRainRate = 35) {
  const { sites } = await loadGisData();
  const hKey = horizon.replace(/\s+/g, '').toLowerCase();

  const horizonMultiplier = {
    '+30m': { rainFactor: 0.85, conf: 91, timeOffset: 30, depthFactor: 0.9 },
    '+1h': { rainFactor: 1.0, conf: 86, timeOffset: 60, depthFactor: 1.1 },
    '+2h': { rainFactor: 1.25, conf: 82, timeOffset: 120, depthFactor: 1.35 },
    '+3h': { rainFactor: 1.15, conf: 78, timeOffset: 180, depthFactor: 1.2 }
  }[hKey] || { rainFactor: 1.0, conf: 82, timeOffset: 60, depthFactor: 1.0 };

  const now = new Date();
  const targetTime = new Date(now.getTime() + horizonMultiplier.timeOffset * 60000);
  const targetTimeStr = `${String(targetTime.getHours()).padStart(2, '0')}:${String(targetTime.getMinutes()).padStart(2, '0')}`;

  const predictions = sites.features.map(feature => {
    const p = feature.properties;
    const baseDepth = p.base_depth_cm || 20;
    const historicalMax = p.historical_max_depth_cm || 45;
    const elevationPenalty = Math.max(0, (6.2 - (p.elevation_m || 5.5)) * 4.5);
    const rainImpact = (currentRainRate / 30) * horizonMultiplier.rainFactor;
    let predictedDepth = Math.round(baseDepth * horizonMultiplier.depthFactor * rainImpact + elevationPenalty);
    predictedDepth = Math.min(predictedDepth, Math.round(historicalMax * 1.05));
    predictedDepth = Math.max(5, predictedDepth);
    const minDepth = Math.max(0, predictedDepth - Math.round(predictedDepth * 0.15));
    const maxDepth = predictedDepth + Math.round(predictedDepth * 0.15);
    let riskLevel = 'low', riskLabel = 'Thấp';
    if (predictedDepth >= 40) { riskLevel = 'very_high'; riskLabel = 'Rất cao'; }
    else if (predictedDepth >= 25) { riskLevel = 'high'; riskLabel = 'Cao'; }
    else if (predictedDepth >= 15) { riskLevel = 'medium'; riskLabel = 'Trung bình'; }
    const startMins = p.start_offset_min || 30;
    const startTime = new Date(now.getTime() + startMins * 60000);
    const startTimeStr = `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`;
    return {
      id: p.id, name: p.name, street: p.street || '', ward: p.ward || '',
      coordinates: feature.geometry.coordinates, risk_level: riskLevel, risk_label: riskLabel,
      depth_min_cm: minDepth, depth_max_cm: maxDepth, depth_range_text: `${minDepth}–${maxDepth} cm`,
      start_time: startTimeStr,
      confidence_pct: Math.min(95, Math.max(65, horizonMultiplier.conf + ((p.elevation_m || 5.5) < 5.0 ? 3 : -2))),
      note: p.note || '', solution: p.solution || ''
    };
  });

  const topHotspot = [...predictions].sort((a, b) => b.depth_max_cm - a.depth_max_cm)[0];
  return {
    horizon: hKey, target_time: targetTimeStr, average_confidence_pct: horizonMultiplier.conf,
    top_hotspot: {
      name: topHotspot.name, risk_label: topHotspot.risk_label,
      depth_range_text: topHotspot.depth_range_text, start_time: topHotspot.start_time,
      confidence_pct: topHotspot.confidence_pct
    },
    predictions
  };
}

/**
 * Early Alerts
 */
export async function getEarlyAlerts(rainRate = 38) {
  const forecast = await getAiForecast('+1h', rainRate);
  const highRisk = forecast.predictions.filter(p => p.risk_level === 'high' || p.risk_level === 'very_high');
  const veryHighRisk = forecast.predictions.filter(p => p.risk_level === 'very_high');
  let level = 'normal', label = 'Bình thường', color = '#166451';
  let banner = 'Hệ thống thoát nước hoạt động ổn định. Không ghi nhận điểm ngập nguy hiểm.';
  if (veryHighRisk.length >= 2 || highRisk.length >= 6 || rainRate >= 50) {
    level = 'danger'; label = 'Nguy hiểm (Báo động cấp 3)'; color = '#dc2626';
    banner = `BÁO ĐỘNG ĐỎ: Đang có ${veryHighRisk.length} điểm ngập rất sâu (>40cm). Nguy cơ tê liệt trục Nguyễn Trãi - Ba La và Lê Trọng Tấn!`;
  } else if (highRisk.length >= 3 || rainRate >= 30) {
    level = 'warning'; label = 'Cảnh báo (Báo động cấp 2)'; color = '#ea580c';
    banner = `CẢNH BÁO: Mưa lớn dồn dập, ${highRisk.length} khu vực có nguy cơ ngập sâu 25–40cm. Cân nhắc đổi lộ trình.`;
  } else if (highRisk.length >= 1 || rainRate >= 15) {
    level = 'advisory'; label = 'Chú ý (Báo động cấp 1)'; color = '#d97706';
    banner = 'CHÚ Ý: Xuất hiện ngập cục bộ tại một số tuyến đường trũng thấp ven hồ và chân dốc.';
  }
  return {
    level, label, color, banner, affected_count: highRisk.length,
    critical_spots: veryHighRisk.map(v => v.name),
    river_status: { river_name: 'Sông Nhuệ (Trạm Cầu Đơ - Hà Đông)', water_level_m: 4.85, alert_stage: 'Báo động II (4.85m / 5.00m)', trend: 'Đang dâng chậm (+3cm/h)' },
    pumping_stations: { yen_nghia: 'Trạm bơm Yên Nghĩa: Vận hành 7/10 tổ máy (120 m³/s xả Sông Đáy)', cau_do: 'Trạm bơm Cầu Đơ: 4/4 tổ máy đang chạy hết công suất' }
  };
}

/**
 * Dashboard Data
 */
export async function getDashboardData(rainRate = 35) {
  const forecast = await getAiForecast('+1h', rainRate);
  const currentlyFlooded = forecast.predictions.filter(p => p.depth_max_cm >= 20).length;
  const highRiskCount = forecast.predictions.filter(p => p.risk_level === 'high' || p.risk_level === 'very_high').length;
  const totalFloodedAreaHa = Number((currentlyFlooded * 1.15 + (rainRate / 20) * 2.8).toFixed(1));
  const trends = {
    '1h': [
      { time: '14:00', rain_mm: 12, water_level_m: 4.60, flooded_count: 3 },
      { time: '14:15', rain_mm: 22, water_level_m: 4.68, flooded_count: 5 },
      { time: '14:30', rain_mm: 36, water_level_m: 4.75, flooded_count: 8 },
      { time: '14:45', rain_mm: 42, water_level_m: 4.82, flooded_count: 10 },
      { time: '15:00', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ],
    '3h': [
      { time: '12:00', rain_mm: 4, water_level_m: 4.45, flooded_count: 0 },
      { time: '13:00', rain_mm: 15, water_level_m: 4.55, flooded_count: 3 },
      { time: '14:00', rain_mm: 38, water_level_m: 4.72, flooded_count: 7 },
      { time: '15:00', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ],
    '6h': [
      { time: '09:00', rain_mm: 0, water_level_m: 4.30, flooded_count: 0 },
      { time: '11:00', rain_mm: 8, water_level_m: 4.40, flooded_count: 1 },
      { time: '13:00', rain_mm: 25, water_level_m: 4.60, flooded_count: 4 },
      { time: '15:00', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ],
    '24h': [
      { time: '16:00 (hqua)', rain_mm: 2, water_level_m: 4.25, flooded_count: 0 },
      { time: '22:00', rain_mm: 0, water_level_m: 4.20, flooded_count: 0 },
      { time: '04:00', rain_mm: 5, water_level_m: 4.30, flooded_count: 0 },
      { time: '10:00', rain_mm: 12, water_level_m: 4.45, flooded_count: 2 },
      { time: '15:00 (nay)', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ]
  };
  return {
    metrics: { currently_flooded_points: currentlyFlooded, high_risk_points: highRiskCount, current_rain_mm_h: rainRate, rain_24h_total_mm: 78.5, river_water_level_m: 4.85, river_threshold_alert2_m: 5.0, risk_area_ha: totalFloodedAreaHa },
    trends
  };
}

/**
 * Timeline Simulation (14:00 → 18:00)
 */
export async function getTimelineSimulation() {
  const { sites } = await loadGisData();
  const timelineSteps = [
    { hour: '14:00', label: '14:00 - Mưa rào bắt đầu', rain_rate_mm: 18, status_desc: 'Mưa dồn dập tại lưu vực phía Bắc Hà Đông, nước bắt đầu tích tụ ở các phễu thu.', spread_multiplier: 0.6, depth_multiplier: 0.5, active_ha: 4.2 },
    { hour: '15:00', label: '15:00 - Mưa lớn dồn dập', rain_rate_mm: 45, status_desc: 'Lượng mưa đạt đỉnh, xuất hiện ngập sâu tại Hầm chui Nguyễn Trãi, Ba La, Văn Quán.', spread_multiplier: 1.0, depth_multiplier: 1.0, active_ha: 14.5 },
    { hour: '16:00', label: '16:00 - Đỉnh triều & ngập cực đại', rain_rate_mm: 32, status_desc: 'Mực nước Sông Nhuệ dâng cao, vùng ngập lan rộng sang các ngõ xóm và trục đường gom.', spread_multiplier: 1.3, depth_multiplier: 1.15, active_ha: 18.2 },
    { hour: '17:00', label: '17:00 - Mưa giảm, trạm bơm Yên Nghĩa hút nước', rain_rate_mm: 12, status_desc: 'Trạm bơm Yên Nghĩa chạy hết công suất 10 tổ máy, nước rút dần 10–15 cm tại trục chính.', spread_multiplier: 0.85, depth_multiplier: 0.75, active_ha: 10.4 },
    { hour: '18:00', label: '18:00 - Nước cơ bản rút hết', rain_rate_mm: 2, status_desc: 'Giao thông trục Quang Trung và Nguyễn Trãi hồi phục, chỉ còn đọng nước cục bộ ở ngõ trũng.', spread_multiplier: 0.35, depth_multiplier: 0.3, active_ha: 2.8 }
  ];
  const steps = timelineSteps.map(step => {
    const stepSites = sites.features.map(f => {
      const p = f.properties;
      const calcDepth = Math.round((p.base_depth_cm || 20) * step.depth_multiplier);
      const radiusM = Math.round((calcDepth > 10 ? calcDepth * 6 : 40) * step.spread_multiplier);
      let level = 'low';
      if (calcDepth >= 40) level = 'very_high';
      else if (calcDepth >= 25) level = 'high';
      else if (calcDepth >= 15) level = 'medium';
      return { id: p.id, name: p.name, coordinates: f.geometry.coordinates, depth_cm: calcDepth, radius_meters: radiusM, risk_level: level };
    });
    return { hour: step.hour, label: step.label, rain_rate_mm: step.rain_rate_mm, status_desc: step.status_desc, active_ha: step.active_ha, sites: stepSites };
  });
  return { timeline: steps };
}

/**
 * Location search
 */
export async function searchLocationRisk(queryStr) {
  if (!queryStr || typeof queryStr !== 'string') return null;
  const q = queryStr.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const forecast = await getAiForecast('+1h', 38);
  const matchedSite = forecast.predictions.find(p => {
    const nameNorm = p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const streetNorm = (p.street || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const wardNorm = (p.ward || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return nameNorm.includes(q) || streetNorm.includes(q) || wardNorm.includes(q) || q.includes(nameNorm) || q.includes(streetNorm);
  }) || forecast.predictions[0];
  return {
    query: queryStr, matched_location: matchedSite.name, street: matchedSite.street, ward: matchedSite.ward,
    coordinates: matchedSite.coordinates, risk_level: matchedSite.risk_level, risk_label: matchedSite.risk_label,
    depth_range_text: matchedSite.depth_range_text, expected_start_time: matchedSite.start_time,
    confidence_pct: matchedSite.confidence_pct,
    safety_advisory: matchedSite.risk_level === 'very_high'
      ? 'Đoạn đường nguy cơ ngập sâu >40cm, không di chuyển qua bằng xe máy hoặc ô tô gầm thấp!'
      : matchedSite.risk_level === 'high'
      ? 'Nguy cơ ngập 25–35cm, đi chậm làn tim đường hoặc chọn tuyến tránh an toàn.'
      : 'Khu vực tương đối an toàn, lưu ý mặt đường trơn ướt và giảm tốc độ.'
  };
}

/**
 * Avoidance routing
 */
export function getAvoidanceRoutes(originName, destName) {
  return {
    origin: originName || 'Bệnh viện 103 (Phùng Hưng)',
    destination: destName || 'KĐT Văn Phú (Hà Đông)',
    regular_route: {
      name: 'Tuyến ngắn nhất (Đường Phùng Hưng - Cầu Bươu - Xa La)', distance_km: 4.8, duration_min: 28, is_flooded: true,
      flood_spots: [{ name: 'Đoạn cổng Bệnh viện 103', depth: '28 cm', risk: 'Cao' }, { name: 'Cổng KĐT Xa La', depth: '35 cm', risk: 'Rất cao' }],
      warning_msg: 'CẢNH BÁO: Đoạn qua Xa La và Viện 103 đang ngập sâu tới 35cm, nguy cơ chết máy cao.',
      path: [[105.7905,20.9635],[105.7930,20.9610],[105.7968,20.9582],[105.7850,20.9550],[105.7720,20.9540],[105.7665,20.9548]]
    },
    safe_route: {
      name: 'Tuyến tránh ngập an toàn (Phùng Hưng → Cầu Trắng → Tô Hiệu → KĐT Văn Phú)', distance_km: 5.4, duration_min: 16, is_flooded: false,
      elevation_status: 'Cốt nền cao, hệ thống thoát nước thông thoáng, không ngập',
      recommendation: 'Lộ trình khuyến nghị: Dù dài hơn 600m nhưng đi qua trục Tô Hiệu không ngập nước, tiết kiệm 12 phút tránh kẹt xe.',
      path: [[105.7905,20.9635],[105.7845,20.9710],[105.7802,20.9780],[105.7742,20.9632],[105.7680,20.9590],[105.7665,20.9548]]
    }
  };
}

/**
 * Action Solutions
 */
export function getActionableSolutions() {
  return [
    {
      category: 'Cảnh báo nhân dân & Người tham gia giao thông', priority: 'Khẩn cấp', icon: '🚗', color: '#dc2626',
      actions: [
        'Hạn chế phương tiện đi vào Hầm chui Nguyễn Trãi - Khuất Duy Tiến và Ngã ba Ba La (độ sâu dự báo 30–45 cm).',
        'Cư dân các chung cư tại KĐT Văn Quán, Xa La, Mộ Lao chủ động đưa ô tô ra khỏi tầng hầm thấp.',
        'Sử dụng các tuyến tránh cao ráo: Trục đường Tô Hiệu, Cầu Trắng, đường đôi 24m KĐT Văn Phú.'
      ]
    },
    {
      category: 'Vận hành hạ tầng & Tiêu thoát nước', priority: 'Ưu tiên 1', icon: '🛟', color: '#ea580c',
      actions: [
        'Kích hoạt 8/10 tổ máy Trạm bơm Yên Nghĩa (120 m³/s) để hạ thấp tối đa mực nước Kênh La Khê.',
        'Trạm bơm Cầu Đơ vận hành liên tục 4 tổ máy tiêu nước nội thị Hà Đông ra sông Nhuệ.',
        'Công nhân Xí nghiệp thoát nước số 8 túc trực tại 16 điểm ngập trọng yếu, mở nắp cống thu và vớt rác rào chắn.'
      ]
    },
    {
      category: 'Điều phối giao thông & Cứu hộ cứu nạn', priority: 'Chủ động', icon: '👮', color: '#2563eb',
      actions: [
        'Đội CSGT số 7 và số 10 cắm chốt từ xa tại ngã tư Lê Trọng Tấn - Quang Trung và ngã tư Vạn Phúc để phân luồng xe tải, xe buýt.',
        'Bố trí xe cứu hộ cẩu kéo chuyên dụng túc trực tại chân cầu vượt Ba La và đường Nguyễn Trãi sẵn sàng kéo xe chết máy.',
        'Phát thanh bản tin cảnh báo ngập qua hệ thống loa truyền thanh thông minh các phường Phúc La, Mộ Lao, Dương Nội.'
      ]
    }
  ];
}

export { RISK_COLORS, RISK_LABELS };
