const map = L.map("map", { scrollWheelZoom: false });
map.attributionControl.setPrefix(false);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
}).addTo(map);

let marker;
let bearing;
const qiblaOutline = L.polyline([], { color: "#fff9ea", weight: 5, opacity: 0.95, interactive: false }).addTo(map);
const directionStyle = { className: "qibla-direction", color: "#183f2f", weight: 2.8, interactive: false };
const qiblaPath = L.polyline([], { ...directionStyle, dashArray: "3.5 4.5" }).addTo(map);
const qiblaTip = L.polyline([], directionStyle).addTo(map);

function drawQiblaDirection() {
  if (!marker || !Number.isFinite(bearing)) {
    qiblaOutline.setLatLngs([]);
    qiblaPath.setLatLngs([]);
    qiblaTip.setLatLngs([]);
    return;
  }
  const origin = marker.getLatLng();
  const radians = bearing * Math.PI / 180;
  // Web Mercator preserves the local bearing, clockwise from north.
  const forward = L.point(Math.sin(radians), -Math.cos(radians));
  const wing = L.point(Math.cos(radians), Math.sin(radians)).multiplyBy(5);
  const center = map.project(origin);
  const tip = center.add(forward.multiplyBy(65));
  const base = tip.subtract(forward.multiplyBy(9));
  const shaft = [origin, map.unproject(base)];
  const arrowhead = [base.subtract(wing), tip, base.add(wing)].map((point) => map.unproject(point));
  qiblaOutline.setLatLngs([shaft, arrowhead]);
  qiblaPath.setLatLngs(shaft);
  qiblaTip.setLatLngs(arrowhead);
}

function updateLocation() {
  const position = new URLSearchParams(window.location.hash.slice(1));
  const lat = Number(position.get("lat") ?? NaN);
  const lon = Number(position.get("lon") ?? NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return;

  const center = [lat, lon];
  map.fitBounds([
    [Math.max(-85, lat - 0.03), Math.max(-180, lon - 0.05)],
    [Math.min(85, lat + 0.03), Math.min(180, lon + 0.05)],
  ], { animate: false });

  if (marker) {
    marker.setLatLng(center);
  } else {
    marker = L.marker(center, { title: "Approximate location", alt: "Approximate location" }).addTo(map);
  }
  bearing = Number(position.get("bearing") ?? NaN);
  drawQiblaDirection();
}

map.on("zoomend", drawQiblaDirection);
window.addEventListener("hashchange", updateLocation);
updateLocation();
