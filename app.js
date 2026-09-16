/**
 * Hà Đông Flood Lab - GIS & AI Urban Flood Monitoring Platform
 * Full client-side application logic
 * Works on both localhost (Node server) AND GitHub Pages (static)
 */
import {
  loadGisData, loadReports, saveReport, fetchWeatherDirect,
  getAiForecast, getEarlyAlerts, getDashboardData, getTimelineSimulation,
  searchLocationRisk, getAvoidanceRoutes, getActionableSolutions,
  RISK_COLORS, RISK_LABELS
} from './flood-engine.js';

const $ = id => document.getElementById(id);

let map;
let layers = {
  roads: null, residential: null, lakes: null, rivers: null,
  drainage: null, sites: null, community: null, rainRadar: null,
  routing: null, timelineSpread: null
};

let currentForecast = null;
let currentTimeline = null;
let timelineTimer = null;
let isPlayingTimeline = false;
let soundEnabled = false;
let audioCtx = null;
let selectedReportCoords = [105.78, 20.97];
let isPickingMapLocation = false;
let currentRainHorizon = 24;
let weatherData = null;

function playAlertBeep() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) { console.warn('Audio not allowed yet', e); }
}

// ═══════════════════════════════════════════════════════
// 1. INITIALIZE LEAFLET MAP & ALL GIS LAYERS
// ═══════════════════════════════════════════════════════
async function initMap() {
  if (!window.L) {
    $('map').innerHTML = '<div style="padding:20px;color:#dc2626">Không thể tải Leaflet Map. Vui lòng kiểm tra kết nối mạng.</div>';
    return;
  }
  map = L.map('map', { center: [20.972, 105.776], zoom: 13.5, zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Hà Đông Flood Lab'
  }).addTo(map);

  layers.roads = L.layerGroup().addTo(map);
  layers.residential = L.layerGroup().addTo(map);
  layers.lakes = L.layerGroup().addTo(map);
  layers.rivers = L.layerGroup().addTo(map);
  layers.drainage = L.layerGroup().addTo(map);
  layers.sites = L.layerGroup().addTo(map);
  layers.community = L.layerGroup().addTo(map);
  layers.rainRadar = L.layerGroup().addTo(map);
  layers.routing = L.layerGroup().addTo(map);
  layers.timelineSpread = L.layerGroup().addTo(map);

  map.on('click', e => {
    if (isPickingMapLocation) {
      selectedReportCoords = [Number(e.latlng.lng.toFixed(4)), Number(e.latlng.lat.toFixed(4))];
      $('rep-coords-hint').textContent = `Tọa độ đã chọn: ${selectedReportCoords[1]}° N, ${selectedReportCoords[0]}° E`;
      $('pick-on-map-btn').textContent = '✓ Đã chọn vị trí';
      $('pick-on-map-btn').classList.add('primary-btn');
      isPickingMapLocation = false;
      $('map-status-msg').textContent = 'Đã chọn tọa độ báo cáo trên bản đồ!';
      $('report-modal').classList.add('open');
    }
  });

  await renderGisLayers();
}

