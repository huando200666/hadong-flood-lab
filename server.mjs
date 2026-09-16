import http from 'node:http';
import {createWeatherCache} from './weather-cache.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8'};
const getWeather=createWeatherCache();
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    if (url.pathname === '/api/weather') {
      const data=await getWeather();
      res.writeHead(200,{'Content-Type':types['.json']}); return res.end(JSON.stringify(data));
    }
    let name = decodeURIComponent(url.pathname);
    if (name === '/') name='/index.html';
    const isData=name.startsWith('/data/');
    const base = path.join(root,isData?'data':'public');
    const relativeName=isData?name.slice('/data'.length):name;
    const target=path.resolve(base,'.'+relativeName);
    if (!target.startsWith(base+path.sep)) {res.writeHead(403);return res.end();}
    const content=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:content);
  } catch(error) {
    const weather=req.url.startsWith('/api/');
    res.writeHead(weather?502:404,{'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:weather?'Không lấy được dữ liệu thời tiết. Vui lòng thử lại.':'Không tìm thấy tài nguyên.'}));
  }
});
const port=Number(process.env.PORT)||3000;
const host=process.env.HOST||'127.0.0.1';
server.listen(port,host,()=>console.log(`Hà Đông Flood Lab listening on ${host}:${port}`));
