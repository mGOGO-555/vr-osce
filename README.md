# VR-OSCE PoC（理学療法学生向け・症例選択式）

理学療法学生向け VR-OSCE の試作（3症例：脳卒中片麻痺／大腿骨頸部骨折術後／COPD。各1ステーション）。WebXR + Three.js、ビルド不要。Meta Quest Browser で動作させる想定です。
PCブラウザではマウス操作（ドラッグで視点回転、クリックで選択）で動作確認できます。

## 1. PCで動かす（開発・確認用）

```bash
cd vr-osce
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080/` を開く → 学生ID（例：S001）入力 → 「ID確定」。
`file://` で直接開くとES Modulesが動かないため、必ずサーバー経由で開いてください。

## 2. Quest で動かす

WebXR は「安全なコンテキスト（HTTPS）」が必要です（MDN: XRSystem）。以下のどちらかで接続します。

### 方法A：USB接続＋adb reverse（開発時・最も手軽）
Meta公式の Browser Remote Debugging の手順に沿います。
1. Quest で開発者モードを有効化、PCとUSB接続（Quest側で「USBデバッグを許可」）。
2. PCで `python3 -m http.server 8080` を起動。
3. `adb reverse tcp:8080 tcp:8080`
4. Quest Browser で `http://localhost:8080/` を開く。
5. 不具合調査は PC の Chrome で `chrome://inspect/#devices` からQuest Browserを検査（console確認可）。

※ localhost が安全なコンテキスト扱いになるか、Questで「ENTER VR」が表示されるかは、実機で最初に確認してください（未確認）。表示されない場合は方法Bへ。

### 方法B：HTTPSで公開（授業・複数台運用向け）
GitHub Pages / Netlify など、HTTPSで静的ファイルを配信できる場所に `vr-osce` フォルダの中身をそのまま置き、そのURLをQuest Browserで開きます。
（大学のサーバーを使う場合もHTTPSが必要。個人情報は扱いませんが、公開範囲は学内限定などを検討してください。）

### 方法C：LAN内のHTTPS（自己署名証明書）
PCのLAN IPでHTTPSサーバーを立て、Quest Browserで証明書警告を承認して開く方法（Meta IWSDKのテストガイドにも記載）。設定がやや面倒なのでA/Bを推奨します。

## 3. 実機確認チェックリスト

- [ ] 学生ID入力 → 「ENTER VR」が表示され、VRに入れる
- [ ] コントローラのレイ（線）が見え、パネルのボタンにホバー・選択できる
- [ ] パネルの文字が読める（特に結果画面の小さめ文字）。読みにくければ `ui.js` の文字サイズ、`main.js` のパネル位置・サイズを調整
- [ ] 日本語フォントが正しく表示される（豆腐□にならない）
- [ ] 患者・ベッド・車椅子のスケール感（患者が実寸に見えるか）
- [ ] 「立ち上がり評価」のアニメーションが見やすい位置から観察できる
- [ ] 残り時間表示が進む／7分で自動終了する
- [ ] 結果画面（4ページ）が最後まで読める
- [ ] 「VRを終了してデータを保存」→ 2Dパネルにスコア表とダウンロードボタンが出る
- [ ] Quest BrowserでJSON/CSVをダウンロードでき、Questのファイルに保存される
- [ ] VR途中で終了した場合も、ログが `end_reason: vr_exit` で保存できる
- [ ] ドアが開き、暗転して室内に入れる／床の輪で移動でき、移動後もパネルが見える位置にある
- [ ] コントローラーとハンド（ピンチ）の両方でボタンと輪を選べる。手がリアルな手の形で表示され、ピンチで二重に反応しない
- [ ] 患者の右膝・体幹・骨盤に手を近づけて、介助できる（青く光る→0.5秒で介助済み）
- [ ] 動作が重くない（フレーム落ち・酔いが出ない）

