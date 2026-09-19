import { mkdtempSync, rmSync, rmdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGisData,
  getAiForecast,
  getEarlyAlerts,
  getDashboardData,
  getTimelineSimulation,
  searchLocationRisk,
  getAvoidanceRoutes,
  loadReports,
  saveReport
} from '../flood-engine.mjs';

test('loadGisData loads valid GeoJSON sites and layers', () => {
  const { sites, layers } = loadGisData();
  assert.equal(sites.type, 'FeatureCollection');
  assert.ok(sites.features.length >= 10, 'Must have at least 10 historical/vulnerable sites');
  assert.equal(layers.type, 'FeatureCollection');
  assert.ok(layers.features.some(f => f.properties.layer === 'roads'));
  assert.ok(layers.features.some(f => f.properties.layer === 'residential'));
  assert.ok(layers.features.some(f => f.properties.layer === 'lakes'));
  assert.ok(layers.features.some(f => f.properties.layer === 'rivers'));
  assert.ok(layers.features.some(f => f.properties.layer === 'drainage'));
});

test('getAiForecast calculates realistic predictions and confidence', () => {
  const horizons = ['+30m', '+1h', '+2h', '+3h'];
  for (const h of horizons) {
    const forecast = getAiForecast(h, 40);
    assert.ok(forecast.average_confidence_pct >= 70 && forecast.average_confidence_pct <= 95);
    assert.ok(forecast.predictions.length > 0);
    assert.ok(forecast.top_hotspot.name);
    assert.ok(forecast.top_hotspot.depth_range_text.includes('cm'));
  }
});

test('getEarlyAlerts escalates severity with rain and high risk counts', () => {
  const lowAlert = getEarlyAlerts(10);
  assert.ok(['normal', 'advisory'].includes(lowAlert.level));

  const severeAlert = getEarlyAlerts(65);
  assert.equal(severeAlert.level, 'danger');
  assert.ok(severeAlert.critical_spots.length > 0);
});

test('getDashboardData returns correct KPI structures and trends', () => {
  const dashboard = getDashboardData(35);
  assert.ok(dashboard.metrics.currently_flooded_points >= 0);
  assert.ok(dashboard.metrics.river_water_level_m > 0);
  assert.ok(dashboard.metrics.risk_area_ha > 0);
  assert.ok(dashboard.trends['1h'].length > 0);
  assert.ok(dashboard.trends['24h'].length > 0);
});

test('getTimelineSimulation returns 5 time steps from 14:00 to 18:00', () => {
  const { timeline } = getTimelineSimulation();
  assert.equal(timeline.length, 5);
  assert.equal(timeline[0].hour, '14:00');
  assert.equal(timeline[4].hour, '18:00');
  // Peak should have higher active area than end
  assert.ok(timeline[2].active_ha > timeline[4].active_ha);
});

test('searchLocationRisk correctly resolves known streets in Ha Dong', () => {
  const res1 = searchLocationRisk('Nguyễn Trãi, Hà Đông');
  assert.ok(res1.matched_location.includes('Nguyễn Trãi') || res1.street.includes('Nguyễn Trãi'));
  assert.ok(res1.depth_range_text.includes('cm'));

  const res2 = searchLocationRisk('Văn Quán');
  assert.ok(res2.matched_location.includes('Văn Quán'));
});

test('getAvoidanceRoutes provides regular and safe alternative routes', () => {
  const routes = getAvoidanceRoutes('Bệnh viện 103', 'KĐT Văn Phú');
  assert.ok(routes.regular_route.is_flooded);
  assert.ok(!routes.safe_route.is_flooded);
  assert.ok(routes.safe_route.recommendation);
  assert.ok(routes.safe_route.path.length >= 3);
});

test('reports persist as unverified without modifying project data', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'flood-report-test-'));
  try {
    const file=path.join(dir,'reports.json');
    const saved=saveReport({reporter_name:'Test Citizen',location_name:'Đường Quang Trung',depth_cm:28,depth_level:'medium',description:'Ngập nhẹ lối vào ga'},file);
    assert.ok(saved.id.startsWith('rep-'));
    assert.equal(saved.status,'unverified');
    assert.equal(saved.votes,0);
    assert.equal(saved.coordinates,null);
    assert.equal(loadReports(file).length,1);
  } finally { rmSync(path.join(dir,'reports.json'),{force:true}); rmdirSync(dir); }
});
test('unknown locations do not fall back to an unrelated site', () => {
  assert.equal(searchLocationRisk('zzzz nonexistent road'),null);
  assert.equal(searchLocationRisk('     '),null);
});
test('zero rain produces zero depth in a scenario', () => {
  assert.ok(getAiForecast('+1h',0).predictions.every(p=>p.depth_max_cm===0));
});

test('damaged report storage is never overwritten by a new submission',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'flood-report-corrupt-')),file=path.join(dir,'reports.json');
 try{
  writeFileSync(file,'truncated JSON');
  assert.throws(()=>saveReport({reporter_name:'Test',location_name:'Văn Quán',depth_cm:25,depth_level:'medium'},file));
  assert.equal(readFileSync(file,'utf8'),'truncated JSON');
 }finally{rmSync(file,{force:true});rmdirSync(dir);}
});
