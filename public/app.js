import {assess,futureHours} from './risk.js';
const $=id=>document.getElementById(id);
let map,points,weather;
const fmt=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('vi-VN',{maximumFractionDigits:1}):'—';
async function initMap(){
  let data;
  try {const res=await fetch('/data/sites.geojson');if(!res.ok)throw Error();data=await res.json();}
  catch{$('sites').textContent='Không tải được danh sách khu vực.';return;}
  if(window.L){
    map=L.map('map').setView([20.977,105.781],14);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    tiles.once('tileerror',()=>{$('site-detail').textContent='Một số ô bản đồ chưa tải được. Kiểm tra kết nối Internet; tọa độ tham chiếu vẫn có trong danh sách.';});
    points=L.layerGroup().addTo(map);
  } else {$('map').innerHTML='<p class="map-error">Không tải được thư viện bản đồ. Cần Internet để kết nối Leaflet và OpenStreetMap. Danh sách khu vực vẫn sử dụng được.</p>';}
  for(const f of data.features){
    const [lng,lat]=f.geometry.coordinates,p=f.properties;
    const button=document.createElement('button');button.className='site';
    const title=document.createElement('strong');title.textContent=p.name;
    const sub=document.createElement('span');sub.textContent=`${lat.toFixed(4)}° N · ${lng.toFixed(4)}° E ↗`;
    button.append(title,sub);$('sites').append(button);
    let marker;
    const choose=()=>{document.querySelectorAll('.site').forEach(el=>el.classList.remove('selected'));button.classList.add('selected');$('site-detail').textContent=p.note;if(map){map.setView([lat,lng],15);marker.openPopup();}};
    if(map){const popup=document.createElement('div');popup.textContent=p.name+' — tọa độ tham chiếu, chưa xác minh thực địa.';marker=L.circleMarker([lat,lng],{radius:10,color:'#fff',weight:3,fillColor:'#287f64',fillOpacity:1}).addTo(points).bindPopup(popup).bindTooltip(p.name);marker.on('click',choose);}
    button.onclick=choose;
  }
}
$('reset-map').onclick=()=>map?.setView([20.977,105.781],14);
$('show-points').onchange=e=>{if(map&&points)e.target.checked?points.addTo(map):map.removeLayer(points);};
function renderWeather(data){
  const hours=futureHours(data);
  if(hours.length!==24)throw Error('Không có đủ dự báo 24 giờ tới.');
  $('rain-now').innerHTML=fmt(hours[0].rain)+' <small>mm</small>';
  const complete=hours.every(x=>typeof x.rain==='number'&&Number.isFinite(x.rain));
  $('rain-total').innerHTML=fmt(complete?hours.reduce((a,x)=>a+x.rain,0):null)+' <small>mm</small>';
  $('weather-status').textContent=complete?'Đã nhận dữ liệu dự báo':'Thiếu một số giá trị mưa';
  $('weather-time').textContent=`Lấy dữ liệu: ${new Date(data.retrieved_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})} (UTC+7). Dự báo mô hình, không phải quan trắc tại chỗ.`;
  $('chart').replaceChildren();$('weather-table').replaceChildren();
  const max=Math.max(5,...hours.map(h=>typeof h.rain==='number'?h.rain:0));
  hours.forEach((h,i)=>{
    const col=document.createElement('div');col.className='bar-column';col.title=`${h.time.replace('T',' ')}: ${fmt(h.rain)} mm`;
    const value=document.createElement('span');value.textContent=fmt(h.rain);
    const bar=document.createElement('div');bar.className='bar';bar.style.height=(typeof h.rain==='number'?h.rain/max*140:0)+'px';
    const label=document.createElement('small');label.textContent=i%3===0?h.time.slice(11,16):'';
    col.append(value,bar,label);$('chart').append(col);
    const tr=document.createElement('tr');[h.time.replace('T',' '),fmt(h.rain),fmt(h.rain3h)].forEach(t=>{const td=document.createElement('td');td.textContent=t;tr.append(td);});$('weather-table').append(tr);
  });
}
async function loadWeather(){
  $('refresh').disabled=true;$('weather-status').textContent='Đang cập nhật…';
  try{const r=await fetch('/api/weather',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();const data=await r.json();renderWeather(data);weather=data;$('export').disabled=false;}
  catch{weather=null;$('export').disabled=true;$('rain-now').textContent='—';$('rain-total').textContent='—';$('weather-status').textContent='Không kết nối được nguồn mưa';$('weather-time').textContent='Không có dự báo hiện hành. Có thể dùng kịch bản mô phỏng bên dưới.';$('chart').innerHTML='<p>Chưa có dữ liệu. Nhấn “Cập nhật mưa” để thử lại.</p>';$('weather-table').replaceChildren();}
  finally{$('refresh').disabled=false;}
}
$('refresh').onclick=loadWeather;
$('export').onclick=()=>{if(!weather)return;const url=URL.createObjectURL(new Blob([JSON.stringify(weather,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='hadong-weather.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function scenario(changed){
  if(+$('rain3').value<+$('rain1').value){if(changed==='rain3')$('rain1').value=$('rain3').value;else $('rain3').value=$('rain1').value;}
  const r1=+$('rain1').value,r3=+$('rain3').value,result=assess(r1,r3);
  $('rain1-value').value=r1;$('rain3-value').value=r3;
  $('risk-result').className='risk-result '+result.level;
  $('risk-result').innerHTML=`<strong>${result.score}<small style="font-size:13px">/100</small></strong><div><b>Chỉ số kịch bản: ${result.label}</b><p>Ngưỡng minh họa · chưa hiệu chỉnh tại Hà Đông</p></div>`;
  const first=result.level==='high'?['Ưu tiên an toàn khi có ngập','Tránh đi qua vùng nước ngập; theo dõi hướng dẫn và thông báo chính thức của địa phương.']:result.level==='medium'?['Chuẩn bị phương án ứng phó','Theo dõi diễn biến mưa và thông tin địa phương; chủ động bảo vệ tài sản tại vị trí từng bị ngập.']:['Duy trì theo dõi','Chỉ số thấp không đồng nghĩa không có ngập. Tiếp tục theo dõi thông tin thực tế tại khu vực.'];
  const advice=[first,['Bổ sung quan trắc thực địa','Ghi nhận thời điểm, tọa độ, độ sâu và thời gian rút nước khi có thể thực hiện an toàn.'],['Phối hợp với địa phương','Đối chiếu tình trạng thoát nước và kế hoạch ứng phó với đơn vị quản lý hạ tầng.']];
  $('advice').innerHTML=advice.map((a,i)=>`<div class="advice-row"><span>0${i+1}</span><div><b>${a[0]}</b><p>${a[1]}</p></div></div>`).join('');
}
['rain1','rain3'].forEach(id=>$(id).oninput=()=>scenario(id));
document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>{document.querySelectorAll('nav a').forEach(n=>n.classList.remove('active'));a.classList.add('active');});
scenario();initMap();loadWeather();
