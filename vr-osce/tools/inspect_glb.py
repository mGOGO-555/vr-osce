#!/usr/bin/env python3
"""GLB解析ツール（読み取り専用）。使い方: python3 tools/inspect_glb.py assets/patients/patient_01.glb
scene階層 / mesh / skin・bone / 主要bone / morph target / animation / bbox・実寸 / 向き / rest pose を出力する。"""
import json, struct, sys, math, re
import numpy as np

def load(path):
    b = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<4sII', b[:12])
    assert magic == b'glTF', 'GLBではありません'
    off, js, bins = 12, None, None
    while off < len(b):
        n, t = struct.unpack('<I4s', b[off:off+8]); d = b[off+8:off+8+n]; off += 8 + n
        if t == b'JSON': js = json.loads(d)
        elif t == b'BIN\0': bins = d
    return js, bins, len(b)

def local_mat(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
    t = np.array(n.get('translation', [0, 0, 0])); q = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
    x, y, z, w = q
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                  [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                  [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    M = np.eye(4); M[:3, :3] = R * np.array(s); M[:3, 3] = t
    return M

def main(path):
    g, bins, size = load(path)
    nodes = g.get('nodes', [])
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    world = {}
    def W(i):
        if i not in world:
            world[i] = (W(parent[i]) if i in parent else np.eye(4)) @ local_mat(nodes[i])
        return world[i]
    print(f'## ファイル: {path}  {size/1e6:.2f} MB  glTF {g["asset"].get("version")} generator={g["asset"].get("generator")}')
    print('extensionsUsed:', g.get('extensionsUsed', []))

    print('\n## 1. scene hierarchy')
    def tree(i, d):
        n = nodes[i]; tags = []
        if 'mesh' in n: tags.append('mesh:' + str(g['meshes'][n['mesh']].get('name')))
        if 'skin' in n: tags.append('skin#%d' % n['skin'])
        print('  ' * d + f'- {n.get("name")}' + (f'  [{", ".join(tags)}]' if tags else ''))
        if d < 3 or 'mesh' in n:
            for c in n.get('children', []): tree(c, d + 1)
        elif n.get('children'): print('  ' * (d + 1) + f'... 子{len(n["children"])}件（以降はbone一覧参照）')
    for r in g['scenes'][g.get('scene', 0)]['nodes']: tree(r, 0)

    acc = g.get('accessors', [])
    print('\n## 2. mesh一覧')
    meshnodes = [i for i, n in enumerate(nodes) if 'mesh' in n]
    allmin, allmax = np.full(3, 1e9), np.full(3, -1e9)
    for i in meshnodes:
        m = g['meshes'][nodes[i]['mesh']]
        for p in m['primitives']:
            a = acc[p['attributes']['POSITION']]
            mat = g['materials'][p['material']] if 'material' in p else {}
            pbr = mat.get('pbrMetallicRoughness', {})
            tex = [k for k in ('baseColorTexture', 'metallicRoughnessTexture') if k in pbr] + [k for k in ('normalTexture', 'emissiveTexture', 'occlusionTexture') if k in mat]
            ni = len(p.get('targets', []))
            print(f'  - node="{nodes[i].get("name")}" vertices={a["count"]} tris={acc[p["indices"]]["count"]//3 if "indices" in p else "-"} material="{mat.get("name")}" textures={tex} morph={ni} skinned={"JOINTS_0" in p["attributes"]}')
            # bbox（ワールド）。skinned meshはskin前の頂点でrest位置を使う
            lo, hi = np.array(a['min']), np.array(a['max'])
            corners = np.array([[x, y, z, 1] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
            wc = (W(i) @ corners.T).T[:, :3]
            allmin = np.minimum(allmin, wc.min(0)); allmax = np.maximum(allmax, wc.max(0))

    print('\n## 3. skeleton / bone一覧')
    bonenames = {}
    for si, s in enumerate(g.get('skins', [])):
        js_ = s['joints']
        print(f'  skin#{si} name={s.get("name")} joints={len(js_)} skeleton_root={s.get("skeleton")}')
        for j in js_: bonenames[nodes[j].get('name', '')] = j
        def jt(j, d):
            print('    ' + '  ' * d + nodes[j].get('name', '?'))
            for c in nodes[j].get('children', []):
                if c in js_: jt(c, d + 1)
        roots = [j for j in js_ if j not in parent or parent[j] not in js_]
        for r in roots: jt(r, 0)
    if not g.get('skins'): print('  skinなし（リグ無し）')

    print('\n## 4. 主要bone（Mixamo系/一般名で自動判定）')
    pats = {'hips': r'hips|pelvis', 'spine': r'^(.*:)?spine$|spine1', 'spine2': r'spine2|chest', 'neck': r'neck', 'head': r'^(.*:)?head$',
            'L_upleg': r'left.*(up.*leg|thigh)', 'L_leg': r'left.*(leg$|calf|shin|lowleg)', 'L_foot': r'left.*foot', 'L_toe': r'left.*toe(base)?$',
            'R_upleg': r'right.*(up.*leg|thigh)', 'R_leg': r'right.*(leg$|calf|shin|lowleg)', 'R_foot': r'right.*foot', 'R_toe': r'right.*toe(base)?$',
            'L_shoulder': r'left.*shoulder', 'L_arm': r'left.*arm$', 'L_forearm': r'left.*forearm', 'L_hand': r'left.*hand$',
            'R_shoulder': r'right.*shoulder', 'R_arm': r'right.*arm$', 'R_forearm': r'right.*forearm', 'R_hand': r'right.*hand$'}
    found = {}
    for k, p in pats.items():
        c = [n for n in bonenames if re.search(p, n, re.I)]
        if k.endswith('_leg'): c = [n for n in c if not re.search('up', n, re.I)]
        if k == 'L_arm' or k == 'R_arm': c = [n for n in c if not re.search('fore', n, re.I)]
        found[k] = c[0] if c else None
        print(f'  {k:11s} -> {found[k]}' + (f'   (候補{len(c)})' if len(c) > 1 else ''))

    print('\n## 5. blendshape / morph target')
    tot = 0
    for i in meshnodes:
        m = g['meshes'][nodes[i]['mesh']]
        names = m.get('extras', {}).get('targetNames') or (m['primitives'][0].get('extras', {}) or {}).get('targetNames') or []
        n = len(m['primitives'][0].get('targets', []))
        tot += n
        if n: print(f'  {nodes[i].get("name")}: {n}個  ' + ', '.join(names[:60]) + (' ...' if len(names) > 60 else ''))
    if not tot: print('  なし')

    print('\n## 6. embedded animation')
    for a in g.get('animations', []):
        tmax = max((acc[s['input']]['max'][0] for s in a['samplers']), default=0)
        print(f'  - "{a.get("name")}" channels={len(a["channels"])} 長さ={tmax:.2f}s')
    if not g.get('animations'): print('  なし')

    print('\n## 7. bounding box / 実寸（rest pose・ワールド座標・単位m想定）')
    sz = allmax - allmin
    print(f'  min={np.round(allmin, 3)} max={np.round(allmax, 3)}')
    print(f'  サイズ x(幅)={sz[0]:.3f} y(高さ)={sz[1]:.3f} z(奥行)={sz[2]:.3f}')
    print(f'  → 身長目安 {sz[1]*100:.0f} cm（単位がmでない場合はスケール補正が必要）')
    root_scales = [nodes[r].get('scale') for r in g['scenes'][g.get('scene', 0)]['nodes'] if nodes[r].get('scale')]
    print('  ルートnodeのscale:', root_scales or 'なし')

    print('\n## 8. forward / up 軸（骨位置から推定）')
    def pos(k):
        n = found.get(k); return W(bonenames[n])[:3, 3] if n else None
    lu, ru, lf, lt = pos('L_upleg'), pos('R_upleg'), pos('L_foot'), pos('L_toe')
    hp, hd = pos('hips'), pos('head')
    if hp is not None and hd is not None:
        up = hd - hp; ax = int(np.argmax(np.abs(up)))
        print(f'  up軸: {"XYZ"[ax]}{"+" if up[ax] > 0 else "-"}  (hips→head = {np.round(up, 3)})')
    if lu is not None and ru is not None:
        lr = lu - ru; ax = int(np.argmax(np.abs(lr)))
        print(f'  モデルの左右軸: 左脚は {"XYZ"[ax]}{"+" if lr[ax] > 0 else "-"} 側 (L_upleg - R_upleg = {np.round(lr, 3)})')
        if hp is not None and hd is not None and lt is not None and lf is not None:
            fw = lt - lf; fx = int(np.argmax(np.abs(fw * np.array([1, 0, 1]))))
            print(f'  forward（左足 foot→toe方向）: {"XYZ"[fx]}{"+" if fw[fx] > 0 else "-"}  ({np.round(fw, 3)})')
            # 右手系: forward = up × left_dir の関係で検算
            fwd_c = np.cross(up / np.linalg.norm(up), lr / np.linalg.norm(lr))
            print(f'  検算 forward(up×左方向) = {np.round(fwd_c, 2)}（上と符号が一致すれば整合）')
    print('  ※ 顔の向きの最終確認は表示後のスクリーンショットで行う')

    print('\n## 9. rest pose（T/A/その他）')
    la, lfa, lh = pos('L_arm'), pos('L_forearm'), pos('L_hand')
    if la is not None and lh is not None:
        d = lh - la; d = d / np.linalg.norm(d)
        ang = math.degrees(math.asin(max(-1, min(1, -d[1] if abs(d[1]) > 0 else 0))))
        up_ax = 1
        lateral = math.degrees(math.atan2(abs(d[0]) + abs(d[2]) * 0, abs(d[1]) + 1e-9))
        kind = 'T-pose（腕が水平）' if abs(d[1]) < 0.25 else ('A-pose（腕が斜め下）' if d[1] > -0.85 else '腕が体側（下垂）')
        print(f'  左 肩→手 方向 = {np.round(d, 2)} → {kind}（水平からの下がり角 約{ang:.0f}°）')
    else:
        print('  腕boneが特定できないため判定不可')
    if found['L_upleg'] and found['L_foot']:
        v = pos('L_foot') - pos('L_upleg'); print(f'  脚の開き: 左股→左足首 = {np.round(v, 3)}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'assets/patients/patient_01.glb')
