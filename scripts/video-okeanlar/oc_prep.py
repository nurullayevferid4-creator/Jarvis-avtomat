# Ekvirektanqulyar rastrlar: quru maskası + okean ID (1 Sakit, 2 Atlantik, 3 Hind, 4 Cənub, 5 Şimal Buzlu)
import sys, json, numpy as np
from PIL import Image, ImageDraw
D, OUT = sys.argv[1], sys.argv[2]
WW, HH = 4096, 2048
def xy(lon, lat): return ((lon+180)/360*WW, (90-lat)/180*HH)
def polys(g):
    return [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
land = Image.new('L', (WW, HH), 0); dl = ImageDraw.Draw(land)
for ft in json.load(open(f'{D}/land.geojson'))['features']:
    for p in polys(ft['geometry']):
        dl.polygon([xy(*q[:2]) for q in p[0]], fill=255)
        for h in p[1:]: dl.polygon([xy(*q[:2]) for q in h], fill=0)
# Antarktida qütbə qədər
L = np.asarray(land).copy(); L[int(HH*(1-5/180)):, :] = 255
P = "North Pacific Ocean,South Pacific Ocean,Bering Sea,Sea of Okhotsk,Sea of Japan,Yellow Sea,Bo Hai,East China Sea,South China Sea,Philippine Sea,Taiwan Strait,Luzon Strait,Korea Strait,Gulf of Alaska,Bristol Bay,Cook Inlet,Shelikhova Gulf,Golfo de California,Golfo de Panamá,Celebes Sea,Sulu Sea,Molucca Sea,Ceram Sea,Banda Sea,Bismarck Sea,Solomon Sea,Coral Sea,Tasman Sea,Bay of Plenty,Great Barrier Reef,Gulf of Thailand,Gulf of Tonkin,Java Sea,Makassar Strait,Arafura Sea,Gulf of Carpentaria,Columbia River,Yangtze River,Inner Sea"
A = "North Atlantic Ocean,South Atlantic Ocean,Caribbean Sea,Gulf of Mexico,Bahía de Campeche,Sargasso Sea,Mediterranean Sea,Adriatic Sea,Aegean Sea,Balearic Sea,Golfe du Lion,Ionian Sea,Tyrrhenian Sea,Black Sea,North Sea,Baltic Sea,Gulf of Bothnia,Gulf of Finland,English Channel,Irish Sea,Bristol Channel,Bay of Biscay,Strait of Gibraltar,Gulf of Guinea,Río de la Plata,Golfo San Jorge,Amazon River,Gulf of Saint Lawrence,Gulf of Maine,Bay of Fundy,Chesapeake Bay,Straits of Florida,Gulf of Honduras,Labrador Sea,Davis Strait,Norwegian Sea,Scotia Sea,Drake Passage,Inner Seas"
I = "INDIAN OCEAN,Arabian Sea,Bay of Bengal,Andaman Sea,Laccadive Sea,Gulf of Mannar,Gulf of Kutch,Gulf of Oman,Persian Gulf,Red Sea,Gulf of Aden,Mozambique Channel,Great Australian Bight,Timor Sea,Strait of Malacca,Strait of Singapore"
Sx = "SOUTHERN OCEAN,Amundsen Sea,Bellingshausen Sea,Ross Sea,Weddell Sea"
R = "Arctic Ocean,Barents Sea,Kara Sea,Laptev Sea,Chukchi Sea,Beaufort Sea,Greenland Sea,White Sea,Amundsen Gulf,Viscount Melville Sound,The North Western Passages,Melville Bay,Baffin Bay,Hudson Bay,Hudson Strait,James Bay,Ungava Bay"
M = {}
for k, s in ((1, P), (2, A), (3, I), (4, Sx), (5, R)):
    for n in s.split(','): M[n] = k
ids = Image.new('L', (WW, HH), 0); di = ImageDraw.Draw(ids)
miss = set()
for ft in json.load(open(f'{D}/marine.geojson'))['features']:
    n = ft['properties'].get('name') or ''
    k = M.get(n)
    if not k: miss.add(n); continue
    for p in polys(ft['geometry']):
        di.polygon([xy(*q[:2]) for q in p[0]], fill=k)
print('unmapped:', miss)
O = np.asarray(ids).copy()
water = L < 128
O[~water] = 0
lat = 90 - (np.arange(HH)+0.5)/HH*180
O[(lat < -60)[:, None] & water] = 4
# boş su piksellərini ən yaxın okeanla doldur (iterativ genişlənmə)
for it in range(400):
    emp = water & (O == 0)
    if not emp.any(): break
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sh = np.roll(np.roll(O, dy, 0), dx, 1)
        fill = emp & (sh > 0) & (O == 0)
        O[fill] = sh[fill]
# Kaspi: okean deyil
cy0, cy1 = int((90-47.5)/180*HH), int((90-36)/180*HH); cx0, cx1 = int((46+180)/360*WW), int((55.5+180)/360*WW)
sub = O[cy0:cy1, cx0:cx1]; 
print('left empty', (water & (O == 0)).sum(), 'iters', it)
np.save(f'{OUT}/ocean_id.npy', O.astype(np.uint8)); np.save(f'{OUT}/land.npy', (L >= 128))
pal = np.array([[40, 40, 40], [230, 80, 80], [40, 170, 160], [240, 160, 60], [90, 110, 240], [140, 210, 240]], np.uint8)
Image.fromarray(pal[O]).resize((1024, 512)).save(f'{OUT}/ocean_id.png')
