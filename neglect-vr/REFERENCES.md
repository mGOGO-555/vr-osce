# 参考資料・ライセンス

確認日: 2026-09-26。**「確認した範囲」を正直に区別して記載します。**

## 1. コードとして利用・同梱したもの

| 対象 | URL | ライセンス | 更新時期 | 利用箇所 |
|---|---|---|---|---|
| three.js r170(`three.module.js`, `VRButton`, `XRHandModelFactory`, `XRHandMeshModel`, `XRHandPrimitiveModel`, `GLTFLoader`, `BufferGeometryUtils`) | https://github.com/mrdoob/three.js / https://www.npmjs.com/package/three | MIT(`vendor/three/LICENSE`) | r170を同梱。npm最新は0.186.1(2026-09-24更新) | `vendor/three/` にそのままコピー。アプリ本体はこれを import |
| @webxr-input-profiles/assets 1.0.20(`generic-hand/left.glb, right.glb, profile.json`) | https://github.com/immersive-web/webxr-input-profiles | MIT(`vendor/hand/LICENSE.md`, Copyright Amazon) | npm 2025-10-28 | 実手モデル。`XRHandModelFactory.setPath('vendor/hand/')` でCDNなしで読み込み |

## 2. 実際にソースを読んで参考にしたもの

- **three.js example `webxr_vr_handinput_cubes.html`**(https://threejs.org/examples/webxr_vr_handinput_cubes.html , ソース: https://github.com/mrdoob/three.js/blob/dev/examples/webxr_vr_handinput_cubes.html)
  - ライセンス: MIT(three.js)。最終コミット日は未確認(GitHub APIに接続できなかったため)。
  - 参考にした部分: `requiredFeatures: ['hand-tracking']`のセッション初期化、`renderer.xr.getHand(i)` + `XRHandModelFactory.createHandModel(hand, 'mesh')` による左右の手モデル生成。
  - **コードのコピーはしていません**。ピンチ検出は独自(親指–人差指先端の距離+ヒステリシス、`js/input.js`)、grabは独自(`js/grab.js`)。
- **three.js `WebXRController`(同梱の `three.module.js`)**: `hand.joints[...]` の `visible`/位置の更新方法を確認し、追跡有効判定に使用(`js/input.js`)。

## 3. 公式ドキュメント(検索結果の要点のみ確認。ページ全文は未読)

- Meta Immersive Web SDK(IWSDK)概要 https://developers.meta.com/horizon/documentation/iwsdk/guides/overview/ 、リポジトリ https://github.com/facebook/immersive-web-sdk (MIT。LICENSE冒頭のみ取得して確認。最終コミット日は未確認。npm `@iwsdk/core` は 1.0.0-rc.2、2026-09-24更新)
  - 不採用の理由: ECS+Viteのビルド前提、npmのlatestがrc、MVPの「Questで確実に動く最小構成」を優先。将来IWSDKへ移行する場合、XR Input(Pointers/grab)概念 https://developers.meta.com/horizon/documentation/web/iwsdk-concept-xr-input が参考になる。
- Meta WebXR Hands https://developers.meta.com/horizon/documentation/web/webxr-hands/ (hand-tracking機能、three.jsの`joints`、サンプル一覧)
- Meta Interaction SDK / Hands design(Unity/Unreal向け。概念のみ参照)https://developers.meta.com/horizon/design/hands/

## 4. GitHub上の他実装(READMEの概要のみ。コードは読んでおらず、流用なし)

- https://github.com/simonevetere/webxr (three.js+WebXR Hand Trackingのpinch-to-grab。ライセンス・更新日は未確認)
- https://github.com/EdgarAnt/orbe (Quest向けhand-trackedの実験。three.js CDN固定、`getHand(n).joints`を直接読む構成。ライセンス・更新日は未確認)
- https://github.com/msurguy/awesome-webxr (リンク集)

これらの実装は参考候補として挙げただけで、本プロジェクトのコードには含まれていません。ライセンスを確認した上で流用する場合は、ここへ追記してください。

## 5. 未確認事項
- GitHubの各リポジトリの最終コミット日(APIとWebFetchが利用できなかったため。上記はnpmの公開日で代用)
- 実機Questでの動作(README「既知の制約」参照)
