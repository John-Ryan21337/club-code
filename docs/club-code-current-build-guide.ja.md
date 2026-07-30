# Club Code 現行ビルド案内

この案内は、現在の Club Code repository source に実装されている利用者向け機能を
説明します。特定の installer、GitHub branch、pull request が公開済みだと証明する文書では
ありません。source の status と残る release gate は project plan で別に管理します。

アルファ版に関する注意

Club Code は現在テスト中のアルファ版ソフトウェアです。信頼性、特定目的への適合性、
無停止動作などについて、いかなる保証または表明も行いません。利用者ご自身の責任で使用し、
重要なデータはバックアップし、重要な結果は確認してください。

> [!CAUTION]
> **Auto Nudge は実際のお金を短時間で消費する可能性があります。** 自動 follow-up
> は毎回、本物の provider request です。token、credit、quota、従量課金を急速に
> 消費する場合があります。provider の請求は利用者自身の責任であり、Club Code の
> maintainers はその費用を補償または負担できません。round 上限を小さく
> 設定し、その thread 専用の慎重な prompt または skill を用意し、離席中も phone
> Web UI などで監視してください。夜間に無人で実行する場合は、費用上の危険を理解し
> 受け入れた場合に限ってください。

ここからは歌舞伎町の二軒目テンションでご案内しまぁす🥂✨ 英語版は
[Club Code Current-Build Guide](./club-code-current-build-guide.md) ね。

## Cafe Code から何が変わったの？　伝票はこちらです🍾

Club Code は Cafe Code の coding-agent chat を土台にして、local-first desktop、
安全柵つき automation、仕事の見える化、media、そして「照明ちょっと盛っていい？」
を足した build。chat が主役で、terminal drawer や偽 VS Code を店内に増築は
してません。席が狭くなるからね、解散〜😂

| 分野                | 現行 Club Code に入っていること                                                                                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 看板と互換性        | 表では **Club Code**。でも `cafe-code`、`@cafecode/*`、`CAFE_CODE_*`、protocol、data path は互換性のため残す。看板を替えて常連さんのボトル札まで捨てる事故はしません🙅‍♀️                                                                                                    |
| Provider            | Codex、Claude、OpenCode に加えて、別枠の **LM Studio Local**。Cafe Code の Codex 0.146 protocol 対応も取り込み済み。local chat model は main composer の model picker に出るよ🤖                                                                                          |
| Prompt 操作         | thread ごとの draft 復元、見える follow-up queue、対応 provider の **Steer**、durable FIFO、画像と bounded `.txt`、camera preview・前後切替・撮り直し・system camera fallback 📸                                                                                          |
| Auto Nudge          | thread ごとの mode、編集できる standing-order、round cap、foreground または opt-in background、minimize、thread ごとの Stop と既知の接続 thread 向け Emergency Stop、普通の history に残る message。server が受理した operator work が先。ここ超重要⚠️                    |
| Atmosphere          | 全画面 snow/rain/Matrix、日英 mix、2ch glyph、fixed/rainbow/stream別 rainbow/music reactive、shimmer、live-work word、Flat/Forward/Reverse/Warp/Walk Forward/Walk Reverse。Matrix Walk はランダムな位置から設定した距離だけ落下し、中心から外向きの wind も調整できる🌧️🌈 |
| Mobile presentation | composer 横の touch-size toggle で、その renderer だけ Desktop / Mobile optimized を切替。Mobile は今の見た目を壊さず Matrix を on、Desktop に戻しても Matrix は消さない。スマホが店の desktop まで着替えさせる事故なし📱👗                                               |
| 世界時計とお天気    | 透明で move/resize/collapse できる multi-city clock。rainbow shimmer、amber nixie、analog、old-school LED。weather は別の local opt-in で default off。勝手な天気通信、出禁です🕰️🌦️                                                                                       |
| Activity line       | provider が本当に報告した network/database/build/agent delegation だけを route、packet、trail、endpoint で表示。safe な reported filename は bounded live-work vocabulary にだけ使える。prompt、command、SQL、secret、妄想 traffic は混ぜない。盛るのはラメだけ✨         |
| Ambient media       | YouTube、Spotify、direct local media、desktop VLC、画像/GIF、bounded directory cycle、floating/custom/Theater/Cinema、adaptive glow、Spectrum と 395 preset の MilkDrop/Butterchurn visualizer 🎬🎶                                                                       |
| YouTube list        | Japanese、EDM、K-pop の三本を one-click 選択。同じ filename の再 import はその browser の list を置換、新しい filename なら追加。embed 不可や unavailable は bounded pass 内で skip。入店拒否の一人で店ごと閉めない方式💃                                                 |
| Project Resources   | 透明で move/resize/collapse できる panel。host CPU/RAM/network、project disk、GPU/VRAM、host が出せる measured temperature を Matrix 色 graph で表示 📈                                                                                                                   |
| Observatory         | provider-reported Workflow と read-only Workspace。project tree、bounded text、SQLite table、verified file focus、最大八 pane。file/database を編集せず、勝手に model context にも入れない。見る専のお客様です👀                                                          |
| Supervised browser  | temporary sandbox tab、assisted action ごとの native approval、exact origin/thread/provider に縛った Codex/Claude grant。sensitive field は prompt と routine log に入れない。身分証チェック厳しめ🔐                                                                      |
| Usage と通知        | provider-reported usage/paid state、advisory Model Pacing、cache/compaction counter、Ultra Caching handoff、privacy-safe completion sound と固定の日英 speech。架空の「token saved 億万長者」はやらない💸                                                                 |
| Personalization     | local settings profile、Club Code first-run presentation、対応 desktop の whole-window opacity、動作を止めず presentation だけ隠す Meeting Privacy。昼用 profile と夜用 profile、はい優勝🏆                                                                               |
| Connection          | LAN Web UI と、到達可能な Cafe Code/Club Code server への saved direct connection。project/thread/provider/subscription は選択 server ごと。スマホから見張り番もできる📱                                                                                                  |
| Desktop workflow    | thread の project 間 move、Recycle Bin/restore/permanent delete、external editor 選択、real path open、source/package update check、provider/session/checkpoint lifecycle hardening。地味だけどこういう子が一番仕事できる👏                                               |

