# v2 rəng tonu: base.png -> base2.png (yaşılımtıl relyef, firuzəyi su). istifadə: python3 grade.py <build_qovluğu>
import sys, numpy as np
from PIL import Image, ImageFilter
B = sys.argv[1]
b = np.asarray(Image.open(f'{B}/base.png')).astype(np.float32)
land = np.asarray(Image.open(f'{B}/landmask.png').filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)[..., None]/255
D = np.load(f'{B}/depth.npy').astype(np.float32)
lum = b.mean(-1, keepdims=True)/255
landc = np.array([12, 19, 17]) + np.clip(lum*1.25, 0, 1)**1.5*np.array([175, 190, 160])
d = np.clip(D/1000, 0, 1)[..., None]**0.5
wat = np.array([22, 66, 74])*(1-d) + np.array([5, 20, 27])*d
Image.fromarray(np.clip(landc*land + wat*(1-land), 0, 255).astype(np.uint8)).save(f'{B}/base2.png')
