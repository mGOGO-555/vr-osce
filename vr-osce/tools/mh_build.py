#!/usr/bin/env python3
"""MakeHuman(CC0データ)から 72歳男性・アジア系 の体型を合成し、骨格付きGLBを作る。
参照: MakeHuman community (https://github.com/makehumancommunity/makehuman) のデータのみ
  makehuman/data/3dobjs/base.obj, data/targets/macrodetails/*.target, data/rigs/default.mhskel, default_weights.mhw (CC0)
MakeHumanのコード(AGPL)は使用していない。マクロ合成の考え方(性別・年齢・人種の係数の積)だけ参考にし、自前で実装した。
"""
import json, math, struct, sys, os, re
import numpy as np

MH = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "/home/claude/makehumancommunity/makehuman/makehuman/data"
OUT = sys.argv[2] if len(sys.argv) > 2 else 'patient.glb'
# 体型などの指定: 第3引数にJSON（または環境変数 BODY_SPEC）。例: {"gender":0,"age":81,"weight":-0.6,"muscle":-0.7,"scale":0.95,"hair":"b9b9b9","hair_style":"bob"}
SPEC = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
AGE_YEARS = float(SPEC.get('age', 72.0))
GENDER = float(SPEC.get('gender', 1.0))      # 1=男性 0=女性（中間も可）
WEIGHT = float(SPEC.get('weight', 0.0))      # -1(細い)〜+1(太い)
MUSCLE = float(SPEC.get('muscle', 0.0))      # -1〜+1
SCALE = float(SPEC.get('scale', 1.0))        # 全体の拡大率（身長差）
ASIAN = 1.0

# ---- base.obj ----
verts, body_faces, group = [], [], None
for ln in open(f'{MH}/3dobjs/base.obj'):
    if ln.startswith('v '): verts.append([float(x) for x in ln.split()[1:4]])
    elif ln.startswith('g '): group = ln.split()[1]
    elif ln.startswith('f ') and group == 'body':
        body_faces.append([int(t.split('/')[0]) - 1 for t in ln.split()[1:]])
V = np.array(verts)   # 全頂点(ヘルパー含む)。単位はdm
print('verts', V.shape, 'body faces', len(body_faces))

# ---- マクロ係数 ----
age01 = 0.5 + (AGE_YEARS - 25) / (90 - 25) * 0.5
old = max(0, age01 * 2 - 1); young = 1 - old
gender = {'male': GENDER, 'female': 1.0 - GENDER}
ages = {'old': old, 'young': young, 'child': 0, 'baby': 0}
races = {'asian': ASIAN, 'african': 0.0, 'caucasian': 0.0}
def tri(v, lo, mid, hi):    # -1..1 を3段階の重みに分解
    return {lo: max(0.0, -v), mid: 1 - abs(v), hi: max(0.0, v)}
mus = tri(MUSCLE, 'minmuscle', 'averagemuscle', 'maxmuscle'); wts = tri(WEIGHT, 'minweight', 'averageweight', 'maxweight')
def load_target(path):
    idx, d = [], []
    for ln in open(path):
        if ln.startswith('#') or not ln.strip(): continue
        p = ln.split(); idx.append(int(p[0])); d.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, int), np.array(d)
def apply(name, w):
    if w <= 0: return
    i, d = load_target(f"{MH}/targets/macrodetails/{name}.target")
    if len(i): V[i] += d * w
for g, gw in gender.items():
    for a, aw in ages.items():
        for m, mw in mus.items():
            for wt, ww in wts.items():
                apply(f'universal-{g}-{a}-{m}-{wt}', gw * aw * mw * ww)
        for r, rw in races.items():
            apply(f'{r}-{g}-{a}', rw * gw * aw)