## 3.5 操作方法
- **症例の選択**：廊下のパネルのボタンで患者（症例）を選びます（VR内で操作）。選んだ症例の課題文が出て、「開始」で入室します。「← 症例を選び直す」で選び直せます。URLに `?case=case02` を付けると、選択を省略してその症例から始まります（試験で症例を固定したいとき用）。
- **誤操作の防止**：画面が切り替わった直後（約0.5秒）のボタン入力は無視します（戻るボタンの位置に別のボタンが出て、二重入力で連鎖するのを防ぐため）。「Station終了」は確認画面を挟みます。
- **患者の声**：問診の回答を、ブラウザの読み上げ機能（日本語）で話します。症例JSONの `patient.voice`（pitch・rate・pause）で声の高さ・速さを変えます。メニューの「患者の声：ON/OFF」で切り替え。Questで日本語の声が使えるか・聞き取りやすいかは未確認（ヘッドレスでは音は確認できていません）。
- **入室**：最初は長い病院の廊下（約18m）の端に立ちます。「開始」で病室の前へ暗転して移動し（ログ `arrive_at_room`）、ドアが開いて室内（正面・遠）へ入ります（ログ `enter_room`）。ドアの脇の札に病室番号と患者名（架空）があります。
- **選択**：コントローラーのレイ＋トリガー、またはハンドトラッキングのレイ＋親指と人差し指のつまみ（ピンチ）。PCはマウスクリック。
- **移動**：床に出る青い輪（正面・遠／正面・近／患者の右側／患者の左側）にレイを当てて選択すると、暗転して移動します（ログに `move`）。PCは輪をクリック。
- ハンドトラッキングを使うには Quest 側の設定でハンドトラッキングをオンにしてください（未確認）。パームピンチ（手のひらを向けてつまむ）はシステムが使うため、通常のピンチを使います（Meta公式資料）。

- **立位のまま評価に戻る**：立ち上がり後の観察画面の「評価項目に戻る（患者は立位のまま）」で評価メニューに戻れます（ログに `back_to_menu_standing`）。「立位保持」「歩行」は評価項目から、立ち上がり評価の前後を問わず任意の順で選べます。患者が座っているときに選ぶと、先に自動で立ち上がります（ログ `auto_stand_up`。車椅子ブレーキ未確認なら Safety error 扱い）。歩行は介助下で前方に4歩進み、そのあと介助で元の位置へ戻ります。

- **介助・声かけ**：メニュー「介助・声かけ」で「声かけをする」「右膝を支える」「体幹を支える」「骨盤を支える」を選べます。選んだ介助はその後の動作（立ち上がり・立位保持・歩行）に反映されます（右膝を支える→膝折れが出ない、体幹→前傾が十分、骨盤→左右の偏りが減る）。観察結果の文面も介助に応じて変わります（症例JSONの `if_assist`）。
  **手で触れる介助**：患者の右膝・体幹・骨盤にハンド（またはコントローラー）を近づけると、触れている間は姿勢が整います（0.4秒でなめらかに変化）。そのまま0.5秒触れ続けると「介助あり」に確定し（緑で表示）、手を離しても続きます。同じ部位をもう一度0.5秒触れると解除されます（ログ `release_assist_…`）。確定のログの `selection` は「…（手で接触）」。立ち上がり・立位保持・歩行の動作中は、開始時点の介助が最後まで続きます。手が届くよう、「患者の右側」「正面（近）」の位置を患者に近づけました（Quest実機で判定の大きさ・位置を要調整。未確認）。
  採点：右膝を支える→Safety（立ち上がり前）、声かけ→Communication に追加（Safety は4項目すべてで2点、Communication は5項目すべてで2点。体幹・骨盤は記録のみで採点なし）。

## 4. ファイル構成

```
vr-osce/
├ index.html           入口（学生ID入力・VRボタン・保存パネル）
├ main.js              シーン・操作・進行管理
├ ui.js                VR内パネル（canvas）
├ patient.js           患者の動作（立ち上がりアニメーション）。人体モデルを読み込み、失敗時は簡易人型で代替
├ assets/hands/        ハンドトラッキング用の手のモデル（左右。MIT）
├ assets/patient_case01〜03.glb   患者の人体モデル（症例ごとに性別・年齢・体型・髪/服の色が違う。骨格付き）
├ tools/mh_build.py    上記モデルの生成スクリプト（MakeHumanのCC0データから自作）
├ tools/specs/         モデルごとの体型の指定（性別・年齢・体重・筋量・髪・服の色）
├ logger.js            行動ログ
├ scoring.js           ルールベース採点
├ exporter.js          JSON/CSV出力
├ cases/index.json     症例の一覧（選択欄に出る）
├ cases/case01_stroke.json / case02_hip_fracture.json / case03_copd.json   症例定義（患者の見た目・動き・メニュー・回答・判断・採点ルール）
└ lib/three/           Three.js r186（ローカル同梱）、VRButton.js
```