// ═══════════════════════════════════════════════════════
// 2. LOAD & RENDER GIS LAYERS
// ═══════════════════════════════════════════════════════
async function renderGisLayers() {
  if (!map) return;
  let data;
  try { data = await loadGisData(); } catch (e) { console.error('Lỗi khi tải GIS layers', e); return; }

  layers.roads.clearLayers(); layers.residential.clearLayers();
  layers.lakes.clearLayers(); layers.rivers.clearLayers();
  layers.drainage.clearLayers(); layers.sites.clearLayers();

  const feats = data.layers?.features || [];
  feats.forEach(feat => {
    const p = feat.properties; const geom = feat.geometry;
    if (p.layer === 'roads') {
      const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
      const poly = L.polyline(latlngs, { color: p.flood_vulnerable ? '#f97316' : '#64748b', weight: p.width_m > 30 ? 5 : 3.5, opacity: 0.85, dashArray: p.flood_vulnerable ? '4, 4' : null }).addTo(layers.roads);
      poly.bindTooltip(`<b>${p.name}</b><br>${p.road_type}`, { sticky: true });
    }
    if (p.layer === 'residential') {
      const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
      const poly = L.polygon(latlngs, { color: '#15803d', weight: 1.5, fillColor: '#86efac', fillOpacity: 0.25 }).addTo(layers.residential);
      poly.bindTooltip(`<b>${p.name}</b><br>Dân số: ${(p.population||0).toLocaleString('vi-VN')} người · ${p.area_ha} ha`, { sticky: true });
    }
    if (p.layer === 'lakes') {
      const latlngs = geom.coordinates[0].map(c => [c[1], c[0]]);
      const poly = L.polygon(latlngs, { color: '#0284c7', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.55 }).addTo(layers.lakes);
      poly.bindTooltip(`<b>${p.name}</b><br>Dung tích: ${(p.capacity_m3||0).toLocaleString('vi-VN')} m³`, { sticky: true });
    }
    if (p.layer === 'rivers') {
      const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
      const poly = L.polyline(latlngs, { color: '#0369a1', weight: 6, opacity: 0.9 }).addTo(layers.rivers);
      poly.bindTooltip(`<b>${p.name}</b><br>Mực nước: ${p.current_water_level_m}m · ${p.type}`, { sticky: true });
    }
    if (p.layer === 'drainage') {
      if (geom.type === 'Point') {
        const [lng, lat] = geom.coordinates;
        const marker = L.circleMarker([lat, lng], { radius: 9, color: '#ffffff', weight: 2, fillColor: '#ea580c', fillOpacity: 0.95 }).addTo(layers.drainage);
        marker.bindPopup(`<b>${p.name}</b><br>${p.role || ''}<br><b>${p.operating_pumps || ''}</b>`);
        marker.bindTooltip(p.name);
      } else if (geom.type === 'LineString') {
        const latlngs = geom.coordinates.map(c => [c[1], c[0]]);
        const poly = L.polyline(latlngs, { color: '#d97706', weight: 4, dashArray: '5, 8', opacity: 0.85 }).addTo(layers.drainage);
        poly.bindTooltip(`<b>${p.name}</b><br>${p.status || ''}`, { sticky: true });
      }
    }
  });

  // Flood Sites
  const sites = data.sites?.features || [];
  sites.forEach(f => {
    const [lng, lat] = f.geometry.coordinates; const p = f.properties;
    const color = RISK_COLORS[p.risk_level] || '#ea580c';
    const isDanger = p.risk_level === 'very_high';
    const marker = L.circleMarker([lat, lng], {
      radius: isDanger ? 12 : 9, color: '#ffffff', weight: 3,
      fillColor: color, fillOpacity: 0.95, className: isDanger ? 'pulsing-beacon' : ''
    }).addTo(layers.sites);
    const popupContent = document.createElement('div');
    popupContent.innerHTML = `
      <div style="font-weight:700;font-size:14px;color:#0f172a;margin-bottom:4px">${p.name}</div>
      <div style="font-size:11px;color:#64748b;margin-bottom:8px">Đường: ${p.street||''} (${p.ward||''})</div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:${color};color:white">Nguy cơ: ${RISK_LABELS[p.risk_level]||''}</span>
        <span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#f1f5f9;color:#334155">Lịch sử: ${p.historical_max_depth_cm||0} cm</span>
      </div>
      <p style="font-size:11px;color:#475569;margin:0 0 8px;line-height:1.5">${p.note||''}</p>
      <div style="font-size:11px;background:#f0fdf4;border-left:3px solid #166451;padding:6px;color:#166534;margin-bottom:8px"><b>Ứng phó:</b> ${p.solution||''}</div>`;
    marker.bindPopup(popupContent);
    marker.bindTooltip(`<b>${p.name}</b><br>Mức nguy cơ: ${RISK_LABELS[p.risk_level]||''}`, { sticky: true });
  });

  // Heavy Rain Zone Overlay
  const heavyRainPolygon = [[20.989,105.772],[20.992,105.795],[20.975,105.798],[20.970,105.775]];
  const radar = L.polygon(heavyRainPolygon, { color: '#3b82f6', weight: 2, dashArray: '3, 6', fillColor: '#2563eb', fillOpacity: 0.22 }).addTo(layers.rainRadar);
  radar.bindTooltip('🌧️ <b>Vùng mây đối lưu mưa lớn đang phát triển (45 mm/h)</b>', { sticky: true });
}