# 顔・頭の形（MakeHumanの顔のターゲット）。spec["face"] = {"nose/nose-width1-incr": 0.4, ...}。目・頬・耳は左右同時に適用
SYM = ('head', 'chin', 'forehead', 'mouth', 'nose', 'neck')
for key, w in SPEC.get('face', {}).items():
    d, name = key.split('/')
    for n in ([name] if d in SYM else ['l-' + name, 'r-' + name]):
        path = f"{MH}/targets/{d}/{n}.target"
        if not os.path.exists(path): print('missing target', path); continue
        i, dd = load_target(path)
        if len(i): V[i] += dd * float(w)
V *= 0.1 * SCALE   # dm → m
print('height approx(m):', V[:, 1].max() - V[:, 1].min())

# ---- スケルトン ----
sk = json.load(open(f'{MH}/rigs/default.mhskel'))
J = lambda name: V[sk['joints'][name]].mean(axis=0)
def head(b): return J(sk['bones'][b]['head'])
def tail(b): return J(sk['bones'][b]['tail'])

# 簡略骨格（回転ゼロのレスト姿勢。ノードは平行移動のみ）
RED = ['hips', 'spine', 'chest', 'neck', 'head', 'clav_L', 'clav_R', 'uarm_L', 'uarm_R', 'larm_L', 'larm_R', 'hand_L', 'hand_R',
       'uleg_L', 'uleg_R', 'lleg_L', 'lleg_R', 'foot_L', 'foot_R', 'toe_L', 'toe_R']
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'clav_L': 'chest', 'clav_R': 'chest',
          'uarm_L': 'clav_L', 'uarm_R': 'clav_R', 'larm_L': 'uarm_L', 'larm_R': 'uarm_R', 'hand_L': 'larm_L', 'hand_R': 'larm_R',
          'uleg_L': 'hips', 'uleg_R': 'hips', 'lleg_L': 'uleg_L', 'lleg_R': 'uleg_R', 'foot_L': 'lleg_L', 'foot_R': 'lleg_R',
          'toe_L': 'foot_L', 'toe_R': 'foot_R'}
def reduced(b):   # MHの骨名 → 簡略骨
    s = b.split('.'); side = s[1] if len(s) > 1 else ''; n = s[0]
    if n in ('root',) or n.startswith('pelvis'): return 'hips'
    if n in ('spine05', 'spine04'): return 'spine'
    if n in ('spine03', 'spine02', 'spine01') or n.startswith('breast'): return 'chest'
    if n.startswith('neck'): return 'neck'
    if n == 'head' or n == 'jaw' or n.startswith(('eye', 'oculi', 'oris', 'levator', 'risorius', 'temporalis', 'orbicularis', 'special', 'tongue')): return 'head'
    if n.startswith(('clavicle', 'shoulder')): return 'clav_' + side
    if n.startswith('upperarm'): return 'uarm_' + side
    if n.startswith('lowerarm'): return 'larm_' + side
    if n.startswith(('wrist', 'finger', 'metacarpal')): return 'hand_' + side
    if n.startswith('upperleg'): return 'uleg_' + side
    if n.startswith('lowerleg'): return 'lleg_' + side
    if n.startswith('foot'): return 'foot_' + side
    if n.startswith('toe'): return 'toe_' + side
    raise ValueError(b)

# 関節位置（簡略骨の頭の位置）
P = {
  'uleg_L': head('upperleg01.L'), 'uleg_R': head('upperleg01.R'),
  'lleg_L': head('lowerleg01.L'), 'lleg_R': head('lowerleg01.R'),
  'foot_L': head('foot.L'), 'foot_R': head('foot.R'),
  'toe_L': head('toe1-1.L'), 'toe_R': head('toe1-1.R'),
  'spine': head('spine05'), 'chest': head('spine03'), 'neck': head('neck01'), 'head': head('head'),
  'clav_L': head('clavicle.L'), 'clav_R': head('clavicle.R'),
  'uarm_L': head('upperarm01.L'), 'uarm_R': head('upperarm01.R'),
  'larm_L': head('lowerarm01.L'), 'larm_R': head('lowerarm01.R'),
  'hand_L': head('wrist.L'), 'hand_R': head('wrist.R'),
}
P['hips'] = (P['uleg_L'] + P['uleg_R']) / 2
print({k: np.round(v, 3).tolist() for k, v in P.items()})
# 左右の判定: MH の .L が +x か確認
print('L hip x', P['uleg_L'][0], 'R hip x', P['uleg_R'][0])