## 5. 症例・採点の編集

症例の文言、患者の回答、評価結果の文面、判断の選択肢、採点ルールはすべて症例ごとのJSON（`cases/` 内）にあります。
- `room`：病室番号・患者名（札に表示）／`props`：車椅子の有無
- `patient.model`：人体モデル（GLB）／`patient.motion`：動きの型。`type` は `hemiparesis`（片麻痺：患側の膝折れ・荷重の偏り）、`offload`（疼痛回避：患側に荷重しない・ためらい・歩行器）、`dyspnea`（息切れ：前傾位・休息・呼吸動作）。`side`（患側 right/left）、`severity`、`speed`、`walker`、`breath`（呼吸数と大きさ）も指定可
- メニューの `assist` 分類：項目に `effect`（knee/trunk/pelvis）を付けると動きに反映され、`zone: true` で手で触れる部位になる。`effect` なしの項目（例：口すぼめ呼吸を促す）は、実施済みかどうかで返答が変わる（`if_assist`）
- `if_state`：結果の文面を状態で切り替える（`stood`＝立位後、`walked`＝歩行後。JSONの順に最初に該当したもの）。バイタルの変化などに使う
- `scoring.safety_errors`：立ち上がり前に必要な確認（`requires`）が未実施なら Safety error（上限1点）
- `menu`：質問・観察・評価・安全確認の項目と固定回答
- `judgement`：臨床判断。`type:"rank"` の設問は、問題点を最大3つ選んで優先順位をつける形式（各選択肢に `weight`＝重要度 3/2/1/0 と `rationale`＝根拠文）。それ以外は1問1選択（`correct`、`score`）
  - Clinical reasoning の採点（仮案）：最優先（weight 3）を1位に選び、かつ無関係（weight 0）を選んでいない＝2点／最優先を含む＝1点／含まない＝0点
  - 結果画面に「判断の根拠」ページ（学生の順位と根拠文）を表示。根拠文・重要度は教員確認前の仮案
- `scoring`：6領域の対象項目、点数条件、Safety error（`safety_errors`）
- 評価結果の数値・所見は仮作成です。**教員が内容を確認・修正してください。**

**評価結果の数値（すべて仮作成）**：MMT（右 股屈曲3・股伸展3・膝伸展3・膝屈曲3・足背屈2・足底屈3／左5）、Brunnstrom stage 右下肢Ⅲ、Fugl-Meyer 下肢17/34、SIAS（股屈曲3・膝伸展3・足パット2）、感覚（触覚 右7/10、位置覚 右3/5）、荷重（座位 左:右≒6:4、立位≒7:3）、FAC 1。症例JSONの `menu` の評価項目に書いてあります。**教員が臨床的に妥当か確認・修正してください。**

## 5.5 症例を増やす・患者モデルを作り直す
1. `tools/specs/caseNN.json` に体型を書く（`gender` 1=男/0=女、`age`、`weight` −1〜+1、`muscle` −1〜+1、`scale`、`hair`、`hair_style`=short/bob/bald、`shirt`/`pants`/`skin` の色）。
2. MakeHumanのデータを取得したうえで `python3 tools/mh_build.py <makehuman/data のパス> assets/patient_caseNN.glb tools/specs/caseNN.json` を実行（numpyが必要。パスを空文字にすると既定の場所を使う）。
3. 既存の症例JSONをコピーして内容を書き換え、`cases/index.json` に追加する。

## 6. 未検証の点

- **症例2・3の臨床内容（所見・数値・問題点の重要度・根拠文・中止基準・対応の選択肢）はすべて仮案です。教員の確認・修正が必要です。**
- 症例ごとの患者の動き（疼痛回避・息切れ・歩行器歩行・呼吸動作）は、PCのヘッドレス画面でのみ確認しています。Quest実機で、自然に見えるか確認してください。
- 廊下の長さ・ドアまでの暗転移動の感覚（実機未確認）

- Quest実機での表示・ray操作・文字の読みやすさ・ダウンロード動作（ヘッドレスChromiumでのみ検証済み）
- ハンドトラッキングとテレポートのVR内での動作（PCでは移動・入室・クリックのみ確認済み。ハンドは実機未確認）
- 採点基準の妥当性（Safety上限=ブレーキ未確認時は最大1点、部分点は問題点の「左下肢筋力低下」のみ1点。教員の確認が必要）