// ═══════════════════════════════════════════════════════
// 3. LAYER TOGGLE CONTROLS
// ═══════════════════════════════════════════════════════
function setupLayerControls() {
  [['layer-roads',layers.roads],['layer-residential',layers.residential],['layer-lakes',layers.lakes],
   ['layer-rivers',layers.rivers],['layer-drainage',layers.drainage],['layer-sites',layers.sites],
   ['layer-community',layers.community],['layer-rain-radar',layers.rainRadar]].forEach(([id,layer]) => {
    const el = $(id); if (!el) return;
    el.addEventListener('change', e => {
      if (!map) return;
      if (e.target.checked) { layer.addTo(map); e.target.parentElement.classList.add('active'); }
      else { map.removeLayer(layer); e.target.parentElement.classList.remove('active'); }
    });
  });
  $('reset-map-view').onclick = () => map?.setView([20.972, 105.776], 13.5);
  $('locate-user-btn').onclick = () => {
    if (!navigator.geolocation) { alert('Trình duyệt không hỗ trợ định vị.'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { map?.flyTo([pos.coords.latitude, pos.coords.longitude], 15); L.marker([pos.coords.latitude, pos.coords.longitude]).addTo(map).bindPopup('<b>Vị trí của bạn</b>').openPopup(); },
      () => alert('Không thể lấy được vị trí. Hãy bật GPS và cấp quyền truy cập.')
    );
  };
}

// ═══════════════════════════════════════════════════════
// 4. TIMELINE SIMULATION (14:00 → 18:00)
// ═══════════════════════════════════════════════════════
async function loadTimeline() {
  try { const data = await getTimelineSimulation(); currentTimeline = data.timeline; updateTimelineStep(1); } catch (e) { console.error('Lỗi nạp timeline', e); }
}

function updateTimelineStep(stepIndex) {
  if (!currentTimeline || !currentTimeline[stepIndex]) return;
  const step = currentTimeline[stepIndex];
  $('timeline-range').value = stepIndex;
  $('timeline-current-label').textContent = step.label;
  $('timeline-desc').textContent = `${step.status_desc} Lượng mưa: ${step.rain_rate_mm} mm/h · Diện tích ngập ước tính: ${step.active_ha} ha.`;
  document.querySelectorAll('.timeline-marks .mark').forEach((m, idx) => m.classList.toggle('active', idx === Number(stepIndex)));
  layers.timelineSpread.clearLayers();
  step.sites.forEach(site => {
    if (site.depth_cm < 10) return;
    const [lng, lat] = site.coordinates;
    const color = RISK_COLORS[site.risk_level] || '#ea580c';
    L.circle([lat, lng], { radius: site.radius_meters, color, weight: 1.5, fillColor: color, fillOpacity: 0.35 })
      .addTo(layers.timelineSpread).bindTooltip(`<b>${site.name}</b><br>Độ sâu: ${site.depth_cm} cm · Lan rộng: ${site.radius_meters}m`);
  });
  $('map-status-msg').textContent = `Mô phỏng thời gian ${step.hour}: Diện tích ngập ${step.active_ha} ha`;
}

function setupTimelineEvents() {
  $('timeline-range').addEventListener('input', e => updateTimelineStep(Number(e.target.value)));
  document.querySelectorAll('.timeline-marks .mark').forEach(m => m.addEventListener('click', () => updateTimelineStep(Number(m.dataset.step))));
  $('timeline-play-btn').onclick = () => {
    if (isPlayingTimeline) {
      clearInterval(timelineTimer); isPlayingTimeline = false;
      $('timeline-play-btn').textContent = '▶ Tự động chạy (Play)'; $('timeline-play-btn').classList.remove('primary');
    } else {
      isPlayingTimeline = true; $('timeline-play-btn').textContent = '⏸ Tạm dừng (Pause)'; $('timeline-play-btn').classList.add('primary');
      timelineTimer = setInterval(() => { let next = Number($('timeline-range').value) + 1; if (next > 4) next = 0; updateTimelineStep(next); }, 2400);
    }
  };
}

// ═══════════════════════════════════════════════════════
// 5. AI FORECAST PANEL
// ═══════════════════════════════════════════════════════
async function loadAiForecast(horizon = '+1h') {
  try { currentForecast = await getAiForecast(horizon); renderAiForecast(currentForecast); } catch (e) { console.error('Lỗi nạp AI forecast', e); }
}

function renderAiForecast(data) {
  if (!data) return;
  const top = data.top_hotspot;
  $('ai-top-location').textContent = `Nguy cơ ngập ${top.risk_label.toLowerCase()} – ${top.name}`;
  $('ai-depth-val').textContent = top.depth_range_text;
  $('ai-start-val').textContent = top.start_time;
  $('ai-confidence-val').textContent = `${top.confidence_pct}%`;
  const listEl = $('ai-sites-list'); listEl.innerHTML = '';
  data.predictions.forEach(p => {
    const item = document.createElement('div'); item.className = 'ai-site-item';
    item.innerHTML = `<div class="ai-site-info"><strong>${p.name}</strong><span>Dự kiến: ${p.start_time} · Độ sâu: <b>${p.depth_range_text}</b></span></div><span class="ai-site-badge badge-${p.risk_level}">${p.risk_label} · ${p.confidence_pct}%</span>`;
    item.onclick = () => { const [lng,lat] = p.coordinates; map?.flyTo([lat,lng],16); L.popup().setLatLng([lat,lng]).setContent(`<b>${p.name}</b><br>Mức nguy cơ: <b>${p.risk_label}</b><br>Độ sâu dự báo: <b>${p.depth_range_text}</b><br>Thời gian ngập: <b>${p.start_time}</b><br>Độ tin cậy: <b>${p.confidence_pct}%</b>`).openOn(map); };
    listEl.appendChild(item);
  });
}

function setupAiHorizonEvents() {
  document.querySelectorAll('.ai-horizon-selector .horizon-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('.ai-horizon-selector .horizon-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); loadAiForecast(btn.dataset.horizon); });
  });
}