# ---- スキンウェイト ----
wj = json.load(open(f'{MH}/rigs/default_weights.mhw'))['weights']
nb = len(V); W = {}
body_idx = sorted(set(i for f in body_faces for i in f))
remap = {o: n for n, o in enumerate(body_idx)}
NV = len(body_idx)
Wt = np.zeros((NV, len(RED)))
for b, lst in wj.items():
    r = RED.index(reduced(b))
    for vi, w in lst:
        if vi in remap: Wt[remap[vi], r] += w
miss = (Wt.sum(axis=1) < 1e-6)
Wt[miss, RED.index('hips')] = 1.0
Wt /= Wt.sum(axis=1, keepdims=True)
print('unweighted verts', int(miss.sum()))

# ---- 変形後の形状 ----
pos = V[body_idx].copy()
tris = []
for f in body_faces:
    f = [remap[i] for i in f]
    tris.append([f[0], f[1], f[2]])
    if len(f) == 4: tris.append([f[0], f[2], f[3]])
tris = np.array(tris, np.uint32)
def normals(p):
    n = np.zeros_like(p)
    a, b, c = p[tris[:, 0]], p[tris[:, 1]], p[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3): np.add.at(n, tris[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
N0 = normals(pos)

# ---- 服の厚み（身体を法線方向にふくらませて、シャツ・ズボン・靴に見せる）----
GROUP = {'spine': 'shirt', 'chest': 'shirt', 'clav_L': 'shirt', 'clav_R': 'shirt', 'uarm_L': 'shirt', 'uarm_R': 'shirt', 'larm_L': 'shirt', 'larm_R': 'shirt',
         'hips': 'pants', 'uleg_L': 'pants', 'uleg_R': 'pants', 'lleg_L': 'pants', 'lleg_R': 'pants',
         'foot_L': 'shoe', 'foot_R': 'shoe', 'toe_L': 'shoe', 'toe_R': 'shoe',
         'neck': 'skin', 'head': 'skin', 'hand_L': 'skin', 'hand_R': 'skin'}
THICK = {'shirt': 0.013, 'pants': 0.010, 'shoe': 0.012, 'skin': 0.0}
cats = ['skin', 'shirt', 'pants', 'shoe']
Cw = np.zeros((NV, 4))
for j, b in enumerate(RED): Cw[:, cats.index(GROUP[b])] += Wt[:, j]
thick = Cw @ np.array([THICK[c] for c in cats])
pos_c = pos + N0 * thick[:, None]
# 腹部：シャツの下をやや丸く（高齢男性の体型）
def srgb(h): c = np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255]) / 255.0; return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
hx = lambda k, d: int(str(SPEC.get(k, d)).replace('#', ''), 16)
COL = {'skin': srgb(hx('skin', 'd0a083')), 'shirt': srgb(hx('shirt', '8f9da2')), 'pants': srgb(hx('pants', '4e5a62')), 'shoe': srgb(hx('shoe', '33393f'))}
dom = Cw.argmax(axis=1)
colors = np.array([COL[cats[d]] for d in dom])
# 布地の境目のなじみ：ウェイトで混色を少し入れる
colors = 0.75 * colors + 0.25 * (Cw @ np.array([COL[c] for c in cats]))
# 区分の補正：胴体の「シャツ↔ズボン」「首元の肌」は高さで滑らかに切り替える（裾・襟ぐりがギザギザにならないように）
hipY0 = P['hips'][1]; neckY0 = P['neck'][1]
ix = lambda *names: [RED.index(n) for n in names]
ss = lambda x: 0.0 if x <= 0 else 1.0 if x >= 1 else x * x * (3 - 2 * x)
thick = np.array([THICK[cats[d]] for d in dom]); colors = np.array([COL[cats[d]] for d in dom])
for i in range(NV):
    w_leg = Wt[i, ix('uleg_L', 'uleg_R', 'lleg_L', 'lleg_R')].sum()
    w_tor = Wt[i, ix('hips', 'spine', 'chest', 'clav_L', 'clav_R', 'neck')].sum()
    if w_tor > 0.5 and w_leg < 0.5 and Wt[i, ix('uarm_L', 'uarm_R', 'larm_L', 'larm_R', 'head')].sum() < 0.3:
        y, x = pos[i][1], abs(pos[i][0])
        t = ss((y - (hipY0 + 0.06)) / 0.025)                      # 0=ズボン 1=シャツ
        c = COL['pants'] * (1 - t) + COL['shirt'] * t; th = THICK['pants'] * (1 - t) + THICK['shirt'] * t
        k = ss((y - (neckY0 + 0.012)) / 0.02) if x < 0.08 and pos[i][2] > -0.12 else 0.0   # 首元
        colors[i] = c * (1 - k) + COL['skin'] * k; thick[i] = th * (1 - k)
