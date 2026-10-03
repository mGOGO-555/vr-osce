#!/usr/bin/env python3
"""実測motion-capture export (Vicon Plug-in Gait, 100 Hz) から NORMAL STS の派生データを作る。
元CSV(data/raw)は変更しない。出力: derived/normal_sts_motion.json  と  derived/normal_sts_report.json
- 座標: マーカーXYZは空間座標(mm)。角度列のX/Y/Zは flex/ext, ab/adduction, rotation（別物）。
- 各segmentの軸(O,P,L,A)から向きを作り、解剖学的frame（x=患者左, y=上, z=前）へ符号付き置換で写す。
- その向きから角度列(X/Y/Z)を再計算し、元の角度列と一致すること（RMSE）を確認してから使う。
- 左右の角度列(LxxxAngles/RxxxAngles)は同一segment向きの左右別符号規約。平均はしない。"""
import csv, json, itertools, sys, os
import numpy as np
from scipy.spatial.transform import Rotation as Rot
SRC = sys.argv[1] if len(sys.argv) > 1 else 'data/raw/standing_full.csv'
T0, T1, PAD = 1.18, 3.57, 0.3        # 初期候補区間と、前後の余白（余白付きで出力し、再生側で区間を選ぶ）
def load(f):
    rows = list(csv.reader(open(f, encoding='utf-8-sig'))); h0, h1 = rows[0], rows[1]; names = []; cur = ''
    for a, b in zip(h0, h1):
        if a: cur = a
        names.append((cur, b))
    return names, np.array([[float(x) if x != '' else np.nan for x in r] for r in rows[2:]])
names, d = load(SRC); t = d[:, 0]
def g(n): return d[:, [i for i, (a, b) in enumerate(names) if a == n and b in ('X', 'Y', 'Z')]]
rep = {'source': SRC, 'n': int(len(t)), 'dt': float(np.median(np.diff(t))), 'fs': float(1 / np.median(np.diff(t)))}
# ---- 1) 空間軸を実測markerから決める ----
head, ank = g('LFHD').mean(0), g('LANK').mean(0)
vert = int(np.argmax(np.abs(head - ank))); vsign = 1 if (head - ank)[vert] > 0 else -1
asi, psi = (g('LASI') + g('RASI')) / 2, (g('LPSI') + g('RPSI')) / 2
ap = (asi - psi).mean(0); ap[vert] = 0; fa = int(np.argmax(np.abs(ap))); fs_ = 1 if ap[fa] > 0 else -1
lr = (g('LASI') - g('RASI')).mean(0); lr[vert] = 0; la = int(np.argmax(np.abs(lr))); ls_ = 1 if lr[la] > 0 else -1
up = np.zeros(3); up[vert] = vsign; fw = np.zeros(3); fw[fa] = fs_; lf = np.zeros(3); lf[la] = ls_
M = np.array([lf, up, fw])                    # lab -> patient (x=left, y=up, z=fwd)
assert abs(np.linalg.det(M) - 1) < 1e-9, 'axes not right-handed'
rep['axes'] = {'vertical': 'XYZ'[vert] + ('+' if vsign > 0 else '-'), 'forward': 'XYZ'[fa] + ('+' if fs_ > 0 else '-'), 'left': 'XYZ'[la] + ('+' if ls_ > 0 else '-'),
               'fwd_deviation_deg': float(np.degrees(np.arctan2(abs((asi - psi).mean(0)[[i for i in range(3) if i not in (vert, fa)][0]]), abs((asi - psi).mean(0)[fa])))), 'units': 'mm',
               'basis': 'head-ankle height / mean(ASISmid-PSISmid) / LASI-RASI'}
def pos(n): return g(n) @ M.T
def Fr(seg):
    O, P, L, A = [g(seg + k) for k in 'OPLA']
    v = [(x - O) @ M.T for x in (A, L, P)]; v = [x / np.linalg.norm(x, axis=1)[:, None] for x in v]
    return np.stack(v, axis=2)
A_, L_, P_ = 0, 1, 2
def pick(l, u, f):
    S = np.zeros((3, 3))
    for c, (i, s) in enumerate((l, u, f)): S[i, c] = s
    return S
ID = pick((L_, 1), (P_, 1), (A_, 1)); ARM = pick((L_, -1), (P_, 1), (A_, -1)); FOOT = pick((L_, 1), (A_, 1), (P_, -1))
SEG = {'PEL': ID, 'HED': ID, 'TRX': pick((L_, -1), (P_, -1), (A_, 1)), 'LCL': pick((P_, -1), (L_, 1), (A_, 1)), 'RCL': pick((P_, 1), (L_, -1), (A_, 1))}
for s in 'LR':
    for k in ('FE', 'TI'): SEG[s + k] = ID
    for k in ('FO', 'TO'): SEG[s + k] = FOOT
    for k in ('HU', 'RA', 'HN'): SEG[s + k] = ARM