// ═══════════════════════════════════════════════════════
// 6. LOCATION SEARCH
// ═══════════════════════════════════════════════════════
async function searchLocation(query) {
  if (!query) return;
  try { const data = await searchLocationRisk(query); renderSearchResult(data); } catch (e) { console.error('Lỗi tìm kiếm', e); }
}

function renderSearchResult(data) {
  if (!data) return;
  $('search-res-title').textContent = data.matched_location;
  $('search-res-ward').textContent = `${data.street} (${data.ward})`;
  $('search-res-depth').textContent = data.depth_range_text;
  $('search-res-time').textContent = data.expected_start_time;
  $('search-res-conf').textContent = `${data.confidence_pct}%`;
  const badge = $('search-res-risk-badge'); badge.textContent = data.risk_label;
  badge.className = `badge ${data.risk_level === 'very_high' ? 'danger' : data.risk_level === 'high' ? 'warning' : 'info'}`;
  $('search-res-advisory').textContent = data.safety_advisory;
  $('search-focus-map-btn').onclick = () => { const [lng,lat] = data.coordinates; map?.flyTo([lat,lng],16); L.popup().setLatLng([lat,lng]).setContent(`<b>${data.matched_location}</b><br>Nguy cơ: <b>${data.risk_label}</b><br>Độ sâu: <b>${data.depth_range_text}</b>`).openOn(map); };
  $('search-find-avoid-btn').onclick = () => { $('route-to').value = data.matched_location; $('routing-section').scrollIntoView({behavior:'smooth'}); calculateAvoidanceRoute(); };
}