pos_c = pos + N0 * thick[:, None]
# 口（唇）の色味：口の骨 oris01 の位置付近のみ
mouth = head('oris01')
for i in range(NV):
    if dom[i] == 0 and Wt[i, RED.index('head')] > 0.9:
        p = pos[i]
        if p[2] > mouth[2] - 0.01 and abs(p[1] - (mouth[1] + 0.008)) < 0.0075 and abs(p[0]) < 0.026:
            colors[i] = srgb(0xb0756a)
# 髪（白髪）：頭部の頂点のうち、頭頂・側頭・後頭を灰色にして少し盛り上げる（額と耳は出す）
eyeY = head('eye.L')[1]
hv0 = np.array([i for i in range(NV) if Wt[i, RED.index('head')] > 0.9])
hcz = pos[hv0][:, 2].mean()
HAIR = srgb(hx('hair', 'b9b9b9')); HSTYLE = SPEC.get('hair_style', 'short')
HL = 0.065 + (0.03 if HSTYLE == 'receding' else 0.0)   # 生え際の高さ（receding=後退）
for i in (hv0 if HSTYLE != 'bald' else []):
    x, y, z = abs(pos[i][0]), pos[i][1], pos[i][2]
    top = ss((y - (eyeY + HL)) / 0.02)                          # 額の生え際より上
    back = ss((y - (eyeY - 0.055)) / 0.02) * ss((hcz - 0.012 - z) / 0.02)   # 側頭〜後頭（耳より後ろ）
    ear = ss((x - 0.072) / 0.01) * (1 - ss((y - (eyeY + 0.03)) / 0.015))     # 耳は除く
    k = max(top, back * (1 - ear))
    if k > 0:
        colors[i] = colors[i] * (1 - k) + HAIR * k; thick[i] = 0.009 * k
# 長めの髪（ボブ）：後頭部から首の後ろ・肩にかけても髪にする
if HSTYLE == 'bob':
    for i in range(NV):
        wh, wn = Wt[i, RED.index('head')], Wt[i, RED.index('neck')]
        if wh + wn > 0.6:
            x, y, z = abs(pos[i][0]), pos[i][1], pos[i][2]
            k = ss((hcz - 0.035 - z) / 0.02) * ss((y - (neckY0 - 0.035)) / 0.02) * (1 - ss((x - 0.085) / 0.012))
            if k > colors_k.get(i, 0) if False else k > 0:
                colors[i] = colors[i] * (1 - k) + HAIR * k; thick[i] = max(thick[i], 0.014 * k)
# ひげ：'mustache'（口ひげ）／'stubble'（無精ひげ）。髪と同じ色の薄いグレーで下顔面を塗る
BEARD = SPEC.get('beard')
if BEARD:
    my = mouth[1]
    for i in hv0:
        x, y, z = abs(pos[i][0]), pos[i][1], pos[i][2]
        if z < hcz - 0.0: continue
        k = 0.0
        if BEARD in ('mustache', 'stubble'): k = max(k, ss((0.032 - x) / 0.01) * ss((y - (my + 0.006)) / 0.006) * (1 - ss((y - (my + 0.034)) / 0.008)))
        if BEARD == 'stubble': k = max(k, 0.7 * ss((0.075 - x) / 0.02) * (1 - ss((y - (my - 0.004)) / 0.01)) * ss((y - (my - 0.075)) / 0.015))
        if k > 0: colors[i] = colors[i] * (1 - 0.8 * k) + HAIR * 0.8 * k