## Auto Nudge、酔って押す前にここ読んでね⚠️

Auto Nudge は **時間で発火しません。完了 event で発火します**。ここ、赤ペン三本。

1. その exact thread で provider が新しい completed turn を報告する。
2. その thread で受理された operator follow-up が FIFO 順に全部終わる。
3. provider、transport、approval、user input、draft、cap などの safety gate が全部 OK。
4. dispatch の直前に safety gate をもう一回ぜんぶ確認。
5. その completed turn は一回だけ消費。次の nudge には、次の completed-turn identity が必要。

nudge timer、countdown、経過時間による run 上限、定期 dispatch はありません。
idle の時計だけ眺めても provider request は生えない。**壁時計に token を飲ませない**、
それなです🫡

built-in の入口も plan-driven に更新済み。**Steady Progress** は今の context をそのまま
引き継ぎ、handoff / plan / canon / PR を照合して、次に検証できる slice へ最大二 lane。
**Hardcore Fanout** は重複しない bounded lane を一人一担当で回し、repository gate と
必要な independent audit で合流します。actionable status と dependency は Linear、
durable decision と research は Notion、同じ内容を両方へコピペしない。完了・block・
new authority 必要などの stop condition も prompt 内に入っています。そこから保存済み
thread ごとに prompt を編集できます。A thread の standing order が project 全体や
B thread に化けることはありません。伝票は席ごと、これ歌舞伎町の基本〜🍾

background continuation も exact thread ごとの opt-in。Settings や別 chat を見ていても
controller を維持します。複数 renderer が同じ completion を見ても、exact environment server が
command を直列化し、正しい revision/turn の消費を一回だけ許可。初期 cap は
5 rounds、設定できる硬い範囲は 1–20 rounds。

control は最初から minimize で、collapsed bar は chat manuscript の幅だけ。Off は赤、On は
緑、exact-thread background continuation 付き On は cyan/green の animation。collapse は
見た目だけ変え、enabled policy を止めません。小さくても営業中ならランプは正直〜🚥

