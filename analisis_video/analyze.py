import cv2, numpy as np, json, mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision
opts=vision.FaceLandmarkerOptions(
  base_options=mpp.BaseOptions(model_asset_path='/home/claude/proj/yourself/public/mediapipe/face_landmarker.task'),
  running_mode=vision.RunningMode.IMAGE, num_faces=1,
  output_face_blendshapes=True, output_facial_transformation_matrixes=True)
lm=vision.FaceLandmarker.create_from_options(opts)
cap=cv2.VideoCapture('/mnt/user-data/uploads/video_de_persona_hablando.mp4')
names=None; B=[];P=[];FS=[];OK=[];hist=[];L=[]
prev=None; cuts=[]
i=0
while True:
    ok,f=cap.read()
    if not ok: break
    h=cv2.calcHist([cv2.resize(f,(73,127))],[0,1,2],None,[8,8,8],[0,256]*3).flatten(); h/=h.sum()
    if prev is not None:
        d=0.5*np.abs(h-prev).sum()
        hist.append(d)
    else: hist.append(0)
    prev=h
    img=mp.Image(image_format=mp.ImageFormat.SRGB,data=cv2.cvtColor(f,cv2.COLOR_BGR2RGB))
    r=lm.detect(img)
    if r.face_landmarks:
        bs=r.face_blendshapes[0]
        if names is None: names=[b.category_name for b in bs]
        B.append([b.score for b in bs])
        M=np.array(r.facial_transformation_matrixes[0]); R=M[:3,:3]
        s=np.linalg.norm(R[:,0]); R=R/s
        pitch=np.degrees(np.arcsin(-R[1,2])); yaw=np.degrees(np.arctan2(R[0,2],R[2,2])); roll=np.degrees(np.arctan2(R[1,0],R[1,1]))
        P.append([yaw,pitch,roll,M[0,3],M[1,3],M[2,3]])
        pts=np.array([[p.x,p.y,p.z] for p in r.face_landmarks[0]])
        L.append(pts.astype(np.float32))
        FS.append(np.hypot(*(pts[454,:2]-pts[234,:2])))  # ancho cara normalizado
        OK.append(1)
    else:
        B.append([np.nan]*52); P.append([np.nan]*6); L.append(np.full((478,3),np.nan,np.float32)); FS.append(np.nan); OK.append(0)
    i+=1
np.savez('res.npz',B=np.array(B),P=np.array(P),FS=np.array(FS),OK=np.array(OK),hist=np.array(hist),L=np.array(L),names=np.array(names))
print('frames',i,'detected',sum(OK))