def anat(seg): return np.einsum('nij,jk->nik', Fr(seg), SEG[seg])
AN = {s: anat(s) for s in SEG}
for s, R in AN.items(): assert np.allclose(np.linalg.det(R), 1, atol=1e-6), s
# ---- 2) 角度列の再現（segment向き→角度列。Euler順序と符号は関節ごとに全探索して一致を確認）----
def rel(p, c): return np.einsum('nji,njk->nik', p, c)
I3 = np.broadcast_to(np.eye(3), (len(t), 3, 3))
J = {'Pelvis': (None, 'PEL', 'PelvisAngles'), 'Thorax': (None, 'TRX', 'ThoraxAngles'), 'Head': (None, 'HED', 'HeadAngles'), 'Spine': ('PEL', 'TRX', 'SpineAngles'), 'Neck': ('TRX', 'HED', 'NeckAngles'),
     'Hip': ('PEL', '{}FE', 'HipAngles'), 'Knee': ('{}FE', '{}TI', 'KneeAngles'), 'Ankle': ('{}TI', '{}FO', 'AnkleAngles'), 'Shoulder': ('TRX', '{}HU', 'ShoulderAngles'),
     'Elbow': ('{}HU', '{}RA', 'ElbowAngles'), 'Wrist': ('{}RA', '{}HN', 'WristAngles')}
conv = {}; qc_ang = {}
for jn, (p, c, col) in J.items():
    for side in 'LR':
        pn = None if p is None else p.format(side); cn = c.format(side); ex = g(side + col)
        Rr = rel(I3 if pn is None else AN[pn], AN[cn]); best = None
        for seq in ['xzy', 'xyz', 'yxz', 'zxy', 'yzx', 'zyx']:
            e = Rot.from_matrix(Rr).as_euler(seq.upper(), degrees=True)
            for perm in itertools.permutations(range(3)):
                for sg in itertools.product([1, -1], repeat=3):
                    pred = np.stack([sg[k] * e[:, perm[k]] for k in range(3)], axis=1)
                    err = np.sqrt(((pred - ex) ** 2).mean(0)); tot = err[0] if jn == 'Elbow' else err.sum()   # 肘はY/Z列が常に0
                    if best is None or tot < best[0]: best = (tot, seq, perm, sg, err)
        conv[side + jn] = {'seq': best[1].upper(), 'perm': list(best[2]), 'sign': list(best[3])}
        qc_ang[side + jn] = [float(x) for x in best[4]]
rep['angle_reproduction_rmse_deg'] = qc_ang
# 左右の符号規約: 同一segmentでL/Rの符号がどの成分で反転するか
flip = {}
for jn in ['Pelvis', 'Thorax', 'Head', 'Spine', 'Neck', 'Hip', 'Knee', 'Ankle', 'Shoulder', 'Wrist']:
    cl, cr = conv['L' + jn], conv['R' + jn]; flip[jn] = [int(a * b) for a, b in zip(cl['sign'], cr['sign'])]
rep['LR_sign_product_XYZ'] = flip      # -1 の成分が左右で符号反転
rep['LR_pelvis_check'] = {'X_equal': bool(np.allclose(g('LPelvisAngles')[:, 0], g('RPelvisAngles')[:, 0])), 'Y_mirror': bool(np.allclose(g('LPelvisAngles')[:, 1], -g('RPelvisAngles')[:, 1])), 'Z_mirror': bool(np.allclose(g('LPelvisAngles')[:, 2], -g('RPelvisAngles')[:, 2])),
                          'spine_L_eq_R_X': bool(np.allclose(g('LSpineAngles')[:, 0], g('RSpineAngles')[:, 0]))}
# ---- 3) 骨盤位置: LASI/RASI/LPSI/RPSI から ----
LA, RA_, LP, RP = pos('LASI'), pos('RASI'), pos('LPSI'), pos('RPSI')
O = (LA + RA_) / 2; yv = (LA - RA_); yv /= np.linalg.norm(yv, axis=1)[:, None]
xt = O - (LP + RP) / 2; xv = xt - (xt * yv).sum(1)[:, None] * yv; xv /= np.linalg.norm(xv, axis=1)[:, None]; zv = np.cross(xv, yv)
Rm = np.stack([xv, yv, zv], axis=2)                                    # マーカー骨盤frame (fwd,left,up) in patient coords
pelo = pos('PELO')
off = np.einsum('nji,nj->ni', Rm, pelo - O)                              # PELO（Viconの骨盤原点=股関節中心）をマーカー骨盤frame内で表現
offc = np.median(off, axis=0); res = np.einsum('nij,j->ni', Rm, offc) + O - pelo
rep['pelvis'] = {'ASISmid_to_PELO_in_marker_frame_mm(fwd,left,up)': offc.tolist(), 'rigid_residual_mm_max': float(np.abs(res).max()), 'rigid_residual_mm_rms': float(np.sqrt((res ** 2).mean())),
                 'note': 'PELO(Vicon pelvis origin)はASIS中点ではなく、ASIS/PSISマーカー骨盤frameに固定された点（股関節中心付近）。avatarのhips boneは股関節中心なので、この点を骨盤位置とする'}
