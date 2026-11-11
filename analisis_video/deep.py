import numpy as np, json
from scipy.signal import find_peaks, butter, filtfilt
from sklearn.cluster import KMeans
d=np.load('res.npz'); B=d['B'];P=d['P'];L=d['L'].astype(np.float64);names=list(d['names']);fps=30.
ix={n:i for i,n in enumerate(names)}
segs=[(0,471),(471,863),(863,1334),(1334,1774),(1774,2550),(2550,2950)]
def lp(x,fc):
    b,a=butter(2,fc/(fps/2)); return filtfilt(b,a,x)
# --- 1. parpadeos corregidos (histeresis 0.6/0.3, min 2 frames)
res={}
for k,(a,b_) in enumerate(segs):
    bl=(B[a:b_,ix['eyeBlinkLeft']]+B[a:b_,ix['eyeBlinkRight']])/2
    ev=[];i=0
    while i<len(bl):
        if bl[i]>0.6:
            s=i
            while s>0 and bl[s-1]>0.3: s-=1
            e=i
            while e<len(bl)-1 and bl[e+1]>0.3: e+=1
            if e-s+1>=2: ev.append((s,e,e-s+1))
            i=e+1
        else: i+=1
    dur=[x[2]/fps*1000 for x in ev]
    # asimetria entre ojos
    res[k]=dict(n=len(ev),per_min=round(len(ev)/((b_-a)/fps/60),1),dur_med=round(float(np.median(dur)),0) if dur else None,
      dur_p10_p90=[round(float(np.percentile(dur,10))),round(float(np.percentile(dur,90)))] if dur else None,
      ibi_med=round(float(np.median(np.diff([e[0] for e in ev])/fps)),2) if len(ev)>2 else None)
print('PARPADEO',json.dumps(res))
# --- 2. normalizar landmarks a marco local de cabeza (similitud sobre puntos rigidos)
rigid=[33,133,362,263,168,6,197,195,5,4,1,234,454,10,151,9,8,193,417,168]
mean=np.nanmean(L,axis=0)
def umeyama(src,dst):
    mu_s,mu_d=src.mean(0),dst.mean(0); X=src-mu_s;Y=dst-mu_d
    U,S,Vt=np.linalg.svd(Y.T@X/len(src)); D=np.eye(3)
    if np.linalg.det(U@Vt)<0: D[2,2]=-1
    R=U@D@Vt; s=np.trace(np.diag(S)@D)/X.var(0).sum(); t=mu_d-s*R@mu_s
    return s,R,t
# iterar media canonica
ref=mean[rigid].copy()
ref[:,2]*=1.0
LOC=np.zeros_like(L)
for it in range(2):
    for f in range(len(L)):
        s,R,t=umeyama(L[f,rigid],ref); LOC[f]=(s*(R@L[f].T)).T+t
    ref=np.nanmean(LOC,axis=0)[rigid]
cano=np.nanmean(LOC,axis=0)
iod=np.linalg.norm(cano[263]-cano[33]) # distancia interocular canonica
DEL=(LOC-cano)/iod   # deformacion local normalizada por distancia interocular
# --- 3. regresion ridge blendshapes -> deformacion de landmarks (base aprendida)
use=['jawOpen','mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight','mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight','mouthStretchLeft','mouthStretchRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper','mouthPressLeft','mouthPressRight','mouthLowerDownLeft','mouthLowerDownRight','mouthUpperUpLeft','mouthUpperUpRight','jawForward','jawLeft','jawRight','browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight','cheekPuff','cheekSquintLeft','cheekSquintRight','noseSneerLeft','noseSneerRight','eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight']
X=B[:,[ix[n] for n in use]]; Y=DEL.reshape(len(L),-1)
tr=np.r_[0:1774]; te=np.r_[1774:2950]
def ridge(X,Y,lam):
    Xb=np.c_[X,np.ones(len(X))]; A=Xb.T@Xb+lam*np.eye(Xb.shape[1]); A[-1,-1]-=lam
    return np.linalg.solve(A,Xb.T@Y)
