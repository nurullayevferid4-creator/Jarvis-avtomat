import math, os, subprocess, concurrent.futures as cf, sys
Z=7; out=sys.argv[1]
def tx(lon): return int((lon+180)/360*2**Z)
def ty(lat): r=math.radians(lat); return int((1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*2**Z)
xs=range(tx(41),tx(59)+1); ys=range(ty(49),ty(34)+1)
print(list(xs)[0],list(xs)[-1],list(ys)[0],list(ys)[-1])
def get(a):
    x,y=a; p=f"{out}/{x}_{y}.png"
    if not os.path.exists(p): subprocess.run(["curl","-s","-o",p,f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"])
with cf.ThreadPoolExecutor(16) as ex: list(ex.map(get,[(x,y) for x in xs for y in ys]))