function setupSearchEvents() {
  $('search-btn').onclick = () => searchLocation($('location-search-input').value);
  $('location-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchLocation(e.target.value); });
  document.querySelectorAll('.search-suggestions .sugg-tag').forEach(tag => tag.addEventListener('click', () => { $('location-search-input').value = tag.dataset.query; searchLocation(tag.dataset.query); }));
}

// ═══════════════════════════════════════════════════════
// 7. SMART ROUTING
// ═══════════════════════════════════════════════════════
function calculateAvoidanceRoute() {
  const from = $('route-from').value; const to = $('route-to').value;
  const data = getAvoidanceRoutes(from, to);
  renderAvoidanceRoute(data);
}

function renderAvoidanceRoute(routeData) {
  if (!map || !routeData) return;
  layers.routing.clearLayers();
  const reg = routeData.regular_route; const safe = routeData.safe_route;
  const regCoords = reg.path.map(c => [c[1], c[0]]);
  L.polyline(regCoords, { color: '#dc2626', weight: 5, dashArray: '6, 8', opacity: 0.8 }).addTo(layers.routing).bindTooltip(`⚠️ ${reg.name}<br>Có ${reg.flood_spots.length} điểm ngập sâu`, { sticky: true });
  const safeCoords = safe.path.map(c => [c[1], c[0]]);
  L.polyline(safeCoords, { color: '#166451', weight: 6, opacity: 0.95 }).addTo(layers.routing).bindTooltip(`★ ${safe.name}<br>Cốt nền cao, an toàn`, { sticky: true });
  L.marker(safeCoords[0]).addTo(layers.routing).bindPopup(`<b>Điểm xuất phát:</b> ${routeData.origin}`);
  L.marker(safeCoords[safeCoords.length - 1]).addTo(layers.routing).bindPopup(`<b>Điểm đến:</b> ${routeData.destination}`);
  map.fitBounds(L.latLngBounds(safeCoords.concat(regCoords)), { padding: [40, 40] });
  $('map-status-msg').textContent = 'Đang hiển thị gợi ý tuyến tránh ngập: Xanh (An toàn) vs Đỏ (Ngập nước)';
}

// ═══════════════════════════════════════════════════════
// 8. RAINFALL MONITORING
// ═══════════════════════════════════════════════════════
async function loadWeather() {
  try {
    $('rain-status-text').textContent = 'Đang kết nối Open-Meteo…';
    weatherData = await fetchWeatherDirect();
    renderWeatherChart(weatherData, currentRainHorizon);
    $('rain-status-text').textContent = `Dữ liệu từ Open-Meteo trực tiếp (${new Date(weatherData.retrieved_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})}). Múi giờ UTC+7.`;
  } catch {
    $('rain-status-text').textContent = 'Không kết nối được Open-Meteo; hiển thị mô phỏng.';
    renderWeatherChart(null, currentRainHorizon);
  }
}

function renderWeatherChart(data, hoursCount = 24) {
  const container = $('rain-chart-container'); container.innerHTML = '';
  let times = data?.hourly?.time?.slice(0, hoursCount) || [];
  let rains = data?.hourly?.precipitation?.slice(0, hoursCount) || [];
  if (times.length === 0) { for (let i = 0; i < hoursCount; i++) { times.push(`${String((14 + i) % 24).padStart(2, '0')}:00`); rains.push(Math.max(0, Math.round(Math.sin(i / 3) * 35 + 10))); } }
  const maxRain = Math.max(10, ...rains);
  const totalRain = rains.reduce((a, b) => a + b, 0).toFixed(1);
  const peakRain = Math.max(...rains); const peakIndex = rains.indexOf(peakRain);
  $('rain-summary-badge').textContent = `Tổng mưa ${hoursCount}h: ${totalRain} mm · Đỉnh mưa: ${peakRain} mm/h lúc ${times[peakIndex]?.slice(11, 16) || times[peakIndex]}`;
  times.forEach((t, i) => {
    const rain = rains[i] ?? 0; const isPeak = i === peakIndex && rain > 0;
    const col = document.createElement('div'); col.className = 'chart-col'; col.title = `${t}: ${rain} mm`;
    col.innerHTML = `<span class="chart-val">${rain > 0 ? rain : ''}</span><div class="chart-bar ${isPeak ? 'peak' : ''}" style="height:${Math.round((rain / maxRain) * 140)}px"></div><span class="chart-label">${i % 3 === 0 ? (t.length > 5 ? t.slice(11, 16) : t) : ''}</span>`;
    container.appendChild(col);
  });
}

function setupRainEvents() {
  document.querySelectorAll('.forecast-period-selector .horizon-chart-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('.forecast-period-selector .horizon-chart-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentRainHorizon = Number(btn.dataset.hours); if (weatherData) renderWeatherChart(weatherData, currentRainHorizon); });
  });
  $('export-rain-json-btn').onclick = () => { if (!weatherData) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(weatherData, null, 2)], { type: 'application/json' })); a.download = 'ha-dong-weather.json'; a.click(); };
  $('export-rain-csv-btn').onclick = () => { if (!weatherData?.hourly) return; const h = weatherData.hourly; const rows = ['thoi_gian,luong_mua_mm']; for (let i = 0; i < h.time.length; i++) rows.push(`${h.time[i]},${h.precipitation[i]}`); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })); a.download = 'ha-dong-rain.csv'; a.click(); };
  $('print-sheet-btn').onclick = () => window.print();
}