hjc = O + np.einsum('nij,j->ni', Rm, offc)                              # マーカー由来の骨盤(股関節中心)位置
# マーカー骨盤frameとPEL segment frameの向きの差
dq = Rot.from_matrix(rel(Rm, np.einsum('nij,jk->nik', AN['PEL'], np.eye(3)))).magnitude()
Rpel_fwd = np.stack([AN['PEL'][:, :, 2], AN['PEL'][:, :, 0], AN['PEL'][:, :, 1]], axis=2)   # (fwd,left,up)
dq = Rot.from_matrix(rel(Rm, Rpel_fwd)).magnitude() * 180 / np.pi
rep['pelvis']['marker_frame_vs_PEL_orientation_deg'] = {'mean': float(dq.mean()), 'max': float(dq.max())}
# ---- 4) clavicle / toe の剛体性 ----
rep['clav_rel_thorax_deg_range'] = {s: [float(x) for x in (Rot.from_matrix(rel(AN['TRX'], AN[s + 'CL'])).magnitude() * 180 / np.pi).__array__()[[0]]] + [float(np.ptp(Rot.from_matrix(rel(AN['TRX'], AN[s + 'CL'])).magnitude() * 180 / np.pi))] for s in 'LR'}
rep['toe_rel_foot_deg_range'] = {s: float(np.ptp(Rot.from_matrix(rel(AN[s + 'FO'], AN[s + 'TO'])).magnitude() * 180 / np.pi)) for s in 'LR'}
# ---- 5) 出力 ----
i0, i1 = int(round(max(0, T0 - PAD) / rep['dt'])), int(round((T1 + PAD) / rep['dt'])) + 1
sl = slice(i0, i1)
segs = ['PEL', 'TRX', 'HED'] + [s + k for s in 'LR' for k in ('FE', 'TI', 'FO', 'TO', 'HU', 'RA', 'HN', 'CL')]
def q(R): return Rot.from_matrix(R).as_quat()                           # x,y,z,w
Q = {}
for s in segs:
    qq = q(AN[s][sl]); 
    for k in range(1, len(qq)):                                           # 連続性（q と -q の符号揃え）
        if np.dot(qq[k], qq[k - 1]) < 0: qq[k] = -qq[k]
    Q[s] = np.round(qq, 6).tolist()
ref = {}
for jn, (p, c, col) in J.items():
    for side in 'LR': ref[side + jn] = np.round(g(side + col)[sl], 4).tolist()
out = {'meta': {'source': os.path.basename(SRC), 'fs': rep['fs'], 'tStart': float(t[i0]), 'tEnd': float(t[i1 - 1]), 'defaultWindow': [T0, T1], 'units': {'position': 'm', 'angle': 'deg'},
                'axes': rep['axes'], 'frame': 'patient (x=left, y=up, z=forward); quaternions x,y,z,w; segment anatomical frame columns=(left,up,fwd)',
                'derived': 'reconstructed from raw export; raw CSV untouched', 'interpolation': 'linear (JS: slerp for quaternions / lerp for positions)'},
       't': np.round(t[sl], 4).tolist(), 'quat': Q, 'pelvisHJC': np.round(hjc[sl] / 1000, 5).tolist(), 'pelvisASISmid': np.round(O[sl] / 1000, 5).tolist(),
       'ankleMid': np.round((pos('LANK') + pos('RANK'))[sl] / 2000, 5).tolist(), 'lengths_m': {k: float(np.mean(np.linalg.norm(g(k + a) - g(k + 'O'), axis=1)) / 1000) for k in ['LFE', 'LTI', 'RFE', 'RTI'] for a in ['P']},
       'angleConvention': conv, 'refAngles': ref}
os.makedirs('derived', exist_ok=True)
json.dump(out, open('derived/normal_sts_motion.json', 'w'), separators=(',', ':')); json.dump(rep, open('derived/normal_sts_report.json', 'w'), indent=1)
print(json.dumps(rep, indent=1)[:6000])
