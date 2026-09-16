import http from 'node:http';
import { createWeatherCache } from './weather-cache.mjs';
import {
  loadGisData,
  loadReports,
  saveReport,
  getAiForecast,
  getEarlyAlerts,
  getDashboardData,
  getTimelineSimulation,
  searchLocationRisk,
  getAvoidanceRoutes,
  getActionableSolutions
} from './flood-engine.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const getWeather = createWeatherCache();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // CORS & JSON helper
    const sendJson = (data, code = 200) => {
      res.writeHead(code, {
        'Content-Type': types['.json'],
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end(JSON.stringify(data));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    // Weather endpoint (existing)
    if (url.pathname === '/api/weather') {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
      const data = await getWeather();
      return sendJson(data);
    }

    // GIS Layers & Sites
    if (url.pathname === '/api/flood-data') {
      const data = loadGisData();
      return sendJson(data);
    }

    // AI Forecast (+30m, +1h, +2h, +3h)
    if (url.pathname === '/api/ai-forecast') {
      const horizon = url.searchParams.get('horizon') || '+1h';
      const rain = Number(url.searchParams.get('rain')) || 35;
      const data = getAiForecast(horizon, rain);
      return sendJson(data);
    }

    // Dashboard management metrics & time-series
    if (url.pathname === '/api/dashboard') {
      const rain = Number(url.searchParams.get('rain')) || 35;
      const data = getDashboardData(rain);
      return sendJson(data);
    }

    // Early Alerts
    if (url.pathname === '/api/alerts') {
      const rain = Number(url.searchParams.get('rain')) || 38;
      const data = getEarlyAlerts(rain);
      return sendJson(data);
    }

    // Timeline simulation (14:00 -> 18:00)
    if (url.pathname === '/api/timeline') {
      const data = getTimelineSimulation();
      return sendJson(data);
    }

    // Location search & risk lookup
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q') || 'Nguyễn Trãi, Hà Đông';
      const data = searchLocationRisk(q);
      return sendJson(data);
    }

    // Smart avoidance routing
    if (url.pathname === '/api/routing') {
      const from = url.searchParams.get('from') || 'Bệnh viện 103';
      const to = url.searchParams.get('to') || 'KĐT Văn Phú';
      const data = getAvoidanceRoutes(from, to);
      return sendJson(data);
    }

    // Community Reports
    if (url.pathname === '/api/community-reports') {
      if (req.method === 'GET') {
        return sendJson(loadReports());
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const report = JSON.parse(body || '{}');
            const saved = saveReport(report);
            return sendJson({ success: true, report: saved }, 201);
          } catch (e) {
            return sendJson({ error: 'Dữ liệu báo cáo không hợp lệ' }, 400);
          }
        });
        return;
      }
    }

    // Actionable response proposals
    if (url.pathname === '/api/solutions') {
      const rain = Number(url.searchParams.get('rain')) || 35;
      const data = getActionableSolutions(rain);
      return sendJson(data);
    }

    // Static file serving
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let name = decodeURIComponent(url.pathname);
    if (name === '/') name = '/index.html';
    const isData = name.startsWith('/data/');
    const base = path.join(root, isData ? 'data' : 'public');
    const relativeName = isData ? name.slice('/data'.length) : name;
    const target = path.resolve(base, '.' + relativeName);
    if (!target.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
    const content = await readFile(target);
    res.writeHead(200, {
      'Content-Type': types[path.extname(target)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    const isApi = req.url.startsWith('/api/');
    res.writeHead(isApi ? 502 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: isApi ? 'Lỗi máy chủ API hoặc dịch vụ không phản hồi.' : 'Không tìm thấy tài nguyên.' }));
  }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Hà Đông Flood Lab listening on ${host}:${port}`));
export default server;