// ═══════════════════════════════════════════════════════
// 9. DASHBOARD & ALERTS
// ═══════════════════════════════════════════════════════
async function loadDashboardAndAlerts() {
  try {
    const dash = await getDashboardData(35);
    const m = dash.metrics;
    $('kpi-flooded-count').innerHTML = `${String(m.currently_flooded_points).padStart(2, '0')} <small>điểm</small>`;
    $('kpi-high-risk-count').innerHTML = `${String(m.high_risk_points).padStart(2, '0')} <small>khu vực</small>`;
    $('kpi-rain-now').innerHTML = `${m.current_rain_mm_h.toFixed(1)} <small>mm/h</small>`;
    $('kpi-rain-24h').textContent = `Tích lũy 24h: ${m.rain_24h_total_mm} mm`;
    $('kpi-water-level').innerHTML = `${m.river_water_level_m.toFixed(2)} <small>m</small>`;
    $('kpi-flooded-area').innerHTML = `${m.risk_area_ha.toFixed(1)} <small>ha</small>`;
    renderDashboardMiniChart(dash.trends['3h']); setupTrendTabs(dash.trends);
    const alertData = await getEarlyAlerts(38);
    $('alert-text').textContent = alertData.banner;
    $('top-alert-ticker').className = `top-alert-ticker ${alertData.level}`;
    if (alertData.level === 'danger' || alertData.level === 'warning') playAlertBeep();
  } catch (e) { console.error('Lỗi tải dashboard/alerts', e); }
}

function renderDashboardMiniChart(points = []) {
  const chartEl = $('trend-chart-mini'); chartEl.innerHTML = '';
  const maxRain = Math.max(10, ...points.map(p => p.rain_mm));
  $('trend-summary-text').textContent = `Thời gian quan trắc: ${points[0]?.time} đến ${points[points.length - 1]?.time} · Mực nước sông Nhuệ dâng lên ${points[points.length - 1]?.water_level_m}m.`;
  points.forEach((p, idx) => {
    const item = document.createElement('div'); item.className = 'trend-bar-item';
    const fillHeight = Math.max(8, Math.round((p.rain_mm / maxRain) * 60));
    item.innerHTML = `<span class="trend-bar-val">${p.rain_mm}</span><div class="trend-bar-fill ${idx === points.length - 1 ? 'active' : ''}" style="height:${fillHeight}px"></div><span class="trend-bar-label">${p.time}</span>`;
    chartEl.appendChild(item);
  });
}

function setupTrendTabs(trends) {
  document.querySelectorAll('.trend-tabs .trend-tab').forEach(tab => {
    tab.onclick = () => { document.querySelectorAll('.trend-tabs .trend-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); renderDashboardMiniChart(trends[tab.dataset.period]); };
  });
}

// ═══════════════════════════════════════════════════════
// 10. COMMUNITY REPORTS
// ═══════════════════════════════════════════════════════
async function loadCommunityReports() {
  try { const reports = await loadReports(); renderCommunityFeed(reports); } catch (e) { console.error('Lỗi nạp báo cáo', e); }
}

function renderCommunityFeed(reports) {
  const feedEl = $('community-feed-list'); feedEl.innerHTML = ''; layers.community.clearLayers();
  reports.forEach(rep => {
    const [lng, lat] = rep.coordinates || [105.78, 20.97];
    const marker = L.circleMarker([lat, lng], { radius: 8, color: '#ffffff', weight: 2, fillColor: '#7c3aed', fillOpacity: 0.95 }).addTo(layers.community);
    marker.bindPopup(`<div style="font-size:12px"><b style="color:#7c3aed">📱 Báo cáo từ ${rep.reporter_name}</b><br><b>Vị trí:</b> ${rep.location_name}<br><b>Độ sâu:</b> ${rep.depth_cm} cm<br><p style="margin:4px 0">${rep.description}</p>${rep.photo_url ? `<img src="${rep.photo_url}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-top:4px">` : ''}</div>`);
    const card = document.createElement('div'); card.className = 'community-report-card';
    card.innerHTML = `<img class="rep-thumbnail" src="${rep.photo_url || 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?w=200&auto=format&fit=crop&q=60'}" alt="Hiện trường"><div class="rep-content"><div class="rep-header"><span class="rep-author">${rep.reporter_name}</span><span class="rep-time">${new Date(rep.reported_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</span></div><div class="rep-location">📍 ${rep.location_name}</div><p class="rep-desc">${rep.description}</p><div class="rep-footer"><span class="ai-site-badge badge-${rep.depth_level}">Độ sâu: ~${rep.depth_cm} cm</span><span class="rep-verified-badge">✓ Đã xác thực (${rep.votes} lượt)</span></div></div>`;
    card.onclick = () => { map?.flyTo([lat, lng], 16); marker.openPopup(); };
    feedEl.appendChild(card);
  });
}

function setupCommunityModalEvents() {
  const modal = $('report-modal');
  const openModal = () => { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); };
  const closeModal = () => { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); };
  $('open-report-modal-btn').onclick = openModal; $('report-quick-btn').onclick = openModal;
  $('modal-close-btn').onclick = closeModal; $('modal-cancel-btn').onclick = closeModal;
  document.querySelectorAll('.depth-option-btn').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.depth-option-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }));
  $('pick-on-map-btn').onclick = () => { closeModal(); isPickingMapLocation = true; $('map-status-msg').textContent = '👉 Nhấp chuột vào vị trí ngập trên bản đồ!'; $('gis-map-section').scrollIntoView({ behavior: 'smooth' }); };
  $('rep-photo').onchange = e => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = evt => { $('photo-preview').src = evt.target.result; }; reader.readAsDataURL(file); } };
  $('community-report-form').onsubmit = async e => {
    e.preventDefault();
    const checkedDepth = document.querySelector('input[name="depth-level"]:checked')?.value || 'medium';
    const depthCm = checkedDepth === 'very_high' ? 50 : checkedDepth === 'high' ? 38 : checkedDepth === 'medium' ? 25 : 12;
    saveReport({ reporter_name: $('rep-name').value.trim(), location_name: $('rep-street').value.trim(), coordinates: selectedReportCoords, depth_level: checkedDepth, depth_cm: depthCm, photo_url: $('photo-preview').src, description: $('rep-desc').value.trim() });
    alert('Cảm ơn bạn! Báo cáo ngập đã được cập nhật lên bản đồ GIS.'); closeModal(); $('community-report-form').reset(); await loadCommunityReports();
  };
}