server が operator follow-up を受理した後は、その exact-thread FIFO と provider work が
Auto Nudge を止めます。ただし未送信 draft は renderer-local。dispatch する renderer は自分の
exact-thread draft を確認するけど、別 device で入力中・送信前の意図は server から見えないので
予約できません。Emergency Stop も browser/host の durable suppression と、既知の接続 thread
への Stop request で成り立ちます。無関係な別 machine へ自動共有される server-global signal
ではありません。ここは魔法のテレパシー、未実装です📵

安全に使うコツ、ガチでこれ👇

- round cap は小さく。最初から満卓にしない。
- exact-thread prompt に objective、stop condition、verification、scope を書く。用途別の
  小さな skill にするのも有効。でも skill は無料券ではないよ。
- **Steady progress** は bounded continuation 向き。hardcore fan-out は並列調査が本当に必要で、
  その請求を見張れる時だけ。シャンパンタワー感覚で agent tower しない🥂
- visible な background round count、普通の chat history、provider usage を見る。離席中は LAN Web UI を phone で確認。
  「たぶん大丈夫」は SNS なら可愛い、請求では怖い😇
- 一席だけなら **Stop this thread**、全部なら **Emergency Stop all**。ただし provider が
  すでに受理した request は取り消せません。
- overnight unattended は、必要性・prompt・cap・費用リスクを確認した時だけ。
  寝落ちは仕様ではありません🌙

## Provider と local model 🤖

### LM Studio Local は OpenCode じゃないよ

**Settings > Providers** の **LM Studio Local** を選びます。Club Code は別の Codex OSS
app-server instance を起動し、LM Studio の OpenAI-compatible `/v1/models` から callable
chat model を見つけます。embedding-only model は除外。cloud Codex と混ぜず、refresh 後に
main composer の model picker へ表示。別会計です、安心して〜💁‍♀️

default endpoint:

```text
http://127.0.0.1:1234/v1
```

`http://192.168.1.50:1234/v1` のような literal private/LAN address または HTTPS も利用可能。
plain HTTP hostname、public IP、credential 入り URL、query、API でない path は拒否します。
先に LM Studio server を起動して chat model を load、または JIT loading を有効にしてから
Club Code の status を refresh してね。

現在の Codex 内蔵 LM Studio route には bearer-token hook がないため、LM Studio の
**Require Authentication** が on だと接続できません。unauthenticated endpoint は loopback
か firewall/VPN で守られた trusted private network 限定。public internet へ直出し禁止。
plain HTTP は暗号化もされません。ここは冗談なし、戸締まり案件です🔒

### Usage 周りも盛らずに正直会計

- Usage は provider が出した fact だけ。unavailable/stale もそのまま表示。
- Model Pacing は allowance・reset までの時間・reserve を比較する advisory。勝手に model
  change しない。
- cache read、cache write、output、observed compaction は別 counter。足して架空の
  “tokens saved” にしない。伝票マジック禁止🧾
- Completion alert は同じ turn の completion でだけ鳴る。prompt、answer、path、project
  content は読み上げない。ずっと喋るのはあたしだけ〜😂

## Queue、attachment、camera 📸

provider が running 中に送った follow-up は exact-thread queue に見える形で入り、FIFO を
守ります。queue head は provider が本当に live steer 対応なら **Steer**、そうでなければ
ready 後の次 turn まで待機。server が受理した operator queue は Auto Nudge より先。
別 device の未送信 draft や、まだ server に届いていない submission は durable FIFO では
ありません。人間のお客様の伝票も、受理前は店から見えないの〜🙌

paperclip は画像と bounded plain `.txt` に対応。.txt は composer に見える形で decode され、
謎の binary upload tunnel にはなりません。

paperclip 横の camera icon は secure camera context なら live preview を開きます。audio は
要求せず video だけ。rear camera 優先、front/rear 切替、retake、bounded JPEG attach、
close 時 media track stop。mobile browser では system camera fallback も使えます。

phone の camera は通常、phone が信頼する certificate の HTTPS が必要。loopback は browser
の特例があるけど、普通の LAN HTTP address は secure camera context にならない場合が多いです。
最後に送れるかは provider/model の image 対応次第。カメラ許可だけで model に千里眼は
生えません👁️

## Matrix、media、Project Resources ✨

### Atmosphere の席