## 7. ライセンス・参照

- Three.js r186（MIT License）。`lib/three/` にそのまま同梱。`VRButton.js`・`GLTFLoader.js`・`BufferGeometryUtils.js`・`SkeletonUtils.js` は未改変のコピー。
- 患者モデル：MakeHuman community（https://github.com/makehumancommunity/makehuman）の基本メッシュ・体型データ・骨格ウェイト（CC0）を元に、`tools/mh_build.py`（自作）で 72歳男性・アジア系の体型に合成。MakeHumanのプログラム（AGPL）は使用していない。服・髪・唇の色と厚みは自作スクリプトで追加。目・眉は `patient.js` で追加。
- 手のモデル：`assets/hands/left.glb`・`right.glb` は @webxr-input-profiles/assets（generic-hand、MIT License、`assets/hands/LICENSE-webxr-input-profiles.txt`）をそのまま同梱。
- 他のGitHubコードの流用はありません。
- 参照した公式資料：
  - Meta Horizon: Browser Remote Debugging
  - Meta IWSDK: Testing your experience
  - MDN: XRSystem / WebXR Device API
  - three.js docs: WebXR / VRButton

## 8. 今後の拡張案

音声入力、ハンドトラッキング、複数症例・複数ステーション、教員用の採点集計ツール、サーバーへの結果送信（同意・匿名化の設計が必要）。

### 見た目の指定（tools/specs/caseNN.json）
`gender, age, weight, muscle, scale` に加え、`face`（顔の形の調整。例 `"head/head-oval": 0.8, "nose/nose-hump-incr": 0.5`）、`hair_style`（short / bob / receding / bald）、`beard`（mustache / stubble）、症例JSONの `patient.glasses: true`（眼鏡）で顔を変えられます。服の胸まわりは突起が見えないよう自動で平滑化しています。

### 声で質問（学生の音声入力）
- 「問診」の分類に「声で質問する」ボタンが出ます。押して話し、「話し終わった」を押すと認識し、質問項目に当てはめて患者が答えます（当てはまらなければ患者が聞き返します）。ボタンでの質問も従来どおり使えます。
- 認識は Quest の中で行い（Whisper tiny、transformers.js をCDNから読み込み）、声は外部に送らず保存もしません。初回は約40MBのダウンロードがあり、インターネット接続が必要です。
- 当てはめは症例JSONの質問項目の `say`（キーワードの配列）で決めます。症例を足すときは、各質問に言い方の違い（漢字・かな）を入れてください。ログには `（音声：認識した文）` が残ります。
- PC確認用：`?asr=0` で読み込みを止められます。

### 症例4：パーキンソン病（動きの型 `parkinson`）
- 75歳男性・Hoehn-Yahr III〜IV。前傾（円背）、ゆっくりした立ち上がり（座位でためらう）、歩き出しのすくみ、進むほど小さく速くなる歩幅、立位保持中のわずかな動揺を表現します。左右対称の型です。
- 介助・声かけの「視覚的な合図（床の目印）」を出してから歩行を評価すると、すくみが短く歩幅の大きい歩行になります（`effect: "cue"`）。掛け声（聴覚的な合図）は、この症例では変化なしとして設定しています。
- 臨床内容（数値・所見・重みづけ・推奨対応）は先生の確認が必要な下書きです。動画・症例スライドは動きの特徴を参考にしただけで、内容は転載していません。

## 立ち上がり（STS）動作プロファイル（patient.js）
4症例ごとに独立した軌道（cubic Hermite・離臀は通過イベント）。所要時間は stroke 4.2 / hip fracture 4.4 / COPD 3.6 / Parkinson 5.0 秒（医学的cutoffではなく視覚調整用の初期値）。
ブラウザconsoleで `osceSTS.all()` を実行すると4症例の指標一覧、現在の患者のみは `__osce.patient.stsReport()`。