// ═══════════════════════════════════════════════════════
// 11. SOLUTIONS
// ═══════════════════════════════════════════════════════
function loadActionableSolutions() {
  const solutions = getActionableSolutions();
  const container = $('action-solutions-list'); container.innerHTML = '';
  solutions.forEach(sol => {
    const card = document.createElement('div'); card.className = 'solution-group-card';
    const priorityClass = sol.priority === 'Khẩn cấp' ? 'danger' : sol.priority === 'Ưu tiên 1' ? 'warning' : 'info';
    card.innerHTML = `<div class="sol-card-head"><div class="sol-title-wrap"><span style="font-size:18px">${sol.icon}</span><span>${sol.category}</span></div><span class="sol-priority ${priorityClass}">${sol.priority}</span></div><ul class="sol-action-items">${sol.actions.map(a => `<li>${a}</li>`).join('')}</ul>`;
    container.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════
// 12. NAV & GLOBAL SETUP
// ═══════════════════════════════════════════════════════
function setupGlobalEvents() {
  $('refresh-btn').onclick = async () => {
    $('refresh-btn').disabled = true; $('refresh-btn').textContent = 'Đang tải...';
    await Promise.all([loadWeather(), loadDashboardAndAlerts(), loadAiForecast('+1h'), loadTimeline(), loadCommunityReports()]);
    loadActionableSolutions();
    $('refresh-btn').disabled = false; $('refresh-btn').textContent = '↻ Cập nhật dữ liệu';
  };
  $('toggle-sound-btn').onclick = () => { soundEnabled = !soundEnabled; $('toggle-sound-btn').textContent = soundEnabled ? '🔔 Âm cảnh báo: BẬT' : '🔕 Âm cảnh báo: TẮT'; if (soundEnabled) playAlertBeep(); };
  $('calc-route-btn').onclick = calculateAvoidanceRoute;
  document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('nav a').forEach(n => n.classList.remove('active')); a.classList.add('active'); }));
}

// ═══════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  await initMap();
  setupLayerControls(); setupTimelineEvents(); setupAiHorizonEvents();
  setupSearchEvents(); setupRainEvents(); setupCommunityModalEvents(); setupGlobalEvents();
  await Promise.all([loadWeather(), loadDashboardAndAlerts(), loadTimeline(), loadAiForecast('+1h'), loadCommunityReports(), searchLocation('Nguyễn Trãi, Hà Đông')]);
  calculateAvoidanceRoute(); loadActionableSolutions();
});
