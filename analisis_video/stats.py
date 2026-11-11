import numpy as np, json
from scipy.signal import find_peaks, welch, butter, filtfilt
d=np.load('res.npz'); B=d['B'];P=d['P'];FS=d['FS'];L=d['L'];names=list(d['names'])
fps=30.0
segs=[(0,471),(471,863),(863,1334),(1334,1774),(1774,2550),(2550,2950)]
ix={n:i for i,n in enumerate(names)}
def g(n): return B[:,ix[n]]
def gap(): # apertura labial interior / ancho de cara
    return (L[:,14,1]-L[:,13,1])/np.hypot(L[:,454,0]-L[:,234,0],L[:,454,1]-L[:,234,1])
gp=gap()
def lp(x,fc=12):
    b,a=butter(2,fc/(fps/2)); return filtfilt(b,a,x)
out={}
for k,(a,b_) in enumerate(segs):
    s=slice(a,b_); r={}
    r['frames']=b_-a; r['sec']=round((b_-a)/fps,1); r['face_width_frac']=round(float(np.nanmedian(FS[s])),3)
    jo=g('jawOpen')[s]
    r['jawOpen']={q:round(float(np.percentile(jo,q)),3) for q in (5,50,95,99)}
    r['jawOpen']['mean']=round(float(jo.mean()),3)
    # velocidad de mandíbula
    v=np.abs(np.diff(jo))*fps
    r['jaw_speed_p95_per_s']=round(float(np.percentile(v,95)),2)
    # ritmo silábico: picos de jawOpen filtrado
    js=lp(jo,8); pk,_=find_peaks(js,prominence=0.04,distance=3)
    r['jaw_peaks_per_s']=round(len(pk)/((b_-a)/fps),2)
    # espectro
    f,pw=welch(jo-jo.mean(),fs=fps,nperseg=min(128,len(jo)))
    r['jaw_dominant_hz']=round(float(f[1:][np.argmax(pw[1:])]),2)
    for n in ['mouthPucker','mouthFunnel','mouthSmileLeft','mouthClose','mouthPressLeft','mouthRollLower','mouthShrugLower','mouthLowerDownLeft','mouthStretchLeft','browInnerUp','browDownLeft','browOuterUpLeft','cheekSquintLeft','eyeWideLeft','eyeSquintLeft','jawForward','jawLeft','eyeLookDownLeft','eyeLookUpLeft','eyeLookInLeft','eyeLookOutLeft']:
        x=g(n)[s]; r[n]={'p50':round(float(np.percentile(x,50)),3),'p95':round(float(np.percentile(x,95)),3),'max':round(float(x.max()),3)}
    # cierre labial (gap bajo mientras hay habla)
    gg=gp[s]; r['lip_gap_p5_p50_p95']=[round(float(np.percentile(gg,q)),4) for q in (5,50,95)]
    closed=(gg<0.004).astype(int); r['closed_frac']=round(float(closed.mean()),2)
    # pose
    for j,n in enumerate(['yaw','pitch','roll']):
        x=P[s,j]; x=x-np.median(x)
        sp=np.abs(np.diff(lp(x,6)))*fps
        r[n]={'p5':round(float(np.percentile(x,5)),1),'p95':round(float(np.percentile(x,95)),1),'rms':round(float(np.sqrt((x**2).mean())),1),'speed_p50':round(float(np.percentile(sp,50)),1),'speed_p95':round(float(np.percentile(sp,95)),1),'max_abs':round(float(np.abs(x).max()),1)}
    # parpadeo
    bl=(g('eyeBlinkLeft')[s]+g('eyeBlinkRight')[s])/2
    on=bl>0.5; trans=np.flatnonzero(np.diff(on.astype(int))==1)
    dur=[]
    for t in trans:
        e=t
        while e<len(on) and on[e]: e+=1
        dur.append((e-t)/fps*1000)
    r['blinks']=len(trans); r['blinks_per_min']=round(len(trans)/((b_-a)/fps/60),1); r['blink_dur_ms_med']=round(float(np.median(dur)),0) if dur else None
    # lag cabeza-mandíbula: correlación pitch vs jaw
    c=np.corrcoef(lp(P[s,1],6),lp(jo,6))[0,1]; r['corr_pitch_jaw']=round(float(c),2)
    out[f'clip{k+1}']=r
json.dump(out,open('clipstats.json','w'),indent=1)
for k,v in out.items():
    print(k,v['sec'],'s face_w',v['face_width_frac'],'jaw',v['jawOpen'],'peaks/s',v['jaw_peaks_per_s'],'domHz',v['jaw_dominant_hz'])
    print('  yaw',v['yaw'],'\n  pitch',v['pitch'],'\n  roll',v['roll'])
    print('  blink/min',v['blinks_per_min'],'dur',v['blink_dur_ms_med'],'closedfrac',v['closed_frac'],'gap',v['lip_gap_p5_p50_p95'],'jawspeed',v['jaw_speed_p95_per_s'])
    print('  pucker',v['mouthPucker'],'funnel',v['mouthFunnel'],'smile',v['mouthSmileLeft'],'browInnerUp',v['browInnerUp'],'browDown',v['browDownLeft'],'eyeWide',v['eyeWideLeft'])
