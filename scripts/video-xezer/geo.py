import math
Z=7; X0=78; Y0=43; K=2  # base scale factor
def proj(lon,lat):
    r=math.radians(lat)
    x=(lon+180)/360*2**Z*256
    y=(1-math.log(math.tan(r)+1/math.cos(r))/math.pi)/2*2**Z*256
    return ((x-X0*256)*K,(y-Y0*256)*K)
W=7*256*K; H=9*256*K