for lam in (1e-2,1,10):
    W=ridge(X[tr],Y[tr],lam); pred=np.c_[X[te],np.ones(len(te))]@W
    # R2 solo en region boca (labios 61..291 + menton)
    lips=[0,13,14,17,37,39,40,61,78,80,81,82,84,87,88,91,95,146,178,181,185,191,267,269,270,291,308,310,311,312,314,317,318,321,324,375,402,405,409,415,152,176,400,377,148]
    idx=np.array([[3*i,3*i+1,3*i+2] for i in lips]).ravel()
    ss=((Y[te][:,idx]-pred[:,idx])**2).sum(); st=((Y[te][:,idx]-Y[tr][:,idx].mean(0))**2).sum()
    print('ridge lam',lam,'R2 boca (test clips 5-6)',round(1-ss/st,3))
W=ridge(X,Y,1.0)
basis=W[:-1].reshape(len(use),478,3)  # delta en unidades de distancia interocular, por blendshape=1
amp=np.linalg.norm(basis,axis=2)
for n in ['jawOpen','mouthPucker','mouthFunnel','mouthSmileLeft','mouthClose','mouthRollLower']:
    j=use.index(n); v=amp[j]; top=np.argsort(-v)[:3]
    print(n,'max desplaz (xIOD)',round(float(v.max()),3),'en vertice',top.tolist(), 'jaw-menton dy',round(float(basis[j,152,1]),3))
# guardar base (solo vertices con desplaz>0.004) en JSON compacto
out={'iod_normalized':True,'shapes':use,'cano':np.round((cano-cano.mean(0))/iod,4).tolist(),'basis':{}}
for j,n in enumerate(use):
    nz=np.flatnonzero(amp[j]>0.004)
    out['basis'][n]={'idx':nz.tolist(),'d':np.round(basis[j,nz],4).ravel().tolist()}
json.dump(out,open('learned_basis.json','w'))
print('basis json bytes',len(json.dumps(out)))
# --- 4. visemas: clusters sobre frames con habla
act=np.zeros(len(B),bool)
for a,b_ in segs:
    jo=lp(B[a:b_,ix['jawOpen']],8); act[a:b_]=np.abs(np.gradient(jo))*fps>0.15
act=np.convolve(act,np.ones(9),'same')>0
print('frames con articulacion activa',act.sum(),'de',len(B))
vs=['jawOpen','mouthClose','mouthFunnel','mouthPucker','mouthSmileLeft','mouthStretchLeft','mouthLowerDownLeft','mouthUpperUpLeft','mouthRollLower','mouthPressLeft','mouthShrugLower']
V=B[act][:,[ix[n] for n in vs]]
km=KMeans(8,n_init=10,random_state=0).fit(V)
order=np.argsort(km.cluster_centers_[:,0])
print('VISEMAS (clusters):',vs)
for o in order: print(' share',round(float((km.labels_==o).mean()),2),[round(float(x),2) for x in km.cluster_centers_[o]])
# --- 5. dinamica: tiempos de subida/bajada de mandibula y lag
jo_all=[];
rise=[];fall=[]
for a,b_ in segs:
    jo=lp(B[a:b_,ix['jawOpen']],8); pk,_=find_peaks(jo,prominence=0.08)
    for p in pk:
        l=p
        while l>0 and jo[l-1]<jo[l]: l-=1
        r=p
        while r<len(jo)-1 and jo[r+1]<jo[r]: r+=1
        rise.append((p-l)/fps*1000); fall.append((r-p)/fps*1000)
print('jaw picos',len(rise),'subida ms med',round(float(np.median(rise))),'bajada ms med',round(float(np.median(fall))))
# pose: espectro y aceleracion
for j,n in enumerate(['yaw','pitch','roll']):
    xs=[]
    for a,b_ in segs:
        x=P[a:b_,j]-np.median(P[a:b_,j]); xs.append(np.percentile(np.abs(np.diff(lp(x,6)))*fps,50))
    print(n,'vel mediana deg/s por clip',[round(float(v),1) for v in xs])
# acoplamiento pitch<->jaw y yaw vs gaze
print('corr(jaw, pitch rel)', [round(float(np.corrcoef(lp(B[a:b_,0*0+ix['jawOpen']],6),lp(P[a:b_,1],6))[0,1]),2) for a,b_ in segs])