pos_c = pos + N0 * thick[:, None]

# ---- 胸の乳頭の突起をなだらかにする（服の上から突起が見えないように。胸まわりの前面を平滑化）----
def smooth_region(P, w, iters, lam):
    for _ in range(iters):
        acc = np.zeros_like(P); cnt = np.zeros(len(P))
        for a, b in ((0, 1), (1, 2), (2, 0)):
            np.add.at(acc, tris[:, a], P[tris[:, b]]); np.add.at(cnt, tris[:, a], 1)
            np.add.at(acc, tris[:, b], P[tris[:, a]]); np.add.at(cnt, tris[:, b], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        P += lam * w[:, None] * (avg - P)
chestY = P['chest'][1]; spineY = P['spine'][1]; torsoZ = (P['chest'][2] + P['spine'][2]) / 2
w_t = Wt[:, ix('spine', 'chest')].sum(axis=1) - Wt[:, ix('uarm_L', 'uarm_R', 'larm_L', 'larm_R')].sum(axis=1)
front = np.array([ss((pos[i][2] - (torsoZ - 0.02)) / 0.03) for i in range(NV)])
band = np.array([ss((0.22 - abs(pos[i][1] - (chestY - 0.02))) / 0.14) for i in range(NV)])
xm = np.array([ss((0.19 - abs(pos[i][0])) / 0.03) for i in range(NV)])
w_chest = np.clip(w_t + 0.5, 0, 1) * xm * front * band * np.clip((Cw[:, cats.index('shirt')] - 0.1) / 0.3, 0, 1)
smooth_region(pos_c, w_chest, 300, 0.5)
N1 = normals(pos_c)
for _ in range(30):                                  # 胸まわりは法線も平滑化（陰影の突起を消す）
    acc = np.zeros_like(N1); cnt = np.zeros(len(N1))
    for a, b in ((0, 1), (1, 2), (2, 0)):
        np.add.at(acc, tris[:, a], N1[tris[:, b]]); np.add.at(cnt, tris[:, a], 1)
        np.add.at(acc, tris[:, b], N1[tris[:, a]]); np.add.at(cnt, tris[:, b], 1)
    N1 = N1 + 0.6 * np.clip(w_chest * 1.5, 0, 1)[:, None] * (acc / np.maximum(cnt, 1)[:, None] - N1)
N1 /= np.linalg.norm(N1, axis=1, keepdims=True) + 1e-12

# ---- 床・原点の調整（靴底 y=0、股関節中心 x=z=0）----
minY = pos_c[:, 1].min()
hipJ = P['hips']
shift = np.array([-hipJ[0], -minY, -hipJ[2]])
pos_c += shift
Pj = {k: v + shift for k, v in P.items()}
print('hip height above floor', Pj['hips'][1], 'ankle', Pj['foot_L'][1])

# ---- GLB 書き出し ----
order = RED
jidx = {n: i for i, n in enumerate(order)}
top = np.argsort(-Wt, axis=1)[:, :4]
jw = np.take_along_axis(Wt, top, axis=1); jw /= jw.sum(axis=1, keepdims=True)
J0 = top.astype(np.uint8)
ibm = np.zeros((len(order), 16), np.float32)
for n in order:
    m = np.eye(4); m[:3, 3] = -Pj[n]; ibm[jidx[n]] = m.T.reshape(-1)   # 列優先
bin_ = bytearray(); views = []; accs = []
def add(arr, target, ctype, typ, minmax=False):
    global bin_
    while len(bin_) % 4: bin_ += b'\0'
    off = len(bin_); raw = arr.tobytes(); bin_ += raw
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(raw), **({'target': target} if target else {})})
    a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
    accs.append(a); return len(accs) - 1