- snow/rain/Matrix は optional、pointer-transparent。
- Flat/Forward/Reverse/Warp の Matrix base font は 1–72 px。
- Walk の start/end は 1–144 px、1 px step。depth と position は連続補間しつつ、font cache
  は whole-pixel で local 負荷を抑える。0.01 刻みで PC を筋トレさせる会は終了〜🏋️‍♀️
- perspective ratio は bounded line/trail/packet/pulse/telemetry にも反映。near endpoint は
  flare、Warp は center plane へ細くなる。
- Cinema video 上の falling effect は別 opt-in、default off。provider activity connector は
  player の後ろに残す。
- reduced motion では travel animation を外し、使える static presentation だけ残す。

composer 横の 44 px toggle は、今見ている renderer を **Mobile optimized** または
responsive **Desktop** に着替えさせます。wide desktop でも mobile sidebar、run context、
chat padding、right panel を compact に並べ替え。UI を双子にして保守地獄、みたいな
深夜テンション実装はしてません😂 narrow phone は override を書かなくても普通に responsive。

Mobile optimized を明示的に on にすると falling layer と Matrix も on。ただし color、
shimmer、density、speed、font、perspective、activity line の保存値はそのまま。Desktop に
戻す時は layout override だけ外すので、Matrix は operator が別に off にするまで残ります。
この choice は browser/Desktop renderer local。phone が離席中の desktop を勝手に
「スマホ服」に着替えさせない、席ごとのロッカー方式です📱🔐🖥️

### 世界時計と optional weather の席 🌃🕰️

default off の世界時計は、1〜6 の curated city を explicit IANA timezone で表示。style は
**Rainbow shimmer**、**Amber nixie tubes**、**Transparent analog**、
**Old-school LED**。move、resize、collapse、keyboard 操作ができ、狭い viewport から
家出しないよう clamp。collapse/hidden 中は clock tick と Matrix color subscription を
止め、reduced motion では飾り shimmer を凍らせます。時計まで休憩上手、見習いたい〜😴

clock の on/off、style、city は local settings profile に保存可能。panel geometry は
renderer ごと。weather は別の renderer-local consent で default off、profile からは除外。
つまり「夜用 profile 読んだら全端末が突然お天気 API 営業開始」はありません。怖すぎ草🌱

weather を on にした renderer だけが、選択 catalog city の coordinates と HTTPS 接続上の
network IP を Open-Meteo に直接送ります。prompt、project、provider、account、workspace
data は送りません。batch/cache/timeout/response size/retry を bounded にし、古い値を残す時は
**stale** と表示。Settings の notice と widget attribution から current terms を確認してね。
詳細は [世界時計＆お天気ガイド](./world-clock-weather.ja.md)。伝票の細字こそ読む女、
信用できる〜🍸

### Media の席

YouTube と Spotify は normalized official embed。YouTube player は Settings を開いても
維持されます。ただし browser、owner、region、age、embedding、autoplay、mobile policy は
YouTube/Spotify 側のルール。Club Code が入口で土下座して突破する機能はありません🙇‍♀️

同梱 list:

- [JPMusic.txt](../examples/youtube-url-queues/JPMusic.txt): supplied 77 lines、
  accepted unique 71、duplicate 3、10-character の malformed ID 3。
- [EDMYoutubeList.txt](../examples/youtube-url-queues/EDMYoutubeList.txt): supplied 31、
  accepted 30、malformed ID 1。
- [KPOPList.txt](../examples/youtube-url-queues/KPOPList.txt): supplied 8、全部 accepted。

imported library はその browser/device local。active queue は session-only。同名 import は
replace、別名は option 追加。embed 不可 item は skip します。「一曲ダメ＝全員帰宅」には
しない、営業続行です🎧

direct browser media と desktop VLC queue も session-only。native path は renderer に渡さない。
YouTube/Spotify を visualizer に反応させる時は explicit display-audio share が必要で、
microphone fallback や hidden iframe audio 抽出はなし。盗み聞きしない、えらい👏

### Project Resources の席

panel は move、resize、collapse、restore できる overlay で、chat transcript の layout 自体を
押し下げたり切ったりしません。見た目で重なる時は好きな席へ移動してね。collapsed/hidden 中は
poll を止めます。background/card は transparent、graph color は Matrix の palette、shimmer、
music response に追従。グラフまでドレスコード守ってる💚💙