## 症例1 起き上がり（仰臥位→端座位）〔デバッグ再生のみ・UI未接続〕
症例1は、ベッドの長辺（患者の左前方）で端座位→STS→立位になるよう `placement`（x=0.5, z=-1.0, yaw 90°）で配置している。
`patientRoot`（patient.js の root）の局所座標で全て計算するため、STS・立位・歩行・歩行器・触診ゾーンは従来と同じ局所姿勢のまま。
ブラウザのconsoleで:
- `osceBed.play()`（`{speed:0.5}` でスロー）／`osceBed.playThenStand()`（端座位→そのままSTS）
- `osceBed.at(t)`（0〜6.2秒のフレーム確認）／`osceBed.stop()`／`osceBed.toSitting()`
- `osceBed.validate()`：total duration・各landmark・右脚遅れ・肘/手の接触誤差・最大貫通・STS初期姿勢との差を表示
実装: `bedmob.js`（値は見た目調整の初期値）。右（麻痺側）上下肢は支持に使わず、左より遅れて追従。最終姿勢は t=6.2s で STS 初期姿勢と完全一致。

### Quest確認用デバッグパネル（一時）
URL末尾に `?beddebug=1` を付けたときだけ、VR内に小パネル（Play Bed Mobility / Bed → Stand / Reset）が出る。通常起動では読み込まれない。OSCE進行・採点・loggerには接続していない。
`osceBed.validate()` は、設計値（nominal_event_times_s）と実測値（measured_event_times_s）、設定上の右脚時間遅れ（configured_paretic_time_lag_s=0）と実測の右−左legs-off差を分けて表示する。
基準版バックアップ: `backup/before_quest_bedmob/`（軌道値はQuest確認まで固定）。

## 起き上がり評価（症例1・通常UI）／STS時間軸の再調整
- 症例1の「評価項目」に「起き上がり評価（仰臥位→端座位）」（`assess_bed_mobility`）を追加。選ぶと仰臥位へリセット→案内文→通常速度で再生（6.2秒）→端座位で停止→観察画面（寝返り／右上下肢／起き上がり）。STSへは自動で続けない。立ち上がり評価は別項目として従来どおり。採点は未変更（観察項目のみ）。文面は `cases/case01_stroke.json` の `bed_mobility`。
- STSの所要時間（視覚調整の初期値。医学的基準ではない）：stroke 3.0 / hip fracture 3.3 / COPD 2.7 / Parkinson 4.0 秒。`patient.js` の `RETIME`（区分線形の時間ワープ）で、荷重差・患側遅延・ためらい・予備運動の形は保って時間だけ圧縮。stroke: peak trunk flexion 0.7 / seat-off 1.0 / extension 1.1 / 立位 2.3 / 安定 3.0 秒。
- `?beddebug=1` のデバッグパネルは従来どおり。バックアップ: `backup/patient_before_sts_retime.js` ほか。

## NORMAL STS（病態なしの基準の立ち上がり・調整用）
- `?sts=normal` で起動、またはconsoleで `osceSTS.normal()`（`osceSTS.normal(false)` で戻す）。既定の4症例のSTSは変更なし。
- 総時間2.4秒（見た目調整の初期値。医学的な正常値ではない）。体幹前傾ピーク約39°、骨盤前傾は体幹の約35%（初期値）。
- `osceSTS.kin()`：表示中の骨のworld変換から、患者局所の矢状面へ投影して、体幹角・骨盤AP/上下位置・骨盤前傾・頭部前方移動・股/膝角・骨盤速度・体幹角速度を出力。
- 病態（左右差・麻痺側の遅れ等）は未実装。

## NORMAL STS（実測motion-capture由来・debug）
旧「手作りNORMAL STS」は廃止し、実測データ（Vicon Plug-in Gait export, 100 Hz）から作り直した。
- 起動: `?sts=normal`、またはconsoleで `await osceSTS.normal()`（`osceSTS.normal(false)` で戻る）。既定の4症例のSTS・歩行・bed mobility・UI・scoring・loggerは変更なし。
- 元データ: `data/raw/standing_full.csv`（変更しない）。派生: `derived/normal_sts_motion.json`、`derived/normal_sts_report.json`（`python3 tools/build_normal_sts.py` で再生成）。区間は初期候補 1.18–3.57 s。
- 空間軸はmarkerから決定（鉛直=Z、前=−X、左=−Y）。角度列のX/Y/Z（flex/ab/rot）とは別。左右の角度列（Y/Z符号反転）は同一segment向きの左右別符号規約で、平均しない。
- 骨盤位置: LASI/RASI/LPSI/RPSI から作ったマーカー骨盤frame＋定数オフセット（Vicon骨盤原点=股関節中心）。avatarの脚長/実測脚長でスケール。
- 向き: segment frame → `restQuaternion × 実測motion`。補間は隣接サンプル間の線形（向きはslerp）。平滑化・Hermiteなし。人工的な呼吸・腕・頭の動きは加えない。
- 鎖骨は角度列が無いため動かさない。spine/chest・neck/headの2骨への配分（50/50）のみ非実測（合計は実測と一致）。
- `osceSTS.kin()` : avatarのworld変換から骨盤位置・骨盤/体幹/頭頸部角・左右 hip/knee/ankle・速度を計算し、`qc` に元CSVとのRMSE・最大誤差、骨盤位置誤差、足部のずれを出す。
- `?stsfoot=pin`（任意）: 両足首を固定するよう骨盤の前後・上下を補正（実測の骨盤移動からずれる）。既定OFF。