aP = add(pos_c.astype(np.float32), 34962, 5126, 'VEC3', True)
aN = add(N1.astype(np.float32), 34962, 5126, 'VEC3')
aC = add(colors.astype(np.float32), 34962, 5126, 'VEC3')
aJ = add(J0, 34962, 5121, 'VEC4')
aW = add(jw.astype(np.float32), 34962, 5126, 'VEC4')
aI = add(tris.reshape(-1), 34963, 5125, 'SCALAR')
aB = add(ibm.reshape(-1, 16), None, 5126, 'MAT4')
nodes = []
for n in order:
    par = PARENT[n]; t = Pj[n] - (Pj[par] if par else 0)
    nodes.append({'name': n, 'translation': [float(x) for x in t]})
for n in order:
    if PARENT[n]: nodes[jidx[PARENT[n]]].setdefault('children', []).append(jidx[n])
meshNode = len(nodes); nodes.append({'name': 'patient_body', 'mesh': 0, 'skin': 0})
# 頭部の大きさ（髪・眉の配置用）
hv = pos_c[(Wt[:, RED.index('head')] > 0.9)]
hmin, hmax = hv.min(axis=0), hv.max(axis=0)
# 手のひらの法線（主成分分析の最小分散方向）。向きの符号は patient.js 側で確認して決める
def palm_normal(bname):
    hv = pos_c[Wt[:, RED.index(bname)] > 0.9]
    c = hv - hv.mean(axis=0); u, sv, vt = np.linalg.svd(c, full_matrices=False)
    return vt[2].tolist(), vt[0].tolist()
palmL, axisL = palm_normal('hand_L'); palmR, axisR = palm_normal('hand_R')
meta = {
  'L1': float(np.linalg.norm(Pj['uleg_L'] - Pj['lleg_L'])), 'L2': float(np.linalg.norm(Pj['lleg_L'] - Pj['foot_L'])),
  'ankleY': float(Pj['foot_L'][1]), 'hipX': float(Pj['uleg_L'][0]), 'hipY': float(Pj['hips'][1]),
  'eyeL': (head('eye.L') + shift).tolist(), 'eyeR': (head('eye.R') + shift).tolist(),
  'headMin': hmin.tolist(), 'headMax': hmax.tolist(),
  'joints': {k: v.tolist() for k, v in Pj.items()},
  'palmN': {'L': palmL, 'R': palmR}, 'handAxis': {'L': axisL, 'R': axisR},
  'age_years': AGE_YEARS, 'source': f'MakeHuman CC0 base mesh + macro targets (asian, gender={GENDER}, age {AGE_YEARS:g}, weight {WEIGHT}, muscle {MUSCLE})',
}
gltf = {
  'asset': {'version': '2.0', 'generator': 'vr-osce tools/mh_build.py', 'extras': meta},
  'scene': 0, 'scenes': [{'nodes': [jidx['hips'], meshNode]}], 'nodes': nodes,
  'skins': [{'joints': list(range(len(order))), 'skeleton': jidx['hips'], 'inverseBindMatrices': aB}],
  'meshes': [{'name': 'body', 'primitives': [{'attributes': {'POSITION': aP, 'NORMAL': aN, 'COLOR_0': aC, 'JOINTS_0': aJ, 'WEIGHTS_0': aW}, 'indices': aI, 'material': 0}]}],
  'materials': [{'name': 'body', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.85}, 'doubleSided': False}],
  'buffers': [{'byteLength': len(bin_)}], 'bufferViews': views, 'accessors': accs,
}
js = json.dumps(gltf, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(bin_) % 4: bin_ += b'\0'
glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(bin_), b'BIN\0') + bytes(bin_)
open(OUT, 'wb').write(glb)
print('wrote', OUT, len(glb) // 1024, 'KB', {k: (round(v, 3) if isinstance(v, float) else '') for k, v in meta.items() if isinstance(v, float)})
