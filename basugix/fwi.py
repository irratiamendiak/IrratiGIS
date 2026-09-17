import math
from dataclasses import dataclass

@dataclass
class FWIResult:
    ffmc: float; dmc: float; dc: float; isi: float; bui: float; fwi: float

DMC_DAY_LENGTH=[6.5,7.5,9.0,12.8,13.9,13.9,12.4,10.9,9.4,8.0,7.0,6.0]
DC_DRYING_FACTOR=[-1.6,-1.6,-1.6,0.9,3.8,5.8,6.4,5.0,2.4,0.4,-1.6,-1.6]

def clamp(v,a,b): return max(a,min(b,v))

def ffmc(t,rh,w,r,prev=85.0):
    rh=clamp(rh,0,100); mo=147.2*(101-prev)/(59.5+prev)
    if r>0.5:
        rf=r-0.5
        add=42.5*rf*math.exp(-100/(251-mo))*(1-math.exp(-6.93/rf))
        if mo>150: add+=0.0015*(mo-150)**2*math.sqrt(rf)
        mo=min(250,mo+add)
    ed=0.942*rh**0.679+11*math.exp((rh-100)/10)+0.18*(21.1-t)*(1-math.exp(-0.115*rh))
    if mo<ed:
        ew=0.618*rh**0.753+10*math.exp((rh-100)/10)+0.18*(21.1-t)*(1-math.exp(-0.115*rh))
        if mo<=ew:
            kl=0.424*(1-((100-rh)/100)**1.7)+0.0694*math.sqrt(max(w,0))*(1-((100-rh)/100)**8)
            kw=kl*0.581*math.exp(0.0365*t); m=ew-(ew-mo)*10**(-kw)
        else: m=mo
    else:
        kl=0.424*(1-(rh/100)**1.7)+0.0694*math.sqrt(max(w,0))*(1-(rh/100)**8)
        kw=kl*0.581*math.exp(0.0365*t); m=ed+(mo-ed)*10**(-kw)
    return clamp(59.5*(250-m)/(147.2+m),0,101)

def dmc(t,rh,r,month,prev=6.0):
    x=max(prev,0)
    if r>1.5:
        re=0.92*r-1.27; mo=20+math.exp(5.6348-x/43.43)
        b=100/(0.5+0.3*x) if x<=33 else (14-1.3*math.log(x) if x<=65 else 6.2*math.log(x)-17.2)
        mr=mo+1000*re/(48.77+b*re); x=max(0,244.72-43.43*math.log(max(mr-20,1e-9)))
    if t<-1.1: return x
    rk=1.894*(t+1.1)*(100-clamp(rh,0,100))*DMC_DAY_LENGTH[month-1]*1e-6
    return max(0,x+100*rk)

def dc(t,r,month,prev=15.0):
    x=max(prev,0)
    if r>2.8:
        rd=0.83*r-1.27; qo=800*math.exp(-x/400); qr=qo+3.937*rd
        x=max(0,400*math.log(800/max(qr,1e-9)))
    v=max(0,0.36*(max(t,-2.8)+2.8)+DC_DRYING_FACTOR[month-1])
    return max(0,x+0.5*v)

def isi(w,ff):
    mo=147.2*(101-ff)/(59.5+ff)
    return 0.208*math.exp(0.05039*max(w,0))*91.9*math.exp(-0.1386*mo)*(1+mo**5.31/4.93e7)

def bui(d,dcv):
    if d<=0.4*dcv:
        den=d+0.4*dcv; return 0 if den<=0 else 0.8*d*dcv/den
    return d-(1-0.8*dcv/(d+0.4*dcv))*(0.92+(0.0114*d)**1.7)

def fwi_from(i,b):
    fd=0.626*b**0.809+2 if b<=80 else 1000/(25+108.64*math.exp(-0.023*b))
    x=0.1*i*fd
    return x if x<=1 else math.exp(2.72*(0.434*math.log(x))**0.647)

def calculate(temp,rh,wind_kmh,rain_mm,month,prev_ffmc=85,prev_dmc=6,prev_dc=15):
    a=ffmc(temp,rh,wind_kmh,rain_mm,prev_ffmc); b=dmc(temp,rh,rain_mm,month,prev_dmc); c=dc(temp,rain_mm,month,prev_dc)
    i=isi(wind_kmh,a); u=max(0,bui(b,c)); f=max(0,fwi_from(i,u))
    return FWIResult(*[round(x,2) for x in (a,b,c,i,u,f)])

def danger_level(v):
    if v<5:return 'Bajo'
    if v<12:return 'Moderado'
    if v<21:return 'Alto'
    if v<30:return 'Muy alto'
    return 'Extremo'