## NORMAL STS の motion modifiers（debug・病態値は未設定）
実測NORMALの上に重ねる補正。元CSV・`derived/normal_sts_motion.json`・NORMAL本体は変更しない。全値が既定、または `modifier=off` のときは実測NORMALと完全に一致（検証済み）。
| 値 | 既定 | 意味 |
|---|---|---|
| timeScale | 1.0 | 所要時間の倍率（>1でゆっくり）。時間軸だけを伸縮し波形は不変 |
| rightFootAPOffset / leftFootAPOffset | 0 | 足の接地位置を前(+)/後(-)へ（m） |
| stanceWidthOffset | 0 | 両足の間隔（m、左右へ半分ずつ） |
| pelvisLateralOffset | 0 | 骨盤を左(+)/右(-)へ（m） |
| trunkFlexionGain | 1.0 | 胸郭の前傾量（開始姿勢からの変化量）の倍率。頭・腕は胸郭に対する実測の相対角のまま追従 |
| rightLegTimeDelay / leftLegTimeDelay | 0 | 脚の関節角（股・膝・足首）の時間遅れ（秒）。骨盤・体幹は遅らせない |
| rightKneeExtensionGain / leftKneeExtensionGain | 1.0 | 膝の伸展量（座位からの変化量）の倍率 |
- console: `osceSTS.setTimeScale(1.2)`、`setRightFootOffset(0.05)`、`setLeftFootOffset`、`setStanceWidthOffset`、`setPelvisLateralOffset`、`setTrunkFlexionGain`、`setRight/LeftLegTimeDelay`、`setRight/LeftKneeExtensionGain`、`setModifiers({...})`、`modifiers()`、`modifier('off'|'on')`、`resetModifiers()`。
- URL（Quest用）: `?sts=normal&timeScale=1.2&rightFootAPOffset=0.05 …`、`&modifier=off`。
- 足位置は関節角を書き換えず、足首の接地位置を指定量ずらして、股・膝だけの2リンクIKで最小限補正（足部の向きは保持）。届かないときは脚を伸ばしきった位置で止まる。
- 脚の時間遅れ・膝の伸展量は足を床に固定しない（足が浮く/滑るのも結果として出る）。

### NORMAL STS: 0.50 mベッドへの環境リターゲット（既定ON、`?stsenv=off` / `osceSTS.setEnvRetarget(false)` で実測そのまま）
実測の座面≈0.38 m → VRベッド0.50 m。実測CSV・derived・既存4症例は不変。
- 骨盤上下：座面高差 `seatDiff`(=0.134 m。IK後の臀部メッシュが開始時に座面へ接するよう数値で較正：`osceSTS.calibrateSeat()`) を、実測の骨盤上昇率(単調化)のsmootherstepに沿って 開始+seatDiff → 最終0 へ減らす。
- 足底：左右別の2リンクIKで足底(足部メッシュ頂点)を床に拘束。股・膝のみ補正、足部のworld向きは保持（足関節角は結果として変化）。
- 脚が伸びきっても届かない区間（実測の立位骨盤が下肢長より高い）のみ、不足分だけ骨盤を下げる（最大≈29 mm、`reachDrop`として記録）。
- QC：`osceSTS.envQC()`（臀部－ベッド、左右足底－床、股/膝/足関節の元CSVとの差、骨盤上下変更量）。結果は `derived/env_retarget_qc.json`。
- 旧 `?stsy=` / `setRootYOffset` は残置（既定0）。