現在の source は検出した GPU を **GPU 1**、**GPU 2** のように安定した順番で分けて表示。
adapter ごとの utilization、VRAM used/total/free、取れる時だけ実測 core temperature、
bounded history をそれぞれ持ちます。host の報告順が入れ替わってもカード番号は暴れません。

temperature は CPU、GPU、RAM、VRAM、storage、case/ambient、other の各 class で、実測 sensor
の hottest value を表示。値がなければ unavailable。推測して体温計を捏造しません。
Windows の non-GPU temperature は Libre Hardware Monitor または Open Hardware Monitor が
WMI に出した sensor が必要。NVIDIA GPU core は `nvidia-smi` から取れる場合があります。
Linux は対応する `/sys/class/hwmon`。hardware、driver、firmware、sensor software 次第で
空欄は普通にあります。「-- °C」は壊れた占いじゃなく、証拠なしの正直表示🔍

## Settings profile、保存、privacy 👜

Settings profile は local presentation preset。theme、Atmosphere/Matrix、media presentation、
Mobile optimized/Desktop、世界時計の見た目と city、completion alert、UI layout など
allowlist された client preference を保存・切替できます。最大 32 profiles、その
browser/desktop client の bounded local storage。同名 save は local profile を置換し、
active profile は restart 後も残ります。Mobile と Desktop を着替えるの、一クリック。
衣装チェンジ早い子は売れます👗✨

ただし provider account/credential/endpoint、server exposure、repository/project path、
Model Pacing、exact-thread Auto Nudge authority は profile に入れません。renderer-local の
weather consent も除外し、profile load だけで third-party 通信を始めない。presentation の
衣装と実行権限・network consent の金庫を同じバッグに入れない。大人の分離です。

Meeting Privacy は選んだ project/thread を presentation surface から local に隠します。
hidden work は接続されたまま動けます。access control や process stop ではないので、
「見えない＝止まった」ではありません。ステルス出勤みたいなもの、知らんけど🥷

validated ambient image/GIF は local server store に persist。Local/VLC queue、YouTube `.txt`
queue、display audio、browser grant、camera stream は session scope。Workflow/Workspace は
read-only で provider context に勝手に混ざりません。

## LAN と phone Web UI 📱

desktop settings で LAN/network access を enable、host firewall で表示 port を許可し、
phone から host PC の private LAN address を開きます。packaged default:

- HTTPS/WSS: `3775/tcp`
- HTTP/WS fallback と certificate bootstrap: `3773/tcp`

Web UI でも browser capability があれば Matrix、shimmer、activity overlay は表示されます。
background tab、reduced-motion preference、device performance、mobile media policy により
effect が弱くなったり pause したりはします。スマホにもネオン、でも battery と browser が
店長です🔋

composer toggle は LAN Web UI にも表示。phone renderer だけ Mobile optimized にして、
机に置いた desktop renderer は Desktop のまま。世界時計も Web UI で動くけど、weather は
その renderer で別途 opt-in。遠隔で勝手に傘を配るサービスではありません☂️😂

Club Code は VPN、SSH tunnel、trusted certificate、firewall rule を勝手に作りません。
browser credential は session scope、desktop の saved-server credential は Electron safe
storage。backend を public internet に直出ししないでね。住所をSNS全公開は草じゃ済まない🙅‍♀️

## 現行 build の境界、最後にお会計です🧾

- activity line は provider evidence が来た分だけ。来ない event を発明しない。
- 検出 GPU は一枚ずつ utilization、VRAM、temperature、history を表示。sensor がなければ
  正直に unavailable。
- temperature は実 sensor と対応 software 次第。
- YouTube/Spotify の embed、login、DRM、autoplay policy は各 service が決める。
- LAN camera は browser が信頼する secure context 次第。
- Mobile/Desktop choice は renderer-local。Matrix の見た目は独立した保存設定。
- weather は optional third-party network。profile や別 renderer から勝手に on にならない。
- LM Studio は外部 software。network 利用は trusted private boundary が必要。
- Auto Nudge の completion gate と cap は危険を減らすけど、provider call を無料にはしない。

はい、未実装の夢は一個も伝票に載せてません。現行 source で確認できるものだけです🥂
